package auth

import (
	"context"
	"sort"
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
	// weeklyResetAt is zero when the weekly reset is unknown or the window is idle.
	weeklyResetAt time.Time
	shortUsed     float64
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
	candidates := make([]resetFirstCandidate, 0, len(available))
	best := resetFirstWeeklyExhausted
	for _, auth := range available {
		candidate := classifyResetFirstCandidate(auth, resetFirstUpstreamModel(ctx, auth.ID, model), now, maxShort)
		best = min(best, candidate.tier)
		candidates = append(candidates, candidate)
	}
	tier := make([]resetFirstCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.tier == best {
			tier = append(tier, candidate)
		}
	}

	var picked *Auth
	switch best {
	case resetFirstReady:
		picked = earliestWeeklyReset(tier)
		if picked == nil {
			unknown := make([]*Auth, 0, len(tier))
			for _, candidate := range tier {
				unknown = append(unknown, candidate.auth)
			}
			return s.unknown.Pick(ctx, provider, model, opts, unknown)
		}
	case resetFirstShortLimited:
		sort.SliceStable(tier, func(i, j int) bool { return tier[i].shortUsed < tier[j].shortUsed })
		picked = tier[0].auth
	default:
		picked = earliestWeeklyReset(tier)
		if picked == nil {
			picked = tier[0].auth
		}
	}
	selectorLogEntry(ctx).Debugf("reset-first: picked auth=%s tier=%d provider=%s model=%s", picked.ID, best, provider, model)
	return picked, nil
}

// earliestWeeklyReset returns the candidate whose weekly window resets first,
// or nil when no candidate has a known reset. Candidates arrive ID-sorted, so
// ties resolve deterministically.
func earliestWeeklyReset(candidates []resetFirstCandidate) *Auth {
	var picked *resetFirstCandidate
	for i := range candidates {
		candidate := &candidates[i]
		if candidate.weeklyResetAt.IsZero() {
			continue
		}
		if picked == nil || candidate.weeklyResetAt.Before(picked.weeklyResetAt) {
			picked = candidate
		}
	}
	if picked == nil {
		return nil
	}
	return picked.auth
}

func classifyResetFirstCandidate(auth *Auth, upstreamModel string, now time.Time, maxShort float64) resetFirstCandidate {
	windows := auth.QuotaWindows.Effective(now)
	candidate := resetFirstCandidate{auth: auth}
	weekly := windows.Weekly
	if isFableModel(upstreamModel) {
		// Fable has its own weekly limit and still draws on the shared windows.
		if quotaWindowExhausted(weekly) {
			candidate.tier = resetFirstWeeklyExhausted
			return candidate
		}
		weekly = windows.FableWeekly
	}
	if weekly.State == QuotaWindowActive && !weekly.ResetAt.IsZero() {
		candidate.weeklyResetAt = weekly.ResetAt
	}
	if quotaWindowExhausted(weekly) {
		candidate.tier = resetFirstWeeklyExhausted
		return candidate
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
