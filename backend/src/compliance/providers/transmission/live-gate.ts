/**
 * Shared gate helper for live (real-API) integration tests.
 *
 * Returns `describe` when the feature flag AND all required credential env vars are present.
 * Returns `describe.skip` otherwise — ensuring gated specs are silently skipped in CI and
 * in any offline run where the flag is not explicitly set.
 *
 * Usage (one line replaces the inline ternary in every live spec):
 *
 *   import { liveDescribe } from '../live-gate';
 *   const describeLive = liveDescribe('KSEF_LIVE', ['KSEF_AUTH_TOKEN']);
 *   describeLive('KSeF live round-trip', () => { ... });
 *
 * Gate logic:
 *   - Flag absent or not '1'   → describe.skip (silent — normal default-off behaviour)
 *   - Flag set but creds absent → describe.skip (+ one-line stderr warning so the operator
 *                                  knows what to add; does not appear as a test failure)
 *   - Flag set + creds present  → describe (block runs)
 *
 * Hard-success contract (enforced inside each spec, not here):
 *   - A REJECTED or SKIPPED transmission result must fail the test.
 *   - An empty authority ref/id must fail the test.
 *   - This file only controls WHETHER the block runs, not how it asserts.
 *
 * Env vars summary (see LIVE_TESTING.md for full list):
 *   KSEF_LIVE=1         KSeF (PL) round-trip
 *   PDP_LIVE=1          PDP superpdp (FR) round-trip
 *   PDP_AFNOR_LIVE=1    PDP AFNOR-style flow (FR) round-trip
 *   EMAIL_LIVE=1        Email SMTP round-trip (Ethereal — no creds needed)
 *   SDI_LIVE=1          SdI (IT) round-trip (requires AdE accreditation + PFX)
 *   PEPPOL_LIVE=1       Peppol AP round-trip (requires connected Access Point)
 *   PORTAL_LIVE=1       National portal round-trip (requires PORTAL_ID + portal-specific creds)
 */
export function liveDescribe(
  flagVar: string,
  requiredEnvVars: string[] = [],
): typeof describe {
  // Primary gate: opt-in flag must be explicitly '1'.
  if (process.env[flagVar] !== '1') {
    // eslint-disable-next-line no-restricted-properties
    return describe.skip;
  }

  // Secondary gate: all listed credential env vars must be non-empty.
  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    process.stderr.write(
      `[live-gate] ${flagVar}=1 but missing env vars: ${missing.join(', ')} — suite will be skipped.\n`,
    );
    // eslint-disable-next-line no-restricted-properties
    return describe.skip;
  }

  return describe;
}
