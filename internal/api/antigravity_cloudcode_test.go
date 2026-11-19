package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MoeForge/moego/json"
	"github.com/gin-gonic/gin"
	proxyconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

type antigravityCloudCodeCapture struct {
	mu        sync.Mutex
	calls     int
	path      string
	query     string
	authz     string
	userAgent string
	body      []byte
}

func newAntigravityCloudCodeTestServer(t *testing.T, enabled bool) (*Server, *antigravityCloudCodeCapture) {
	t.Helper()
	capture := &antigravityCloudCodeCapture{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		capture.mu.Lock()
		capture.calls++
		capture.path = r.URL.Path
		capture.query = r.URL.RawQuery
		capture.authz = r.Header.Get("Authorization")
		capture.userAgent = r.Header.Get("User-Agent")
		capture.body = body
		capture.mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"response\":{\"responseId\":\"r1\"}}\n\n")
		_, _ = io.WriteString(w, "data: {\"response\":{\"responseId\":\"r2\"}}\n\n")
	}))
	t.Cleanup(upstream.Close)

	cfg := &proxyconfig.Config{SDKConfig: sdkconfig.SDKConfig{APIKeys: []string{"test-key"}}}
	cfg.Antigravity.CloudCodePassthrough = enabled
	server := newTestServerWithConfig(t, cfg)
	server.handlers.AuthManager.RegisterExecutor(executor.NewAntigravityExecutor(server.getConfig()))
	registerAntigravityCloudCodeAuth(t, server, "antigravity-pool", "pool", upstream.URL)
	return server, capture
}

func registerAntigravityCloudCodeAuth(t *testing.T, server *Server, id, name, baseURL string) {
	t.Helper()
	if _, errRegister := server.handlers.AuthManager.Register(context.Background(), &auth.Auth{
		ID:       id,
		Provider: "antigravity",
		Status:   auth.StatusActive,
		Metadata: map[string]any{
			"access_token": name + "-token",
			"project_id":   name + "-project",
			"base_url":     baseURL,
			"expired":      time.Now().Add(time.Hour).Format(time.RFC3339),
		},
	}); errRegister != nil {
		t.Fatalf("Register auth: %v", errRegister)
	}
}

const antigravityCloudCodeQuotaBody = `{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED",` +
	`"details":[{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"QUOTA_EXHAUSTED"},` +
	`{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"3600s"}]}}`

// newAntigravityQuotaUpstream returns an upstream that always reports exhausted quota.
func newAntigravityQuotaUpstream(t *testing.T, calls *int, mu *sync.Mutex) string {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		mu.Lock()
		*calls++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, antigravityCloudCodeQuotaBody)
	}))
	t.Cleanup(upstream.Close)
	return upstream.URL
}

