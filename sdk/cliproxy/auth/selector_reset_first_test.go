package auth

import (
	"context"
	"net/http"
	"testing"
	"time"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
)

var resetFirstNow = time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)

func activeWindow(used float64, resetIn time.Duration) QuotaWindow {
	return QuotaWindow{State: QuotaWindowActive, UsedPercent: used, UsedKnown: true, ResetAt: resetFirstNow.Add(resetIn), ObservedAt: resetFirstNow.Add(-time.Minute)}
}

func resetFirstAuth(id string, windows QuotaWindows) *Auth {
	return &Auth{ID: id, Provider: "claude", Status: StatusActive, QuotaWindows: windows}
}

func newTestResetFirstSelector(threshold int) *ResetFirstSelector {
	selector := NewResetFirstSelector(threshold)
	selector.now = func() time.Time { return resetFirstNow }
	return selector
}

func pickResetFirst(t *testing.T, ctx context.Context, selector *ResetFirstSelector, model string, auths ...*Auth) string {
	t.Helper()
	picked, errPick := selector.Pick(ctx, "claude", model, cliproxyexecutor.Options{}, auths)
	if errPick != nil {
		t.Fatalf("Pick: %v", errPick)
	}
	return picked.ID
}

func TestResetFirstPicksSoonestWeeklyReset(t *testing.T) {
	selector := newTestResetFirstSelector(85)
	got := pickResetFirst(t, context.Background(), selector, "claude-sonnet-5-5",
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(40, 72*time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(70, 24*time.Hour)}),
		resetFirstAuth("c", QuotaWindows{}),
	)
	if got != "b" {
		t.Fatalf("picked %q, want the soonest weekly reset b", got)
	}
}

func TestResetFirstSkipsCredentialWithoutFiveHourHeadroom(t *testing.T) {
	auths := []*Auth{
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(40, 72*time.Hour), Short: activeWindow(10, time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(70, 24*time.Hour), Short: activeWindow(90, time.Hour)}),
	}
	selector := newTestResetFirstSelector(85)
	if got := pickResetFirst(t, context.Background(), selector, "m", auths...); got != "a" {
		t.Fatalf("picked %q, want a: b is over the five-hour threshold", got)
	}
	selector.SetMaxShortUtilization(95)
	if got := pickResetFirst(t, context.Background(), selector, "m", auths...); got != "b" {
		t.Fatalf("picked %q after raising the threshold, want b", got)
	}
}

func TestResetFirstTreatsWarningAsNoHeadroom(t *testing.T) {
	warning := QuotaWindow{State: QuotaWindowActive, Warning: true, ObservedAt: resetFirstNow}
	got := pickResetFirst(t, context.Background(), newTestResetFirstSelector(85), "m",
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(40, 72*time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(70, 24*time.Hour), Short: warning}),
	)
	if got != "a" {
		t.Fatalf("picked %q, want a", got)
	}
}

func TestResetFirstPrefersWeeklyQuotaOverFiveHourHeadroom(t *testing.T) {
	// When no credential has five-hour headroom, the threshold relaxes only
	// among credentials that still have weekly quota.
	got := pickResetFirst(t, context.Background(), newTestResetFirstSelector(85), "m",
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(100, 24*time.Hour), Short: activeWindow(0, time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(20, 72*time.Hour), Short: activeWindow(90, time.Hour)}),
		resetFirstAuth("c", QuotaWindows{Weekly: activeWindow(20, 48*time.Hour), Short: activeWindow(95, time.Hour)}),
	)
	if got != "b" {
		t.Fatalf("picked %q, want b: weekly quota left and the least five-hour usage", got)
	}
}

func TestResetFirstPicksSoonestRecoveryWhenAllWeeklyExhausted(t *testing.T) {
	got := pickResetFirst(t, context.Background(), newTestResetFirstSelector(85), "m",
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(100, 72*time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(100, 24*time.Hour)}),
	)
	if got != "b" {
		t.Fatalf("picked %q, want b", got)
	}
}

func TestResetFirstRotatesCredentialsWithoutWeeklyReset(t *testing.T) {
	selector := newTestResetFirstSelector(85)
	auths := []*Auth{resetFirstAuth("a", QuotaWindows{}), resetFirstAuth("b", QuotaWindows{})}
	first := pickResetFirst(t, context.Background(), selector, "m", auths...)
	second := pickResetFirst(t, context.Background(), selector, "m", auths...)
	if first == second {
		t.Fatalf("credentials without quota windows were not rotated: %q then %q", first, second)
	}
}

func TestResetFirstTreatsPassedResetAsFreshWindow(t *testing.T) {
	got := pickResetFirst(t, context.Background(), newTestResetFirstSelector(85), "m",
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(99, -time.Minute)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(10, 96*time.Hour)}),
	)
	if got != "b" {
		t.Fatalf("picked %q, want b: a's window already reset and has nothing left to lose", got)
	}
}

