package api

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MoeForge/moego/ojson"
	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/clienterror"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/runtime/executor/helps"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	log "github.com/sirupsen/logrus"
)

// antigravityCloudCodePrefix is the base path native Antigravity clients use as their
// --cloud_code_endpoint. The client cannot send a custom auth header (it always sends
// its own Google token), so the CLIProxyAPI key travels as the first path segment.
const antigravityCloudCodePrefix = "/antigravity-cloudcode/"

const antigravityCloudCodeMethodPrefix = "v1internal:"

// splitAntigravityCloudCodePath extracts the API key and the remaining path from
// /antigravity-cloudcode/<key>/<rest>.
func splitAntigravityCloudCodePath(path string) (key, rest string, ok bool) {
	trimmed, found := strings.CutPrefix(path, antigravityCloudCodePrefix)
	if !found {
		return "", "", false
	}
	key, rest, found = strings.Cut(trimmed, "/")
	if !found || key == "" {
		return "", "", false
	}
	return key, "/" + rest, true
}

// antigravityCloudCodeKeyMiddleware moves the path-embedded API key into the
// Authorization header (replacing the client's Google token, which must never reach
// upstream) and masks it in URL.Path. It must run before any logging middleware.
// Gin has already matched the route, so path params still hold the original values.
func antigravityCloudCodeKeyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if key, rest, ok := splitAntigravityCloudCodePath(c.Request.URL.Path); ok {
			c.Request.Header.Set("Authorization", "Bearer "+key)
			c.Request.URL.Path = antigravityCloudCodePrefix + "-" + rest
			c.Request.URL.RawPath = ""
		}
		c.Next()
	}
}

// antigravityCloudCodeEnabledMiddleware hides the passthrough unless it is enabled.
func (s *Server) antigravityCloudCodeEnabledMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := s.getConfig()
		if cfg == nil || !cfg.Antigravity.CloudCodePassthrough {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.Next()
	}
}

// antigravityCloudCodeErrorBody builds a Google API style error, which is what
// Antigravity clients parse.
func antigravityCloudCodeErrorBody(status int, message string) []byte {
	doc := ojson.NewDoc([]byte(`{"error":{}}`))
	_ = doc.Set("error.code", status)
	_ = doc.Set("error.message", message)
	_ = doc.Set("error.status", strings.ToUpper(strings.ReplaceAll(http.StatusText(status), " ", "_")))
	return doc.Bytes()
}

func writeAntigravityCloudCodeError(c *gin.Context, status int, message string) {
	c.Data(status, "application/json", antigravityCloudCodeErrorBody(status, message))
}

// rewriteAntigravityCloudCodeProject points the request at the selected credential's
// project. Requests without a top-level "project" are returned unchanged.
func rewriteAntigravityCloudCodeProject(body []byte, projectID string) []byte {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" || len(bytes.TrimSpace(body)) == 0 {
		return body
	}
	doc := ojson.NewDoc(body)
	current := doc.Get("project")
	if !current.Exists() || current.String() == projectID {
		return body
	}
	if errSet := doc.Set("project", projectID); errSet != nil {
		log.Warnf("antigravity cloudcode: rewrite project failed: %v", errSet)
		return body
	}
	return doc.Bytes()
}

// antigravityCloudCodeFailure is an upstream error response kept so it can be returned
// to the client when every credential failed.
type antigravityCloudCodeFailure struct {
	status      int
	contentType string
	body        []byte
}

func (f *antigravityCloudCodeFailure) write(c *gin.Context) {
	if f.contentType != "" {
		c.Header("Content-Type", f.contentType)
	}
	c.Status(f.status)
	if len(f.body) > 0 {
		_, _ = c.Writer.Write(f.body)
	}
}

// antigravityCloudCodeSwitchStatus reports upstream statuses that are specific to the
// credential (auth, quota, capacity) and worth retrying with another account.
func antigravityCloudCodeSwitchStatus(status int) bool {
	switch status {
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden,
		http.StatusTooManyRequests, http.StatusServiceUnavailable:
		return true
	}
	return false
}

// antigravityCloudCodeDefaultCooldown applies when a quota error carries no retry delay.
const antigravityCloudCodeDefaultCooldown = time.Minute

// antigravityCloudCodeCooldowns tracks which credentials are cooling down for which
// client model. Cloud Code quotas are per model, and native clients use model names
// (e.g. MODEL_PLACEHOLDER_M400) that the pool's registry does not know, so these
// cooldowns are kept here instead of in the pool's model states, where an unknown
// model's cooldown would block the credential for every other model.
type antigravityCloudCodeCooldowns struct {
	mu    sync.Mutex
	until map[string]time.Time
}

func antigravityCloudCodeCooldownKey(authID, model string) string {
	return authID + "\x00" + strings.ToLower(model)
}

func (c *antigravityCloudCodeCooldowns) set(authID, model string, until time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.until == nil {
		c.until = make(map[string]time.Time)
	}
	c.until[antigravityCloudCodeCooldownKey(authID, model)] = until
}

