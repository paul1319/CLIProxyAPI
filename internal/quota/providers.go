package quota

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Credential is a request-local adapter input. It is never serialized into a snapshot.
type Credential struct {
	Provider   string
	Metadata   map[string]any
	Attributes map[string]string
	AccountID  string
	KimiDomain string
	Token      func(context.Context) (string, error)
	Transport  http.RoundTripper
	Plugin     func(context.Context) (json.RawMessage, error)
}

type Resource struct {
	Interval time.Duration
	Fetch    func(context.Context) (json.RawMessage, error)
}

// shape is a positive field allowlist. nil allows a scalar, [] projects an array,
// and * projects dynamic map members through an explicit nested shape.
type shape map[string]shape

func fields(names ...string) shape {
	result := make(shape, len(names))
	for _, name := range names {
		result[name] = nil
	}
	return result
}

func array(element shape) shape { return shape{"[]": element} }

func project(value any, selection shape) (any, bool) {
	if value == nil {
		return nil, true
	}
	if selection == nil {
		switch scalar := value.(type) {
		case string:
			return scalar, len(scalar) <= 512 && !strings.ContainsAny(scalar, "\x00\r\n")
		case bool, json.Number, float64:
			return scalar, true
		}
		return nil, false
	}
	if items, ok := value.([]any); ok {
		element, allowed := selection["[]"]
		if !allowed || len(items) > 1000 {
			return nil, false
		}
		result := make([]any, 0, len(items))
		for _, item := range items {
			if projected, valid := project(item, element); valid {
				result = append(result, projected)
			}
		}
		return result, true
	}
	if object, ok := value.(map[string]any); ok {
		result := make(map[string]any)
		for key, item := range object {
			nested, allowed := selection[key]
			if !allowed && item != nil {
				nested, allowed = selection["*"]
			}
			if !allowed || len(key) > 128 {
				continue
			}
			if projected, valid := project(item, nested); valid {
				result[key] = projected
			}
		}
		return result, len(result) > 0
	}
	if _, allowed := selection["$scalar"]; allowed {
		return project(value, nil)
	}
	return nil, false
}

func sanitize(data []byte, selection shape, allowEmpty bool, validators ...func(map[string]any) bool) (json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var value any
	if errDecode := decoder.Decode(&value); errDecode != nil {
		return nil, errors.New("invalid quota response")
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		return nil, errors.New("invalid quota response")
	}
	object, isObject := value.(map[string]any)
	if !isObject {
		return nil, errors.New("invalid quota response")
	}
	for _, validate := range validators {
		if !validate(object) {
			return nil, errors.New("invalid quota response")
		}
	}
	projected, valid := project(value, selection)
	if !valid {
		if !allowEmpty {
			return nil, errors.New("quota response contains no recognized data")
		}
		projected = map[string]any{}
	}
	anchorResetTimes(projected, time.Now())
	return json.Marshal(projected)
}

// Relative provider countdowns are anchored once, before persistence or browser hydration.
func anchorResetTimes(value any, observedAt time.Time) {
	switch object := value.(type) {
	case map[string]any:
		hasAbsolute := false
		for _, name := range []string{"reset_at", "resetAt", "reset_time", "resetTime"} {
			if field := object[name]; field != nil {
				text := stringValue(field)
				if number, errParse := strconv.ParseFloat(text, 64); errParse == nil && number > 0 && !math.IsInf(number, 0) {
					hasAbsolute = true
				}
				if _, errParse := time.Parse(time.RFC3339Nano, text); errParse == nil {
					hasAbsolute = true
				}
			}
		}
		if !hasAbsolute {
			for _, name := range []string{"reset_after_seconds", "resetAfterSeconds", "reset_in", "resetIn", "ttl"} {
				seconds, errParse := strconv.ParseFloat(stringValue(object[name]), 64)
				if errParse == nil && seconds >= 0 && seconds <= 100*365*86400 && !math.IsNaN(seconds) {
					object["reset_at"] = observedAt.Add(time.Duration(seconds * float64(time.Second))).UTC().Format(time.RFC3339Nano)
					break
				}
			}
		}
		for _, nested := range object {
			anchorResetTimes(nested, observedAt)
		}
	case []any:
		for _, nested := range object {
			anchorResetTimes(nested, observedAt)
		}
	}
}

