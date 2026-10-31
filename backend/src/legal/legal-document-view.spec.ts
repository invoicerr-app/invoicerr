import { LegalDocument } from './legal-documents';
import { availableLanguagesOf, resolveLegalDocumentView } from './legal-document-view';

/**
 * `translations` carries French only — the state of every real document since D-297 — so these
 * fixtures also prove what the shrinking of `LEGAL_DOCUMENT_LANGUAGES` changed: a German (or Italian,
 * Polish, Portuguese) preference is still a perfectly valid input, it simply matches no translation
 * any more and falls back to English instead of erroring.
 */
function buildDoc(overrides: Partial<LegalDocument> = {}): LegalDocument {
  return {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    version: '2026-09-19',
    effectiveDate: '2026-09-19',
    sidebarPosition: 2,
    content: 'English body.',
    contentHash: 'english-hash',
    translations: {
      fr: { language: 'fr', title: 'Politique de Confidentialité', content: 'Corps français.' },
    },
    ...overrides,
  };
}

describe('availableLanguagesOf', () => {
  it('always lists English first, then every translated language in catalog order', () => {
    expect(availableLanguagesOf(buildDoc())).toEqual(['en', 'fr']);
  });

  it('is just ["en"] for a document with no translation at all', () => {
    expect(availableLanguagesOf(buildDoc({ translations: {} }))).toEqual(['en']);
  });

  it('ignores a translation whose language the catalog no longer carries', () => {
    // The trailing `as never` models a stale `de`/`it`/`pl`/`pt` file left on disk after D-297: the
    // loader still parses it into `translations`, but a view must never advertise or serve it.
    const stale = {
      de: { language: 'de', title: 'Datenschutzerklärung', content: 'Deutscher Text.' },
    } as unknown as LegalDocument['translations'];
    const doc = buildDoc({ translations: { ...buildDoc().translations, ...stale } });
    expect(availableLanguagesOf(doc)).toEqual(['en', 'fr']);
  });
});

describe('resolveLegalDocumentView', () => {
  it("picks the first preferred language the document actually has, ignoring ones it doesn't", () => {
    const view = resolveLegalDocumentView(buildDoc(), ['de', 'fr']);
    expect(view.language).toBe('fr');
    expect(view.title).toBe('Politique de Confidentialité');
    expect(view.content).toBe('Corps français.');
  });

  it('falls back to English when nothing in the preference list matches', () => {
    const view = resolveLegalDocumentView(buildDoc(), ['it', 'pl']);
    expect(view.language).toBe('en');
    expect(view.title).toBe('Privacy Policy');
    expect(view.content).toBe('English body.');
  });

  it('falls back to English for a German preference — the catalog no longer carries German', () => {
    const view = resolveLegalDocumentView(buildDoc(), ['de']);
    expect(view.language).toBe('en');
    expect(view.content).toBe('English body.');
  });

  it('falls back to English for a French preference on a document with no French text', () => {
    const view = resolveLegalDocumentView(buildDoc({ translations: {} }), ['fr']);
    expect(view.language).toBe('en');
    expect(view.title).toBe('Privacy Policy');
  });

  it('falls back to English for an empty preference list', () => {
    expect(resolveLegalDocumentView(buildDoc(), []).language).toBe('en');
  });

  it('an explicit "en" preference short-circuits before any translation is even considered', () => {
    const view = resolveLegalDocumentView(buildDoc(), ['en', 'fr']);
    expect(view.language).toBe('en');
    expect(view.content).toBe('English body.');
  });

  it('reports every language this slug has text in, regardless of which one was chosen', () => {
    const view = resolveLegalDocumentView(buildDoc(), ['fr']);
    expect(view.availableLanguages).toEqual(['en', 'fr']);
  });

  it('carries the slug/version/effectiveDate/sidebarPosition through unchanged by language choice', () => {
    const doc = buildDoc();
    const en = resolveLegalDocumentView(doc, ['en']);
    const fr = resolveLegalDocumentView(doc, ['fr']);
    for (const view of [en, fr]) {
      expect(view.slug).toBe('privacy-policy');
      expect(view.version).toBe('2026-09-19');
      expect(view.effectiveDate).toBe('2026-09-19');
      expect(view.sidebarPosition).toBe(2);
    }
  });

  it('NEVER changes contentHash based on the resolved language — the acceptance identity is always the English hash', () => {
    const doc = buildDoc();
    const en = resolveLegalDocumentView(doc, ['en']);
    const fr = resolveLegalDocumentView(doc, ['fr']);
    const de = resolveLegalDocumentView(doc, ['de']);
    expect(en.contentHash).toBe('english-hash');
    expect(fr.contentHash).toBe('english-hash');
    expect(de.contentHash).toBe('english-hash');
  });
});
