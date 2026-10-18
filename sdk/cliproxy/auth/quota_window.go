package auth

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// QuotaWindowState classifies what is known about one provider quota window.
type QuotaWindowState uint8

const (
	// QuotaWindowUnknown means no usable observation exists for the window.
	QuotaWindowUnknown QuotaWindowState = iota
	// QuotaWindowIdle means the window is not running: the provider reported it
	// unused, or an observed window has already reset.
	QuotaWindowIdle
	// QuotaWindowActive means the window is running.
	QuotaWindowActive
)

const (
	quotaFiveHourSeconds = 5 * 60 * 60
	quotaWeekSeconds     = 7 * 24 * 60 * 60
	quotaMinMonthSeconds = 28 * 24 * 60 * 60
	quotaMaxMonthSeconds = 31 * 24 * 60 * 60
)

// QuotaWindow is a normalized view of one provider quota window.
type QuotaWindow struct {
	State QuotaWindowState
	// ResetAt is when the window resets; zero when the provider did not report it.
	ResetAt time.Time
	// UsedPercent is the consumed share on a 0-100 scale; valid only when UsedKnown.
	// Providers may report values above 100 once a limit is overrun.
	UsedPercent float64
	UsedKnown   bool
	// Exhausted reports an explicit rejection or full consumption.
	Exhausted bool
	// Warning reports a provider early-warning status (Claude allowed_warning).
	Warning bool
	// ObservedAt is when the provider reported this window. A zero value means
	// the window was never observed.
	ObservedAt time.Time
}

// QuotaWindows holds the normalized quota windows of one credential.
type QuotaWindows struct {
	// Short is the rolling burst window (Claude five_hour, Codex five-hour).
	Short QuotaWindow
	// Weekly is the shared long window (Claude seven_day, Codex weekly or monthly).
	Weekly QuotaWindow
	// FableWeekly is the Claude Fable-scoped weekly window. Response headers do
	// not report it, so only usage polling fills it.
	FableWeekly QuotaWindow
}

// IsZero reports whether the window was never observed.
func (w QuotaWindow) IsZero() bool {
	return w.ObservedAt.IsZero()
}

// Effective returns the window as of now. A window whose reset time has
// passed has rolled over: its consumption no longer applies and its next
// reset is unknown until the provider reports it again.
func (w QuotaWindow) Effective(now time.Time) QuotaWindow {
	if w.State != QuotaWindowActive || w.ResetAt.IsZero() || now.Before(w.ResetAt) {
		return w
	}
	return QuotaWindow{State: QuotaWindowIdle, ObservedAt: w.ObservedAt}
}

// IsZero reports whether no window was ever observed.
func (ws QuotaWindows) IsZero() bool {
	return ws.Short.IsZero() && ws.Weekly.IsZero() && ws.FableWeekly.IsZero()
}

// Effective returns every window as of now.
func (ws QuotaWindows) Effective(now time.Time) QuotaWindows {
	return QuotaWindows{
		Short:       ws.Short.Effective(now),
		Weekly:      ws.Weekly.Effective(now),
		FableWeekly: ws.FableWeekly.Effective(now),
	}
}

// Merge keeps the newest observation of each window independently. Header
// observations and usage polls report different subsets of windows, so a
// response that omits a window must never erase it.
func (ws QuotaWindows) Merge(incoming QuotaWindows) QuotaWindows {
	return QuotaWindows{
		Short:       mergeQuotaWindow(ws.Short, incoming.Short),
		Weekly:      mergeQuotaWindow(ws.Weekly, incoming.Weekly),
		FableWeekly: mergeQuotaWindow(ws.FableWeekly, incoming.FableWeekly),
	}
}

func mergeQuotaWindow(current, incoming QuotaWindow) QuotaWindow {
	if incoming.IsZero() || incoming.ObservedAt.Before(current.ObservedAt) {
		return current
	}
	return incoming
}

// finishQuotaWindow derives the window state. It returns a zero window when
// nothing usable was reported, so a sparse observation never replaces a
// richer earlier one.
func finishQuotaWindow(w QuotaWindow) QuotaWindow {
	if w.UsedKnown && w.UsedPercent >= 100 {
		w.Exhausted = true
	}
	switch {
	case !w.ResetAt.IsZero() || w.Exhausted || w.Warning || (w.UsedKnown && w.UsedPercent > 0):
		w.State = QuotaWindowActive
	case w.UsedKnown:
		w.State = QuotaWindowIdle
	default:
		return QuotaWindow{}
	}
	return w
}

