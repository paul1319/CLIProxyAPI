package auth

import (
	"context"
	"net/http"
	"strconv"
	"testing"
	"time"

	internallogging "github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
)

var quotaTestNow = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func unixText(at time.Time) string {
	return strconv.FormatInt(at.Unix(), 10)
}

func TestQuotaWindowsFromClaudeHeadersIgnoresOverageWindow(t *testing.T) {
	reset5h, reset7d := quotaTestNow.Add(2*time.Hour), quotaTestNow.Add(3*24*time.Hour)
	// Fixture shape from issue #5915: 7d_oi is the overage-included claim.
	windows := quotaWindowsFromHeaders("claude", http.Header{
		"Anthropic-Ratelimit-Unified-5h-Utilization":       []string{"0.42"},
		"Anthropic-Ratelimit-Unified-5h-Reset":             []string{unixText(reset5h)},
		"Anthropic-Ratelimit-Unified-5h-Status":            []string{"allowed"},
		"Anthropic-Ratelimit-Unified-7d-Utilization":       []string{"0.69"},
		"Anthropic-Ratelimit-Unified-7d-Reset":             []string{unixText(reset7d)},
		"Anthropic-Ratelimit-Unified-7d-Status":            []string{"allowed_warning"},
		"Anthropic-Ratelimit-Unified-7d_oi-Status":         []string{"rejected"},
		"Anthropic-Ratelimit-Unified-7d_oi-Utilization":    []string{"1.02"},
		"Anthropic-Ratelimit-Unified-Representative-Claim": []string{"seven_day_overage_included"},
	}, nil, quotaTestNow)

	if windows.Short.State != QuotaWindowActive || !windows.Short.UsedKnown || windows.Short.UsedPercent != 42 || !windows.Short.ResetAt.Equal(reset5h) {
		t.Fatalf("Short = %+v", windows.Short)
	}
	if windows.Weekly.UsedPercent != 69 || !windows.Weekly.ResetAt.Equal(reset7d) || !windows.Weekly.Warning || windows.Weekly.Exhausted {
		t.Fatalf("Weekly = %+v", windows.Weekly)
	}
	if !windows.FableWeekly.IsZero() {
		t.Fatalf("overage 7d_oi headers leaked into FableWeekly: %+v", windows.FableWeekly)
	}
}

func TestQuotaWindowsFromClaudeHeadersMarksRejectedWindowExhausted(t *testing.T) {
	windows := quotaWindowsFromHeaders("claude", http.Header{
		"Anthropic-Ratelimit-Unified-5h-Status": []string{"rejected"},
		"Anthropic-Ratelimit-Unified-5h-Reset":  []string{unixText(quotaTestNow.Add(time.Hour))},
		// A status without usage or reset carries nothing to rank by.
		"Anthropic-Ratelimit-Unified-7d-Status": []string{"allowed"},
	}, nil, quotaTestNow)
	if !windows.Short.Exhausted || windows.Short.State != QuotaWindowActive {
		t.Fatalf("Short = %+v", windows.Short)
	}
	if !windows.Weekly.IsZero() {
		t.Fatalf("status-only window must stay unobserved: %+v", windows.Weekly)
	}
}

func TestQuotaWindowsFromCodexHeadersClassifiesByLength(t *testing.T) {
	weeklyReset := quotaTestNow.Add(4 * 24 * time.Hour)
	// Plans without a five-hour limit report the weekly window as primary.
	windows := quotaWindowsFromHeaders("codex", http.Header{
		"X-Codex-Primary-Used-Percent":   []string{"51"},
		"X-Codex-Primary-Window-Minutes": []string{"10080"},
		"X-Codex-Primary-Reset-At":       []string{unixText(weeklyReset)},
	}, nil, quotaTestNow)
	if !windows.Short.IsZero() {
		t.Fatalf("weekly primary was classified as short: %+v", windows.Short)
	}
	if windows.Weekly.UsedPercent != 51 || !windows.Weekly.ResetAt.Equal(weeklyReset) {
		t.Fatalf("Weekly = %+v", windows.Weekly)
	}

	windows = quotaWindowsFromHeaders("codex", http.Header{
		"X-Codex-Primary-Used-Percent":          []string{"12"},
		"X-Codex-Primary-Window-Minutes":        []string{"300"},
		"X-Codex-Primary-Reset-After-Seconds":   []string{"600"},
		"X-Codex-Secondary-Used-Percent":        []string{"30"},
		"X-Codex-Secondary-Window-Minutes":      []string{"10080"},
		"X-Codex-Secondary-Reset-After-Seconds": []string{"86400"},
	}, nil, quotaTestNow)
	if !windows.Short.ResetAt.Equal(quotaTestNow.Add(10*time.Minute)) || windows.Short.UsedPercent != 12 {
		t.Fatalf("relative reset must anchor to the observation time: %+v", windows.Short)
	}
	if !windows.Weekly.ResetAt.Equal(quotaTestNow.Add(24*time.Hour)) || windows.Weekly.UsedPercent != 30 {
		t.Fatalf("Weekly = %+v", windows.Weekly)
	}
}

