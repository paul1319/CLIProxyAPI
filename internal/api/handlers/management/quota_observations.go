package management

import (
	"context"
	"encoding/json"
	"errors"
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
	h.mu.Lock()
	manager := h.authManager
	h.mu.Unlock()
	if manager == nil {
		return
	}
	service := h.quotaService()
	current := make(map[string]bool)
	for _, auth := range manager.List() {
		if auth != nil {
			current[auth.ID] = true
		}
	}
	service.Retain(current)
}

func quotaCredentialIdentity(auth *coreauth.Auth) quota.Identity {
	return quota.Identity{AuthID: auth.ID, Fingerprint: coreauth.QuotaAccountFingerprint(auth)}
}

func (h *Handler) quotaCredential(auth *coreauth.Auth, pluginID string) quota.Credential {
	metadata := coreauth.QuotaCredentialMetadata(auth)
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