func (c *antigravityCloudCodeCooldowns) active(authID, model string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	key := antigravityCloudCodeCooldownKey(authID, model)
	until, ok := c.until[key]
	if !ok {
		return false
	}
	if !until.After(now) {
		delete(c.until, key)
		return false
	}
	return true
}

func (c *antigravityCloudCodeCooldowns) clear(authID, model string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.until, antigravityCloudCodeCooldownKey(authID, model))
}

// selectAntigravityCloudCodeAuth picks the next untried Antigravity credential that is
// not cooling down for model. Skipped credentials are added to tried; when only cooling
// credentials remain, the error is a 429 so the client backs off.
func (s *Server) selectAntigravityCloudCodeAuth(ctx context.Context, model string, tried map[string]struct{}) (*auth.Auth, error) {
	manager := s.handlers.AuthManager
	skippedCooling := false
	for {
		selected, errSelect := manager.SelectAuthExcluding(ctx, "antigravity", "", coreexecutor.Options{}, tried)
		if errSelect != nil {
			if skippedCooling {
				return nil, &auth.Error{
					Code:       "model_cooldown",
					Message:    "all Antigravity credentials are cooling down for model " + model,
					HTTPStatus: http.StatusTooManyRequests,
				}
			}
			return nil, errSelect
		}
		if !s.antigravityCloudCodeCooldowns.active(selected.ID, model, time.Now()) {
			return selected, nil
		}
		skippedCooling = true
		tried[selected.ID] = struct{}{}
	}
}

// handleAntigravityCloudCode forwards one Cloud Code v1internal call through a pooled
// Antigravity credential and streams the upstream response back. Credential-specific
// failures (auth, quota, capacity) are retried with the next credential before any
// byte reaches the client; the client only sees the last failure when all of them fail.
func (s *Server) handleAntigravityCloudCode(c *gin.Context) {
	method := strings.TrimPrefix(c.Param("method"), "/")
	if !strings.HasPrefix(method, antigravityCloudCodeMethodPrefix) || strings.Contains(method, "/") {
		writeAntigravityCloudCodeError(c, http.StatusNotFound, "unsupported Cloud Code method")
		return
	}
	ctx := c.Request.Context()
	body, errRead := io.ReadAll(c.Request.Body)
	if errRead != nil {
		writeAntigravityCloudCodeError(c, clienterror.HTTPStatusFromErrorOr(errRead, http.StatusBadRequest), "failed to read request body")
		return
	}
	model := strings.TrimSpace(ojson.GetBytesNoCopy(body, "model").String())

	manager := s.handlers.AuthManager
	maxAttempts := manager.MaxRetryCredentials()
	tried := make(map[string]struct{})
	var lastFailure *antigravityCloudCodeFailure
	for attempt := 0; maxAttempts <= 0 || attempt < maxAttempts; attempt++ {
		selected, errSelect := s.selectAntigravityCloudCodeAuth(ctx, model, tried)
		if errSelect != nil {
			if lastFailure != nil {
				lastFailure.write(c)
				return
			}
			writeAntigravityCloudCodeError(c, clienterror.HTTPStatusFromErrorOr(errSelect, http.StatusServiceUnavailable), errSelect.Error())
			return
		}
		tried[selected.ID] = struct{}{}
		if s.forwardAntigravityCloudCode(c, selected, method, model, body, &lastFailure) {
			return
		}
		if ctx.Err() != nil {
			return
		}
	}
	if lastFailure != nil {
		lastFailure.write(c)
		return
	}
	writeAntigravityCloudCodeError(c, http.StatusServiceUnavailable, "no Antigravity credential available")
}

