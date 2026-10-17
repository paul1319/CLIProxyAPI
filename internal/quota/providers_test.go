package quota

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type quotaTransport func(*http.Request) (*http.Response, error)

func (f quotaTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestProviderResourcesOnlyReadAllowlistedData(t *testing.T) {
	for _, test := range []struct {
		provider, resource, target, response, want string
	}{
		{provider: "claude", resource: "usage", target: "https://api.anthropic.com/api/oauth/usage", response: `{"five_hour":{"utilization":12,"resets_at":"2099-01-01T00:00:00Z","access_token":"secret"},"access_token":"secret","extra_usage":{"is_enabled":true,"used_credits":10}}`, want: `"utilization":12`},
		{provider: "codex", resource: "usage", target: "https://chatgpt.com/backend-api/wham/usage", response: `{"plan_type":"pro","rate_limit":{"primary_window":{"used_percent":40,"reset_after_seconds":20}},"credits":{"balance":"1.25","access_token":"secret"}}`, want: `"balance":"1.25"`},
		{provider: "xai", resource: "weekly", target: "https://cli-chat-proxy.grok.com/v1/billing?format=credits", response: `{"config":{"creditUsagePercent":25,"monthlyLimit":{"val":100},"used":50,"token":"secret"},"token":"secret"}`, want: `"used":50`},
		{provider: "kimi-ai", resource: "usage", target: "https://api.kimi.ai/coding/v1/usages", response: `{"usage":{"used":10,"limit":100},"limits":[],"token":"secret"}`, want: `"used":10`},
		{provider: "devin", resource: "usage", target: "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus", response: `{"userStatus":{"planStatus":{"dailyQuotaRemainingPercent":15,"weeklyQuotaResetAtUnix":"1900000000","planInfo":{"planName":"pro","token":"secret"}},"apiKey":"secret"}}`, want: `"dailyQuotaRemainingPercent":15`},
		{provider: "meta", resource: "usage", target: "https://api.meta.ai/muse-code/key", response: `{"api_key":"secret","user_email":"secret","subs_usage":{"window":{"used_percent":2},"weekly":{"used_percent":0}},"is_subs_active":true}`, want: `"used_percent":0`},
		{provider: "antigravity", resource: "usage", target: "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", response: `{"groups":[{"displayName":"Models","buckets":[{"remainingFraction":0.5,"resetTime":"2099-01-01T00:00:00Z","token":"secret"}]}],"token":"secret"}`, want: `"remainingFraction":0.5`},
	} {
		t.Run(test.provider, func(t *testing.T) {
			requests := 0
			credential := Credential{Provider: test.provider, KimiDomain: "kimi.ai", Metadata: map[string]any{"project_id": "test-project", "dca_token": "dca:test"},
				Token: func(context.Context) (string, error) {
					if test.provider == "meta" {
						t.Error("Meta quota resolved the inference token")
					}
					return "test-token", nil
				},
				Transport: quotaTransport(func(req *http.Request) (*http.Response, error) {
					requests++
					if req.URL.String() != test.target {
						t.Errorf("target = %s, want %s", req.URL, test.target)
					}
					if strings.Contains(req.URL.Path, "chat/completions") {
						t.Fatal("quota read ran inference")
					}
					wantToken := "test-token"
					if test.provider == "meta" {
						wantToken = "dca:test"
					}
					if req.Header.Get("Authorization") != "Bearer "+wantToken {
						t.Error("wrong credential selected")
					}
					return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(test.response))}, nil
				}),
			}
			resource, errResource := ProviderResource(credential, test.resource)
			if errResource != nil {
				t.Fatal(errResource)
			}
			body, errFetch := resource.Fetch(t.Context())
			if errFetch != nil {
				t.Fatal(errFetch)
			}
			if requests != 1 || !strings.Contains(string(body), test.want) || strings.Contains(string(body), "secret") {
				t.Fatalf("unsafe or incomplete observation: %s", body)
			}
		})
	}
}

func TestProviderResourceIntervalsAndUnsupportedOperations(t *testing.T) {
	credential := Credential{Provider: "codex", AccountID: "account-a"}
	for _, test := range []struct {
		name     string
		interval time.Duration
	}{
		{name: "usage", interval: UsageInterval}, {name: "subscription", interval: time.Hour}, {name: "reset_credits", interval: 10 * time.Minute},
	} {
		resource, errResource := ProviderResource(credential, test.name)
		if errResource != nil || resource.Interval != test.interval {
			t.Fatalf("%s: %v, interval %v", test.name, errResource, resource.Interval)
		}
	}
	for _, name := range []string{"chat", "reset", "consume", "https://attacker.invalid/usage"} {
		if _, errResource := ProviderResource(Credential{Provider: "xai"}, name); errResource == nil {
			t.Fatalf("accepted unsafe operation %q", name)
		}
	}
}

