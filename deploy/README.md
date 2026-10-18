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

## Change runtime configuration through CI

All changes to the deployed service go through CI/CD. Change non-secret runtime
settings in `deploy/runtime-config.json`; the `configure-mac` workflow validates
the deployment suite and applies this partial JSON document on pushes to `main`.
It can also be dispatched manually on `main`. PRs run validation only.

The configuration job uses the same Tailscale identity, deployment variables,
and concurrency group as `deploy-mac`. It calls the local v8 management API,
preserving unrelated settings and credentials. It neither rebuilds the image nor
restarts the container. Session affinity is enabled in the versioned settings;
the routing strategy and affinity TTL retain their configured values or defaults.

The management key is read on the Mac from `initial-credentials.json` and never
sent to GitHub or printed. If it has been rotated, the local credential handoff
must contain the current key before configuration jobs can authenticate. Keep
secrets out of `runtime-config.json`.

Updates use `If-Match` to reject concurrent changes and read back the saved
settings before reporting success. A failed verification attempts to restore the
previous configuration, also with `If-Match`; a concurrent writer is never
overwritten by rollback. A lost write response or failed rollback leaves CI
failed and requires inspection. To change or revert settings, update the JSON
document and deliver it through the same workflow. Avoid manual writes to live
files, management API/UI settings, or containers.

## Initialize the Mac once

Build and start the checked-out version:

```bash
docker build --platform linux/arm64 -t cliproxyapi:bootstrap .
python3 deploy/bootstrap.py --image cliproxyapi:bootstrap
```

Runtime state is under `~/.local/share/cliproxyapi`, independently of Git checkouts:

- `config/config.yaml`: v8 configuration managed through CI, mounted as a directory so
  management API atomic writes remain visible to the container.
- `auths`, `plugins`, `logs`, and `static`: persistent credentials and runtime data.
- `state/quota-snapshots.json`: persisted, sanitized account quota observations;
  deployments and rollbacks preserve this directory. Compose mounts it at
  `/data/state` and sets `CLI_PROXY_STATE_DIR` accordingly.
- `initial-credentials.json`: initial client API key and management password,
  created with owner-only permissions and never printed by bootstrap or CI.
  This is an initial handoff record; it does not track subsequent key rotation.
- `releases`: versioned deployment scripts and Compose definitions.
- `.env`: the last successfully deployed image and bundle.

The Docker image includes the customized account quota panel built directly from
the TypeScript and SCSS sources in `management-ui/`. The Compose bundle serves
`/CLIProxyAPI/static`
and disables management asset downloads with `MANAGEMENT_DISABLE_AUTO_UPDATE=true`,
so panel changes are versioned and rolled back together with the image. The old
`static` runtime directory is retained for older release bundles. See
[`management-ui/README.md`](../management-ui/README.md) for local panel builds.

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
subject: repo:paul1319@28653225/CLIProxyAPI@1420830716:ref:refs/heads/main
```

This fork uses GitHub's immutable subject format, which includes owner and
repository IDs. Retrieve the exact subject from the repository's OIDC settings
instead of assuming the older name-only format:

```bash
gh api repos/paul1319/CLIProxyAPI/actions/oidc/customization/sub \
  --jq '.sub_claim_prefix + ":ref:refs/heads/main"'
```

Tailscale SSH requires a tagged destination when CI uses a tag identity. A
tagged CI node cannot SSH to a user-owned destination by naming its owner or IP.
See the [SSH destination constraints](https://tailscale.com/docs/reference/syntax/policy-file#dst-1).

Review and back up the existing tailnet policy before moving the Mac to
`tag:cliproxy-mac`. Tagging changes its identity for every service, including
existing SSH and T3 access. First preserve the owner's required network and SSH
permissions explicitly, then add the CI grant. Merge entries into the existing
policy rather than replacing it. This example permits the owner and CI to SSH
as `pavel`; retain any other already-required owner accounts as well:

```json
{
  "tagOwners": {
    "tag:cliproxy-ci": ["autogroup:admin"],
    "tag:cliproxy-mac": ["autogroup:admin"]
  },
  "grants": [
    {"src": ["REPLACE_WITH_MAC_OWNER_IDENTITY"], "dst": ["tag:cliproxy-mac"], "ip": ["*"]},
    {"src": ["tag:cliproxy-ci"], "dst": ["tag:cliproxy-mac"], "ip": ["tcp:22"]}
  ],
  "ssh": [
    {"action": "check", "src": ["REPLACE_WITH_MAC_OWNER_IDENTITY"], "dst": ["tag:cliproxy-mac"], "users": ["pavel"]},
    {"action": "accept", "src": ["tag:cliproxy-ci"], "dst": ["tag:cliproxy-mac"], "users": ["pavel"]}
  ]
}
```

Check existing grants and SSH rules for broader access: a pre-existing wildcard
source can grant CI additional network access. Preserve other devices' required
permissions when narrowing such rules, including the server Mac's existing
outbound tailnet access. Preserve existing owner SSH check-mode requirements.
After policy validation, assign
`tag:cliproxy-mac` only to the server Mac, preserving any existing tags. Verify
the owner's SSH and T3 access from another device before enabling deployment.
CI SSH runs as the Docker Desktop owner, `pavel`, so trusted `main` code has that
user's machine access. Protect who can write to `main`.

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

The temporary Docker configuration explicitly uses file credentials so headless
SSH does not invoke the macOS Keychain helper. CI also requires an exact completion
receipt from each remote operation: macOS `login` can return zero even when the
child command fails. Deployment emits its receipt only after image and HTTP
health verification, a successful deployment-state write, and credential cleanup.

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

For a code rollback, revert the corresponding repository change and deliver it
through `deploy-mac`. Configuration changes use `configure-mac` as described
above. Do not run a retained deployment bundle manually against the service.

If a process was forcibly killed and left `.deploy.lock`, confirm no deploy is
running before removing that empty directory. Keep the previous image cached for
offline automatic rollback. Do not run `docker compose down -v` or broad cleanup
commands as part of deployment.
