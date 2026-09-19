/**
 * Resolves a `LegalDocument` (`legal-documents.ts`, always English + zero or more translations) into
 * the language a given request actually gets — the ONE place `title`/`content` can differ from the
 * document's own English fields, so `legal.service.ts` and any future consumer never each grow their
 * own "pick a translation, or fall back" logic. `contentHash` — and therefore acceptance/release
 * identity — is passed through completely untouched by this resolution: see `LegalDocument.
 * contentHash`'s own comment for why only the English wording is ever the text an acceptance is keyed
 * on.
 */
import { LegalDocument } from './legal-documents';
import {
  DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  LegalDocumentLanguage,
  LEGAL_DOCUMENT_LANGUAGES,
} from './legal-languages';

export interface LegalDocumentView {
  slug: string;
  title: string;
  version: string;
  effectiveDate: string;
  sidebarPosition: number;
  content: string;
  contentHash: string;
  /** The language this VIEW actually rendered in — 'en' whenever none of the caller's preferred
   *  languages had a translation for this particular slug, even if the caller's #1 choice was
   *  something else entirely (a French-preferring visitor reading `terms-of-service`, which only ships
   *  an `en`/`fr` pair, still gets `language: 'fr'`; the same visitor reading a slug with no French
   *  translation at all gets `language: 'en'`). */
  language: LegalDocumentLanguage;
  /** Every language this SLUG has text in, 'en' always first — what a language selector in the
   *  frontend (`pages/legal/[slug].tsx`/`accept.tsx`) renders, and the one field that lets it decide
   *  whether to show a selector at all (`length > 1`). */
  availableLanguages: LegalDocumentLanguage[];
}

/** `'en'` first (it always exists), then every language this document ships a translation in, in the
 *  catalog's own canonical order — never the order translations happen to appear in `translations`
 *  (a `Record`'s own key order is an implementation detail this view must not expose as if it meant
 *  something). */
export function availableLanguagesOf(doc: LegalDocument): LegalDocumentLanguage[] {
  return [
    DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
    ...LEGAL_DOCUMENT_LANGUAGES.filter(
      (lang) => lang !== DEFAULT_LEGAL_DOCUMENT_LANGUAGE && doc.translations[lang],
    ),
  ];
}

/**
 * `preferredLanguages` is an ORDERED wishlist (highest priority first, built by
 * `legal-request-language.ts`) — the first entry that names a language THIS document actually has
 * text in wins; a preference this document has no translation for is simply skipped, never treated as
 * an error. English is always a safe last resort because `availableLanguagesOf` always includes it, so
 * this function never needs its own separate "nothing matched" branch beyond `?? DEFAULT_...`.
 */
export function resolveLegalDocumentView(
  doc: LegalDocument,
  preferredLanguages: readonly string[],
): LegalDocumentView {
  const available = availableLanguagesOf(doc);
  const chosen = preferredLanguages.find((lang) => (available as readonly string[]).includes(lang)) as
    | LegalDocumentLanguage
    | undefined;
  const language = chosen ?? DEFAULT_LEGAL_DOCUMENT_LANGUAGE;
  const translation = language === DEFAULT_LEGAL_DOCUMENT_LANGUAGE ? undefined : doc.translations[language];

  return {
    slug: doc.slug,
    title: translation?.title ?? doc.title,
    version: doc.version,
    effectiveDate: doc.effectiveDate,
    sidebarPosition: doc.sidebarPosition,
    content: translation?.content ?? doc.content,
    contentHash: doc.contentHash,
    language,
    availableLanguages: available,
  };
}