func TestResetFirstRanksFableByItsOwnWeeklyWindow(t *testing.T) {
	auths := []*Auth{
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(10, 24*time.Hour), FableWeekly: activeWindow(10, 120*time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(10, 96*time.Hour), FableWeekly: activeWindow(10, 48*time.Hour)}),
	}
	selector := newTestResetFirstSelector(85)
	if got := pickResetFirst(t, context.Background(), selector, "claude-sonnet-5-5", auths...); got != "a" {
		t.Fatalf("Sonnet picked %q, want a by shared weekly reset", got)
	}
	if got := pickResetFirst(t, context.Background(), selector, "claude-fable-5-1", auths...); got != "b" {
		t.Fatalf("Fable picked %q, want b by Fable weekly reset", got)
	}

	// An exhausted shared weekly window also blocks Fable.
	auths[1].QuotaWindows.Weekly = activeWindow(100, 96*time.Hour)
	if got := pickResetFirst(t, context.Background(), selector, "claude-fable-5-1", auths...); got != "a" {
		t.Fatalf("Fable picked %q, want a: b has no shared weekly quota", got)
	}
}

func TestResetFirstUsesUpstreamModelFromContext(t *testing.T) {
	auths := []*Auth{
		resetFirstAuth("a", QuotaWindows{Weekly: activeWindow(10, 24*time.Hour), FableWeekly: activeWindow(10, 120*time.Hour)}),
		resetFirstAuth("b", QuotaWindows{Weekly: activeWindow(10, 96*time.Hour), FableWeekly: activeWindow(10, 48*time.Hour)}),
	}
	ctx := withResetFirstUpstreamModels(context.Background(), map[string]string{"a": "claude-fable-5-1", "b": "claude-fable-5-1"})
	if got := pickResetFirst(t, ctx, newTestResetFirstSelector(85), "team-alias", auths...); got != "b" {
		t.Fatalf("aliased Fable request picked %q, want b", got)
	}
}

func TestManagerResetFirstUpstreamModelsResolveOAuthAlias(t *testing.T) {
	manager := NewManager(nil, NewResetFirstSelector(0), nil)
	manager.SetOAuthModelAlias(map[string][]internalconfig.OAuthModelAlias{
		"claude": {{Name: "claude-fable-5-1", Alias: "best-model"}},
	})
	auth := &Auth{ID: "alias-auth", Provider: "claude", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "t"}}
	models := manager.resetFirstUpstreamModels(manager.Selector(), []*Auth{auth}, "best-model")
	if models["alias-auth"] != "claude-fable-5-1" {
		t.Fatalf("upstream models = %v", models)
	}
	if models := manager.resetFirstUpstreamModels(&RoundRobinSelector{}, []*Auth{auth}, "best-model"); models != nil {
		t.Fatalf("other selectors must not resolve upstream models: %v", models)
	}
}

func TestResetFirstSelectorOf(t *testing.T) {
	resetFirst := NewResetFirstSelector(0)
	if resetFirst.MaxShortUtilization() != DefaultResetFirstMaxShortUtilization {
		t.Fatalf("default threshold = %d", resetFirst.MaxShortUtilization())
	}
	affinity := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: resetFirst, TTL: time.Hour})
	defer affinity.Stop()
	if ResetFirstSelectorOf(affinity) != resetFirst || ResetFirstSelectorOf(resetFirst) != resetFirst {
		t.Fatal("reset-first selector was not found")
	}
	if ResetFirstSelectorOf(&FillFirstSelector{}) != nil {
		t.Fatal("fill-first reported as reset-first")
	}
	if isBuiltInSelector(resetFirst) {
		t.Fatal("reset-first must stay off the scheduler fast path")
	}
}

