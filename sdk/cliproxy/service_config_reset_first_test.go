package cliproxy

import (
	"context"
	"testing"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestResetFirstRoutingSelector(t *testing.T) {
	state := normalizedRoutingRuntimeState(&internalconfig.Config{
		Routing: internalconfig.RoutingConfig{Strategy: "Reset-First"},
	})
	if state.strategy != "reset-first" {
		t.Fatalf("strategy = %q, want reset-first", state.strategy)
	}
	if _, ok := newRoutingSelector(state).(*coreauth.ResetFirstSelector); !ok {
		t.Fatalf("selector type = %T, want *auth.ResetFirstSelector", newRoutingSelector(state))
	}
	state.sessionAffinity = true
	affinity := newRoutingSelector(state)
	if stoppable, ok := affinity.(coreauth.StoppableSelector); ok {
		defer stoppable.Stop()
	}
	if coreauth.ResetFirstSelectorOf(affinity) == nil {
		t.Fatalf("session affinity selector %T does not wrap reset-first", affinity)
	}
}

func TestApplyManagerConfigTunesResetFirstWithoutReplacingSelector(t *testing.T) {
	service := &Service{coreManager: coreauth.NewManager(nil, nil, nil)}
	apply := func(threshold int) coreauth.Selector {
		t.Helper()
		cfg := &internalconfig.Config{Routing: internalconfig.RoutingConfig{
			Strategy:        "reset-first",
			SessionAffinity: true,
			ResetFirst:      internalconfig.ResetFirstRoutingConfig{MaxFiveHourUtilization: threshold},
		}}
		if !service.applyManagerConfig(context.Background(), configCommit{cfg: cfg, sequence: 1}) {
			t.Fatal("applyManagerConfig failed")
		}
		return service.coreManager.Selector()
	}

	first := apply(0)
	defer func() {
		if stoppable, ok := service.coreManager.Selector().(coreauth.StoppableSelector); ok {
			stoppable.Stop()
		}
	}()
	if got := coreauth.ResetFirstSelectorOf(first).MaxShortUtilization(); got != coreauth.DefaultResetFirstMaxShortUtilization {
		t.Fatalf("default threshold = %d", got)
	}
	// Replacing the selector would drop every session binding.
	if second := apply(70); second != first {
		t.Fatal("changing the threshold replaced the selector")
	}
	if got := coreauth.ResetFirstSelectorOf(first).MaxShortUtilization(); got != 70 {
		t.Fatalf("threshold = %d, want 70", got)
	}
}
