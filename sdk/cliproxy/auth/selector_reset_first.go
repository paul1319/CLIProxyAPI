package auth

import (
	"context"
	"strings"
	"sync/atomic"
	"time"

	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

// DefaultResetFirstMaxShortUtilization is the five-hour usage, in percent, at
// which a credential stops receiving new sessions while others have headroom.
const DefaultResetFirstMaxShortUtilization = 85

// ResetFirstSelector prefers the credential whose weekly quota resets soonest,
// so subscription quota that would expire unused is consumed first. Behind
// session affinity it only places new sessions and failovers; established
// bindings are never moved.
type ResetFirstSelector struct {
	maxShortUtilization atomic.Int64
	// unknown rotates credentials that have no weekly reset to rank by.
	unknown RoundRobinSelector
	now     func() time.Time
}

// NewResetFirstSelector creates a reset-first selector with the given
// five-hour headroom threshold in percent.
func NewResetFirstSelector(maxShortUtilization int) *ResetFirstSelector {
	selector := &ResetFirstSelector{}
	selector.SetMaxShortUtilization(maxShortUtilization)
	return selector
}

// SetMaxShortUtilization updates the five-hour headroom threshold in place, so
// a configuration change keeps existing session bindings. Values outside
// 1-100 select the default.
func (s *ResetFirstSelector) SetMaxShortUtilization(percent int) {
	if percent < 1 || percent > 100 {
		percent = DefaultResetFirstMaxShortUtilization
	}
	s.maxShortUtilization.Store(int64(percent))
}

// MaxShortUtilization reports the five-hour headroom threshold in percent.
func (s *ResetFirstSelector) MaxShortUtilization() int {
	if percent := s.maxShortUtilization.Load(); percent > 0 {
		return int(percent)
	}
	return DefaultResetFirstMaxShortUtilization
}

// resetFirstTier orders candidates from most to least preferred.
type resetFirstTier int

const (
	// resetFirstReady has weekly quota left and five-hour headroom.
	resetFirstReady resetFirstTier = iota
	// resetFirstShortLimited has weekly quota left but its five-hour window
	// is near or at its limit.
	resetFirstShortLimited
	// resetFirstWeeklyExhausted has used up the applicable weekly quota.
	resetFirstWeeklyExhausted
)

type resetFirstCandidate struct {
	auth *Auth
	tier resetFirstTier
	// resetAt is the weekly reset for ready and short-limited candidates, and
	// the weekly recovery for exhausted ones. Zero means unknown.
	resetAt   time.Time
	shortUsed float64
}

// before reports whether c ranks ahead of other. Candidates arrive sorted by
// ID, so keeping the first of equal candidates breaks ties deterministically.
func (c resetFirstCandidate) before(other resetFirstCandidate) bool {
	if c.tier != other.tier {
		return c.tier < other.tier
	}
	if c.tier == resetFirstShortLimited && c.shortUsed != other.shortUsed {
		return c.shortUsed < other.shortUsed
	}
	return !c.resetAt.IsZero() && (other.resetAt.IsZero() || c.resetAt.Before(other.resetAt))
}

// Pick selects the credential with the soonest weekly reset among those with
// five-hour headroom. Credentials without a known reset rotate after ranked
// ones, so providers without quota windows keep round-robin behavior.
func (s *ResetFirstSelector) Pick(ctx context.Context, provider, model string, opts cliproxyexecutor.Options, auths []*Auth) (*Auth, error) {
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	available, err := getSelectorAvailableAuths(ctx, auths, provider, model, now)
	if err != nil {
		return nil, err
	}
	available = preferCodexWebsocketAuths(ctx, provider, available)

	maxShort := float64(s.MaxShortUtilization())
	var best resetFirstCandidate
	var unranked []*Auth
	for i, auth := range available {
		candidate := classifyResetFirstCandidate(auth, resetFirstUpstreamModel(ctx, auth.ID, model), now, maxShort)
		if candidate.tier == resetFirstReady && candidate.resetAt.IsZero() {
			unranked = append(unranked, auth)
		}
		if i == 0 || candidate.before(best) {
			best = candidate
		}
	}
	if best.tier == resetFirstReady && best.resetAt.IsZero() {
		return s.unknown.Pick(ctx, provider, model, opts, unranked)
	}
	selectorLogEntry(ctx).Debugf("reset-first: picked auth=%s tier=%d provider=%s model=%s", best.auth.ID, best.tier, provider, model)
	return best.auth, nil
}

func classifyResetFirstCandidate(auth *Auth, upstreamModel string, now time.Time, maxShort float64) resetFirstCandidate {
	windows := auth.QuotaWindows.Effective(now)
	candidate := resetFirstCandidate{auth: auth}
	weekly := windows.Weekly
	limits := []QuotaWindow{weekly}
	if isFableModel(upstreamModel) {
		// Fable has its own weekly limit and still draws on the shared one.
		weekly = windows.FableWeekly
		limits = append(limits, weekly)
	}
	exhausted, recoversAt := false, time.Time{}
	for _, limit := range limits {
		if !quotaWindowExhausted(limit) {
			continue
		}
		// The credential recovers when its last exhausted limit resets.
		if !exhausted || (!recoversAt.IsZero() && (limit.ResetAt.IsZero() || limit.ResetAt.After(recoversAt))) {
			recoversAt = limit.ResetAt
		}
		exhausted = true
	}
	if exhausted {
		candidate.tier, candidate.resetAt = resetFirstWeeklyExhausted, recoversAt
		return candidate
	}
	if weekly.State == QuotaWindowActive {
		candidate.resetAt = weekly.ResetAt
	}
	short := windows.Short
	switch {
	case quotaWindowExhausted(short):
		candidate.tier, candidate.shortUsed = resetFirstShortLimited, max(short.UsedPercent, 100)
	case short.UsedKnown && short.UsedPercent >= maxShort:
		candidate.tier, candidate.shortUsed = resetFirstShortLimited, short.UsedPercent
	case short.Warning:
		candidate.tier, candidate.shortUsed = resetFirstShortLimited, maxShort
	}
	return candidate
}

func quotaWindowExhausted(window QuotaWindow) bool {
	return window.Exhausted || (window.UsedKnown && window.UsedPercent >= 100)
}

func isFableModel(model string) bool {
	return strings.Contains(strings.ToLower(model), "fable")
}

type resetFirstUpstreamModelsKey struct{}

// withResetFirstUpstreamModels carries each candidate's resolved upstream
// model, because the selector receives the client route model, which may be
// an alias of a model with its own quota window.
func withResetFirstUpstreamModels(ctx context.Context, models map[string]string) context.Context {
	if len(models) == 0 {
		return ctx
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, resetFirstUpstreamModelsKey{}, models)
}

func resetFirstUpstreamModel(ctx context.Context, authID, routeModel string) string {
	if ctx != nil {
		if models, ok := ctx.Value(resetFirstUpstreamModelsKey{}).(map[string]string); ok {
			if model := models[authID]; model != "" {
				return model
			}
		}
	}
	return routeModel
}

// ResetFirstSelectorOf returns the reset-first selector configured directly
// or as the session affinity fallback, or nil.
func ResetFirstSelectorOf(selector Selector) *ResetFirstSelector {
	switch typed := selector.(type) {
	case *ResetFirstSelector:
		return typed
	case *SessionAffinitySelector:
		if typed == nil {
			return nil
		}
		resetFirst, _ := typed.fallback.(*ResetFirstSelector)
		return resetFirst
	default:
		return nil
	}
}