func TestQuotaWindowsFromLegacyCodexHeadersFallsBackToOrder(t *testing.T) {
	windows := quotaWindowsFromHeaders("codex", http.Header{
		"X-Codex-Primary-Used-Percent":   []string{"5"},
		"X-Codex-Secondary-Used-Percent": []string{"7"},
	}, nil, quotaTestNow)
	if windows.Short.UsedPercent != 5 || windows.Weekly.UsedPercent != 7 {
		t.Fatalf("legacy windows = %+v", windows)
	}
}

func TestParseClaudeUsageWindowsReadsFableScopedLimit(t *testing.T) {
	body := []byte(`{
		"five_hour": {"utilization": 0, "resets_at": null},
		"seven_day": {"utilization": 34, "resets_at": "2026-10-20T08:00:00Z"},
		"seven_day_oauth_apps": {"utilization": 99, "resets_at": "2026-10-19T08:00:00Z"},
		"iguana_necktie": {"utilization": 12, "resets_at": "2026-10-21T08:00:00Z", "limit_dollars": 50},
		"limits": [
			{"kind": "weekly_scoped", "percent": 80, "resets_at": "2026-10-22T08:00:00Z", "is_active": false, "scope": {"model": {"display_name": "Opus"}}},
			{"kind": "weekly_scoped", "percent": 61, "resets_at": "2026-10-19T20:00:00Z", "is_active": true, "scope": {"model": {"display_name": "Fable"}}}
		]
	}`)
	windows := ParseQuotaUsageWindows("claude", body, quotaTestNow)
	if windows.Short.State != QuotaWindowIdle || !windows.Short.UsedKnown || windows.Short.UsedPercent != 0 {
		t.Fatalf("unused five-hour window = %+v", windows.Short)
	}
	if windows.Weekly.UsedPercent != 34 || !windows.Weekly.ResetAt.Equal(time.Date(2026, 10, 20, 8, 0, 0, 0, time.UTC)) {
		t.Fatalf("Weekly = %+v", windows.Weekly)
	}
	if windows.FableWeekly.UsedPercent != 61 || !windows.FableWeekly.ResetAt.Equal(time.Date(2026, 10, 19, 20, 0, 0, 0, time.UTC)) {
		t.Fatalf("FableWeekly = %+v", windows.FableWeekly)
	}
}

func TestParseClaudeUsageWindowsLegacyFableWindowExcludesCreditPool(t *testing.T) {
	legacy := ParseQuotaUsageWindows("claude", []byte(`{"iguana_necktie": {"utilization": 40, "resets_at": "2026-10-21T08:00:00Z"}}`), quotaTestNow)
	if legacy.FableWeekly.UsedPercent != 40 {
		t.Fatalf("legacy Fable window = %+v", legacy.FableWeekly)
	}
	pool := ParseQuotaUsageWindows("claude", []byte(`{"iguana_necktie": {"utilization": 40, "resets_at": "2026-10-21T08:00:00Z", "used_dollars": 20}}`), quotaTestNow)
	if !pool.FableWeekly.IsZero() {
		t.Fatalf("dollar credit pool was read as Fable: %+v", pool.FableWeekly)
	}
}

func TestParseClaudeUsageWindowsStartedWindowWithoutResetStaysActive(t *testing.T) {
	windows := ParseQuotaUsageWindows("claude", []byte(`{"five_hour": {"utilization": 20, "resets_at": null}}`), quotaTestNow)
	if windows.Short.State != QuotaWindowActive || !windows.Short.ResetAt.IsZero() {
		t.Fatalf("a used window without a reset time must not look idle: %+v", windows.Short)
	}
}

