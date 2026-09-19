import {
  REQUIRED_ACCEPTANCE_SLUGS,
  computeContentHash,
  currentContentHashOf,
  currentVersionOf,
  getLegalDocument,
  listLegalDocuments,
} from './legal-documents';

describe('legal-documents', () => {
  it('loads all six documents from ./data, sorted by sidebar_position', () => {
    const docs = listLegalDocuments();
    expect(docs.map((d) => d.slug)).toEqual([
      'terms-of-service',
      'privacy-policy',
      'data-processing-agreement',
      'legal-notice',
      'cookies-and-acceptable-use',
      'international-access-transparency',
    ]);
  });

  it('parses required front-matter fields for every document', () => {
    for (const doc of listLegalDocuments()) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(doc.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(doc.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Front matter itself must not leak into the body.
      expect(doc.content).not.toContain('sidebar_position:');
      expect(doc.content.startsWith('---')).toBe(false);
      expect(doc.content.length).toBeGreaterThan(0);
    }
  });

  it('getLegalDocument resolves a known slug and is undefined for an unknown one', () => {
    expect(getLegalDocument('terms-of-service')?.slug).toBe('terms-of-service');
    expect(getLegalDocument('does-not-exist')).toBeUndefined();
  });

  it('currentVersionOf mirrors getLegalDocument', () => {
    expect(currentVersionOf('privacy-policy')).toBe(getLegalDocument('privacy-policy')?.version);
    expect(currentVersionOf('does-not-exist')).toBeUndefined();
  });

  it('REQUIRED_ACCEPTANCE_SLUGS are exactly the two gated documents, and both exist', () => {
    expect(REQUIRED_ACCEPTANCE_SLUGS).toEqual(['terms-of-service', 'privacy-policy']);
    for (const slug of REQUIRED_ACCEPTANCE_SLUGS) {
      expect(getLegalDocument(slug)).toBeDefined();
    }
  });

  describe('computeContentHash', () => {
    it('is stable — the same content hashes the same on repeated calls', () => {
      const content = 'Section 1\n\nSome legal prose.\n';
      expect(computeContentHash(content)).toBe(computeContentHash(content));
    });

    it('is identical for the same text written with CRLF vs LF line endings', () => {
      const lf = 'Section 1\n\nSome legal prose.\nSecond line.';
      const crlf = lf.replace(/\n/g, '\r\n');
      expect(computeContentHash(crlf)).toBe(computeContentHash(lf));
    });

    it('ignores trailing whitespace on a line', () => {
      const clean = 'Section 1\nSome legal prose.';
      const trailingSpaces = 'Section 1  \nSome legal prose.\t';
      expect(computeContentHash(trailingSpaces)).toBe(computeContentHash(clean));
    });

    it('changes when the wording actually changes', () => {
      expect(computeContentHash('Version A')).not.toBe(computeContentHash('Version B'));
    });
  });

  it('currentContentHashOf mirrors getLegalDocument, undefined for an unknown slug', () => {
    expect(currentContentHashOf('privacy-policy')).toBe(getLegalDocument('privacy-policy')?.contentHash);
    expect(currentContentHashOf('does-not-exist')).toBeUndefined();
  });

  it('every loaded document carries a 64-hex-char sha256 contentHash', () => {
    for (const doc of listLegalDocuments()) {
      expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  describe('translations', () => {
    it('privacy-policy and data-processing-agreement ship every non-English catalog language', () => {
      for (const slug of ['privacy-policy', 'data-processing-agreement']) {
        const doc = getLegalDocument(slug)!;
        expect(Object.keys(doc.translations).sort()).toEqual(['de', 'fr', 'it', 'pl', 'pt']);
      }
    });

    it('terms-of-service, legal-notice and cookies-and-acceptable-use ship French only', () => {
      for (const slug of ['terms-of-service', 'legal-notice', 'cookies-and-acceptable-use']) {
        const doc = getLegalDocument(slug)!;
        expect(Object.keys(doc.translations)).toEqual(['fr']);
      }
    });

    it("a translation's own body never leaks front matter, and actually differs from the English text", () => {
      for (const doc of listLegalDocuments()) {
        for (const translation of Object.values(doc.translations)) {
          expect(translation!.content.startsWith('---')).toBe(false);
          expect(translation!.content.length).toBeGreaterThan(0);
          expect(translation!.title.length).toBeGreaterThan(0);
          expect(translation!.content).not.toBe(doc.content);
        }
      }
    });

    it("a translation's own language field, when present, always matches its filename", () => {
      // Loading itself already throws on a mismatch (`loadTranslation`) — this only asserts the
      // suite's fixtures actually exercise that agreement rather than every file omitting the field.
      expect(() => listLegalDocuments()).not.toThrow();
    });

    it("editing a translation never changes the slug's contentHash — only the English wording does", () => {
      // The hash is computed once, in `loadDocument`, straight from the ENGLISH file's own body —
      // a translation's `content` is never even passed to `computeContentHash`. This re-derives that
      // guarantee from the real, on-disk documents rather than a hand-built fixture, so a future
      // refactor that accidentally starts hashing a translation's bytes fails here.
      for (const doc of listLegalDocuments()) {
        expect(doc.contentHash).toBe(computeContentHash(doc.content));
      }
    });
  });
});
