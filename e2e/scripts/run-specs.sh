#!/usr/bin/env bash
# Runs a comma-separated list of specs one Cypress process each, every process under a hard
# wall-clock limit. A browser that stops answering cannot be failed from inside Cypress, so a spec
# that outlives the limit is killed here and reported red while the remaining specs still run.
#
# A spec that failed with "The browser never connected" before running a single test gets exactly
# one retry: Cypress lost the browser before the spec started, so no test result is being papered
# over. A spec that ran any test is never retried, and a spec killed by the wall-clock limit is not
# retried either.
#
# Usage: run-specs.sh <spec,spec,...> [cypress args...]   (SPEC_TIMEOUT_MIN, default 15)
set -uo pipefail

specs="${1:?usage: run-specs.sh <spec,spec,...> [cypress args...]}"
shift
limit_min="${SPEC_TIMEOUT_MIN:-15}"
cypress_bin="${CYPRESS_BIN:-npx cypress}"
failed=()

# Cypress colours its output on CI, so the summary line reads `Tests:<ESC>[39m  <ESC>[31m0` and
# not `Tests:  0`. Every check below reads the log through this filter, which drops the SGR colour
# sequences; matching the raw log never saw `Tests: 0`, so the retry never fired. grep reads the
# filter through a process substitution, not a pipe: under `pipefail`, `grep -q` exiting on the
# first match would SIGPIPE the filter and turn a match into a failure.
plain() {
  sed -E $'s/\x1b\\[[0-9;]*m//g' "$1"
}

ran_any_test() {
  grep -qE 'Tests:[[:space:]]+[1-9]' <(plain "$1")
}

browser_never_connected() {
  grep -q 'The browser never connected' <(plain "$1")
}

no_test_ran() {
  grep -qE 'Tests:[[:space:]]+0([[:space:]]|$)' <(plain "$1") && ! ran_any_test "$1"
}

IFS=',' read -ra list <<< "$specs"
for spec in "${list[@]}"; do
  echo "::group::$spec"
  attempt=1
  while :; do
    log="$(mktemp)"
    timeout --kill-after=30 "${limit_min}m" $cypress_bin run "$@" --spec "$spec" 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
    if [[ "$attempt" -eq 1 && "$status" -ne 0 && "$status" -ne 124 && "$status" -ne 137 ]] \
      && browser_never_connected "$log" && no_test_ran "$log"; then
      echo "::warning::$spec: the browser never connected before any test ran, retrying once" >&2
      rm -f "$log"
      attempt=2
      continue
    fi
    rm -f "$log"
    break
  done
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
