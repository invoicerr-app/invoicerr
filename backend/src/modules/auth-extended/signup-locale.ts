import {
  RenderLanguage,
  isSupportedRenderLanguage,
} from '@/modules/documents/rendering/language/supported-languages';

/**
 * `lib/auth.ts`'s sign-up `before` hook calls this to decide what actually lands in the new user's
 * `locale` column. Pulled into its own pure function — testable under Jest, unlike `lib/auth.ts`
 * itself (better-auth is ESM-only across nearly every subpath export; see `account-lifecycle.ts`'s
 * own header for the full account of why that file exists at all) — for the one rule that matters
 * here: the value the sign-up form posts (`frontend/src/pages/auth/sign-up.tsx`'s own
 * `i18n.resolvedLanguage`) is whatever the browser happened to be rendering in, never a choice the
 * person actually made. Stored ONLY when this render layer carries strings for it; anything else
 * becomes `null` rather than a value nothing downstream will ever pick up.
 *
 * Contrast `PATCH /api/auth-extended/preferences` (`preferences.ts`'s own `parseAccountLocaleInput`),
 * which REJECTS an unsupported value with a 400 instead of silently dropping it: that endpoint is a
 * deliberate choice made from a dropdown built off this exact list, so an unsupported value there is a
 * caller bug, not a best-effort guess.
 */
export function normalizeSignupLocale(rawLocale: unknown): RenderLanguage | null {
  if (typeof rawLocale !== 'string') return null;
  const normalized = rawLocale.trim().toLowerCase();
  return isSupportedRenderLanguage(normalized) ? normalized : null;
}
