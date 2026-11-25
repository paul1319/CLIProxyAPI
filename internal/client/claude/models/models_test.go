package models

import "testing"

func TestBuildResponse(t *testing.T) {
	availableModels := []map[string]any{
		{"id": "claude-z", "display_name": "Zebra", "max_tokens": 64000},
		{"id": "gpt-4o", "display_name": "Alpha"},
		{"id": "claude-c", "display_name": "Alpha"},
		{"id": "claude-b", "display_name": "Beta"},
	}

	response := BuildResponse(availableModels, Options{})
	models, ok := response["data"].([]map[string]any)
	if !ok {
		t.Fatalf("data type = %T, want []map[string]any", response["data"])
	}

	wantIDs := []string{
		"claude-c",
		"claude-fable-5-dd-o4-tpg",
		"claude-b",
		"claude-z",
	}
	if len(models) != len(wantIDs) {
		t.Fatalf("len(data) = %d, want %d", len(models), len(wantIDs))
	}
	for i, want := range wantIDs {
		if got, _ := models[i]["id"].(string); got != want {
			t.Fatalf("data[%d].id = %q, want %q", i, got, want)
		}
	}
	if got := models[3]["max_tokens"]; got != 64000 {
		t.Fatalf("max_tokens = %v, want 64000", got)
	}
	if got := response["has_more"]; got != false {
		t.Fatalf("has_more = %v, want false", got)
	}
	if got := response["first_id"]; got != wantIDs[0] {
		t.Fatalf("first_id = %v, want %q", got, wantIDs[0])
	}
	if got := response["last_id"]; got != wantIDs[len(wantIDs)-1] {
		t.Fatalf("last_id = %v, want %q", got, wantIDs[len(wantIDs)-1])
	}

	if got := availableModels[1]["id"]; got != "gpt-4o" {
		t.Fatalf("BuildResponse mutated input id to %v", got)
	}
	if got := availableModels[0]["id"]; got != "claude-z" {
		t.Fatalf("BuildResponse reordered input: first id = %v", got)
	}
}

func TestBuildResponseWithCloakingDisabled(t *testing.T) {
	availableModels := []map[string]any{
		{"id": "gpt-4o", "display_name": "GPT-4o"},
	}

	response := BuildResponse(availableModels, Options{DisableCloaking: true})
	models, ok := response["data"].([]map[string]any)
	if !ok {
		t.Fatalf("data type = %T, want []map[string]any", response["data"])
	}
	if len(models) != 1 {
		t.Fatalf("len(data) = %d, want 1", len(models))
	}
	if got := models[0]["id"]; got != "gpt-4o" {
		t.Fatalf("data[0].id = %v, want gpt-4o", got)
	}
	if got := response["first_id"]; got != "gpt-4o" {
		t.Fatalf("first_id = %v, want gpt-4o", got)
	}
	if got := response["last_id"]; got != "gpt-4o" {
		t.Fatalf("last_id = %v, want gpt-4o", got)
	}
}

func TestBuildResponseClaudeOnly(t *testing.T) {
	availableModels := []map[string]any{
		{"id": "gpt-4o", "display_name": "GPT-4o"},
		{"id": "claude-sonnet-4-6", "display_name": "Claude Sonnet"},
		{"id": "gemini-3-flash", "display_name": "Gemini Flash"},
		{"id": "team/claude-opus-4-8", "display_name": "Team Opus"},
		{"id": "my-claude-custom", "display_name": "Custom"},
	}

	for _, disableCloaking := range []bool{false, true} {
		response := BuildResponse(availableModels, Options{DisableCloaking: disableCloaking, ClaudeOnly: true})
		models, ok := response["data"].([]map[string]any)
		if !ok {
			t.Fatalf("data type = %T, want []map[string]any", response["data"])
		}
		wantIDs := []string{"claude-sonnet-4-6", "team/claude-opus-4-8"}
		if !disableCloaking {
			wantIDs[1] = EnsureClaudeModelIDPrefix("team/claude-opus-4-8")
		}
		if len(models) != len(wantIDs) {
			t.Fatalf("disableCloaking=%t: len(data) = %d, want %d: %v", disableCloaking, len(models), len(wantIDs), models)
		}
		for i, want := range wantIDs {
			if got, _ := models[i]["id"].(string); got != want {
				t.Fatalf("disableCloaking=%t: data[%d].id = %q, want %q", disableCloaking, i, got, want)
			}
		}
		if response["first_id"] != wantIDs[0] || response["last_id"] != wantIDs[1] {
			t.Fatalf("disableCloaking=%t: IDs = (%v, %v), want (%q, %q)", disableCloaking, response["first_id"], response["last_id"], wantIDs[0], wantIDs[1])
		}
	}
}