// forwardAntigravityCloudCode sends the call with one credential. It returns true when
// the response was written to the client, or false (recording lastFailure) when the
// caller should retry with another credential.
func (s *Server) forwardAntigravityCloudCode(c *gin.Context, selected *auth.Auth, method, model string, body []byte, lastFailure **antigravityCloudCodeFailure) bool {
	ctx := c.Request.Context()
	manager := s.handlers.AuthManager
	cfg := s.getConfig()
	logging.SetGinCPATraceID(c, selected.EnsureIndex())

	projectID, _ := selected.Metadata["project_id"].(string)
	body = rewriteAntigravityCloudCodeProject(body, projectID)

	upstreamURL := strings.TrimRight(executor.AntigravityRequestBaseURL(selected), "/") + "/" + method
	if rawQuery := c.Request.URL.RawQuery; rawQuery != "" {
		upstreamURL += "?" + rawQuery
	}
	req, errRequest := http.NewRequestWithContext(ctx, c.Request.Method, upstreamURL, bytes.NewReader(body))
	if errRequest != nil {
		writeAntigravityCloudCodeError(c, http.StatusBadRequest, "invalid request")
		return true
	}
	for _, name := range []string{"Content-Type", "User-Agent"} {
		if value := strings.TrimSpace(c.GetHeader(name)); value != "" {
			req.Header.Set(name, value)
		}
	}

	authType, authValue := selected.AccountInfo()
	helps.RecordAPIRequest(ctx, cfg, helps.UpstreamRequestLog{
		URL:       upstreamURL,
		Method:    req.Method,
		Headers:   req.Header.Clone(),
		Body:      body,
		Provider:  "antigravity",
		AuthID:    selected.ID,
		AuthLabel: selected.Label,
		AuthType:  authType,
		AuthValue: authValue,
	})
	resp, errDo := manager.HttpRequest(ctx, selected, req)
	if errDo != nil {
		helps.RecordAPIResponseError(ctx, cfg, errDo)
		if ctx.Err() != nil {
			return true
		}
		// Transport failures are not the credential's fault: try the next one without
		// cooling this one down.
		log.WithFields(log.Fields{"method": method, "auth": selected.ID}).Warnf("antigravity cloudcode: upstream request failed: %v", errDo)
		*lastFailure = &antigravityCloudCodeFailure{
			status:      clienterror.HTTPStatusFromErrorOr(errDo, http.StatusBadGateway),
			contentType: "application/json",
			body:        antigravityCloudCodeErrorBody(clienterror.HTTPStatusFromErrorOr(errDo, http.StatusBadGateway), errDo.Error()),
		}
		return false
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.Errorf("antigravity cloudcode: close response body error: %v", errClose)
		}
	}()
	helps.RecordAPIResponseMetadata(ctx, cfg, resp.StatusCode, resp.Header.Clone())

	if antigravityCloudCodeSwitchStatus(resp.StatusCode) {
		errBody, errReadBody := io.ReadAll(resp.Body)
		helps.AppendAPIResponseChunk(ctx, cfg, errBody)
		if errReadBody != nil {
			helps.RecordAPIResponseError(ctx, cfg, errReadBody)
		}
		s.coolAntigravityCloudCodeAuth(ctx, selected, model, resp.StatusCode, errBody)
		log.WithFields(log.Fields{"method": method, "model": model, "status": resp.StatusCode, "auth": selected.ID}).Warn("antigravity cloudcode: credential failed, switching account")
		*lastFailure = &antigravityCloudCodeFailure{status: resp.StatusCode, contentType: resp.Header.Get("Content-Type"), body: errBody}
		return false
	}

	if resp.StatusCode >= http.StatusBadRequest {
		log.WithFields(log.Fields{"method": method, "status": resp.StatusCode, "auth": selected.ID}).Warn("antigravity cloudcode: upstream request failed")
	} else if model != "" {
		s.antigravityCloudCodeCooldowns.clear(selected.ID, model)
	}

	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		c.Header("Content-Type", contentType)
	}
	c.Status(resp.StatusCode)
	streamAntigravityCloudCodeBody(c, resp.Body, func(chunk []byte) { helps.AppendAPIResponseChunk(ctx, cfg, chunk) })
	return true
}

// coolAntigravityCloudCodeAuth takes a failed credential out of rotation. Quota errors
// cool only the client model, honoring the upstream retry delay; auth and permission
// errors are reported to the pool, which cools or disables the whole credential for
// every client. Capacity errors (503) are usually global, so they only switch.
func (s *Server) coolAntigravityCloudCodeAuth(ctx context.Context, selected *auth.Auth, model string, status int, body []byte) {
	if status == http.StatusServiceUnavailable {
		return
	}
	upstreamErr := executor.AntigravityStatusError(status, body)
	if status == http.StatusTooManyRequests {
		cooldown := antigravityCloudCodeDefaultCooldown
		var retryAfter interface{ RetryAfter() *time.Duration }
		if errors.As(upstreamErr, &retryAfter) {
			if delay := retryAfter.RetryAfter(); delay != nil && *delay > 0 {
				cooldown = *delay
			}
		}
		s.antigravityCloudCodeCooldowns.set(selected.ID, model, time.Now().Add(cooldown))
		return
	}
	result := auth.Result{
		AuthID:          selected.ID,
		Provider:        "antigravity",
		Success:         false,
		CredentialScope: true,
		Error:           auth.ResultErrorFromError(upstreamErr),
	}
	s.handlers.AuthManager.MarkResult(ctx, result)
}

// streamAntigravityCloudCodeBody copies the upstream body and flushes after every read
// so SSE events reach the client as soon as they arrive.
func streamAntigravityCloudCodeBody(c *gin.Context, body io.Reader, record func([]byte)) {
	buf := make([]byte, 32<<10)
	for {
		n, errRead := body.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			record(chunk)
			if _, errWrite := c.Writer.Write(chunk); errWrite != nil {
				return
			}
			c.Writer.Flush()
		}
		if errRead != nil {
			if !errors.Is(errRead, io.EOF) {
				log.Warnf("antigravity cloudcode: read upstream body: %v", errRead)
			}
			return
		}
	}
}

func (s *Server) registerAntigravityCloudCodeRoutes() {
	group := s.engine.Group(antigravityCloudCodePrefix + ":key")
	group.Use(s.antigravityCloudCodeEnabledMiddleware(), AuthMiddleware(s.accessManager))
	group.POST("/*method", s.handleAntigravityCloudCode)
}