func TestParseCodexUsageWindows(t *testing.T) {
	body := []byte(`{"rate_limit": {
		"limit_reached": false,
		"primary_window": {"used_percent": 3, "limit_window_seconds": 604800, "reset_at": 1793000000},
		"secondary_window": {"used_percent": 40, "limit_window_seconds": 2592000, "reset_at": "2026-11-01T00:00:00Z"}
	}}`)
	windows := ParseQuotaUsageWindows("codex", body, quotaTestNow)
	if !windows.Short.IsZero() {
		t.Fatalf("Short = %+v", windows.Short)
	}
	if windows.Weekly.UsedPercent != 3 || !windows.Weekly.ResetAt.Equal(time.Unix(1793000000, 0).UTC()) {
		t.Fatalf("the weekly window must win over the monthly one: %+v", windows.Weekly)
	}

	monthly := ParseQuotaUsageWindows("codex", []byte(`{"rateLimit": {"primaryWindow": {"usedPercent": 40, "limitWindowSeconds": 2592000, "resetAt": "2026-11-01T00:00:00Z"}}}`), quotaTestNow)
	if monthly.Weekly.UsedPercent != 40 {
		t.Fatalf("monthly-only plans use the monthly window as the long window: %+v", monthly.Weekly)
	}

	weeklyAfterMonthly := ParseQuotaUsageWindows("codex", []byte(`{"rate_limit": {
		"primary_window": {"used_percent": 40, "limit_window_seconds": 2592000},
		"secondary_window": {"used_percent": 3, "limit_window_seconds": 604800}
	}}`), quotaTestNow)
	if weeklyAfterMonthly.Weekly.UsedPercent != 3 {
		t.Fatalf("a monthly primary window displaced the weekly one: %+v", weeklyAfterMonthly.Weekly)
	}

	// limit_reached is credential-wide: it must not mark a window whose
	// usage is unknown as exhausted.
	reached := ParseQuotaUsageWindows("codex", []byte(`{"rate_limit": {"limit_reached": true,
		"primary_window": {"used_percent": 100, "limit_window_seconds": 18000, "reset_at": "2026-10-18T13:00:00Z"},
		"secondary_window": {"limit_window_seconds": 604800, "reset_at": "2026-10-21T13:00:00Z"}
	}}`), quotaTestNow)
	if !reached.Short.Exhausted || reached.Weekly.Exhausted {
		t.Fatalf("limit_reached attribution: short=%+v weekly=%+v", reached.Short, reached.Weekly)
	}
}

func TestQuotaWindowsFromHeadersUseEachWindowArrivalTime(t *testing.T) {
	weeklyAt, creditsAt := quotaTestNow.Add(-10*time.Minute), quotaTestNow
	headers := http.Header{
		"X-Codex-Primary-Used-Percent":        []string{"20"},
		"X-Codex-Primary-Window-Minutes":      []string{"10080"},
		"X-Codex-Primary-Reset-After-Seconds": []string{"3600"},
		"X-Codex-Credits-Balance":             []string{"5"},
	}
	// A later websocket event carried only credits; the weekly window keeps
	// the time its own headers arrived.
	received := map[string]time.Time{
		"X-Codex-Primary-Used-Percent":        weeklyAt,
		"X-Codex-Primary-Window-Minutes":      weeklyAt,
		"X-Codex-Primary-Reset-After-Seconds": weeklyAt,
		"X-Codex-Credits-Balance":             creditsAt,
	}
	windows := quotaWindowsFromHeaders("codex", headers, received, quotaTestNow)
	if !windows.Weekly.ObservedAt.Equal(weeklyAt) || !windows.Weekly.ResetAt.Equal(weeklyAt.Add(time.Hour)) {
		t.Fatalf("Weekly = %+v", windows.Weekly)
	}
}

