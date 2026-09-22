import { LegalDocument } from './legal-documents';
import { availableLanguagesOf, resolveLegalDocumentView } from './legal-document-view';

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
      de: { language: 'de', title: 'Datenschutzerklärung', content: 'Deutscher Text.' },
    },
    ...overrides,
  };
}

describe('availableLanguagesOf', () => {
  it('always lists English first, then every translated language in catalog order', () => {
    expect(availableLanguagesOf(buildDoc())).toEqual(['en', 'fr', 'de']);
  });

  it('is just ["en"] for a document with no translation at all', () => {
    expect(availableLanguagesOf(buildDoc({ translations: {} }))).toEqual(['en']);
  });
});

describe('resolveLegalDocumentView', () => {
  it("picks the first preferred language the document actually has, ignoring ones it doesn't", () => {
    const view = resolveLegalDocumentView(buildDoc(), ['it', 'de', 'fr']);
    expect(view.language).toBe('de');
    expect(view.title).toBe('Datenschutzerklärung');
    expect(view.content).toBe('Deutscher Text.');
  });

  it('falls back to English when nothing in the preference list matches', () => {
    const view = resolveLegalDocumentView(buildDoc(), ['it', 'pl']);
    expect(view.language).toBe('en');
    expect(view.title).toBe('Privacy Policy');
    expect(view.content).toBe('English body.');
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
    const view = resolveLegalDocumentView(buildDoc(), ['de']);
    expect(view.availableLanguages).toEqual(['en', 'fr', 'de']);
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
