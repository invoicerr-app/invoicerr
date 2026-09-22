import { logger } from '@/logger/logger.service';

import {
  DEFAULT_RENDER_LANGUAGE,
  isSupportedRenderLanguage,
  RenderLanguage,
  SUPPORTED_RENDER_LANGUAGES,
} from './supported-languages';

/**
 * `DEFAULT_LOCALE` — an INSTANCE-wide language, one step above the hardcoded
 * `DEFAULT_RENDER_LANGUAGE` ('en') at the bottom of every language cascade in this codebase
 * (`resolveRecipientLanguage`, `resolveUserLanguage`, and `mailT` itself for the handful of call
 * sites that reach it directly — see that file's own header for which ones and why). Exists for a
 * self-hosted instance whose whole tenant base speaks one language that is not English: a French
 * association running Invoicerr on its own server should not get English system mail just because a
 * given `Client`/`Company` row happens to have no language of its own — today, absent this var, that
 * is exactly what happens, since the ONLY fallback below a client/company/user's own choice is a
 * constant that has nothing to do with where this particular instance is actually deployed.
 *
 * ## Why read once and memoized, not `process.env.DEFAULT_LOCALE` inline at every call site
 *
 * The validity check below (`resolveDefaultLocale`) can log a warning — a bad value is a boot-time
 * misconfiguration, not a per-request event — and a value this codebase already treats as effectively
 * constant for the life of the process (nothing ever changes an instance's own env vars without a
 * restart) has no business being re-parsed and re-validated on every single document/mail render.
 * Same shape as `modules/billing/polar-client.ts`'s own `cached`/`resetPolarClientForTests` pair: a
 * module-level variable holding the resolved value, and a test-only reset so a spec that swaps
 * `process.env.DEFAULT_LOCALE` between cases never silently reuses an earlier run's result.
 */
/** Distinct sentinel from `undefined` — `undefined` is a legitimate MEMOIZED result (env unset, or
 *  set to something this catalog does not carry), so it cannot double as "not read yet" without a
 *  process whose first resolution genuinely finds nothing ever re-checking the env on every call. */
const UNREAD = Symbol('default-locale-unread');

let cached: RenderLanguage | undefined | typeof UNREAD = UNREAD;

/**
 * Resolves `DEFAULT_LOCALE` against `SUPPORTED_RENDER_LANGUAGES`, exactly once per process.
 *
 * Returns `undefined` — never throws, never crashes boot — when the var is unset, blank, or names a
 * language this render layer carries no strings for; every caller already has its own concrete
 * fallback (`DEFAULT_RENDER_LANGUAGE`) for exactly that case, so "no usable instance default" is a
 * perfectly ordinary result here, not an error.
 *
 * An unrecognised-but-non-blank value (an admin's `DEFAULT_LOCALE=fra` typo) is the one case worth a
 * human's attention: it warns exactly ONCE (this function's own memoization is what makes "once" hold)
 * through `logger.warn`, so it lands in Settings → Logs precisely because container stdout is not
 * where a self-hosted admin generally goes looking after boot.
 */
export function resolveDefaultLocale(): RenderLanguage | undefined {
  if (cached !== UNREAD) return cached;

  const raw = process.env.DEFAULT_LOCALE?.trim().toLowerCase();
  cached = raw && isSupportedRenderLanguage(raw) ? raw : undefined;

  if (raw && cached === undefined) {
    // `companyId: null`: this is an instance-level fact, not one tied to whichever company happens
    // to be ambient the first time something resolves a language (the first invoice sent, the first
    // mail, ...) — see `logger.service.ts`'s own `LogOptions.companyId` header for why an explicit
    // `null` is the correct spelling of "genuinely instance-level" rather than omitting the field
    // (which would instead capture whatever company happened to be active at that moment).
    // Not awaited — same "never let a log write block the caller" posture
    // `mail/providers/smtp.provider.ts`'s own missing-`SMTP_HOST` warning already takes.
    // INSTANCE-LEVEL-LOG: DEFAULT_LOCALE is a deployment-wide setting, not scoped to any one company.
    logger.warn(
      `DEFAULT_LOCALE="${raw}" is not one of the languages this instance can render ` +
        `(${SUPPORTED_RENDER_LANGUAGES.join(', ')}) — every document/mail that would have used it falls ` +
        `back to ${DEFAULT_RENDER_LANGUAGE} instead. Fix or unset DEFAULT_LOCALE.`,
      { category: 'mail', companyId: null },
    );
  }

  return cached;
}

/** Test-only: forces the next `resolveDefaultLocale()` call to re-read `process.env.DEFAULT_LOCALE`
 *  instead of returning an earlier run's memoized result — required by any spec that mutates the var
 *  between cases, the same role `resetPolarClientForTests` plays for `polar-client.ts`'s own cache. */
export function __resetDefaultLocaleForTests(): void {
  cached = UNREAD;
}