// TestManagerResetFirstKeepsSessionAffinity verifies the core contract: a
// sooner reset elsewhere never moves a bound session, new sessions go to the
// soonest reset, and a failing bound credential fails over by reset order.
func TestManagerResetFirstKeepsSessionAffinity(t *testing.T) {
	for _, testCase := range []struct {
		name           string
		providerSuffix string
		pick           func(*Manager, context.Context, string, string, cliproxyexecutor.Options) (*Auth, error)
	}{
		{
			name:           "single provider",
			providerSuffix: "single",
			pick: func(manager *Manager, ctx context.Context, provider, model string, opts cliproxyexecutor.Options) (*Auth, error) {
				auth, _, errPick := manager.pickNext(ctx, provider, model, opts, nil)
				return auth, errPick
			},
		},
		{
			name:           "mixed provider",
			providerSuffix: "mixed",
			pick: func(manager *Manager, ctx context.Context, provider, model string, opts cliproxyexecutor.Options) (*Auth, error) {
				auth, _, _, errPick := manager.pickNextMixed(ctx, []string{provider}, model, opts, nil)
				return auth, errPick
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			ctx := context.Background()
			provider := "reset-first-" + testCase.providerSuffix
			model := "reset-first-model"
			soonID, laterID, latestID := provider+"-soon", provider+"-later", provider+"-latest"

			manager := NewManager(nil, nil, nil)
			affinity := NewSessionAffinitySelectorWithConfig(SessionAffinityConfig{Fallback: NewResetFirstSelector(85), TTL: time.Hour})
			defer affinity.Stop()
			manager.SetSelector(affinity)
			manager.RegisterExecutor(schedulerTestExecutor{provider: provider})

			now := time.Now()
			weekly := func(resetIn time.Duration) QuotaWindows {
				return QuotaWindows{Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 30, UsedKnown: true, ResetAt: now.Add(resetIn), ObservedAt: now}}
			}
			for _, auth := range []*Auth{
				{ID: soonID, Provider: provider, Status: StatusActive},
				{ID: laterID, Provider: provider, Status: StatusActive},
				{ID: latestID, Provider: provider, Status: StatusActive},
			} {
				if _, errRegister := manager.Register(WithSkipPersist(ctx), auth); errRegister != nil {
					t.Fatalf("Register(%s): %v", auth.ID, errRegister)
				}
				registry.GetGlobalRegistry().RegisterClient(auth.ID, provider, []*registry.ModelInfo{{ID: model}})
				t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient(auth.ID) })
			}
			manager.ApplyQuotaWindows(soonID, weekly(24*time.Hour), nil)
			manager.ApplyQuotaWindows(laterID, weekly(48*time.Hour), nil)
			manager.ApplyQuotaWindows(latestID, weekly(72*time.Hour), nil)

			session := func(id string) cliproxyexecutor.Options {
				return cliproxyexecutor.Options{Metadata: map[string]any{cliproxyexecutor.DerivedSessionIDMetadataKey: id}}
			}
			pick := func(opts cliproxyexecutor.Options) string {
				t.Helper()
				auth, errPick := testCase.pick(manager, ctx, provider, model, opts)
				if errPick != nil || auth == nil {
					t.Fatalf("pick: auth=%v err=%v", auth, errPick)
				}
				return auth.ID
			}

			if got := pick(session("first")); got != soonID {
				t.Fatalf("cold binding = %q, want soonest reset %q", got, soonID)
			}

			// Another credential now resets sooner: the bound session stays,
			// a new session goes to the new soonest reset.
			sooner := weekly(time.Hour)
			sooner.Weekly.ObservedAt = now.Add(time.Second)
			manager.ApplyQuotaWindows(latestID, sooner, nil)
			if got := pick(session("first")); got != soonID {
				t.Fatalf("bound session moved to %q, want sticky %q", got, soonID)
			}
			if got := pick(session("second")); got != latestID {
				t.Fatalf("new session = %q, want soonest reset %q", got, latestID)
			}

			// The bound credential hits its limit: the session fails over to
			// the soonest reset among the remaining credentials.
			manager.MarkResult(ctx, Result{
				AuthID:   soonID,
				Provider: provider,
				Model:    model,
				Success:  false,
				Error:    &Error{HTTPStatus: http.StatusTooManyRequests, Message: "quota"},
			})
			if got := pick(session("first")); got != latestID {
				t.Fatalf("failover = %q, want %q", got, latestID)
			}
		})
	}
}

func TestManagerResetFirstWithoutAffinityPicksSoonestReset(t *testing.T) {
	ctx := context.Background()
	provider, model := "reset-first-plain", "reset-first-plain-model"
	manager := NewManager(nil, NewResetFirstSelector(85), nil)
	manager.RegisterExecutor(schedulerTestExecutor{provider: provider})
	if manager.useSchedulerFastPath() {
		t.Fatal("reset-first must not use the scheduler fast path")
	}
	now := time.Now()
	for i, id := range []string{"plain-a", "plain-b"} {
		if _, errRegister := manager.Register(WithSkipPersist(ctx), &Auth{ID: id, Provider: provider, Status: StatusActive}); errRegister != nil {
			t.Fatal(errRegister)
		}
		registry.GetGlobalRegistry().RegisterClient(id, provider, []*registry.ModelInfo{{ID: model}})
		t.Cleanup(func() { registry.GetGlobalRegistry().UnregisterClient(id) })
		resetIn := time.Duration(72-i*48) * time.Hour
		manager.ApplyQuotaWindows(id, QuotaWindows{Weekly: QuotaWindow{State: QuotaWindowActive, UsedPercent: 10, UsedKnown: true, ResetAt: now.Add(resetIn), ObservedAt: now}}, nil)
	}
	for range 3 {
		auth, _, errPick := manager.pickNext(ctx, provider, model, cliproxyexecutor.Options{}, nil)
		if errPick != nil || auth == nil || auth.ID != "plain-b" {
			t.Fatalf("pick = %v, %v; want plain-b", auth, errPick)
		}
	}
}
