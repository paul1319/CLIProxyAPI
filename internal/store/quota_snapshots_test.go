package store

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/quota"
)

func TestQuotaSnapshotsSurviveServiceRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state", "quota-snapshots.json")
	storage := &QuotaSnapshotStore{Path: path}
	now := time.Date(2026, 10, 17, 12, 0, 0, 0, time.UTC)
	first, errNew := quota.New(storage, func() time.Time { return now })
	if errNew != nil {
		t.Fatal(errNew)
	}
	request := quota.Request{Identity: quota.Identity{AuthID: "a", Fingerprint: "account-a"}, Resource: "usage", Interval: quota.UsageInterval,
		Fetch: func(context.Context) (json.RawMessage, error) {
			return json.RawMessage(`{"remaining":0,"reset_at":1792239000}`), nil
		},
	}
	if _, errObserve := first.Observe(t.Context(), request); errObserve != nil {
		t.Fatal(errObserve)
	}
	first.Close()
	info, errStat := os.Stat(path)
	if errStat != nil {
		t.Fatal(errStat)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot permissions: %o", info.Mode().Perm())
	}
	second, errRestore := quota.New(storage, func() time.Time { return now.Add(time.Hour) })
	if errRestore != nil {
		t.Fatal(errRestore)
	}
	t.Cleanup(second.Close)
	request.CachedOnly = true
	request.Fetch = func(context.Context) (json.RawMessage, error) {
		t.Error("cached restore contacted a provider")
		return nil, nil
	}
	restored, errObserve := second.Observe(t.Context(), request)
	if errObserve != nil {
		t.Fatal(errObserve)
	}
	if string(restored.Body) != `{"remaining":0,"reset_at":1792239000}` || !restored.ObservedAt.Equal(now) || !restored.Stale {
		t.Fatalf("restored snapshot lost its data or observation time: %+v", restored)
	}
	second.Retain(map[string]bool{})
	contents, errLoad := storage.Load()
	if errLoad != nil || len(contents) != 0 {
		t.Fatalf("deleted credentials remained durable: %v, %v", contents, errLoad)
	}
}

func TestQuotaSnapshotStoreRejectsCorruptionAndPreservesCommittedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "snapshots.json")
	storage := &QuotaSnapshotStore{Path: path}
	if errWrite := os.WriteFile(path, []byte(`{"version":1,"records":`), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	service, errNew := quota.New(storage, nil)
	if service == nil || errNew == nil {
		t.Fatal("corrupt snapshot did not produce a usable empty cache and diagnostic")
	}
	service.Close()
	good := map[string]quota.Record{"a": {Identity: quota.Identity{AuthID: "a", Fingerprint: "a"}, Resource: "usage", Body: json.RawMessage(`{"used":1}`)}}
	if errSave := storage.Save(good); errSave != nil {
		t.Fatal(errSave)
	}
	if errSave := storage.Save(map[string]quota.Record{"a": {Body: json.RawMessage(`invalid`)}}); errSave == nil {
		t.Fatal("invalid data was saved")
	}
	restored, errLoad := storage.Load()
	if errLoad != nil || string(restored["a"].Body) != `{"used":1}` {
		t.Fatalf("failed write replaced last committed snapshot: %v, %v", restored, errLoad)
	}
}
