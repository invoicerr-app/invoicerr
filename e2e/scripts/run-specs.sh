#!/usr/bin/env bash
# Runs a comma-separated list of specs one Cypress process each, every process under a hard
# wall-clock limit. A browser that stops answering cannot be failed from inside Cypress, so a spec
# that outlives the limit is killed here and reported red while the remaining specs still run.
# Usage: run-specs.sh <spec,spec,...> [cypress args...]   (SPEC_TIMEOUT_MIN, default 15)
set -uo pipefail

specs="${1:?usage: run-specs.sh <spec,spec,...> [cypress args...]}"
shift
limit_min="${SPEC_TIMEOUT_MIN:-15}"
cypress_bin="${CYPRESS_BIN:-npx cypress}"
failed=()

# One block per spec start, in the same artefact as the backend log: the timestamps, the spec names
# and the machine load next to them show where a slow shard spent its time. The upload there runs
# `if: always()`, so the file survives a cancelled run, which is exactly when it is needed.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
heartbeat_log="${HEARTBEAT_LOG:-$script_dir/../../logs/heartbeat-shard-${SHARD:-0}.log}"
mkdir -p "$(dirname "$heartbeat_log")" 2>/dev/null || true

record_heartbeat() {
  {
    echo "=== $(date -Is) spec=$1"
    echo "loadavg: $(cat /proc/loadavg 2>/dev/null || echo unavailable)"
    echo "docker stats:"
    docker stats --no-stream 2>/dev/null || echo "  unavailable"
  } >> "$heartbeat_log" 2>&1 || true
}

IFS=',' read -ra list <<< "$specs"
for spec in "${list[@]}"; do
  record_heartbeat "$spec"
  echo "::group::$spec"
  timeout --kill-after=30 "${limit_min}m" $cypress_bin run "$@" --spec "$spec"
  status=$?
  echo "::endgroup::"
  if [[ "$status" -eq 124 || "$status" -eq 137 ]]; then
    echo "::error::$spec exceeded ${limit_min} minutes and was killed" >&2
    failed+=("$spec (timed out)")
  elif [[ "$status" -ne 0 ]]; then
    failed+=("$spec")
  fi
done

if [[ "${#failed[@]}" -gt 0 ]]; then
  echo "Failed specs:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
