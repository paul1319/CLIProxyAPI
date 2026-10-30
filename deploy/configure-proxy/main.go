// Command configure-proxy saves the CI-provided upstream proxy before deployment.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/proxyutil"
	"gopkg.in/yaml.v3"
)

func main() {
	runtime := flag.String("directory", "", "Persistent CLIProxyAPI runtime directory")
	flag.Parse()
	if err := configure(*runtime, os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Upstream proxy saved and verified; ready to start service.")
}

func configure(runtime string, input io.Reader) error {
	if runtime == "" {
		return errors.New("runtime directory is required")
	}
	data, errRead := io.ReadAll(io.LimitReader(input, 8193))
	if errRead != nil || len(data) > 8192 {
		return errors.New("cannot read upstream proxy from stdin")
	}
	proxy := strings.TrimSpace(string(data))
	if !proxyutil.ValidRequestProxy(proxy) {
		return errors.New("stdin must contain a concrete supported proxy URL")
	}
	lock := filepath.Join(runtime, ".deploy.lock")
	if errLock := os.Mkdir(lock, 0700); errLock != nil {
		return errors.New("cannot acquire deployment lock")
	}
	defer func() {
		if errRemove := os.Remove(lock); errRemove != nil {
			fmt.Fprintln(os.Stderr, "Cannot remove deployment lock")
		}
	}()
	path := filepath.Join(runtime, "config", "config.yaml")
	original, errRead := os.ReadFile(path)
	if errRead != nil {
		return errors.New("cannot read runtime configuration")
	}
	var document map[string]any
	if errDecode := yaml.Unmarshal(original, &document); errDecode != nil || document["config-version"] != 8 {
		return errors.New("a valid v8 runtime configuration is required")
	}
	if hasOverride(document["api-keys"], proxy) {
		return errors.New("API-key proxy overrides conflict with the requested global proxy")
	}
	files, errGlob := filepath.Glob(filepath.Join(runtime, "auths", "*.json"))
	if errGlob != nil {
		return errors.New("cannot list OAuth credentials")
	}
	for _, path := range files {
		data, errRead := os.ReadFile(path)
		var credential map[string]any
		if errRead != nil || json.Unmarshal(data, &credential) != nil {
			return errors.New("cannot inspect OAuth credential proxy overrides")
		}
		if hasOverride(credential, proxy) {
			return errors.New("OAuth proxy overrides conflict with the requested global proxy")
		}
	}
	// Prepare and validate a separate file so a rejected update cannot affect startup.
	temp, errCreate := os.CreateTemp(filepath.Dir(path), ".proxy-config-*")
	if errCreate != nil {
		return errors.New("cannot prepare runtime configuration")
	}
	name := temp.Name()
	defer func() {
		if errRemove := os.Remove(name); errRemove != nil && !errors.Is(errRemove, os.ErrNotExist) {
			fmt.Fprintln(os.Stderr, "Cannot remove temporary configuration")
		}
	}()
	_, errWrite := temp.Write(original)
	errClose := temp.Close()
	if errWrite != nil || errClose != nil {
		return errors.New("cannot prepare runtime configuration")
	}
	if errSave := config.SaveConfigPreserveCommentsUpdateNestedScalar(name, []string{"requests", "proxy-url"}, proxy); errSave != nil {
		return errors.New("cannot update upstream proxy configuration")
	}
	saved, errRead := os.ReadFile(name)
	if errRead != nil {
		return errors.New("cannot verify prepared configuration")
	}
	parsed, errParse := config.ParseConfigBytes(saved)
	if errParse != nil || parsed.ProxyURL != proxy {
		return errors.New("prepared upstream proxy configuration did not pass validation")
	}
	current, errRead := os.ReadFile(path)
	if errRead != nil || !bytes.Equal(current, original) {
		return errors.New("runtime configuration changed; rerun CI")
	}
	if errRename := os.Rename(name, path); errRename != nil {
		return errors.New("cannot install upstream proxy configuration")
	}
	return nil
}

func hasOverride(value any, proxy string) bool {
	switch value := value.(type) {
	case map[string]any:
		for key, child := range value {
			if key == "proxy-url" || key == "proxy_url" {
				if setting, ok := child.(string); ok && strings.TrimSpace(setting) != "" && strings.TrimSpace(setting) != proxy {
					return true
				}
			} else if hasOverride(child, proxy) {
				return true
			}
		}
	case []any:
		for _, child := range value {
			if hasOverride(child, proxy) {
				return true
			}
		}
	}
	return false
}
