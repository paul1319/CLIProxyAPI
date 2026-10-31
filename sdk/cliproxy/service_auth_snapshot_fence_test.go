package cliproxy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	internalregistry "github.com/router-for-me/CLIProxyAPI/v8/internal/registry"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/watcher"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

// A config-reload scan can read an auth file just before a Management API PATCH
// persists it. The scan snapshot is bound to the file content it read, so once the
// PATCH rewrote the file the snapshot must be discarded and the PATCH's own
// persisted update must win; otherwise the runtime keeps the stale state while
// disk is current.
func TestHandleAuthUpdates_FileBoundScanSnapshotDoesNotSupersedePersistedUpdate(t *testing.T) {
	type fixture struct {
		manager  *coreauth.Manager
		service  *Service
		base     *coreauth.Auth
		patched8 *coreauth.Auth
		patched9 *coreauth.Auth
		rev      uint64
		path     string
	}
	const authID = "codex-snapshot-fence-auth"
	reg := internalregistry.GetGlobalRegistry()
	fileData := func(prefix string) []byte {
		return []byte(fmt.Sprintf(`{"type":"codex","prefix":%q}`, prefix))
	}
	writeDisk := func(t *testing.T, f *fixture, prefix string) {
		t.Helper()
		if errWrite := os.WriteFile(f.path, fileData(prefix), 0o600); errWrite != nil {
			t.Fatalf("write auth file: %v", errWrite)
		}
	}
	withPrefix := func(base *coreauth.Auth, prefix string) *coreauth.Auth {
		next := base.Clone()
		next.Prefix = prefix
		return next
	}
	// scan builds the snapshot a file scan produces for the given file content.
	scan := func(f *fixture, prefix string) *coreauth.Auth {
		snapshot := withPrefix(f.base, prefix)
		snapshot.Generation = 0
		snapshot.RegistrationEpoch = 0
		snapshot.BindFileSnapshot(f.path, fileData(prefix))
		return snapshot
	}
	deliver := func(f *fixture, a *coreauth.Auth) {
		f.rev++
		update := watcher.AuthUpdate{Action: watcher.AuthUpdateActionModify, ID: authID, Auth: a}
		update.SetRevision(f.rev)
		f.service.handleAuthUpdate(context.Background(), update)
	}
	prefixOf := func(f *fixture) string {
		current, ok := f.manager.GetByID(authID)
		if !ok || current == nil {
			t.Fatal("auth missing from manager")
		}
		return current.Prefix
	}
	hasPrefixedModel := func(prefix string) bool {
		for _, model := range reg.GetModelsForClient(authID) {
			if model != nil && strings.HasPrefix(model.ID, prefix+"/") {
				return true
			}
		}
		return false
	}
	// setup commits PATCH 8 through the watcher pipeline.
	setup := func(t *testing.T) *fixture {
		reg.UnregisterClient(authID)
		t.Cleanup(func() {
			reg.UnregisterClient(authID)
		})
		path := filepath.Join(t.TempDir(), "codex-snapshot-fence.json")
		manager := coreauth.NewManager(nil, nil, nil)
		manager.RegisterExecutor(&syncTestExecutor{})
		base := &coreauth.Auth{
			ID:         authID,
			Provider:   "codex",
			Status:     coreauth.StatusActive,
			Attributes: map[string]string{"plan_type": "pro", "path": path},
		}
		if _, errRegister := manager.Register(context.Background(), base); errRegister != nil {
			t.Fatalf("register auth: %v", errRegister)
		}
		f := &fixture{manager: manager, service: &Service{cfg: &config.Config{}, coreManager: manager}, base: base, path: path}
		writeDisk(t, f, "pfx-8")
		var errPatch error
		if f.patched8, errPatch = manager.Update(context.Background(), withPrefix(base, "pfx-8")); errPatch != nil {
			t.Fatalf("patch 8: %v", errPatch)
		}
		deliver(f, f.patched8)
		return f
	}
	// patch9 writes the file and commits PATCH 9 directly, as the Management API
	// does before its post-persist hook runs.
	patch9 := func(t *testing.T, f *fixture) {
		writeDisk(t, f, "pfx-9")
		var errPatch error
		if f.patched9, errPatch = f.manager.Update(context.Background(), withPrefix(f.patched8, "pfx-9")); errPatch != nil {
			t.Fatalf("patch 9: %v", errPatch)
		}
	}

	t.Run("persisted update wins over a scan read before it", func(t *testing.T) {
		f := setup(t)
		stale := scan(f, "pfx-8")
		patch9(t, f)
		deliver(f, stale)
		deliver(f, f.patched9)
		if got := prefixOf(f); got != "pfx-9" {
			t.Fatalf("prefix = %q, want persisted pfx-9", got)
		}
		if !hasPrefixedModel("pfx-9") || hasPrefixedModel("pfx-8") {
			t.Fatalf("expected models registered under pfx-9 only, got %v", reg.GetModelsForClient(authID))
		}
	})

	t.Run("consecutive stale scans", func(t *testing.T) {
		f := setup(t)
		stale1 := scan(f, "pfx-8")
		stale2 := scan(f, "pfx-8")
		patch9(t, f)
		deliver(f, stale1)
		deliver(f, stale2)
		deliver(f, f.patched9)
		if got := prefixOf(f); got != "pfx-9" {
			t.Fatalf("prefix = %q, want persisted pfx-9 after two stale scans", got)
		}
	})

	t.Run("a write after the scan is kept", func(t *testing.T) {
		f := setup(t)
		stale := scan(f, "pfx-8")
		patch9(t, f)
		deliver(f, stale)
		current, _ := f.manager.GetByID(authID)
		if _, errRefresh := f.manager.Update(context.Background(), withPrefix(current, "pfx-refresh")); errRefresh != nil {
			t.Fatalf("direct write: %v", errRefresh)
		}
		deliver(f, f.patched9)
		if got := prefixOf(f); got != "pfx-refresh" {
			t.Fatalf("prefix = %q, want the newer direct write kept", got)
		}
	})

	t.Run("a fresh external edit beats a delayed older persisted update", func(t *testing.T) {
		f := setup(t)
		patch9(t, f)
		writeDisk(t, f, "pfx-10")
		deliver(f, scan(f, "pfx-10"))
		deliver(f, f.patched8)
		if got := prefixOf(f); got != "pfx-10" {
			t.Fatalf("prefix = %q, want the fresh scan kept over an older persisted update", got)
		}
	})
}
