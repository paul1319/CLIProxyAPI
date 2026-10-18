package management

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/auth/kimi"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/quota"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/store"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
	log "github.com/sirupsen/logrus"
)

func (h *Handler) quotaService() *quota.Service {
	h.quotaMu.Lock()
	defer h.quotaMu.Unlock()
	if h.quotaObservations == nil {
		var snapshots quota.Store
		dir := strings.TrimSpace(os.Getenv("CLI_PROXY_STATE_DIR"))
		if dir == "" && h.configFilePath != "" {
			dir = filepath.Join(filepath.Dir(h.configFilePath), "state")
		}
		if dir != "" {
			snapshots = &store.QuotaSnapshotStore{Path: filepath.Join(dir, "quota-snapshots.json")}
		}
		service, errLoad := quota.New(snapshots, nil)
		if errLoad != nil {
			log.WithError(errLoad).Warn("management quota snapshots could not be restored")
		}
		h.quotaObservations = service
	}
	return h.quotaObservations
}

// CloseQuotaObservations cancels shared requests when the owning API server stops.
func (h *Handler) CloseQuotaObservations() {
	h.stopQuotaPolling()
	h.quotaMu.Lock()
	if h.quotaObservations == nil {
		h.quotaObservations, _ = quota.New(nil, nil)
	}
	service := h.quotaObservations
	h.quotaMu.Unlock()
	service.Close()
}

func (h *Handler) reconcileQuotaObservations() {
	if h.authManager == nil {
		return
	}
	service := h.quotaService()
	current := make(map[string]bool)
	for _, auth := range h.authManager.List() {
		if auth != nil {
			current[auth.ID] = true
		}
	}
	service.Retain(current)
}

func quotaCredentialIdentity(auth *coreauth.Auth) quota.Identity {
	metadata := quotaCredentialMetadata(auth)
	seed := map[string]any{"provider": auth.Provider}
	kind, account := auth.AccountInfo()
	seed["kind"], seed["account"] = kind, account
	stableIdentity := account != ""
	for _, name := range []string{"account_id", "email", "sub", "subject", "user_id", "device_id", "project_id", "domain", "base_url"} {
		if value, ok := metadata[name].(string); ok && strings.TrimSpace(value) != "" {
			seed[name] = value
			switch name {
			case "account_id", "email", "sub", "subject", "user_id", "device_id":
				stableIdentity = true
			}
		}
	}
	// JWT subject/account claims survive access-token rotation and distinguish
	// replacement credentials even when a provider omitted top-level account fields.
	for _, name := range []string{"id_token", "access_token"} {
		if token, ok := metadata[name].(string); ok {
			parts := strings.Split(token, ".")
			if len(parts) == 3 {
				payload, errDecode := base64.RawURLEncoding.DecodeString(parts[1])
				var claims map[string]any
				if errDecode == nil && json.Unmarshal(payload, &claims) == nil {
					for _, claim := range []string{"sub", "email", "https://api.openai.com/auth"} {
						if value := claims[claim]; value != nil {
							if claim == "https://api.openai.com/auth" {
								if info, okInfo := value.(map[string]any); okInfo {
									seed["chatgpt_account_id"] = info["chatgpt_account_id"]
									if id, okID := info["chatgpt_account_id"].(string); okID && id != "" {
										stableIdentity = true
									}
								}
							} else {
								seed[claim] = value
								if id, okID := value.(string); okID && id != "" {
									stableIdentity = true
								}
							}
						}
					}
				}
			}
		}
	}
	if !stableIdentity {
		// Opaque credentials without a stable account identifier cannot safely reuse
		// another token's observations at the same filename.
		for _, name := range []string{"dca_token", "api_key", "token", "refresh_token", "access_token"} {
			if value, ok := metadata[name].(string); ok && value != "" {
				seed["opaque_identity"] = value
				break
			}
		}
	}
	data, _ := json.Marshal(seed)
	digest := sha256.Sum256(data)
	return quota.Identity{AuthID: auth.ID, Fingerprint: hex.EncodeToString(digest[:])}
}

func quotaCredentialMetadata(auth *coreauth.Auth) map[string]any {
	metadata := make(map[string]any)
	if auth.Storage != nil {
		if data, errMarshal := json.Marshal(auth.Storage); errMarshal == nil {
			_ = json.Unmarshal(data, &metadata)
		}
	}
	maps.Copy(metadata, auth.Metadata)
	return metadata
}

