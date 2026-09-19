/**
 * Per-recipient document language ("langue du document par destinataire") — the closed set of languages the
 * PDF/email render layer actually carries a translation for. Deliberately the five in-scope countries
 * (see CLAUDE.md's own "documents module" header — FR/PL/IT/PT/DE) plus 'en', the language every
 * hardcoded string in this render layer was already written in before this feature existed: adding
 * `Client.language`/`Company.language` support for a country this product does not yet operate in
 * would be translating strings nobody has reviewed, not shipping a feature.
 *
 * A `Record<RenderLanguage, X>` (not `Partial`) is the actual completeness guarantee this module
 * leans on throughout `pdf-chrome-strings.ts` and `email-defaults.ts`: the compiler refuses to build
 * unless every one of these six keys has a value, so there is no "supported language with a missing
 * key" state to defend against at runtime — only "language not in this set at all", which
 * `resolveRecipientLanguage` (this directory) already funnels to 'en' before anything ever looks the
 * dictionary up.
 */
export const SUPPORTED_RENDER_LANGUAGES = ['en', 'fr', 'it', 'pl', 'de', 'pt'] as const;

export type RenderLanguage = (typeof SUPPORTED_RENDER_LANGUAGES)[number];

/** The universal fallback — see this module's own header and `resolveRecipientLanguage`'s. Every
 *  hardcoded string this render layer had before this feature existed was already English; keeping it
 *  as the floor of the fallback chain changes nothing for a client/company that never sets a language. */
export const DEFAULT_RENDER_LANGUAGE: RenderLanguage = 'en';

/**
 * Strict (case-sensitive, already-normalized) membership check — `resolveRecipientLanguage` is the
 * only caller that ever feeds this a raw, possibly-differently-cased stored value, and it lowercases
 * first so this function never has to. Never throws: a value this product does not (yet) translate is
 * exactly as valid a database state as an unset one — see `resolveRecipientLanguage`'s own header for
 * why storage stays permissive while consumption stays type-safe, the same split `country`/
 * `guessCountryCode` already holds elsewhere in this schema.
 */
export function isSupportedRenderLanguage(value: unknown): value is RenderLanguage {
  return typeof value === 'string' && (SUPPORTED_RENDER_LANGUAGES as readonly string[]).includes(value);
}
