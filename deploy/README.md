# Docker deployment on the Mac

The `deploy-mac` workflow tests `main`, builds a native `linux/arm64` image in
GitHub Actions, and publishes `ghcr.io/paul1319/cliproxyapi:sha-COMMIT`. Deployment
uses the immutable registry digest. Pull requests never run deployment jobs.
The upstream-only automatic PR retargeting to `dev` is disabled in forks; this
fork deploys `main` and has no `dev` branch.
Docker Desktop must remain running in the Mac's logged-in user session. Configure
its login startup and the Mac's power settings separately.

CI runs the Go suite except `TestAdvertiserAndBrowser_Integration`, which requires
live LAN multicast and fails on this Mac even before deployment changes. The
application's LAN discovery is disabled in the generated runtime configuration.

## Initialize the Mac once

Build and start the checked-out version:

```bash
docker build --platform linux/arm64 -t cliproxyapi:bootstrap .
python3 deploy/bootstrap.py --image cliproxyapi:bootstrap
```

Runtime state is under `~/.local/share/cliproxyapi`, independently of Git checkouts:

- `config/config.yaml`: editable v8 configuration, mounted as a directory so
  management API atomic writes remain visible to the container.
- `auths`, `plugins`, `logs`, and `static`: persistent credentials and runtime data.
- `initial-credentials.json`: initial client API key and management password,
  created with owner-only permissions and never printed by bootstrap or CI.
  This is an initial handoff record; it does not track subsequent key rotation.
- `releases`: versioned deployment scripts and Compose definitions.
- `.env`: the last successfully deployed image and bundle.

Bootstrap preserves existing configuration and credentials. The local API is
`http://127.0.0.1:8317/v1`; the control panel is
`http://127.0.0.1:8317/management.html`. Use the generated management password to
connect provider accounts. Initial startup has no upstream accounts.

Publish to the tailnet on an unused HTTPS port, preserving existing Serve routes:

```bash
/opt/homebrew/bin/tailscale serve --bg --https=8443 http://127.0.0.1:8317
```

The URL is `https://YOUR-MAC.YOUR-TAILNET.ts.net:8443/v1`. Funnel is not used.
The host port binds only to loopback. Management allows remote callers because
Docker forwards host requests through its gateway; the management password still
applies, and access is limited by loopback publishing and the tailnet policy.
No extra OAuth callback ports are published. Use the control panel's callback
handoff when a provider needs a localhost OAuth callback.

## Authorize CI in Tailscale

Create a [federated workload identity](https://tailscale.com/docs/integrations/github/github-action)
for GitHub Actions with the `auth_keys` permission and `tag:cliproxy-ci`.
Restrict its GitHub issuer/subject to this repository's `main` branch:

```text
issuer: https://token.actions.githubusercontent.com
subject: repo:paul1319/CLIProxyAPI:ref:refs/heads/main
```

Merge these entries into the existing tailnet policy, substituting the Mac's
Tailscale IPv4 and the existing owner identity. Do not replace the policy or
retag an existing user-owned Mac just to deploy it:

```json
{
  "tagOwners": {"tag:cliproxy-ci": ["autogroup:admin"]},
  "hosts": {"cliproxy-mac": "REPLACE_WITH_MAC_TAILSCALE_IPV4"},
  "grants": [{"src": ["tag:cliproxy-ci"], "dst": ["cliproxy-mac"], "ip": ["tcp:22"]}],
  "ssh": [{"action": "accept", "src": ["tag:cliproxy-ci"], "dst": ["REPLACE_WITH_MAC_OWNER_IDENTITY"], "users": ["pavel"]}]
}
```

Tailscale SSH rules need the destination user identity or a destination tag;
the host alias limits the network grant. Check other existing grants/SSH rules
for broader access. CI SSH runs as the Docker Desktop owner, `pavel`, so trusted
`main` code has that user's machine access. Protect who can write to `main`.

Configure repository **Actions variables** (not secrets; no long-lived Tailscale
secret is needed):

| Variable | Value |
| --- | --- |
| `TS_CLIENT_ID` | Federated identity client ID |
| `TS_AUDIENCE` | Federated identity audience |
| `CLI_PROXY_DEPLOY_HOST` | Mac's MagicDNS name |
| `CLI_PROXY_DEPLOY_USER` | `pavel` |
| `CLI_PROXY_DEPLOY_ENABLED` | `true`, after bootstrap and policy setup |

The deploy job passes its temporary, read-only GitHub package token over SSH
stdin. The Mac uses a disposable Docker credential directory, retains the
Desktop socket, and deletes the credentials after the operation. Images can
remain private in GHCR. The Docker image source label links the package to the
repository for Actions package permissions.

Until `CLI_PROXY_DEPLOY_ENABLED=true`, CI tests and publishes images while the
deploy job is explicitly skipped. Run `deploy-mac` manually on `main` to verify
the full path after enabling it. Test access from another tailnet device too;
local health alone does not prove that path.

## Update, inspect, and recover

Deploy pulls and checks the candidate image before replacing the current service.
It serializes updates with a directory lock and checks both the running image ID
and `/healthz`. A failure or an ordinary termination signal restores the previous
cached image **and its Compose bundle**. A failed first deployment removes only
the failed service, preserving data. No image pruning is performed.

`/healthz` proves HTTP reachability of the selected image, not successful provider
authentication, upstream inference, or preservation of in-flight streams during
replacement. Deployment interrupts active requests. Rollback changes code and
Compose only; it does not undo configuration/credential changes made by a newer
version. Back up persistent data before incompatible upgrades.

```bash
runtime="$HOME/.local/share/cliproxyapi"
release=$(sed -n 's/^CLI_PROXY_RELEASE=//p' "$runtime/.env")
docker compose --project-name cliproxyapi --project-directory "$runtime" \
  --env-file "$runtime/.env" -f "$runtime/releases/$release/compose.yaml" ps
```

For a manual rollback, run a retained bundle with the previous image's digest:

```bash
bash "$runtime/releases/PREVIOUS_RELEASE/deploy.sh" ghcr.io/paul1319/cliproxyapi@sha256:PREVIOUS_DIGEST
```

If a process was forcibly killed and left `.deploy.lock`, confirm no deploy is
running before removing that empty directory. Keep the previous image cached for
offline automatic rollback. Do not run `docker compose down -v` or broad cleanup
commands as part of deployment.
