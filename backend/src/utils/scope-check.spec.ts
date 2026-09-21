import {
  DOCUMENT_READ_SCOPES,
  DOCUMENT_WRITE_SCOPES,
  hasAnyDocumentScope,
  hasAnyScope,
  hasScope,
  scopeForDocumentType,
} from '@/utils/scope-check';

describe('hasScope', () => {
  it('always passes for session auth (scopes === null)', () => {
    expect(hasScope({ scopes: null }, 'quotes:write')).toBe(true);
    expect(hasScope({ scopes: null }, 'articles:read')).toBe(true);
  });

  it('passes when the API key has the requested scope', () => {
    expect(hasScope({ scopes: ['quotes:write', 'clients:write'] }, 'quotes:write')).toBe(true);
  });

  it('fails when the API key lacks the requested scope', () => {
    expect(hasScope({ scopes: ['clients:write'] }, 'quotes:write')).toBe(false);
  });

  it('fails for an API key with an empty scope set', () => {
    expect(hasScope({ scopes: [] }, 'quotes:write')).toBe(false);
  });
});

/**
 * `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES` are `API_KEY_SCOPES` MINUS the entity list, so a new
 * pair added to the registry and nowhere else joins them by default — and every scope in them grants
 * the coarse `hasAnyDocumentScope` fallback that guards the document routes spanning every type. The
 * time-tracking pair therefore had to be named in that exclusion list, and this is the check that
 * says it still is. Deleting either line from `ENTITY_SCOPES` turns a key minted to log an hour into
 * a key that can read the company's quotes, invoices and credit notes through those routes — with no
 * other test in the suite going red.
 */
describe('a time-tracking key satisfies no document-scope check', () => {
  const timeTrackingOnly = { scopes: ['time-tracking:read', 'time-tracking:write'] };

  // The five document types shipped today, spelled as the descriptors' own ids — the exact input
  // `scopeForDocumentType` pluralises. Named rather than derived, so that a new document type joining
  // the registry makes this list visibly incomplete instead of quietly re-deriving itself.
  const SHIPPED_DOCUMENT_TYPES = ['quote', 'invoice', 'credit-note', 'expense', 'received-invoice'];

  it('is absent from both derived document-scope sets', () => {
    expect(DOCUMENT_READ_SCOPES).not.toContain('time-tracking:read');
    expect(DOCUMENT_READ_SCOPES).not.toContain('time-tracking:write');
    expect(DOCUMENT_WRITE_SCOPES).not.toContain('time-tracking:write');
    expect(DOCUMENT_WRITE_SCOPES).not.toContain('time-tracking:read');
  });

  it('fails the coarse "holds ANY document scope" fallback in both modes', () => {
    expect(hasAnyDocumentScope(timeTrackingOnly, 'read')).toBe(false);
    expect(hasAnyDocumentScope(timeTrackingOnly, 'write')).toBe(false);
  });

  it('fails the per-type check for every shipped document type', () => {
    for (const typeId of SHIPPED_DOCUMENT_TYPES) {
      for (const mode of ['read', 'write'] as const) {
        const scope = scopeForDocumentType(typeId, mode);
        expect(scope).toBeDefined();
        expect(hasScope(timeTrackingOnly, scope!)).toBe(false);
      }
    }
  });

  // The reverse direction, which is the other half of minting a pair of its own: neither scope is
  // reachable from a document scope either, so a key trusted with invoices does not silently acquire
  // the right to rewrite the hours those invoices were built from.
  it('is not granted by any document scope', () => {
    for (const scope of [...DOCUMENT_READ_SCOPES, ...DOCUMENT_WRITE_SCOPES]) {
      expect(hasAnyScope({ scopes: [scope] }, ['time-tracking:read', 'time-tracking:write'])).toBe(false);
    }
  });

  // `?typeId=time-tracking` on a document route computes `time-trackings:read`, which is not a
  // declared scope — so the document routes fail closed on it rather than resolving anything.
  it('is not reachable by naming time-tracking as a document type', () => {
    expect(scopeForDocumentType('time-tracking', 'read')).toBeUndefined();
    expect(scopeForDocumentType('time-tracking', 'write')).toBeUndefined();
  });
});