func TestProviderDoesNotPersistMalformedResponsesOrForwardRedirects(t *testing.T) {
	for _, response := range []struct {
		status int
		body   string
	}{
		{status: 200, body: `{"access_token":"secret"}`}, {status: 200, body: `{"five_hour":[]} garbage`},
		{status: 302, body: `{"five_hour":{"utilization":1}}`}, {status: 429, body: `{"access_token":"secret"}`},
	} {
		credential := Credential{Provider: "claude", Token: func(context.Context) (string, error) { return "token", nil },
			Transport: quotaTransport(func(req *http.Request) (*http.Response, error) {
				if req.URL.Host != "api.anthropic.com" {
					t.Fatal("followed a redirect with a credential")
				}
				return &http.Response{StatusCode: response.status, Header: http.Header{"Location": {"https://attacker.invalid/"}, "Retry-After": {"90"}}, Body: io.NopCloser(strings.NewReader(response.body))}, nil
			}),
		}
		resource, _ := ProviderResource(credential, "usage")
		body, errFetch := resource.Fetch(t.Context())
		if errFetch == nil || len(body) > 0 || strings.Contains(errFetch.Error(), "secret") {
			t.Fatalf("invalid upstream response accepted: %s %v", body, errFetch)
		}
	}
}

func TestDevinTokenIsJSONEscaped(t *testing.T) {
	const token = "token\"with\\escapes"
	credential := Credential{Provider: "devin", Token: func(context.Context) (string, error) { return token, nil },
		Transport: quotaTransport(func(req *http.Request) (*http.Response, error) {
			var body struct {
				Metadata struct {
					APIKey string `json:"apiKey"`
				} `json:"metadata"`
			}
			if errDecode := json.NewDecoder(req.Body).Decode(&body); errDecode != nil || body.Metadata.APIKey != token {
				t.Fatalf("invalid credential framing: %v", errDecode)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"userStatus":{"planStatus":{"dailyQuotaRemainingPercent":1}}}`))}, nil
		}),
	}
	resource, _ := ProviderResource(credential, "usage")
	if _, errFetch := resource.Fetch(t.Context()); errFetch != nil {
		t.Fatal(errFetch)
	}
}

func TestRelativeResetInstantsAreAnchoredBeforePersistence(t *testing.T) {
	observedAt := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	value := map[string]any{"limits": []any{
		map[string]any{"resetIn": json.Number("60")},
		map[string]any{"reset_after_seconds": json.Number("120")},
		map[string]any{"reset_at": "2099-01-01T00:00:00Z", "ttl": json.Number("30")},
	}}
	anchorResetTimes(value, observedAt)
	rows := value["limits"].([]any)
	for i, expected := range []string{"2026-10-17T12:01:00Z", "2026-10-17T12:02:00Z", "2099-01-01T00:00:00Z"} {
		if actual := rows[i].(map[string]any)["reset_at"]; actual != expected {
			t.Fatalf("row %d reset = %v, want %s", i, actual, expected)
		}
	}
	anchorResetTimes(value, observedAt.Add(time.Hour))
	if rows[0].(map[string]any)["reset_at"] != "2026-10-17T12:01:00Z" {
		t.Fatal("restoration moved an already anchored reset")
	}
}

func TestMetaMissingDCAAndMalformedUsageNeverReplaceSuccessfulData(t *testing.T) {
	for _, token := range []string{"", "LLM|wrong-kind", "dca:contains whitespace"} {
		credential := Credential{Provider: "meta", Metadata: map[string]any{"dca_token": token},
			Token: func(context.Context) (string, error) { t.Fatal("resolved inference credential"); return "", nil },
			Transport: quotaTransport(func(*http.Request) (*http.Response, error) {
				t.Fatal("sent a request without a valid DCA token")
				return nil, nil
			}),
		}
		resource, _ := ProviderResource(credential, "usage")
		if body, errFetch := resource.Fetch(t.Context()); errFetch == nil || body != nil {
			t.Fatal("invalid DCA credential accepted")
		}
	}
	for _, test := range []struct{ provider, resource, body string }{
		{provider: "devin", resource: "usage", body: `{"userStatus":{"planStatus":{"planInfo":{"planName":"pro"}}}}`},
		{provider: "claude", resource: "usage", body: `{"random":null}`},
		{provider: "claude", resource: "reset_grants", body: `{"cedar_ember":{"eligible":true,"grants":[{"id":"a","resets_total":1,"resets_left":2}]}}`},
	} {
		credential := Credential{Provider: test.provider, Token: func(context.Context) (string, error) { return "fixture", nil },
			Transport: quotaTransport(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(test.body))}, nil
			}),
		}
		resource, _ := ProviderResource(credential, test.resource)
		if body, errFetch := resource.Fetch(t.Context()); errFetch == nil || body != nil {
			t.Fatalf("malformed %s data accepted: %s", test.provider, body)
		}
	}
}