func (h *Handler) quotaCredential(auth *coreauth.Auth, pluginID string) quota.Credential {
	metadata := quotaCredentialMetadata(auth)
	h.mu.Lock()
	transport, host := h.apiCallTransport(auth, ""), h.pluginHost
	h.mu.Unlock()
	credential := quota.Credential{
		Provider: strings.ToLower(strings.TrimSpace(auth.Provider)), Metadata: metadata, Attributes: auth.Attributes,
		KimiDomain: kimi.ResolveKimiDomainFromAuth(auth), Transport: transport,
		Token: func(ctx context.Context) (string, error) { return h.resolveTokenForAuth(ctx, auth.Clone(), "") },
	}
	if claims := extractCodexIDTokenClaims(auth); claims != nil {
		credential.AccountID, _ = claims["chatgpt_account_id"].(string)
	}
	if credential.AccountID == "" {
		credential.AccountID, _ = metadata["account_id"].(string)
		if credential.AccountID == "" {
			credential.AccountID, _ = metadata["chatgpt_account_id"].(string)
		}
	}
	if pluginID != "" && host != nil && host.HasQuotaProviderForPlugin(pluginID) {
		credential.Plugin = func(ctx context.Context) (json.RawMessage, error) {
			result, handled, errFetch := host.FetchQuotaByPlugin(ctx, pluginID, pluginapi.QuotaFetchRequest{
				AuthIndex: auth.Index, AuthID: auth.ID, Provider: auth.Provider, Metadata: auth.Metadata, Attributes: auth.Attributes,
			})
			if errFetch != nil || !handled {
				return nil, errors.New("plugin quota read failed")
			}
			return json.Marshal(result)
		}
	}
	return credential
}

// CredentialQuotaObservation only serves the v8 snapshot API. GET never contacts a provider.
func (h *Handler) CredentialQuotaObservation(c *gin.Context) {
	var input struct {
		AuthIndex string `json:"auth_index"`
		Resource  string `json:"resource"`
		PluginID  string `json:"plugin_id"`
		Force     bool   `json:"force"`
	}
	cachedOnly := c.Request.Method == http.MethodGet
	if cachedOnly {
		input.AuthIndex, input.Resource, input.PluginID = c.Query("auth_index"), c.Query("resource"), c.Query("plugin_id")
	} else if errBind := c.ShouldBindJSON(&input); errBind != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid quota request"})
		return
	}
	auth := h.authByIndex(input.AuthIndex)
	if auth == nil || auth.Disabled {
		c.JSON(http.StatusOK, gin.H{"status_code": http.StatusNotFound, "error": "quota credential unavailable"})
		return
	}
	resource, errResource := quota.ProviderResource(h.quotaCredential(auth, input.PluginID), input.Resource)
	if errResource != nil {
		c.JSON(http.StatusOK, gin.H{"status_code": http.StatusNotImplemented, "error": "quota resource unavailable"})
		return
	}
	identity := quotaCredentialIdentity(auth)
	resourceKey := input.Resource
	if input.Resource == "plugin" {
		resourceKey += ":" + input.PluginID
	}
	service := h.quotaService()
	h.reconcileQuotaObservations()
	snapshot, errObserve := service.Observe(c.Request.Context(), quota.Request{
		Identity: identity, Resource: resourceKey, Interval: resource.Interval, CachedOnly: cachedOnly, Force: input.Force,
		Current: func() bool {
			current := h.authByIndex(input.AuthIndex)
			return current != nil && !current.Disabled && quotaCredentialIdentity(current) == identity
		},
		Fetch: resource.Fetch,
	})
	if errObserve != nil {
		c.JSON(http.StatusOK, gin.H{"status_code": http.StatusConflict, "error": "quota request no longer current"})
		return
	}
	if input.Resource == "usage" {
		h.applyQuotaWindows(auth.ID, auth.Provider, identity, snapshot)
	}
	status := snapshot.Status
	if len(snapshot.Body) > 0 {
		status = http.StatusOK
	} else if status == 0 {
		status = http.StatusNotFound
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"status_code": status, "body": snapshot.Body, "observed_at": snapshot.ObservedAt,
		"server_time": time.Now().UTC(),
		"stale":       snapshot.Stale, "error_status": snapshot.Status, "retry_at": snapshot.RetryAt,
		"persistence_error": snapshot.PersistenceError,
	})
}
