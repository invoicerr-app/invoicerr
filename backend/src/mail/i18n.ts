import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as i18next from 'i18next';
import type { i18n as I18nInstance, TFunction } from 'i18next';

import { resolveDefaultLocale } from '@/modules/documents/rendering/language/default-locale';
import {
  DEFAULT_RENDER_LANGUAGE,
  isSupportedRenderLanguage,
  RenderLanguage,
  SUPPORTED_RENDER_LANGUAGES,
} from '@/modules/documents/rendering/language/supported-languages';

/**
 * System-mail translations — a SINGLE i18next namespace ('mails') shared by every mail this
 * application sends, loaded for the exact six languages `rendering/language` already carries PDF/
 * email-default strings for (`SUPPORTED_RENDER_LANGUAGES`, reused rather than duplicated: a language
 * this render layer does not know is not a language a mail should claim to know either).
 *
 * ## Why a private i18next INSTANCE, not the module-level default export
 *
 * `i18next.init()` on the default singleton would collide with anything else in this process that
 * ever calls `i18next.init()` (a plugin, a future second namespace) — `createInstance()` keeps this
 * catalog's configuration (its `resources`, its `fallbackLng`) fully private to the mail sender.
 *
 * ## Why the catalogs are READ, not `import`ed
 *
 * Same convention every per-country catalog in `modules/documents/*` already follows
 * (`vat-rates/data/all.ts`, `country-policy/data/all.ts`): `fs.readFileSync` + `JSON.parse` against
 * `nest-cli.json`'s own `**\/*.json` asset-copy rule, so a translation edit is a data change, never a
 * TypeScript one. Unlike those catalogs the language list here is NOT discovered from the directory —
 * `SUPPORTED_RENDER_LANGUAGES` is the single source of truth for which six languages this whole
 * product knows, so a stray extra folder under `locales/` would silently never be loaded rather than
 * silently becoming a seventh supported language nothing else in the app agrees exists.
 *
 * ## Why no `i18next-fs-backend`
 *
 * That plugin exists to load translation files LAZILY, on first use, from disk on every request — the
 * dynamic per-country catalogs in this codebase already prove that pattern is right for hundreds of
 * KB of rarely-touched legal data, but a mail catalog is read on every single send. Loading all six
 * (tiny) files once, synchronously, at module import time (`initImmediate: false` makes `.init()`
 * resolve before this module finishes evaluating, so `mailT` never has to await anything) means
 * sending a mail is zero extra I/O, ever.
 */
const MAILS_NAMESPACE = 'mails';

function loadMailsCatalog(language: RenderLanguage): Record<string, unknown> {
  const path = join(__dirname, 'locales', language, 'mails.json');
  return JSON.parse(readFileSync(path, 'utf-8'));
}

let instance: I18nInstance | undefined;

function getInstance(): I18nInstance {
  if (instance) return instance;

  const created = i18next.createInstance();
  created.init({
    lng: DEFAULT_RENDER_LANGUAGE,
    fallbackLng: DEFAULT_RENDER_LANGUAGE,
    supportedLngs: [...SUPPORTED_RENDER_LANGUAGES],
    ns: [MAILS_NAMESPACE],
    defaultNS: MAILS_NAMESPACE,
    resources: Object.fromEntries(
      SUPPORTED_RENDER_LANGUAGES.map((language) => [
        language,
        { [MAILS_NAMESPACE]: loadMailsCatalog(language) },
      ]),
    ),
    // `{{var}}` is i18next's own default, kept explicit here only so this file states the contract
    // rather than relying on a default nobody reading it would think to check — the SAME syntax the
    // frontend's own `t()` calls use (`frontend/src/lib/i18n.ts`), so a translator moving between the
    // two catalogs never has to learn a second placeholder convention.
    interpolation: { prefix: '{{', suffix: '}}' },
    // Deliberately left at i18next's default (`true`, HTML-escaping) rather than the frontend's
    // `escapeValue: false` — the frontend disables it because React already escapes text nodes on its
    // own; a mail body built by string concatenation (`mail-layout.ts`) has no such second safety net,
    // so an interpolated value (a client's name, an invoice number) must be escaped exactly once, HERE.
    initImmediate: false,
    showSupportNotice: false,
  });

  instance = created;
  return created;
}

/** Case-insensitive, whitespace-tolerant normalization — the exact same private convention
 *  `resolve-recipient-language.ts` already applies to a raw, possibly differently-cased stored value
 *  before checking it against `SUPPORTED_RENDER_LANGUAGES`. Not shared code (that file's own `normalize`
 *  is private to it) because the two callers resolve a DIFFERENT pair of inputs — a client/company
 *  language pair there, a single raw language here — and duplicating four lines is cheaper than
 *  exporting a helper whose only job is to be reused by exactly two call sites in different modules. */
function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve a raw, possibly-unsupported language into one `RenderLanguage` this catalog actually
 * carries strings for, then return an i18next `t` PERMANENTLY fixed to it (`getFixedT`) — every call
 * site gets back a plain function of `(key, options) => string`, never a language argument to thread
 * through every subsequent translation call, and never a way to accidentally translate one mail into
 * two different languages by re-resolving mid-build.
 *
 * An unsupported/unset input (an unset company/client language field, or a stray value from before
 * this feature existed) falls back to `DEFAULT_LOCALE` (`resolveDefaultLocale`, an instance-wide env
 * var) when that names a language this catalog carries, else `DEFAULT_RENDER_LANGUAGE` ('en') — the
 * exact two-step tail `resolveRecipientLanguage`/`resolveUserLanguage` already apply for documents, so
 * a mail and the document it is ABOUT never disagree about which language a recipient with no explicit
 * preference sees.
 *
 * This fallback belongs here too, not only in the two resolvers above them, because not every caller
 * of `mailT` goes through one: `CompanyMailSettingsService#sendTest`'s own `language` parameter is
 * optional and reaches `mailT` unresolved when omitted. Consulting `DEFAULT_LOCALE` again here for an
 * ALREADY-resolved value (the overwhelming majority of calls) is a no-op — `resolved` from either
 * resolver is always one of `SUPPORTED_RENDER_LANGUAGES` already, so `isSupportedRenderLanguage`
 * below is true before this fallback is ever reached.
 */
export function mailT(language: string | null | undefined): TFunction {
  const normalized = normalize(language);
  const resolved = isSupportedRenderLanguage(normalized)
    ? normalized
    : (resolveDefaultLocale() ?? DEFAULT_RENDER_LANGUAGE);
  return getInstance().getFixedT(resolved, MAILS_NAMESPACE);
}
