package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

const testProxy = "socks5://test-user:test-password@proxy.example:1080"

func TestConfigurePreservesSettingsAndComments(t *testing.T) {
	runtime, path, original := fixture(t, "config-version: 8\n# Keep this comment\nserver: {port: 8317}\nrouting: {strategy: reset-first}\nrequests: {proxy-url: old, max-retry-interval: 30}\n")
	if err := configure(runtime, strings.NewReader(testProxy)); err != nil {
		t.Fatal(err)
	}
	saved, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatal(errRead)
	}
	var before, after map[string]any
	if err := yaml.Unmarshal(original, &before); err != nil {
		t.Fatal(err)
	}
	if err := yaml.Unmarshal(saved, &after); err != nil {
		t.Fatal(err)
	}
	if got := after["requests"].(map[string]any)["proxy-url"]; got != testProxy {
		t.Fatalf("saved proxy does not match")
	}
	after["requests"].(map[string]any)["proxy-url"] = "old"
	oldYAML, _ := yaml.Marshal(before)
	newYAML, _ := yaml.Marshal(after)
	if !bytes.Equal(oldYAML, newYAML) || !bytes.Contains(saved, []byte("# Keep this comment")) {
		t.Fatal("unrelated settings or comments changed")
	}
	info, errStat := os.Stat(path)
	if errStat != nil || info.Mode().Perm() != 0600 {
		t.Fatal("configuration permissions must be owner-only")
	}
	if err := configure(runtime, strings.NewReader(testProxy)); err != nil {
		t.Fatalf("repeated configuration failed: %v", err)
	}
}

func TestConfigureRejectsBeforeChangingFile(t *testing.T) {
	for _, test := range []struct {
		name   string
		config string
		auth   string
		proxy  string
	}{
		{name: "invalid proxy", config: "config-version: 8\n", proxy: "socks5://test-user:secret%password@proxy.example:1080"},
		{name: "empty proxy", config: "config-version: 8\n"},
		{name: "legacy config", config: "port: 8317\n", proxy: testProxy},
		{name: "invalid config", config: "config-version: 8\nserver: [\n", proxy: testProxy},
		{name: "invalid settings", config: "config-version: 8\nserver: {port: wrong}\n", proxy: testProxy},
		{name: "API-key override", config: "config-version: 8\napi-keys:\n  codex:\n    - proxy-url: direct\n", proxy: testProxy},
		{name: "OAuth override", config: "config-version: 8\n", auth: `{"proxy_url":"direct"}`, proxy: testProxy},
		{name: "unreadable OAuth", config: "config-version: 8\n", auth: `{invalid`, proxy: testProxy},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtime, path, original := fixture(t, test.config)
			if test.auth != "" {
				if err := os.WriteFile(filepath.Join(runtime, "auths", "credential.json"), []byte(test.auth), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err := configure(runtime, strings.NewReader(test.proxy))
			if err == nil {
				t.Fatal("expected rejection")
			}
			if strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "test-user") {
				t.Fatal("error contains credentials")
			}
			saved, errRead := os.ReadFile(path)
			if errRead != nil || !bytes.Equal(saved, original) {
				t.Fatal("rejected update changed the configuration")
			}
			if _, errStat := os.Stat(filepath.Join(runtime, ".deploy.lock")); !os.IsNotExist(errStat) {
				t.Fatal("deployment lock was not released")
			}
		})
	}
}

func TestConfigureRespectsDeploymentLock(t *testing.T) {
	runtime, path, original := fixture(t, "config-version: 8\n")
	if err := os.Mkdir(filepath.Join(runtime, ".deploy.lock"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := configure(runtime, strings.NewReader(testProxy)); err == nil {
		t.Fatal("expected lock rejection")
	}
	saved, errRead := os.ReadFile(path)
	if errRead != nil || !bytes.Equal(saved, original) {
		t.Fatal("locked configuration changed")
	}
}

func fixture(t *testing.T, source string) (string, string, []byte) {
	t.Helper()
	runtime := t.TempDir()
	for _, directory := range []string{"config", "auths"} {
		if err := os.Mkdir(filepath.Join(runtime, directory), 0700); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(runtime, "config", "config.yaml")
	if err := os.WriteFile(path, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	return runtime, path, []byte(source)
}
