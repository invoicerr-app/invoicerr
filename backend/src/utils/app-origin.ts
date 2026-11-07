import { DEV_FRONTEND_ORIGIN } from '@/lib/dev-origins';

/**
 * The origin the operator's BROWSER uses for this instance.
 *
 * Every link this app emails or redirects a person to (an ownership-transfer acceptance, a portal
 * invite, a signature request, a billing return) must point at the frontend, never at the backend's
 * own port. `APP_URL` is that origin; when it is unset in development the Vite dev server is the
 * only answer that produces a working link. Centralised because the same fallback used to be
 * re-spelled at each call site, with two contradictory defaults (`:3000` here, `:5173` there).
 *
 * Distinct from `backendPublicUrl()`, which is what a THIRD-PARTY SERVER needs to reach this backend.
 */
export function appOrigin(): string {
  const url = process.env.APP_URL || DEV_FRONTEND_ORIGIN;
  return url.replace(/\/+$/, '');
}
