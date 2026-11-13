/**
 * The single switch for hosted billing. The alarming name is deliberate: a self-hosted operator copying
 * `.env.example` unmodified must see nothing change. Pure and synchronous because `lib/auth.ts` reads it
 * at module load time. Accepts "true"/"1", case-insensitive and trimmed.
 */
import { isDemoModeEnabled } from '@/modules/demo/demo-flag';

export const BILLING_FLAG_NAME = 'WARNING__ENABLE_BILLING_FOR_USERS__WARNING';

/**
 * `DEMO_MODE` forces billing off regardless of the flag, so a demo never shows a paywall or calls Polar.
 * `getPolarClient()` refuses on its own too, for paths that skip this check.
 */
export function isBillingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isDemoModeEnabled(env)) return false;
  const raw = (env[BILLING_FLAG_NAME] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}
