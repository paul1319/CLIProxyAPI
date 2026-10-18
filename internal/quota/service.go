// Package quota owns management quota observations, independently of routing cooldowns.
package quota

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"sync"
	"time"
)

const UsageInterval = 300 * time.Second

// Identity uses stable account claims when available; opaque credentials use a token fingerprint.
type Identity struct {
	AuthID      string `json:"auth_id"`
	Fingerprint string `json:"fingerprint"`
}

// Record contains only allowlisted provider data. Tokens and upstream errors never belong here.
type Record struct {
	Identity   Identity        `json:"identity"`
	Resource   string          `json:"resource"`
	Body       json.RawMessage `json:"body,omitempty"`
	ObservedAt time.Time       `json:"observed_at,omitzero"`
	AttemptAt  time.Time       `json:"attempt_at,omitzero"`
	RetryAt    time.Time       `json:"retry_at,omitzero"`
	Status     int             `json:"status,omitzero"`
	Failures   int             `json:"failures,omitzero"`
}

type Snapshot struct {
	Record
	Stale            bool `json:"stale"`
	PersistenceError bool `json:"persistence_error,omitzero"`
}

type Store interface {
	Load() (map[string]Record, error)
	Save(map[string]Record) error
}

// FetchError deliberately excludes the response body, which can contain secrets.
type FetchError struct {
	Status  int
	RetryAt time.Time
}

func (e *FetchError) Error() string { return "quota observation failed" }

type Request struct {
	Identity   Identity
	Resource   string
	Interval   time.Duration
	CachedOnly bool
	Force      bool
	Current    func() bool
	Fetch      func(context.Context) (json.RawMessage, error)
}

type flight struct{ done chan struct{} }

// Service shares refreshes across callers and preserves successful data on failures.
type Service struct {
	mu       sync.Mutex
	writeMu  sync.Mutex
	records  map[string]Record
	inFlight map[string]*flight
	owners   map[string]Identity
	store    Store
	now      func() time.Time
	ctx      context.Context
	cancel   context.CancelFunc
	workers  sync.WaitGroup
	slots    chan struct{}
	closed   bool
	persist  bool
}

func New(store Store, now func() time.Time) (*Service, error) {
	if now == nil {
		now = time.Now
	}
	ctx, cancel := context.WithCancel(context.Background())
	s := &Service{
		records: make(map[string]Record), inFlight: make(map[string]*flight), owners: make(map[string]Identity),
		store: store, now: now, ctx: ctx, cancel: cancel, slots: make(chan struct{}, 3),
	}
	if store != nil {
		records, errLoad := store.Load()
		if errLoad != nil {
			s.persist = true
			return s, errLoad
		}
		if records != nil {
			s.records = records
		}
	}
	return s, nil
}

func recordKey(id Identity, resource string) string {
	return id.AuthID + "\x00" + id.Fingerprint + "\x00" + resource
}

func (s *Service) snapshotLocked(key string, interval time.Duration) Snapshot {
	r := s.records[key]
	r.Body = append(json.RawMessage(nil), r.Body...)
	return Snapshot{Record: r, Stale: r.ObservedAt.IsZero() || !s.now().Before(r.ObservedAt.Add(interval)) || r.Status != 0, PersistenceError: s.persist}
}

func (s *Service) Observe(ctx context.Context, req Request) (Snapshot, error) {
	if errContext := ctx.Err(); errContext != nil {
		return Snapshot{}, errContext
	}
	if req.Current != nil && !req.Current() {
		return Snapshot{}, errors.New("quota credential changed")
	}
	key := recordKey(req.Identity, req.Resource)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Snapshot{}, context.Canceled
	}
	// Reusing a physical credential ID must never restore another account's values.
	s.owners[req.Identity.AuthID] = req.Identity
	changed := false
	for previousKey, previous := range s.records {
		if previous.Identity.AuthID == req.Identity.AuthID && previous.Identity != req.Identity {
			delete(s.records, previousKey)
			changed = true
		}
	}
	result := s.snapshotLocked(key, req.Interval)
	if req.CachedOnly || (!req.Force && !result.Stale) || s.now().Before(result.RetryAt) {
		s.mu.Unlock()
		if changed {
			s.save()
		}
		return result, nil
	}
	work := s.inFlight[key]
	if work == nil {
		work = &flight{done: make(chan struct{})}
		s.inFlight[key] = work
		s.workers.Go(func() { s.refresh(key, req, work) })
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return Snapshot{}, ctx.Err()
	case <-work.done:
	}
	if req.Current != nil && !req.Current() {
		return Snapshot{}, errors.New("quota credential changed")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked(key, req.Interval), nil
}

func (s *Service) refresh(key string, req Request, work *flight) {
	defer func() {
		s.mu.Lock()
		delete(s.inFlight, key)
		close(work.done)
		s.mu.Unlock()
	}()
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-s.ctx.Done():
		return
	}
	if req.Current != nil && !req.Current() {
		return
	}
	body, errFetch := req.Fetch(s.ctx)
	if s.ctx.Err() != nil || (req.Current != nil && !req.Current()) {
		return
	}
	s.mu.Lock()
	if s.owners[req.Identity.AuthID] != req.Identity {
		s.mu.Unlock()
		return
	}
	r := s.records[key]
	r.Identity, r.Resource, r.AttemptAt = req.Identity, req.Resource, s.now().UTC()
	if errFetch == nil {
		r.Body, r.ObservedAt = append(json.RawMessage(nil), body...), r.AttemptAt
		r.Failures, r.Status, r.RetryAt = 0, 0, time.Time{}
	} else {
		r.Failures++
		r.Status = 502
		backoff := min(UsageInterval*time.Duration(1<<min(r.Failures-1, 5)), 5*time.Minute)
		r.RetryAt = r.AttemptAt.Add(backoff)
		if failure, ok := errors.AsType[*FetchError](errFetch); ok {
			r.Status = failure.Status
			if failure.Status == 401 || failure.Status == 403 {
				r.RetryAt = r.AttemptAt.Add(15 * time.Minute)
			}
			if failure.RetryAt.After(r.RetryAt) {
				r.RetryAt = failure.RetryAt
			}
		}
	}
	s.records[key] = r
	s.mu.Unlock()
	s.save()
}

func (s *Service) save() {
	if s.store == nil {
		return
	}
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	s.mu.Lock()
	records := maps.Clone(s.records)
	s.mu.Unlock()
	errSave := s.store.Save(records)
	s.mu.Lock()
	s.persist = errSave != nil
	s.mu.Unlock()
}

// Retain removes observations for credentials no longer owned by this server.
func (s *Service) Retain(current map[string]bool) {
	s.mu.Lock()
	before := len(s.records)
	maps.DeleteFunc(s.owners, func(authID string, _ Identity) bool { return !current[authID] })
	maps.DeleteFunc(s.records, func(_ string, record Record) bool { return !current[record.Identity.AuthID] })
	changed := before != len(s.records)
	s.mu.Unlock()
	if changed {
		s.save()
	}
}

func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	s.cancel()
	s.mu.Unlock()
	s.workers.Wait()
}