// carryQuotaWindows keeps observed windows across ordinary updates such as
// token refreshes, and drops them when the credential now belongs to another
// account, so one account's quota can never rank another.
func carryQuotaWindows(existing, updated *Auth, credentialsChanged bool) QuotaWindows {
	if existing == nil || updated == nil || !strings.EqualFold(strings.TrimSpace(existing.Provider), strings.TrimSpace(updated.Provider)) {
		return QuotaWindows{}
	}
	_, existingAccount := existing.AccountInfo()
	_, updatedAccount := updated.AccountInfo()
	if existingAccount != updatedAccount || (existingAccount == "" && credentialsChanged) {
		return QuotaWindows{}
	}
	return existing.QuotaWindows.Merge(updated.QuotaWindows)
}

// ApplyQuotaWindows merges polled quota windows into the stored credential.
// current receives a copy of the stored credential and is evaluated under the
// manager lock, so a credential replaced while the poll was in flight never
// receives another account's windows.
func (m *Manager) ApplyQuotaWindows(authID string, windows QuotaWindows, current func(*Auth) bool) bool {
	if m == nil || authID == "" || windows.IsZero() {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	auth := m.auths[authID]
	if auth == nil || (current != nil && !current(auth.Clone())) {
		return false
	}
	auth.QuotaWindows = auth.QuotaWindows.Merge(windows)
	return true
}

// quotaWindowsFromHeaders normalizes the quota windows carried by one upstream response.
func quotaWindowsFromHeaders(provider string, headers http.Header, observedAt time.Time) QuotaWindows {
	if len(headers) == 0 || observedAt.IsZero() {
		return QuotaWindows{}
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "claude":
		// The 7d_oi family is deliberately not read: it reports the
		// overage-included claim, not the Fable weekly limit.
		return QuotaWindows{
			Short:  claudeHeaderWindow(headers, "5h", observedAt),
			Weekly: claudeHeaderWindow(headers, "7d", observedAt),
		}
	case "codex":
		return classifyCodexWindows(
			codexHeaderSlot(headers, "Primary", observedAt),
			codexHeaderSlot(headers, "Secondary", observedAt),
		)
	default:
		return QuotaWindows{}
	}
}

func claudeHeaderWindow(headers http.Header, name string, observedAt time.Time) QuotaWindow {
	prefix := "Anthropic-Ratelimit-Unified-" + name + "-"
	status := strings.ToLower(quotaHeader(headers, prefix+"Status"))
	window := QuotaWindow{ObservedAt: observedAt, Exhausted: status == "rejected", Warning: status == "allowed_warning"}
	// Claude reports utilization as a 0-1 fraction in headers.
	if used, ok := quotaNumberValue(quotaHeader(headers, prefix+"Utilization")); ok {
		window.UsedPercent, window.UsedKnown = used*100, true
	}
	window.ResetAt = quotaInstantValue(quotaHeader(headers, prefix+"Reset"))
	return finishQuotaWindow(window)
}

// codexQuotaSlot is one Codex primary or secondary window before classification.
type codexQuotaSlot struct {
	window QuotaWindow
	// seconds is the window length; zero when the provider omitted it.
	seconds int64
}

func codexHeaderSlot(headers http.Header, name string, observedAt time.Time) codexQuotaSlot {
	prefix := "X-Codex-" + name + "-"
	window := QuotaWindow{ObservedAt: observedAt}
	window.UsedPercent, window.UsedKnown = quotaNumberValue(quotaHeader(headers, prefix+"Used-Percent"))
	window.ResetAt = quotaInstantValue(quotaHeader(headers, prefix+"Reset-At"))
	if window.ResetAt.IsZero() {
		if seconds, ok := quotaNumberValue(quotaHeader(headers, prefix+"Reset-After-Seconds")); ok {
			window.ResetAt = observedAt.Add(time.Duration(seconds * float64(time.Second))).UTC()
		}
	}
	slot := codexQuotaSlot{window: finishQuotaWindow(window)}
	if minutes, ok := quotaNumberValue(quotaHeader(headers, prefix+"Window-Minutes")); ok {
		slot.seconds = int64(minutes * 60)
	}
	return slot
}

// classifyCodexWindows assigns windows by their length, because Codex reports
// the weekly window as primary on plans without a five-hour limit. Order is
// only used for legacy payloads that omit the length.
func classifyCodexWindows(primary, secondary codexQuotaSlot) QuotaWindows {
	var result QuotaWindows
	for _, slot := range []codexQuotaSlot{primary, secondary} {
		switch {
		case slot.window.IsZero():
		case slot.seconds == quotaFiveHourSeconds && result.Short.IsZero():
			result.Short = slot.window
		case isCodexLongWindow(slot.seconds) && result.Weekly.IsZero():
			result.Weekly = slot.window
		}
	}
	if primary.seconds == 0 && !primary.window.IsZero() && result.Short.IsZero() {
		result.Short = primary.window
	}
	if secondary.seconds == 0 && !secondary.window.IsZero() && result.Weekly.IsZero() {
		result.Weekly = secondary.window
	}
	return result
}

// isCodexLongWindow reports a weekly window, or the monthly window that
// replaces it on some plans.
func isCodexLongWindow(seconds int64) bool {
	return seconds == quotaWeekSeconds || (seconds >= quotaMinMonthSeconds && seconds <= quotaMaxMonthSeconds)
}

// ParseQuotaUsageWindows normalizes a sanitized provider usage response, as
// stored by the management quota service, into quota windows.
func ParseQuotaUsageWindows(provider string, body []byte, observedAt time.Time) QuotaWindows {
	if len(body) == 0 || observedAt.IsZero() {
		return QuotaWindows{}
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var payload map[string]any
	if errDecode := decoder.Decode(&payload); errDecode != nil || payload == nil {
		return QuotaWindows{}
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "claude":
		return QuotaWindows{
			Short:       claudeUsageWindow(payload["five_hour"], observedAt),
			Weekly:      claudeUsageWindow(payload["seven_day"], observedAt),
			FableWeekly: claudeFableUsageWindow(payload, observedAt),
		}
	case "codex":
		limit, _ := firstQuotaValue(payload, "rate_limit", "rateLimit").(map[string]any)
		if limit == nil {
			return QuotaWindows{}
		}
		reached := quotaTrue(firstQuotaValue(limit, "limit_reached", "limitReached")) || quotaFalse(limit["allowed"])
		return classifyCodexWindows(
			codexUsageSlot(firstQuotaValue(limit, "primary_window", "primaryWindow"), reached, observedAt),
			codexUsageSlot(firstQuotaValue(limit, "secondary_window", "secondaryWindow"), reached, observedAt),
		)
	default:
		return QuotaWindows{}
	}
}

func claudeUsageWindow(value any, observedAt time.Time) QuotaWindow {
	object, ok := value.(map[string]any)
	if !ok {
		return QuotaWindow{}
	}
	// Claude reports utilization on a 0-100 scale in the usage response.
	window := QuotaWindow{ObservedAt: observedAt}
	window.UsedPercent, window.UsedKnown = quotaNumberValue(object["utilization"])
	window.ResetAt = quotaInstantValue(object["resets_at"])
	return finishQuotaWindow(window)
}

// claudeFableUsageWindow reads the Fable weekly limit. Claude reports it as a
// model-scoped weekly limit; older payloads used the iguana_necktie window,
// a key Claude also uses for a dollar credit pool that is not a Fable limit.
func claudeFableUsageWindow(payload map[string]any, observedAt time.Time) QuotaWindow {
	var selected map[string]any
	limits, _ := payload["limits"].([]any)
	for _, item := range limits {
		limit, ok := item.(map[string]any)
		if !ok || !strings.EqualFold(strings.TrimSpace(quotaStringValue(limit["kind"])), "weekly_scoped") || !isFableScopedLimit(limit) {
			continue
		}
		if _, hasPercent := quotaNumberValue(limit["percent"]); !hasPercent {
			continue
		}
		if quotaTrue(limit["is_active"]) {
			selected = limit
			break
		}
		if selected == nil {
			selected = limit
		}
	}
	if selected != nil {
		window := QuotaWindow{ObservedAt: observedAt}
		window.UsedPercent, window.UsedKnown = quotaNumberValue(selected["percent"])
		window.ResetAt = quotaInstantValue(selected["resets_at"])
		return finishQuotaWindow(window)
	}
	legacy, ok := payload["iguana_necktie"].(map[string]any)
	if !ok || isDollarQuotaWindow(legacy) {
		return QuotaWindow{}
	}
	return claudeUsageWindow(legacy, observedAt)
}

func isFableScopedLimit(limit map[string]any) bool {
	scope, _ := limit["scope"].(map[string]any)
	model, _ := scope["model"].(map[string]any)
	name := strings.ToLower(quotaStringValue(model["display_name"]) + " " + quotaStringValue(model["id"]))
	return strings.Contains(name, "fable")
}

func isDollarQuotaWindow(window map[string]any) bool {
	for _, key := range []string{"limit_dollars", "used_dollars", "remaining_dollars"} {
		if _, ok := quotaNumberValue(window[key]); ok {
			return true
		}
	}
	return false
}

func codexUsageSlot(value any, limitReached bool, observedAt time.Time) codexQuotaSlot {
	object, ok := value.(map[string]any)
	if !ok {
		return codexQuotaSlot{}
	}
	window := QuotaWindow{ObservedAt: observedAt}
	window.UsedPercent, window.UsedKnown = quotaNumberValue(firstQuotaValue(object, "used_percent", "usedPercent"))
	window.ResetAt = quotaInstantValue(firstQuotaValue(object, "reset_at", "resetAt"))
	if window.ResetAt.IsZero() {
		if seconds, okSeconds := quotaNumberValue(firstQuotaValue(object, "reset_after_seconds", "resetAfterSeconds")); okSeconds {
			window.ResetAt = observedAt.Add(time.Duration(seconds * float64(time.Second))).UTC()
		}
	}
	// A reached limit without a usage figure means this window is full.
	if limitReached && !window.UsedKnown {
		window.Exhausted = true
	}
	slot := codexQuotaSlot{window: finishQuotaWindow(window)}
	if seconds, okSeconds := quotaNumberValue(firstQuotaValue(object, "limit_window_seconds", "limitWindowSeconds")); okSeconds {
		slot.seconds = int64(seconds)
	}
	return slot
}

// quotaHeader reads a header without relying on canonical key casing.
func quotaHeader(headers http.Header, name string) string {
	if value := headers.Get(name); value != "" {
		return strings.TrimSpace(value)
	}
	for key, values := range headers {
		if strings.EqualFold(key, name) && len(values) > 0 {
			return strings.TrimSpace(values[len(values)-1])
		}
	}
	return ""
}

func firstQuotaValue(object map[string]any, names ...string) any {
	for _, name := range names {
		if value, ok := object[name]; ok && value != nil {
			return value
		}
	}
	return nil
}

func quotaStringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

// quotaNumberValue accepts a JSON number or a numeric string. Negative and
// non-finite values are rejected.
func quotaNumberValue(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case json.Number:
		parsed, errParse := typed.Float64()
		if errParse != nil {
			return 0, false
		}
		number = parsed
	case string:
		parsed, errParse := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if errParse != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || number < 0 {
		return 0, false
	}
	return number, true
}

// quotaInstantValue accepts unix seconds, unix milliseconds, or RFC 3339 text.
func quotaInstantValue(value any) time.Time {
	if number, ok := quotaNumberValue(value); ok {
		if number <= 0 {
			return time.Time{}
		}
		if number > 1e12 {
			return time.UnixMilli(int64(number)).UTC()
		}
		return time.Unix(int64(number), 0).UTC()
	}
	text := quotaStringValue(value)
	if text == "" {
		return time.Time{}
	}
	parsed, errParse := time.Parse(time.RFC3339Nano, text)
	if errParse != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func quotaTrue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, errParse := strconv.ParseBool(strings.TrimSpace(typed))
		return errParse == nil && parsed
	default:
		return false
	}
}

func quotaFalse(value any) bool {
	switch typed := value.(type) {
	case bool:
		return !typed
	case string:
		parsed, errParse := strconv.ParseBool(strings.TrimSpace(typed))
		return errParse == nil && !parsed
	default:
		return false
	}
}
