package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"maps"
	"strings"
)

// QuotaAccountFingerprint identifies the account behind a credential for quota
// observations. It survives token rotation, but changes when the file now
// holds another account, so one account's quota is never attributed to
// another. It is stable across releases because persisted quota snapshots
// are keyed by it.
func QuotaAccountFingerprint(auth *Auth) string {
	metadata := QuotaCredentialMetadata(auth)
	seed := map[string]any{"provider": auth.Provider}
	kind, account := auth.AccountInfo()
	seed["kind"], seed["account"] = kind, account
	stableIdentity := account != ""
	// chatgpt_account_id selects the Codex workspace when the ID token has no
	// account claim. It joins the seed only when present, so fingerprints of
	// credentials without it are unchanged.
	for _, name := range []string{"account_id", "email", "sub", "subject", "user_id", "device_id", "project_id", "domain", "base_url", "chatgpt_account_id"} {
		if value, ok := metadata[name].(string); ok && strings.TrimSpace(value) != "" {
			seed[name] = value
			switch name {
			case "account_id", "email", "sub", "subject", "user_id", "device_id", "chatgpt_account_id":
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
	return hex.EncodeToString(digest[:])
}

// QuotaCredentialMetadata merges token storage fields with runtime metadata,
// with metadata taking precedence.
func QuotaCredentialMetadata(auth *Auth) map[string]any {
	metadata := make(map[string]any)
	if auth.Storage != nil {
		if data, errMarshal := json.Marshal(auth.Storage); errMarshal == nil {
			_ = json.Unmarshal(data, &metadata)
		}
	}
	maps.Copy(metadata, auth.Metadata)
	return metadata
}