func metadataString(credential Credential, names ...string) string {
	for _, name := range names {
		if value, ok := credential.Metadata[name].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
		if value := strings.TrimSpace(credential.Attributes[name]); value != "" {
			return value
		}
	}
	for _, name := range []string{"installed", "web", "user", "oauth"} {
		if nested, ok := credential.Metadata[name].(map[string]any); ok {
			for _, field := range names {
				if value, okValue := nested[field].(string); okValue && strings.TrimSpace(value) != "" {
					return strings.TrimSpace(value)
				}
			}
		}
	}
	return ""
}

func retryAt(header http.Header, now time.Time) time.Time {
	value := strings.TrimSpace(header.Get("Retry-After"))
	if seconds, errParse := strconv.ParseInt(value, 10, 64); errParse == nil && seconds >= 0 && seconds <= 86400*30 {
		return now.Add(time.Duration(seconds) * time.Second)
	}
	parsed, _ := http.ParseTime(value)
	return parsed
}

func httpResource(credential Credential, method string, urls []string, headers map[string]string, body string, selection shape, interval time.Duration, allowEmpty bool, validators ...func(map[string]any) bool) Resource {
	return Resource{Interval: interval, Fetch: func(ctx context.Context) (json.RawMessage, error) {
		var token string
		if credential.Provider == "meta" {
			token = metadataString(credential, "dca_token")
			if !strings.HasPrefix(token, "dca:") || strings.ContainsAny(token, " \t\n\r") {
				return nil, &FetchError{Status: http.StatusUnauthorized}
			}
		} else {
			var errToken error
			token, errToken = credential.Token(ctx)
			if errToken != nil || strings.TrimSpace(token) == "" {
				return nil, &FetchError{Status: http.StatusUnauthorized}
			}
		}
		encodedToken, _ := json.Marshal(token)
		requestBody := strings.ReplaceAll(body, "$TOKEN$", string(encodedToken[1:len(encodedToken)-1]))
		client := &http.Client{Transport: credential.Transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
		var lastError error
		for _, target := range urls {
			req, errRequest := http.NewRequestWithContext(ctx, method, target, strings.NewReader(requestBody))
			if errRequest != nil {
				return nil, errors.New("invalid quota request")
			}
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			for key, value := range headers {
				req.Header.Set(key, value)
			}
			response, errDo := client.Do(req)
			if errDo != nil {
				lastError = errors.New("quota request failed")
				continue
			}
			data, errRead := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
			errClose := response.Body.Close()
			if response.StatusCode < 200 || response.StatusCode >= 300 {
				lastError = &FetchError{Status: response.StatusCode, RetryAt: retryAt(response.Header, time.Now())}
				if response.StatusCode == 429 || response.StatusCode == 401 {
					return nil, lastError
				}
				continue
			}
			if errRead != nil || errClose != nil || len(data) > 1<<20 {
				lastError = errors.New("invalid quota response")
				continue
			}
			projected, errProject := sanitize(data, selection, allowEmpty, validators...)
			if errProject == nil {
				return projected, nil
			}
			lastError = errProject
		}
		return nil, lastError
	}}
}

// ProviderResource accepts fixed operations, never a caller-supplied URL or body.
// These operations only read quota or subscription state; none run inference or spend credits.
func ProviderResource(credential Credential, name string) (Resource, error) {
	headers := map[string]string{"Accept": "application/json"}
	get := func(target string, selection shape, interval time.Duration, validators ...func(map[string]any) bool) (Resource, error) {
		return httpResource(credential, http.MethodGet, []string{target}, headers, "", selection, interval, false, validators...), nil
	}
	switch credential.Provider {
	case "claude":
		headers["User-Agent"] = "claude-cli/2.1.280 (external, cli)"
		headers["anthropic-beta"] = "oauth-2025-04-20"
		switch name {
		case "usage":
			window := fields("utilization", "resets_at", "limit_dollars", "used_dollars", "remaining_dollars")
			selection := shape{"*": window,
				"extra_usage": fields("is_enabled", "monthly_limit", "used_credits", "utilization", "currency", "disabled_reason", "user_disabled", "spend_limit_reached"),
				"limits":      array(shape{"kind": nil, "group": nil, "percent": nil, "resets_at": nil, "is_active": nil, "scope": {"model": fields("id", "display_name")}}),
			}
			return get("https://api.anthropic.com/api/oauth/usage", selection, UsageInterval, validClaudeUsage)
		case "profile":
			return get("https://api.anthropic.com/api/oauth/profile", shape{
				"account":      fields("has_claude_max", "has_claude_pro"),
				"organization": fields("uuid", "organization_type", "billing_type", "rate_limit_tier", "has_extra_usage_enabled", "subscription_status", "subscription_created_at"),
			}, time.Hour)
		case "reset_grants":
			grant := fields("id", "label", "resets_total", "resets_left", "starts_at", "ends_at", "paused", "usable_now", "use_requires_limit")
			grant["clears"], grant["percent_used"] = array(nil), fields("five_hour", "seven_day", "seven_day_overage_included")
			block := fields("eligible", "ineligible_reason", "at_limit", "next_grant_id", "weekly_resets_at", "cooldown_until")
			block["grants"] = array(grant)
			return get("https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1", shape{"cedar_ember": block}, 10*time.Minute, validClaudeGrants)
		}
	case "codex":
		headers["User-Agent"] = "codex-tui/0.149.1 (Mac OS 26.5.2; arm64)"
		if credential.AccountID != "" {
			headers["Chatgpt-Account-Id"] = credential.AccountID
		}
		switch name {
		case "usage":
			window := fields("used_percent", "usedPercent", "limit_window_seconds", "limitWindowSeconds", "reset_after_seconds", "resetAfterSeconds", "reset_at", "resetAt")
			limit := shape{"limit_reached": nil, "limitReached": nil, "allowed": nil, "primary_window": window, "primaryWindow": window, "secondary_window": window, "secondaryWindow": window}
			credits := fields("available_count", "availableCount", "applicable_available_count", "applicableAvailableCount")
			return get("https://chatgpt.com/backend-api/wham/usage", shape{
				"plan_type": nil, "planType": nil, "credits": fields("has_credits", "unlimited", "balance"),
				"rate_limit": limit, "rateLimit": limit, "code_review_rate_limit": limit, "codeReviewRateLimit": limit,
				"additional_rate_limits":   array(shape{"limit_name": nil, "limitName": nil, "metered_feature": nil, "meteredFeature": nil, "rate_limit": limit, "rateLimit": limit}),
				"additionalRateLimits":     array(shape{"limit_name": nil, "limitName": nil, "metered_feature": nil, "meteredFeature": nil, "rate_limit": limit, "rateLimit": limit}),
				"rate_limit_reset_credits": credits, "rateLimitResetCredits": credits,
			}, UsageInterval)
		case "subscription":
			if credential.AccountID == "" {
				return Resource{}, errors.New("subscription account identity unavailable")
			}
			return get("https://chatgpt.com/backend-api/subscriptions?account_id="+url.QueryEscape(credential.AccountID), fields("active_until", "activeUntil"), time.Hour)
		case "reset_credits":
			headers["OpenAI-Beta"], headers["Originator"] = "codex-1", "Codex Desktop"
			credit := fields("id", "status", "reset_type", "resetType", "granted_at", "grantedAt", "expires_at", "expiresAt")
			return get("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits", shape{
				"available_count": nil, "availableCount": nil, "applicable_available_count": nil, "applicableAvailableCount": nil, "credits": array(credit),
			}, 10*time.Minute)
		}
	case "xai":
		headers["x-xai-token-auth"], headers["x-grok-client-version"] = "xai-grok-cli", "1.0.46"
		headers["User-Agent"] = "grok-pager/1.0.46 grok-shell/1.0.46 (macos; aarch64)"
		if user := metadataString(credential, "sub", "subject", "user_id", "userId"); user != "" {
			headers["x-userid"] = user
		} else if user, ok := credential.Metadata["user"].(map[string]any); ok {
			if id, okID := user["id"].(string); okID {
				headers["x-userid"] = id
			}
		}
		switch name {
		case "weekly", "monthly":
			amount := shape{"val": nil, "$scalar": nil}
			config := fields("creditUsagePercent", "credit_usage_percent", "billingPeriodStart", "billing_period_start", "billingPeriodEnd", "billing_period_end")
			for _, key := range []string{"monthlyLimit", "monthly_limit", "used", "onDemandCap", "on_demand_cap", "onDemandUsed", "on_demand_used", "prepaidBalance", "prepaid_balance"} {
				config[key] = amount
			}
			config["currentPeriod"], config["current_period"] = fields("type", "start", "end"), fields("type", "start", "end")
			config["productUsage"], config["product_usage"] = array(fields("product", "usagePercent", "usage_percent")), array(fields("product", "usagePercent", "usage_percent"))
			target := "https://cli-chat-proxy.grok.com/v1/billing"
			if name == "weekly" {
				target += "?format=credits"
			}
			return get(target, shape{"config": config}, UsageInterval)
		case "user":
			return get("https://cli-chat-proxy.grok.com/v1/user?include=subscription", fields("subscriptionTier", "subscription_tier"), time.Hour)
		case "settings":
			return get("https://cli-chat-proxy.grok.com/v1/settings", fields("subscription_tier_display", "subscriptionTierDisplay"), time.Hour)
		}
	case "kimi", "kimi-ai":
		if name == "usage" {
			detail := fields("used", "limit", "remaining", "name", "title", "resetAt", "reset_at", "resetTime", "reset_time", "resetIn", "reset_in", "ttl", "scope", "duration", "timeUnit")
			limit := fields("used", "limit", "remaining", "name", "title", "resetAt", "reset_at", "resetTime", "reset_time", "resetIn", "reset_in", "ttl", "scope", "duration", "timeUnit")
			limit["detail"], limit["window"] = detail, fields("duration", "timeUnit")
			target := "https://api.kimi.com/coding/v1/usages"
			if credential.KimiDomain == "kimi.ai" {
				target = "https://api.kimi.ai/coding/v1/usages"
			}
			return get(target, shape{"usage": detail, "limits": array(limit), "usages": {"limit_month_total": fields("used_ratio", "reset_time")}}, UsageInterval)
		}
	case "devin":
		if name == "usage" {
			headers["Connect-Protocol-Version"] = "1"
			selection := shape{"userStatus": {"planStatus": {
				"dailyQuotaRemainingPercent": nil, "dailyQuotaResetAtUnix": nil, "weeklyQuotaRemainingPercent": nil, "weeklyQuotaResetAtUnix": nil,
				"planStart": nil, "planEnd": nil, "planInfo": fields("planName"),
			}}}
			return httpResource(credential, http.MethodPost, []string{"https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus"}, headers,
				`{"metadata":{"ideName":"chisel","ideVersion":"3000.10.21","apiKey":"$TOKEN$","locale":"en","os":"darwin","extensionVersion":"3000.10.21","clientName":"chisel"}}`, selection, UsageInterval, false, validDevinUsage), nil
		}
	case "meta":
		if name == "usage" {
			headers["x-api-version"] = "1.0.0"
			window := fields("used_percent", "resets_at", "window_duration_mins")
			return httpResource(credential, http.MethodPost, []string{"https://api.meta.ai/muse-code/key"}, headers, "{}", shape{
				"subs_tier_name": nil, "is_subs_active": nil, "subs_usage": {"tier": nil, "window": window, "weekly": window},
			}, UsageInterval, true), nil
		}
	case "antigravity":
		headers["User-Agent"] = "antigravity/hub/2.23.0 darwin/arm64"
		switch name {
		case "usage":
			projectID := metadataString(credential, "project_id", "projectId", "gemini_virtual_project")
			if projectID == "" {
				return Resource{}, errors.New("quota project identity unavailable")
			}
			body, _ := json.Marshal(map[string]string{"project": projectID})
			bucket := fields("bucketId", "bucket_id", "displayName", "display_name", "window", "resetTime", "reset_time", "remainingFraction", "remaining_fraction", "description")
			return httpResource(credential, http.MethodPost, []string{
				"https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
				"https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary",
				"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",
			}, headers, string(body), shape{"groups": array(shape{"displayName": nil, "display_name": nil, "description": nil, "buckets": array(bucket)})}, UsageInterval, false), nil
		case "subscription":
			tier := fields("id", "name")
			return httpResource(credential, http.MethodPost, []string{"https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"}, headers,
				`{"metadata":{"ideType":"ANTIGRAVITY"}}`, shape{"currentTier": tier, "current_tier": tier, "paidTier": tier, "paid_tier": tier}, time.Hour, false), nil
		}
	}
	if name == "plugin" && credential.Plugin != nil {
		return Resource{Interval: UsageInterval, Fetch: credential.Plugin}, nil
	}
	return Resource{}, errors.New("quota resource is not supported for this credential")
}

func validClaudeUsage(value map[string]any) bool {
	for _, key := range []string{"five_hour", "seven_day", "extra_usage", "limits"} {
		if _, present := value[key]; present {
			return true
		}
	}
	for _, raw := range value {
		if window, ok := raw.(map[string]any); ok {
			_, utilization := window["utilization"]
			_, resets := window["resets_at"]
			if utilization && resets {
				return true
			}
		}
	}
	return false
}

func validDevinUsage(value map[string]any) bool {
	user, _ := value["userStatus"].(map[string]any)
	status, _ := user["planStatus"].(map[string]any)
	for _, prefix := range []string{"daily", "weekly"} {
		if number, errParse := strconv.ParseFloat(stringValue(status[prefix+"QuotaRemainingPercent"]), 64); errParse == nil && number >= 0 && number <= 100 {
			return true
		}
		if number, errParse := strconv.ParseInt(stringValue(status[prefix+"QuotaResetAtUnix"]), 10, 64); errParse == nil && number > 0 && number < 8640000000000 {
			return true
		}
	}
	return false
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case json.Number:
		return string(typed)
	case string:
		return typed
	default:
		return ""
	}
}