func TestMergeResponseHeadersKeepsArrivalTimeOfUnchangedHeaders(t *testing.T) {
	ctx := internallogging.WithResponseHeadersHolder(context.Background())
	internallogging.SetResponseHeaders(ctx, http.Header{"X-Codex-Primary-Used-Percent": []string{"20"}})
	before := internallogging.GetResponseHeaderTimes(ctx)["X-Codex-Primary-Used-Percent"]
	internallogging.MergeResponseHeaders(ctx, http.Header{"X-Codex-Credits-Balance": []string{"5"}})
	times := internallogging.GetResponseHeaderTimes(ctx)
	if !times["X-Codex-Primary-Used-Percent"].Equal(before) || times["X-Codex-Credits-Balance"].IsZero() {
		t.Fatalf("header times = %v", times)
	}
}

func TestQuotaWindowsMergeKeepsNewestPerWindow(t *testing.T) {
	older, newer := quotaTestNow.Add(-time.Minute), quotaTestNow
	current := QuotaWindows{
		Short:       QuotaWindow{State: QuotaWindowActive, UsedPercent: 10, UsedKnown: true, ObservedAt: older},
		FableWeekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 50, UsedKnown: true, ObservedAt: older},
	}
	merged := current.Merge(QuotaWindows{
		Short:  QuotaWindow{State: QuotaWindowActive, UsedPercent: 20, UsedKnown: true, ObservedAt: newer},
		Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 30, UsedKnown: true, ObservedAt: newer},
	})
	if merged.Short.UsedPercent != 20 || merged.Weekly.UsedPercent != 30 || merged.FableWeekly.UsedPercent != 50 {
		t.Fatalf("merged = %+v", merged)
	}
	if stale := merged.Merge(QuotaWindows{Short: QuotaWindow{State: QuotaWindowActive, UsedPercent: 1, UsedKnown: true, ObservedAt: older}}); stale.Short.UsedPercent != 20 {
		t.Fatalf("an older observation replaced a newer one: %+v", stale.Short)
	}
}

func TestQuotaWindowEffectiveRollsOverPassedReset(t *testing.T) {
	window := QuotaWindow{State: QuotaWindowActive, UsedPercent: 90, UsedKnown: true, ResetAt: quotaTestNow, ObservedAt: quotaTestNow.Add(-time.Hour)}
	if before := window.Effective(quotaTestNow.Add(-time.Second)); before.UsedPercent != 90 {
		t.Fatalf("window rolled over early: %+v", before)
	}
	after := window.Effective(quotaTestNow)
	if after.State != QuotaWindowIdle || after.UsedKnown || after.Exhausted || !after.ResetAt.IsZero() {
		t.Fatalf("passed reset must roll the window over: %+v", after)
	}
}

func TestManagerMarkResultMergesQuotaWindowsAtHeaderTime(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	auth, errRegister := manager.Register(context.Background(), &Auth{ID: "quota-window-auth", Provider: "claude"})
	if errRegister != nil {
		t.Fatal(errRegister)
	}
	reset := time.Now().Add(48 * time.Hour).Truncate(time.Second)
	ctx := internallogging.WithResponseHeadersHolder(context.Background())
	internallogging.SetResponseHeaders(ctx, http.Header{
		"Anthropic-Ratelimit-Unified-7d-Utilization": []string{"0.5"},
		"Anthropic-Ratelimit-Unified-7d-Reset":       []string{unixText(reset)},
	})
	receivedAt := internallogging.GetResponseHeaderTimes(ctx)["Anthropic-Ratelimit-Unified-7d-Reset"]
	manager.MarkResult(ctx, Result{AuthID: auth.ID, Provider: "claude", Model: "claude-sonnet-5-5", Success: true})

	stored, _ := manager.GetByID(auth.ID)
	if stored.QuotaWindows.Weekly.UsedPercent != 50 || !stored.QuotaWindows.Weekly.ResetAt.Equal(reset.UTC()) {
		t.Fatalf("Weekly = %+v", stored.QuotaWindows.Weekly)
	}
	if !stored.QuotaWindows.Weekly.ObservedAt.Equal(receivedAt) {
		t.Fatalf("observation must be anchored to header arrival: got %v want %v", stored.QuotaWindows.Weekly.ObservedAt, receivedAt)
	}

	// A later response with only Retry-After replaces the raw signal snapshot
	// but must not erase the normalized windows.
	next := internallogging.WithFreshResponseHeadersHolder(context.Background())
	internallogging.SetResponseHeaders(next, http.Header{"Retry-After": []string{"30"}})
	manager.MarkResult(next, Result{AuthID: auth.ID, Provider: "claude", Model: "claude-sonnet-5-5", Success: true})
	stored, _ = manager.GetByID(auth.ID)
	if stored.QuotaWindows.Weekly.UsedPercent != 50 {
		t.Fatalf("sparse response erased the weekly window: %+v", stored.QuotaWindows.Weekly)
	}
}

