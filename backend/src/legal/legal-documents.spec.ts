import {
  REQUIRED_ACCEPTANCE_SLUGS,
  currentVersionOf,
  getLegalDocument,
  listLegalDocuments,
} from './legal-documents';

describe('legal-documents', () => {
  it('loads all five documents from ./data, sorted by sidebar_position', () => {
    const docs = listLegalDocuments();
    expect(docs.map((d) => d.slug)).toEqual([
      'terms-of-service',
      'privacy-policy',
      'data-processing-agreement',
      'legal-notice',
      'cookies-and-acceptable-use',
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
});
