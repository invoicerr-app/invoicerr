import { DEFAULT_RENDER_LANGUAGE, isSupportedRenderLanguage, RenderLanguage } from './supported-languages';

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/**
 * TODO_FEATURES.md rank 14 ("langue du document par destinataire") — the ONE place the recipient's
 * language is decided, for both the PDF (`rendering/render-instance-pdf.ts`) and the send email
 * (`actions/send-document-email.ts`), so the two can never disagree about which language a given
 * document goes out in.
 *
 * ## Why an explicit `Client.language`, not the client's country or a derived locale
 *
 * Three other sources were considered and rejected:
 *  - **The client's own country** — a country names a jurisdiction, not a language. Belgium (French/
 *    Dutch/German) and Switzerland (French/German/Italian/Romansh) are the two textbook cases in
 *    exactly the markets this product operates in; a country→language table would have to either guess
 *    (wrong some fraction of the time, silently) or special-case every multi-language country by hand,
 *    and would still be wrong for a French client living in, say, Portugal.
 *  - **The client's "existing locale"** — there isn't one: neither `Client` nor `User` has ever carried
 *    a locale/language column (verified against the full schema before this feature).
 *  - **The company's own default, alone, with no per-client override** — this is exactly the CURRENT
 *    behavior (every document renders in whatever the descriptor's hardcoded strings happen to be) and
 *    defeats the feature outright: a company invoicing across FR/PL/IT/PT/DE by construction serves
 *    clients who do not all share one language, which is the whole reason rank 14 exists.
 *
 * An explicit field is the only one of the four candidates that is EVER certainly right — it costs the
 * user one extra choice per client (or none, if they never set it and accept the fallback below), which
 * is a small, one-time, honest price for a fact no inference could reconstruct correctly for every
 * client.
 *
 * ## Resolution order
 *
 *  1. `clientLanguage` (`Client.language`) — authoritative when it names a language this render layer
 *     actually carries strings for.
 *  2. `companyLanguage` (`Company.language`) — the company's own default, used for every client who
 *     has not set one. Strictly a FALLBACK, never consulted when the client's own choice is usable:
 *     this is what keeps a company with clients in several languages from being flattened to one.
 *  3. `DEFAULT_RENDER_LANGUAGE` ('en') — every hardcoded string in this render layer predates this
 *     feature and was already English, so an all-default document is byte-for-byte what it always was.
 *
 * Case-insensitive and whitespace-tolerant on the way in (`normalize`), but the return value is always
 * one of the six canonical lowercase codes `pdf-chrome-strings.ts`/`email-defaults.ts` index by.
 */
export function resolveRecipientLanguage(
  clientLanguage: string | null | undefined,
  companyLanguage: string | null | undefined,
): RenderLanguage {
  const client = normalize(clientLanguage);
  if (isSupportedRenderLanguage(client)) return client;

  const company = normalize(companyLanguage);
  if (isSupportedRenderLanguage(company)) return company;

  return DEFAULT_RENDER_LANGUAGE;
}
