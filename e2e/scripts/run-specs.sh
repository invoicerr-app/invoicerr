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

IFS=',' read -ra list <<< "$specs"
for spec in "${list[@]}"; do
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
