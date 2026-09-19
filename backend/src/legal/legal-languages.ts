/**
 * The closed set of languages a legal document (`documentation/docs/legal/*.md`) may carry a
 * translation in, and the pure parsing helpers `legal-request-language.ts` composes to decide which
 * one a given request gets. Deliberately its OWN small catalog rather than importing
 * `modules/documents/rendering/language/supported-languages.ts`: that module's `RenderLanguage` is
 * about which language a PDF/email renders a document IN, a different concern with its own reasons to
 * change independently of this one (per the "a country/concern is data, in its own narrow module"
 * shape CLAUDE.md's own "documents module" section describes for the compliance catalogs) — the two
 * happen to name the same five non-English codes today only because this product's in-scope countries
 * (FR/PL/IT/PT/DE) haven't diverged, not because one derives from the other.
 */

export const LEGAL_DOCUMENT_LANGUAGES = ['en', 'fr', 'de', 'it', 'pl', 'pt'] as const;

export type LegalDocumentLanguage = (typeof LEGAL_DOCUMENT_LANGUAGES)[number];

/** English is the ONLY language every one of the five documents is guaranteed to have — see
 *  `legal-documents.ts`'s own header on why a translation file is optional per slug, never required. */
export const DEFAULT_LEGAL_DOCUMENT_LANGUAGE: LegalDocumentLanguage = 'en';

/** Case-sensitive, already-normalized membership check — every caller that feeds this a raw,
 *  possibly differently-cased value (a query string, an `Accept-Language` tag, a stored `User.locale`)
 *  lowercases first, so this never has to. Never throws: a language this catalog does not (yet) carry
 *  a translation for is exactly as valid an input as an unset one — the caller falls back, it never
 *  errors. */
export function isLegalDocumentLanguage(value: unknown): value is LegalDocumentLanguage {
  return typeof value === 'string' && (LEGAL_DOCUMENT_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Parses an `Accept-Language` header (RFC 7231 §5.3.5, e.g. `"fr-FR,fr;q=0.9,en;q=0.8"`) into an
 * ordered list of lowercase PRIMARY language subtags, highest quality first (`fr-FR` and `fr` both
 * collapse to `fr` — a legal document is translated per language, never per region). Deliberately
 * hand-rolled rather than a dependency: the header's own grammar is small enough that a full
 * content-negotiation library would be more surface than this one call site needs, the same
 * proportionality judgment `legal-documents.ts`'s own front-matter parser makes for its five flat
 * `key: value` lines.
 *
 * Malformed entries (an empty tag, a non-numeric `q`) are dropped rather than thrown on — a visitor's
 * browser sending a header this can't fully parse must still get SOME preference read out of it, not
 * a 500 on the one public route that has to survive literally any request.
 */
export function parseAcceptLanguageHeader(header: string | undefined | null): string[] {
  if (!header) return [];

  const seen = new Set<string>();
  const ordered: string[] = [];

  const entries = header
    .split(',')
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(';');
      const primary = rawTag?.trim().split('-')[0]?.toLowerCase();
      const qParam = params.find((p) => p.trim().toLowerCase().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { primary, q: Number.isFinite(q) ? q : 1 };
    })
    .filter((entry): entry is { primary: string; q: number } => !!entry.primary)
    // `Array#sort` is stable (guaranteed since ES2019), so entries with an equal `q` keep the header's
    // own left-to-right order rather than being shuffled by the sort.
    .sort((a, b) => b.q - a.q);

  for (const entry of entries) {
    if (seen.has(entry.primary)) continue;
    seen.add(entry.primary);
    ordered.push(entry.primary);
  }

  return ordered;
}
