#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ $# -eq 3 ]] || { echo 'Usage: ssh-confirm.sh RECEIPT USER@HOST COMMAND' >&2; exit 1; }
receipt=$1
shift
output=$(mktemp)
trap 'rm -f "$output"' EXIT

# macOS login can report exit zero for a failed child command. Require the
# operation's completion receipt as well as a successful SSH transport status.
tailscale ssh "$@" | tee "$output"
grep --fixed-strings --line-regexp --quiet -- "$receipt" "$output" || {
  printf 'Remote command did not confirm completion: %s\n' "$receipt" >&2
  exit 1
}
