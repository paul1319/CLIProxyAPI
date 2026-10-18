package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/quota"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

const claudeUsageFixture = `{"five_hour":{"utilization":20,"resets_at":"2026-10-17T14:00:00Z"},"seven_day":{"utilization":45,"resets_at":"2026-10-19T08:00:00Z"},"limits":[{"kind":"weekly_scoped","percent":70,"resets_at":"2026-10-20T08:00:00Z","is_active":true,"scope":{"model":{"display_name":"Fable"}}}]}`

// newQuotaPollFixture registers one Claude OAuth credential and seeds a fresh
// usage snapshot, so polling reads the cache instead of contacting Claude.
func newQuotaPollFixture(t *testing.T, strategy string) (*Handler, *coreauth.Manager, *coreauth.Auth) {
	t.Helper()
	manager := coreauth.NewManager(nil, nil, nil)
	auth := &coreauth.Auth{ID: "poll-claude", FileName: "poll.json", Provider: "claude", Metadata: map[string]any{"email": "poll@example.invalid", "access_token": "secret"}}
	auth.EnsureIndex()
	if _, errRegister := manager.Register(t.Context(), auth); errRegister != nil {
		t.Fatal(errRegister)
	}
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	service, _ := quota.New(nil, func() time.Time { return now })
	t.Cleanup(service.Close)
	if _, errObserve := service.Observe(t.Context(), quota.Request{
		Identity: quotaCredentialIdentity(auth), Resource: "usage", Interval: quota.UsageInterval,
		Fetch: func(context.Context) (json.RawMessage, error) { return json.RawMessage(claudeUsageFixture), nil },
	}); errObserve != nil {
		t.Fatal(errObserve)
	}
	h := &Handler{cfg: &config.Config{Routing: config.RoutingConfig{Strategy: strategy}}, authManager: manager, quotaObservations: service}
	return h, manager, auth
}

func pollOnce(t *testing.T, h *Handler) {
	t.Helper()
	h.pollQuotaWindows(t.Context())
	h.quotaPollWorkers.Wait()
}

func TestQuotaPollingAppliesUsageWindowsForResetFirst(t *testing.T) {
	h, manager, auth := newQuotaPollFixture(t, "reset-first")
	pollOnce(t, h)

	stored, _ := manager.GetByID(auth.ID)
	windows := stored.QuotaWindows
	if windows.Short.UsedPercent != 20 || windows.Weekly.UsedPercent != 45 || windows.FableWeekly.UsedPercent != 70 {
		t.Fatalf("polled windows = %+v", windows)
	}
	if !windows.Weekly.ResetAt.Equal(time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)) {
		t.Fatalf("weekly reset = %v", windows.Weekly.ResetAt)
	}
}

func TestQuotaPollingIdleForOtherStrategies(t *testing.T) {
	h, manager, auth := newQuotaPollFixture(t, "fill-first")
	pollOnce(t, h)
	if stored, _ := manager.GetByID(auth.ID); !stored.QuotaWindows.IsZero() {
		t.Fatalf("poller ran without reset-first routing: %+v", stored.QuotaWindows)
	}
}

func TestQuotaPollingSkipsReplacedAccount(t *testing.T) {
	h, manager, auth := newQuotaPollFixture(t, "reset-first")
	replaced := auth.Clone()
	replaced.Metadata["email"] = "other@example.invalid"
	if _, errUpdate := manager.Update(t.Context(), replaced); errUpdate != nil {
		t.Fatal(errUpdate)
	}
	// The replacement is polled under its own identity, which has no cached
	// snapshot; the previous account's snapshot must never reach it.
	h.applyQuotaWindows(auth.ID, auth.Provider, quotaCredentialIdentity(auth), quota.Snapshot{Record: quota.Record{
		Body: json.RawMessage(claudeUsageFixture), ObservedAt: time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC),
	}})
	if stored, _ := manager.GetByID(auth.ID); !stored.QuotaWindows.IsZero() {
		t.Fatalf("replaced account received the previous account's windows: %+v", stored.QuotaWindows)
	}
}

func TestQuotaSnapshotReadAppliesUsageWindows(t *testing.T) {
	h, manager, auth := newQuotaPollFixture(t, "round-robin")
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v8/management/credentials/quota?auth_index="+auth.Index+"&resource=usage", nil)
	h.CredentialQuotaObservation(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if stored, _ := manager.GetByID(auth.ID); stored.QuotaWindows.Weekly.UsedPercent != 45 {
		t.Fatalf("management read did not refresh routing windows: %+v", stored.QuotaWindows)
	}
}

func TestQuotaPollableOnlySubscriptionClaudeAndCodex(t *testing.T) {
	for _, tc := range []struct {
		name string
		auth *coreauth.Auth
		want bool
	}{
		{"claude oauth", &coreauth.Auth{Provider: "claude", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "t"}}, true},
		{"codex oauth", &coreauth.Auth{Provider: "codex", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "t"}}, true},
		{"claude api key", &coreauth.Auth{Provider: "claude", Attributes: map[string]string{"api_key": "k"}}, false},
		{"disabled", &coreauth.Auth{Provider: "claude", Disabled: true, Metadata: map[string]any{"email": "a@example.invalid", "access_token": "t"}}, false},
		{"gemini", &coreauth.Auth{Provider: "gemini", Metadata: map[string]any{"email": "a@example.invalid", "access_token": "t"}}, false},
	} {
		if got := quotaPollable(tc.auth); got != tc.want {
			t.Errorf("%s: quotaPollable = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestQuotaPollingStopsWithQuotaObservations(t *testing.T) {
	h, _, _ := newQuotaPollFixture(t, "fill-first")
	h.StartQuotaPolling()
	h.StartQuotaPolling()
	done := make(chan struct{})
	go func() {
		h.CloseQuotaObservations()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("closing quota observations did not stop the poller")
	}
}
