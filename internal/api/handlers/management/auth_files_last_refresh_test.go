package management

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestBuildAuthFileEntryLastRefresh(t *testing.T) {
	t.Setenv("MANAGEMENT_PASSWORD", "")

	persisted := time.Date(2026, 10, 18, 19, 57, 22, 0, time.UTC)
	tests := []struct {
		name            string
		lastRefreshedAt time.Time
		metadata        map[string]any
		want            time.Time
	}{
		{
			// Auths loaded from disk start with a zero LastRefreshedAt.
			name:     "persisted metadata after restart",
			metadata: map[string]any{"last_refresh": "2026-10-18T21:57:22+02:00"},
			want:     persisted,
		},
		{
			name:            "in-memory refresh newer than metadata",
			lastRefreshedAt: persisted.Add(time.Hour),
			metadata:        map[string]any{"last_refresh": "2026-10-18T21:57:22+02:00"},
			want:            persisted.Add(time.Hour),
		},
		{
			// Executors refreshing inline only update metadata.
			name:            "metadata newer than in-memory refresh",
			lastRefreshedAt: persisted.Add(-time.Hour),
			metadata:        map[string]any{"last_refresh": "2026-10-18T21:57:22+02:00"},
			want:            persisted,
		},
		{
			name: "never refreshed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authDir := t.TempDir()
			filePath := filepath.Join(authDir, "claude.json")
			if errWrite := os.WriteFile(filePath, []byte(`{"type":"claude"}`), 0o600); errWrite != nil {
				t.Fatalf("failed to write auth file: %v", errWrite)
			}
			h := NewHandlerWithoutConfigFilePath(&config.Config{AuthDir: authDir}, nil)
			entry := h.buildAuthFileEntry(&coreauth.Auth{
				ID:              "claude.json",
				FileName:        "claude.json",
				Provider:        "claude",
				Status:          coreauth.StatusActive,
				Attributes:      map[string]string{"path": filePath},
				Metadata:        tt.metadata,
				LastRefreshedAt: tt.lastRefreshedAt,
			}, authFileQuotaContext{})
			if entry == nil {
				t.Fatal("entry is nil")
			}

			got, ok := entry["last_refresh"].(time.Time)
			if tt.want.IsZero() {
				if _, present := entry["last_refresh"]; present {
					t.Fatalf("last_refresh = %#v, want absent", entry["last_refresh"])
				}
				return
			}
			if !ok || !got.Equal(tt.want) {
				t.Fatalf("last_refresh = %#v, want %s", entry["last_refresh"], tt.want)
			}
		})
	}
}