var resetGrantID = regexp.MustCompile(`^[a-z0-9_-]{1,40}$`)

func validClaudeGrants(value map[string]any) bool {
	block, _ := value["cedar_ember"].(map[string]any)
	if _, valid := block["eligible"].(bool); !valid {
		return false
	}
	if reason := block["ineligible_reason"]; reason != nil {
		if _, valid := reason.(string); !valid {
			return false
		}
	}
	validFields := func(object map[string]any, booleans, timestamps []string) bool {
		for _, name := range booleans {
			if field := object[name]; field != nil {
				if _, valid := field.(bool); !valid {
					return false
				}
			}
		}
		for _, name := range timestamps {
			if field := object[name]; field != nil {
				text, valid := field.(string)
				if !valid {
					return false
				}
				if _, errParse := time.Parse(time.RFC3339Nano, text); errParse != nil {
					return false
				}
			}
		}
		return true
	}
	if !validFields(block, []string{"at_limit"}, []string{"weekly_resets_at", "cooldown_until"}) {
		return false
	}
	if block["grants"] == nil {
		return true
	}
	grants, valid := block["grants"].([]any)
	if !valid {
		return false
	}
	seen := make(map[string]bool)
	for _, raw := range grants {
		grant, validObject := raw.(map[string]any)
		if !validObject {
			return false
		}
		id, validID := grant["id"].(string)
		if !validID || !resetGrantID.MatchString(id) || seen[id] {
			return false
		}
		seen[id] = true
		total, validTotal := grant["resets_total"].(json.Number)
		left, validLeft := grant["resets_left"].(json.Number)
		totalCount, errTotal := total.Int64()
		leftCount, errLeft := left.Int64()
		if !validTotal || !validLeft || errTotal != nil || errLeft != nil || totalCount < 0 || totalCount > 9007199254740991 || leftCount < 0 || leftCount > totalCount {
			return false
		}
		if !validFields(grant, []string{"paused", "usable_now", "use_requires_limit"}, []string{"starts_at", "ends_at"}) {
			return false
		}
		if grant["clears"] != nil {
			if _, validClears := grant["clears"].([]any); !validClears {
				return false
			}
		}
	}
	return true
}
