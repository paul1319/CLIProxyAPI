package management

import (
	"context"
	"strings"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/quota"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

// quotaPollTick is how often the poller looks for stale usage. The quota
// service only contacts a provider once its snapshot is older than
// quota.UsageInterval, so the tick bounds reaction time, not request volume.
const quotaPollTick = time.Minute

// StartQuotaPolling keeps Claude and Codex usage fresh while reset-first
// routing is configured, so routing does not depend on an open management
// page. Calling it again is a no-op.
func (h *Handler) StartQuotaPolling() {
	if h == nil {
		return
	}
	h.quotaMu.Lock()
	if h.quotaPollCancel != nil {
		h.quotaMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	h.quotaPollCancel, h.quotaPollDone = cancel, done
	h.quotaMu.Unlock()
	go func() {
		defer close(done)
		ticker := time.NewTicker(quotaPollTick)
		defer ticker.Stop()
		for {
			h.pollQuotaWindows(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// stopQuotaPolling cancels the poller and waits for in-flight observations.
func (h *Handler) stopQuotaPolling() {
	h.quotaMu.Lock()
	cancel, done := h.quotaPollCancel, h.quotaPollDone
	h.quotaMu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	<-done
	h.quotaPollWorkers.Wait()
}

func (h *Handler) pollQuotaWindows(ctx context.Context) {
	h.mu.Lock()
	manager := h.authManager
	enabled := h.cfg != nil && h.cfg.Routing.UsesResetFirst()
	h.mu.Unlock()
	if !enabled || manager == nil || ctx.Err() != nil {
		return
	}
	h.reconcileQuotaObservations()
	for _, auth := range manager.List() {
		if !quotaPollable(auth) || !h.claimQuotaPoll(auth.ID) {
			continue
		}
		// One observation per credential at a time: a request that never
		// returns must not pile up goroutines on later ticks.
		h.quotaPollWorkers.Go(func() {
			defer h.releaseQuotaPoll(auth.ID)
			h.observeQuotaWindows(ctx, auth)
		})
	}
}

// quotaPollable limits polling to subscription accounts whose usage windows
// drive reset-first routing.
func quotaPollable(auth *coreauth.Auth) bool {
	if auth == nil || auth.Disabled || auth.Status == coreauth.StatusDisabled || auth.AuthKind() != coreauth.AuthKindOAuth {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(auth.Provider)) {
	case "claude", "codex":
		return true
	default:
		return false
	}
}

func (h *Handler) claimQuotaPoll(authID string) bool {
	h.quotaMu.Lock()
	defer h.quotaMu.Unlock()
	if _, busy := h.quotaPollInFlight[authID]; busy {
		return false
	}
	if h.quotaPollInFlight == nil {
		h.quotaPollInFlight = make(map[string]struct{})
	}
	h.quotaPollInFlight[authID] = struct{}{}
	return true
}

func (h *Handler) releaseQuotaPoll(authID string) {
	h.quotaMu.Lock()
	delete(h.quotaPollInFlight, authID)
	h.quotaMu.Unlock()
}

func (h *Handler) observeQuotaWindows(ctx context.Context, auth *coreauth.Auth) {
	resource, errResource := quota.ProviderResource(h.quotaCredential(auth, ""), "usage")
	if errResource != nil {
		return
	}
	identity := quotaCredentialIdentity(auth)
	snapshot, errObserve := h.quotaService().Observe(ctx, quota.Request{
		Identity: identity, Resource: "usage", Interval: resource.Interval, Credential: quotaCredentialVersion(auth),
		Current: func() bool { return h.quotaCredentialCurrent(auth.ID, identity) },
		Fetch:   resource.Fetch,
	})
	if errObserve != nil {
		return
	}
	h.applyQuotaWindows(auth.ID, auth.Provider, identity, snapshot)
}

func (h *Handler) quotaCredentialCurrent(authID string, identity quota.Identity) bool {
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	if manager == nil {
		return false
	}
	current, ok := manager.GetByID(authID)
	return ok && !current.Disabled && quotaCredentialIdentity(current) == identity
}

// applyQuotaWindows hands a usage snapshot to routing. The identity check runs
// under the manager lock, so a credential replaced while the snapshot was in
// flight never receives another account's windows.
func (h *Handler) applyQuotaWindows(authID, provider string, identity quota.Identity, snapshot quota.Snapshot) {
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	if manager == nil || len(snapshot.Body) == 0 {
		return
	}
	windows := coreauth.ParseQuotaUsageWindows(provider, snapshot.Body, snapshot.ObservedAt)
	manager.ApplyQuotaWindows(authID, windows, func(current *coreauth.Auth) bool {
		return !current.Disabled && quotaCredentialIdentity(current) == identity
	})
}
