#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }

image=${1:?Usage: deploy.sh IMAGE [--local-image | --registry-token-stdin USER]}
[[ "$image" =~ ^[a-zA-Z0-9][a-zA-Z0-9./:@_-]+$ ]] || die "Invalid image reference"
mode=${2:-}
case "$mode" in
  ""|--local-image) [[ $# -le 2 ]] || die "Unexpected arguments" ;;
  --registry-token-stdin) [[ $# -eq 3 ]] || die "Registry username is required" ;;
  *) die "Unknown option: $mode" ;;
esac

deploy_dir=${CLI_PROXY_DEPLOY_DIR:-"$HOME/.local/share/cliproxyapi"}
deploy_dir=$(cd "$deploy_dir" && pwd -P)
release_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
release=${release_dir##*/}
[[ "$release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Invalid release directory"
[[ "$release_dir" == "$deploy_dir/releases/$release" ]] || die "Install the bundle under DEPLOY_DIR/releases/RELEASE first"
[[ -f "$deploy_dir/config/config.yaml" ]] || die "Run deploy/bootstrap.py on the Mac first"
for directory in auths logs plugins static; do
  [[ -d "$deploy_dir/$directory" ]] || die "Missing runtime directory: $directory"
done
timeout=${CLI_PROXY_HEALTH_TIMEOUT:-60}
[[ "$timeout" =~ ^[0-9]+$ ]] || die "Invalid health timeout"
mkdir "$deploy_dir/.deploy.lock" 2>/dev/null || die "Another deployment holds $deploy_dir/.deploy.lock"

registry_config=""
registry_host=""
state_tmp=""
rollback_needed=false
previous_image=""
previous_release=""
compose_file="$release_dir/compose.yaml"

compose() {
  local selected_image=$1 selected_compose=$2
  shift 2
  CLI_PROXY_IMAGE="$selected_image" docker compose --project-name cliproxyapi \
    --project-directory "$deploy_dir" --env-file /dev/null --file "$selected_compose" "$@"
}

save_state() {
  state_tmp=$(mktemp "$deploy_dir/.env.XXXXXX")
  printf 'CLI_PROXY_IMAGE=%s\nCLI_PROXY_RELEASE=%s\n' "$1" "$2" > "$state_tmp"
  mv -f "$state_tmp" "$deploy_dir/.env"
  state_tmp=""
}

healthy() {
  local selected_image=$1 selected_compose=$2 expected_id=$3 container_id state started=$SECONDS
  while true; do
    container_id=$(compose "$selected_image" "$selected_compose" ps -q proxy) || return 1
    if [[ -n "$container_id" ]]; then
      state=$(docker inspect --format '{{.State.Running}} {{.Image}}' "$container_id") || return 1
      if [[ "$state" == "true $expected_id" ]] && curl --noproxy '*' --silent --fail \
        --output /dev/null --connect-timeout 2 --max-time 3 http://127.0.0.1:8317/healthz; then
        return 0
      fi
    fi
    (( SECONDS - started < timeout )) || return 1
    sleep 1
  done
}

cleanup() {
  local result=$? restored=false
  trap - EXIT INT TERM
  if $rollback_needed; then
    if [[ -n "$previous_image" ]]; then
      printf 'Deployment failed; restoring previous image %s\n' "$previous_image" >&2
      if compose "$previous_image" "$deploy_dir/releases/$previous_release/compose.yaml" up -d --no-build --pull never && \
        healthy "$previous_image" "$deploy_dir/releases/$previous_release/compose.yaml" "$previous_image"; then
        if save_state "$previous_image" "$previous_release"; then restored=true; fi
      fi
      $restored || printf 'Rollback could not be verified; inspect the cliproxyapi Compose project.\n' >&2
    else
      printf 'Initial deployment failed; removing the failed service, retaining all data.\n' >&2
      compose "$image" "$compose_file" rm --stop --force proxy || true
    fi
  fi
  [[ -z "$state_tmp" ]] || rm -f "$state_tmp" || result=1
  [[ -z "$registry_config" ]] || rm -rf "$registry_config" || result=1
  rmdir "$deploy_dir/.deploy.lock" || result=1
  if [[ "$result" == 0 ]]; then
    printf 'Deployed %s (bundle %s); HTTP health check passed.\n' "$image" "$release"
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep Compose's normal plugin/context configuration. Only registry operations
# use the disposable credential store and the existing Desktop socket.
registry_docker() {
  DOCKER_CONFIG="$registry_config" DOCKER_HOST="$registry_host" DOCKER_CONTEXT='' docker "$@"
}

if [[ "$mode" == --registry-token-stdin ]]; then
  registry_host=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}
  registry_config=$(mktemp -d "${TMPDIR:-/tmp}/cliproxy-registry.XXXXXX")
  # A registry entry prevents Docker from auto-selecting the macOS Keychain helper.
  printf '{"auths":{"ghcr.io":{}}}\n' > "$registry_config/config.json"
  registry_docker login ghcr.io --username "$3" --password-stdin
fi

docker info >/dev/null
compose "$image" "$compose_file" config --quiet
old_container=$(compose "$image" "$compose_file" ps -a -q proxy)
if [[ -n "$old_container" ]]; then
  [[ -f "$deploy_dir/.env" ]] || die "Existing service has no deployment state; refusing to replace it"
  previous_release=$(sed -n 's/^CLI_PROXY_RELEASE=//p' "$deploy_dir/.env")
  [[ "$previous_release" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Invalid previous release"
  [[ -f "$deploy_dir/releases/$previous_release/compose.yaml" ]] || die "Previous Compose bundle is missing"
  previous_image=$(docker inspect --format '{{.Image}}' "$old_container")
fi
if [[ "$mode" == --registry-token-stdin ]]; then
  registry_docker pull "$image"
elif [[ "$mode" != --local-image ]]; then
  docker pull "$image"
fi
architecture=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")
[[ "$architecture" == linux/arm64 ]] || die "Expected linux/arm64, received $architecture"
expected_image=$(docker image inspect --format '{{.Id}}' "$image")

# Pull and validate before replacing anything. Both update and rollback use cached images.
rollback_needed=true
compose "$image" "$compose_file" up -d --no-build --pull never
healthy "$image" "$compose_file" "$expected_image" || die "New image failed the HTTP health check"
save_state "$image" "$release"
rollback_needed=false
