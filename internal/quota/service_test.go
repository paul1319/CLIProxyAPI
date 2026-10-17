package quota

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestServiceObservations(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	service, errNew := New(nil, func() time.Time { return now })
	if errNew != nil {
		t.Fatal(errNew)
	}
	t.Cleanup(service.Close)
	calls := 0
	failing := false
	req := Request{Identity: Identity{AuthID: "a", Fingerprint: "account-a"}, Resource: "usage", Interval: UsageInterval,
		Fetch: func(context.Context) (json.RawMessage, error) {
			calls++
			if failing {
				return nil, &FetchError{Status: 429, RetryAt: now.Add(time.Minute)}
			}
			return json.RawMessage(`{"remaining":42}`), nil
		},
	}
	observe := func(request Request) Snapshot {
		t.Helper()
		result, errObserve := service.Observe(t.Context(), request)
		if errObserve != nil {
			t.Fatal(errObserve)
		}
		return result
	}
	cached := req
	cached.CachedOnly = true
	if len(observe(cached).Body) != 0 || calls != 0 {
		t.Fatal("cached reads must not contact the provider")
	}
	first := observe(req)
	if string(first.Body) != `{"remaining":42}` || first.Stale || calls != 1 {
		t.Fatalf("first observation: %+v, calls %d", first, calls)
	}
	first.Body[0] = 'x'
	now = now.Add(14 * time.Second)
	if string(observe(req).Body) != `{"remaining":42}` || calls != 1 {
		t.Fatal("fresh cache was not reused or was mutated by a caller")
	}
	now = now.Add(time.Second)
	failing = true
	failed := observe(req)
	if calls != 2 || string(failed.Body) != `{"remaining":42}` || !failed.Stale || failed.Status != 429 || !failed.ObservedAt.Equal(first.ObservedAt) {
		t.Fatalf("failure erased a successful observation: %+v, calls %d", failed, calls)
	}
	req.Force = true
	now = now.Add(59 * time.Second)
	observe(req)
	if calls != 2 {
		t.Fatal("manual refresh bypassed Retry-After")
	}
	now = now.Add(time.Second)
	failing = false
	recovered := observe(req)
	if calls != 3 || recovered.Stale || recovered.Status != 0 || !recovered.RetryAt.IsZero() {
		t.Fatal("refresh did not recover after Retry-After")
	}
	other := req
	other.Identity.Fingerprint = "account-b"
	other.CachedOnly = true
	if len(observe(other).Body) != 0 {
		t.Fatal("replacement credential restored another account's data")
	}
	if len(service.records) != 0 {
		t.Fatal("old account observations were not removed")
	}
}

func TestServiceSharesConcurrentRefreshAndCancelsReplacedCredential(t *testing.T) {
	service, _ := New(nil, nil)
	t.Cleanup(service.Close)
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	var current atomic.Bool
	current.Store(true)
	req := Request{Identity: Identity{AuthID: "a", Fingerprint: "a"}, Resource: "usage", Interval: UsageInterval,
		Current: current.Load,
		Fetch: func(context.Context) (json.RawMessage, error) {
			if calls.Add(1) == 1 {
				close(entered)
			}
			<-release
			return json.RawMessage(`{"used":1}`), nil
		},
	}
	var workers sync.WaitGroup
	for range 20 {
		workers.Go(func() {
			_, errObserve := service.Observe(t.Context(), req)
			if errObserve != nil {
				t.Errorf("observe: %v", errObserve)
			}
		})
	}
	<-entered
	close(release)
	workers.Wait()
	if calls.Load() != 1 {
		t.Fatalf("concurrent callers made %d provider requests", calls.Load())
	}
	entered, release = make(chan struct{}), make(chan struct{})
	calls.Store(0)
	req.Force = true
	finished := make(chan error, 1)
	go func() { _, errObserve := service.Observe(t.Context(), req); finished <- errObserve }()
	<-entered
	current.Store(false)
	service.Retain(map[string]bool{})
	close(release)
	if errObserve := <-finished; errObserve == nil {
		t.Fatal("replaced credential accepted an in-flight result")
	}
	if len(service.records) != 0 {
		t.Fatal("in-flight result recreated deleted observations")
	}
}

func TestServiceResourceIntervalsAndShutdown(t *testing.T) {
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	service, _ := New(nil, func() time.Time { return now })
	t.Cleanup(service.Close)
	calls := map[string]int{}
	request := func(resource string, interval time.Duration) Request {
		return Request{Identity: Identity{AuthID: "a", Fingerprint: "a"}, Resource: resource, Interval: interval,
			Fetch: func(context.Context) (json.RawMessage, error) {
				calls[resource]++
				return json.RawMessage(`{"value":1}`), nil
			},
		}
	}
	for _, name := range []string{"usage", "profile", "reset_credits"} {
		interval := map[string]time.Duration{"usage": UsageInterval, "profile": time.Hour, "reset_credits": 10 * time.Minute}[name]
		if _, errObserve := service.Observe(t.Context(), request(name, interval)); errObserve != nil {
			t.Fatal(errObserve)
		}
	}
	now = now.Add(UsageInterval)
	for _, name := range []string{"usage", "profile", "reset_credits"} {
		interval := map[string]time.Duration{"usage": UsageInterval, "profile": time.Hour, "reset_credits": 10 * time.Minute}[name]
		if _, errObserve := service.Observe(t.Context(), request(name, interval)); errObserve != nil {
			t.Fatal(errObserve)
		}
	}
	if calls["usage"] != 2 || calls["profile"] != 1 || calls["reset_credits"] != 1 {
		t.Fatalf("resource intervals not respected: %v", calls)
	}
	entered := make(chan struct{})
	req := request("blocking", UsageInterval)
	req.Fetch = func(ctx context.Context) (json.RawMessage, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	finished := make(chan error, 1)
	go func() { _, errObserve := service.Observe(t.Context(), req); finished <- errObserve }()
	<-entered
	service.Close()
	<-finished
	if _, errObserve := service.Observe(t.Context(), req); !errors.Is(errObserve, context.Canceled) {
		t.Fatalf("closed service: %v", errObserve)
	}
}