func TestIsClaudeModelID(t *testing.T) {
	tests := []struct {
		id   string
		want bool
	}{
		{"", false},
		{"claude-sonnet-4-6", true},
		{"team/claude-sonnet-4-6", true},
		{"gpt-4o", false},
		{"my-claude-custom", false},
		{"claude-fable-5-dd-o4-tpg", false},
		{"claude", false},
	}
	for _, tt := range tests {
		if got := IsClaudeModelID(tt.id); got != tt.want {
			t.Errorf("IsClaudeModelID(%q) = %t, want %t", tt.id, got, tt.want)
		}
	}
}

func TestBuildResponseEmpty(t *testing.T) {
	response := BuildResponse(nil, Options{})
	models, ok := response["data"].([]map[string]any)
	if !ok {
		t.Fatalf("data type = %T, want []map[string]any", response["data"])
	}
	if len(models) != 0 {
		t.Fatalf("len(data) = %d, want 0", len(models))
	}
	if response["first_id"] != "" || response["last_id"] != "" {
		t.Fatalf("empty response IDs = (%v, %v), want empty", response["first_id"], response["last_id"])
	}
}

func TestEnsureClaudeModelIDPrefix(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want string
	}{
		{"empty", "", ""},
		{"already has claude prefix", "claude-sonnet-4-6", "claude-sonnet-4-6"},
		{"contains claude mid-string is reversed", "my-claude-custom", "claude-fable-5-dd-motsuc-edualc-ym"},
		{"uppercase Claude prefix is reversed", "Claude-Opus-4", "claude-fable-5-dd-4-supO-edualC"},
		{"gpt model is reversed", "gpt-4o", "claude-fable-5-dd-o4-tpg"},
		{"gemini model is reversed", "gemini-2.5-pro", "claude-fable-5-dd-orp-5.2-inimeg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := EnsureClaudeModelIDPrefix(tt.id); got != tt.want {
				t.Fatalf("EnsureClaudeModelIDPrefix(%q) = %q, want %q", tt.id, got, tt.want)
			}
		})
	}
}

func TestResolveClaudeModelIDPrefix(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want string
	}{
		{"empty", "", ""},
		{"plain claude id unchanged", "claude-sonnet-4-6", "claude-sonnet-4-6"},
		{"non encoded id unchanged", "gpt-4o", "gpt-4o"},
		{"encoded gpt model", "claude-fable-5-dd-o4-tpg", "gpt-4o"},
		{"encoded gemini model", "claude-fable-5-dd-orp-5.2-inimeg", "gemini-2.5-pro"},
		{"empty encoded body unchanged", "claude-fable-5-dd-", "claude-fable-5-dd-"},
		{"preserves thinking suffix", "claude-fable-5-dd-o4-tpg(high)", "gpt-4o(high)"},
		{"round trip", EnsureClaudeModelIDPrefix("custom-model-x"), "custom-model-x"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ResolveClaudeModelIDPrefix(tt.id); got != tt.want {
				t.Fatalf("ResolveClaudeModelIDPrefix(%q) = %q, want %q", tt.id, got, tt.want)
			}
		})
	}
}