func TestAntigravityCloudCodePassthroughSwitchesAccountOnQuota(t *testing.T) {
	server, capture := newAntigravityCloudCodeTestServer(t, true)
	var exhaustedCalls int
	registerAntigravityCloudCodeAuth(t, server, "antigravity-exhausted", "exhausted", newAntigravityQuotaUpstream(t, &exhaustedCalls, &capture.mu))

	const body = `{"project":"client-project","model":"gemini-x","request":{"contents":[]}}`
	for i := 0; i < 4; i++ {
		recorder := serveAntigravityCloudCode(server, "/antigravity-cloudcode/test-key/v1internal:streamGenerateContent?alt=sse", body)
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"r2"`) {
			t.Fatalf("request %d: status = %d, body = %s", i, recorder.Code, recorder.Body.String())
		}
	}

	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.calls != 4 {
		t.Fatalf("healthy upstream calls = %d, want 4", capture.calls)
	}
	if exhaustedCalls != 1 {
		t.Fatalf("exhausted upstream calls = %d, want 1 (tried once, then cooled)", exhaustedCalls)
	}
	if capture.authz != "Bearer pool-token" {
		t.Fatalf("upstream Authorization = %q", capture.authz)
	}
	if !strings.Contains(string(capture.body), `"project":"pool-project"`) {
		t.Fatalf("retried body was not re-pointed at the healthy project: %s", capture.body)
	}
}

func TestAntigravityCloudCodePassthroughAllAccountsExhausted(t *testing.T) {
	cfg := &proxyconfig.Config{SDKConfig: sdkconfig.SDKConfig{APIKeys: []string{"test-key"}}}
	cfg.Antigravity.CloudCodePassthrough = true
	server := newTestServerWithConfig(t, cfg)
	server.handlers.AuthManager.RegisterExecutor(executor.NewAntigravityExecutor(server.getConfig()))
	var mu sync.Mutex
	var calls int
	registerAntigravityCloudCodeAuth(t, server, "antigravity-exhausted", "exhausted", newAntigravityQuotaUpstream(t, &calls, &mu))

	const path = "/antigravity-cloudcode/test-key/v1internal:streamGenerateContent?alt=sse"
	const body = `{"project":"p","model":"gemini-x"}`
	first := serveAntigravityCloudCode(server, path, body)
	if first.Code != http.StatusTooManyRequests || !strings.Contains(first.Body.String(), "QUOTA_EXHAUSTED") {
		t.Fatalf("first: status = %d, body = %s", first.Code, first.Body.String())
	}
	second := serveAntigravityCloudCode(server, path, body)
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second: status = %d, body = %s", second.Code, second.Body.String())
	}
	var parsed map[string]any
	if errUnmarshal := json.Unmarshal(second.Body.Bytes(), &parsed); errUnmarshal != nil {
		t.Fatalf("second body %q is not JSON: %v", second.Body.String(), errUnmarshal)
	}

	mu.Lock()
	if calls != 1 {
		mu.Unlock()
		t.Fatalf("upstream calls = %d, want 1 (cooled credential must not be retried)", calls)
	}
	mu.Unlock()

	// Cloud Code quotas are per model: another model still uses the credential.
	other := serveAntigravityCloudCode(server, path, `{"project":"p","model":"MODEL_PLACEHOLDER_M400"}`)
	if other.Code != http.StatusTooManyRequests || !strings.Contains(other.Body.String(), "QUOTA_EXHAUSTED") {
		t.Fatalf("other model: status = %d, body = %s", other.Code, other.Body.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 2 {
		t.Fatalf("upstream calls = %d, want 2 (other model must not be blocked)", calls)
	}
}

func TestAntigravityCloudCodePassthroughDropsUnauthorizedCredential(t *testing.T) {
	server, capture := newAntigravityCloudCodeTestServer(t, true)
	var mu sync.Mutex
	var revokedCalls int
	revoked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		mu.Lock()
		revokedCalls++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"code":401,"message":"Request had invalid authentication credentials.","status":"UNAUTHENTICATED"}}`)
	}))
	t.Cleanup(revoked.Close)
	registerAntigravityCloudCodeAuth(t, server, "antigravity-revoked", "revoked", revoked.URL)

	for i, model := range []string{"gemini-x", "claude-y", "gemini-x", "claude-y"} {
		recorder := serveAntigravityCloudCode(server, "/antigravity-cloudcode/test-key/v1internal:generateContent", `{"project":"p","model":"`+model+`"}`)
		if recorder.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, body = %s", i, recorder.Code, recorder.Body.String())
		}
	}
	// Account-wide failures also go through the pool for metadata calls without a model.
	if recorder := serveAntigravityCloudCode(server, "/antigravity-cloudcode/test-key/v1internal:loadCodeAssist", `{}`); recorder.Code != http.StatusOK {
		t.Fatalf("loadCodeAssist: status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	mu.Lock()
	defer mu.Unlock()
	if revokedCalls != 1 {
		t.Fatalf("revoked upstream calls = %d, want 1 (tried once, then out of the pool)", revokedCalls)
	}
	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.calls != 5 {
		t.Fatalf("healthy upstream calls = %d, want 5", capture.calls)
	}
}

func serveAntigravityCloudCode(server *Server, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer google-client-token")
	req.Header.Set("User-Agent", "antigravity/cli/1.5.12 (aidev_client; os_type=darwin)")
	recorder := httptest.NewRecorder()
	server.engine.ServeHTTP(recorder, req)
	return recorder
}

func TestAntigravityCloudCodePassthroughUsesPooledCredential(t *testing.T) {
	server, capture := newAntigravityCloudCodeTestServer(t, true)

	recorder := serveAntigravityCloudCode(server,
		"/antigravity-cloudcode/test-key/v1internal:streamGenerateContent?alt=sse",
		`{"project":"client-project","model":"gemini-x","requestType":"agent","request":{"contents":[]}}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content type = %q", got)
	}
	if got := recorder.Body.String(); !strings.Contains(got, `"r1"`) || !strings.Contains(got, `"r2"`) {
		t.Fatalf("response body = %q", got)
	}

	capture.mu.Lock()
	defer capture.mu.Unlock()
	if capture.path != "/v1internal:streamGenerateContent" || capture.query != "alt=sse" {
		t.Fatalf("upstream path = %q query = %q", capture.path, capture.query)
	}
	if capture.authz != "Bearer pool-token" {
		t.Fatalf("upstream Authorization = %q, want pooled token", capture.authz)
	}
	if !strings.HasPrefix(capture.userAgent, "antigravity/cli/1.5.12") {
		t.Fatalf("upstream User-Agent = %q, want client UA", capture.userAgent)
	}
	var sent map[string]any
	if errUnmarshal := json.Unmarshal(capture.body, &sent); errUnmarshal != nil {
		t.Fatalf("upstream body %q: %v", capture.body, errUnmarshal)
	}
	if sent["project"] != "pool-project" || sent["model"] != "gemini-x" || sent["requestType"] != "agent" {
		t.Fatalf("upstream body = %s", capture.body)
	}
}

func TestAntigravityCloudCodePassthroughRejectsRequests(t *testing.T) {
	tests := []struct {
		name       string
		enabled    bool
		path       string
		wantStatus int
	}{
		{name: "disabled", enabled: false, path: "/antigravity-cloudcode/test-key/v1internal:loadCodeAssist", wantStatus: http.StatusNotFound},
		{name: "wrong key", enabled: true, path: "/antigravity-cloudcode/bad-key/v1internal:loadCodeAssist", wantStatus: http.StatusUnauthorized},
		{name: "not v1internal", enabled: true, path: "/antigravity-cloudcode/test-key/v1/models", wantStatus: http.StatusNotFound},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server, capture := newAntigravityCloudCodeTestServer(t, test.enabled)
			recorder := serveAntigravityCloudCode(server, test.path, `{"metadata":{}}`)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", recorder.Code, test.wantStatus, recorder.Body.String())
			}
			capture.mu.Lock()
			defer capture.mu.Unlock()
			if capture.calls != 0 {
				t.Fatalf("upstream called %d times", capture.calls)
			}
		})
	}
}

func TestAntigravityCloudCodeKeyMiddlewareMasksPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	var seenPath, seenAuthz, seenParam string
	engine.Use(antigravityCloudCodeKeyMiddleware())
	engine.POST(antigravityCloudCodePrefix+":key/*method", func(c *gin.Context) {
		seenPath = c.Request.URL.Path
		seenAuthz = c.GetHeader("Authorization")
		seenParam = c.Param("method")
	})
	req := httptest.NewRequest(http.MethodPost, "/antigravity-cloudcode/secret-key/v1internal:fetchUserInfo", nil)
	req.Header.Set("Authorization", "Bearer google-client-token")
	engine.ServeHTTP(httptest.NewRecorder(), req)

	if strings.Contains(seenPath, "secret-key") || seenPath != "/antigravity-cloudcode/-/v1internal:fetchUserInfo" {
		t.Fatalf("path = %q, want masked key", seenPath)
	}
	if seenAuthz != "Bearer secret-key" {
		t.Fatalf("Authorization = %q", seenAuthz)
	}
	if seenParam != "/v1internal:fetchUserInfo" {
		t.Fatalf("method param = %q", seenParam)
	}
}

func TestRewriteAntigravityCloudCodeProject(t *testing.T) {
	tests := []struct {
		name, body, project, want string
	}{
		{name: "replaces project", body: `{"project":"a","x":1}`, project: "b", want: `{"project":"b","x":1}`},
		{name: "no project field", body: `{"metadata":{"ideType":"ANTIGRAVITY"}}`, project: "b", want: `{"metadata":{"ideType":"ANTIGRAVITY"}}`},
		{name: "empty auth project", body: `{"project":"a"}`, project: "", want: `{"project":"a"}`},
		{name: "empty body", body: ``, project: "b", want: ``},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := string(rewriteAntigravityCloudCodeProject([]byte(test.body), test.project)); got != test.want {
				t.Fatalf("got %s, want %s", got, test.want)
			}
		})
	}
}