func TestManagerApplyQuotaWindowsChecksCurrentCredential(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	if _, errRegister := manager.Register(context.Background(), &Auth{ID: "poll-auth", Provider: "codex", Metadata: map[string]any{"email": "a@example.invalid"}}); errRegister != nil {
		t.Fatal(errRegister)
	}
	windows := QuotaWindows{Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 10, UsedKnown: true, ObservedAt: quotaTestNow}}
	if manager.ApplyQuotaWindows("poll-auth", windows, func(*Auth) bool { return false }) {
		t.Fatal("windows applied to a credential that is no longer current")
	}
	if stored, _ := manager.GetByID("poll-auth"); !stored.QuotaWindows.IsZero() {
		t.Fatalf("rejected windows were stored: %+v", stored.QuotaWindows)
	}
	if !manager.ApplyQuotaWindows("poll-auth", windows, func(current *Auth) bool { return current.ID == "poll-auth" }) {
		t.Fatal("windows were not applied")
	}
	if stored, _ := manager.GetByID("poll-auth"); stored.QuotaWindows.Weekly.UsedPercent != 10 {
		t.Fatalf("Weekly = %+v", stored.QuotaWindows.Weekly)
	}
}

func TestManagerUpdateDropsQuotaWindowsWhenCodexAccountChangesUnderSameEmail(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	ctx := context.Background()
	codex := func(accountID, token string) *Auth {
		return &Auth{ID: "codex-carry", Provider: "codex", Metadata: map[string]any{"email": "shared@example.invalid", "account_id": accountID, "access_token": token}}
	}
	if _, errRegister := manager.Register(ctx, codex("acct-1", "one")); errRegister != nil {
		t.Fatal(errRegister)
	}
	manager.ApplyQuotaWindows("codex-carry", QuotaWindows{Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 10, UsedKnown: true, ObservedAt: quotaTestNow}}, nil)
	if _, errUpdate := manager.Update(ctx, codex("acct-1", "two")); errUpdate != nil {
		t.Fatal(errUpdate)
	}
	if stored, _ := manager.GetByID("codex-carry"); stored.QuotaWindows.IsZero() {
		t.Fatal("token rotation dropped quota windows")
	}
	if _, errUpdate := manager.Update(ctx, codex("acct-2", "three")); errUpdate != nil {
		t.Fatal(errUpdate)
	}
	if stored, _ := manager.GetByID("codex-carry"); !stored.QuotaWindows.IsZero() {
		t.Fatalf("another workspace account inherited quota windows: %+v", stored.QuotaWindows)
	}
}

func TestManagerUpdateCarriesQuotaWindowsOnlyForTheSameAccount(t *testing.T) {
	manager := NewManager(nil, nil, nil)
	ctx := context.Background()
	if _, errRegister := manager.Register(ctx, &Auth{ID: "carry-auth", Provider: "claude", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "one"}}); errRegister != nil {
		t.Fatal(errRegister)
	}
	windows := QuotaWindows{Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 10, UsedKnown: true, ObservedAt: quotaTestNow}}
	manager.ApplyQuotaWindows("carry-auth", windows, nil)

	// A token rotation arrives as a fresh auth without runtime state.
	if _, errUpdate := manager.Update(ctx, &Auth{ID: "carry-auth", Provider: "claude", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "two"}}); errUpdate != nil {
		t.Fatal(errUpdate)
	}
	if stored, _ := manager.GetByID("carry-auth"); stored.QuotaWindows.Weekly.UsedPercent != 10 {
		t.Fatalf("token rotation dropped quota windows: %+v", stored.QuotaWindows)
	}

	if _, errUpdate := manager.Update(ctx, &Auth{ID: "carry-auth", Provider: "claude", Metadata: map[string]any{"email": "b@example.invalid", "access_token": "three"}}); errUpdate != nil {
		t.Fatal(errUpdate)
	}
	if stored, _ := manager.GetByID("carry-auth"); !stored.QuotaWindows.IsZero() {
		t.Fatalf("another account inherited quota windows: %+v", stored.QuotaWindows)
	}
}
