/**
 * The escape hatch for the update-check feature (`GET /api/version` outbound call to GitHub — see
 * `version.service.ts`). The check itself is ALREADY safe for a self-hosted instance with no
 * outbound access on its own (on-demand rather than a cron, a 5s timeout, cached for hours, every
 * failure swallowed rather than surfaced — see that file's own header for the full contract), which
 * is why this defaults to enabled rather than requiring an explicit opt-in. This variable exists for
 * the operator who wants ZERO outbound calls from their instance as a matter of policy, not because
 * the default behaviour is unsafe.
 *
 * Accepts "true"/"1" case-insensitively, trimmed — the same tolerance `billing/billing-flag.ts`'s
 * `isBillingEnabled` and `DISABLE_AUTH` already get, so a stray trailing space from a copy-paste
 * never silently reads as "unset".
 */
export const UPDATE_CHECK_DISABLE_FLAG_NAME = 'DISABLE_UPDATE_CHECK';

export function isUpdateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env[UPDATE_CHECK_DISABLE_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
