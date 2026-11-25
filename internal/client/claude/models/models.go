// Package models builds model catalogs for Anthropic clients.
package models

import (
	"sort"
	"strings"
)

const claudeDDModelPrefix = "claude-fable-5-dd-"

// Options controls how BuildResponse shapes an Anthropic model list.
type Options struct {
	// DisableCloaking keeps original model IDs instead of rewriting non-Claude IDs.
	DisableCloaking bool
	// ClaudeOnly drops every model whose ID is not a native Claude model ID.
	ClaudeOnly bool
}

// BuildResponse builds an Anthropic model response from available models.
func BuildResponse(availableModels []map[string]any, opts Options) map[string]any {
	models := make([]map[string]any, 0, len(availableModels))
	for _, model := range availableModels {
		id, _ := model["id"].(string)
		if opts.ClaudeOnly && !IsClaudeModelID(id) {
			continue
		}
		cloned := cloneModel(model)
		if id != "" && !opts.DisableCloaking {
			cloned["id"] = EnsureClaudeModelIDPrefix(id)
		}
		models = append(models, cloned)
	}

	sort.SliceStable(models, func(i, j int) bool {
		displayNameI, _ := models[i]["display_name"].(string)
		displayNameJ, _ := models[j]["display_name"].(string)
		if displayNameI != displayNameJ {
			return displayNameI < displayNameJ
		}
		idI, _ := models[i]["id"].(string)
		idJ, _ := models[j]["id"].(string)
		return idI < idJ
	})

	firstID := ""
	lastID := ""
	if len(models) > 0 {
		firstID, _ = models[0]["id"].(string)
		lastID, _ = models[len(models)-1]["id"].(string)
	}

	return map[string]any{
		"data":     models,
		"has_more": false,
		"first_id": firstID,
		"last_id":  lastID,
	}
}

// IsClaudeModelID reports whether id names a native Claude model. A credential
// prefix such as "team/claude-sonnet-4-6" is ignored; IDs encoded by
// EnsureClaudeModelIDPrefix are not native Claude models.
func IsClaudeModelID(id string) bool {
	if idx := strings.LastIndex(id, "/"); idx >= 0 {
		id = id[idx+1:]
	}
	return strings.HasPrefix(id, "claude-") && !strings.HasPrefix(id, claudeDDModelPrefix)
}

// EnsureClaudeModelIDPrefix rewrites model IDs for Anthropic model listings.
// IDs that already start with "claude-" are returned unchanged; all other IDs
// become "claude-fable-5-dd-" plus the original ID with its characters reversed.
func EnsureClaudeModelIDPrefix(id string) string {
	if id == "" || strings.HasPrefix(id, "claude-") {
		return id
	}
	return claudeDDModelPrefix + reverseModelID(id)
}

// ResolveClaudeModelIDPrefix reverses EnsureClaudeModelIDPrefix for request routing.
// Optional thinking suffixes in model(value) form are preserved.
func ResolveClaudeModelIDPrefix(id string) string {
	if id == "" {
		return id
	}
	base, suffix, hasSuffix := splitModelThinkingSuffix(id)
	if !strings.HasPrefix(base, claudeDDModelPrefix) {
		return id
	}
	encoded := base[len(claudeDDModelPrefix):]
	if encoded == "" {
		return id
	}
	resolved := reverseModelID(encoded)
	if hasSuffix {
		return resolved + "(" + suffix + ")"
	}
	return resolved
}

func cloneModel(model map[string]any) map[string]any {
	cloned := make(map[string]any, len(model))
	for key, value := range model {
		cloned[key] = value
	}
	return cloned
}

func splitModelThinkingSuffix(model string) (base, suffix string, hasSuffix bool) {
	lastOpen := strings.LastIndex(model, "(")
	if lastOpen == -1 || !strings.HasSuffix(model, ")") {
		return model, "", false
	}
	return model[:lastOpen], model[lastOpen+1 : len(model)-1], true
}

func reverseModelID(id string) string {
	runes := []rune(id)
	for i, j := 0, len(runes)-1; i < j; i, j = i+1, j-1 {
		runes[i], runes[j] = runes[j], runes[i]
	}
	return string(runes)
}
