import { API_KEY_SCOPES } from '@/modules/api-keys/scopes';
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
 * `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES` are a POSITIVE allow-list of document-type
 * resources, so a new pair added to the registry and classified nowhere joins them only if someone
 * deliberately names it — and every scope in the two arrays grants the coarse `hasAnyDocumentScope`
 * fallback that guards the document routes spanning every type. The time-tracking pair is safe by
 * simply never being named, and this is the check that says it still isn't. Adding
 * `'time-tracking'` to the resource list in `scope-check.ts` would turn a key minted to log an hour
 * into a key that can read the company's quotes, invoices and credit notes through those routes —
 * with no other test in the suite going red.
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

/**
 * The defect this positive allow-list replaces, restated as a test rather than left to the reader's
 * trust: before the inversion, `company`/`api-keys`/`webhooks`/`billing` had scope pairs in
 * `API_KEY_SCOPES` but no entry in the exclusion list the old derivation subtracted, so each of their
 * `:read` scopes alone satisfied `hasAnyDocumentScope(request, 'read')` — a key minted with nothing
 * but `billing:read` could read the company's quotes, invoices and every other document through the
 * 'every-type' fallback routes (`GET /documents/dashboard` and its siblings), and an `api-keys:write`
 * key satisfied the write side. `billing` stands in for all four here; the completeness check below
 * covers the rest by construction rather than one assertion per resource.
 */
describe('a billing-only key satisfies no document-scope check (the bug this file fixes)', () => {
  it('fails the coarse "holds ANY document scope" fallback in both modes', () => {
    expect(hasAnyDocumentScope({ scopes: ['billing:read'] }, 'read')).toBe(false);
    expect(hasAnyDocumentScope({ scopes: ['billing:write'] }, 'write')).toBe(false);
  });
});

/**
 * The guard against the NEXT scope nobody classifies: `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES`
 * are a positive list, so a brand-new resource added to `API_KEY_SCOPES` is excluded from document
 * access automatically — safe by default, but silently so. Nothing forces a human to decide whether
 * that new resource actually IS a document type (in which case it belongs in
 * `DOCUMENT_TYPE_RESOURCES`) or genuinely isn't (in which case it belongs in the negative list below,
 * maintained here purely so this test can tell the two cases apart). `NON_DOCUMENT_RESOURCES` is
 * deliberately NOT exported for production code to consume — `scope-check.ts` itself only ever needs
 * the positive list — it exists solely so an unclassified resource fails this test loudly instead of
 * passing the production code silently.
 */
describe('every resource in API_KEY_SCOPES is classified as document or non-document', () => {
  // Every resource this app has ever granted an API-key scope for that is NOT one of the five
  // document types — kept here, not in `scope-check.ts`, because production code only ever needs the
  // positive `DOCUMENT_TYPE_RESOURCES` list; this negative list's only job is completeness-checking.
  const NON_DOCUMENT_RESOURCES = [
    'clients',
    'articles',
    'time-tracking',
    'company',
    'api-keys',
    'webhooks',
    'billing',
  ];

  const documentResources = new Set(DOCUMENT_READ_SCOPES.map((scope) => scope.replace(/:read$/, '')));

  it('names every resource exactly once, as document XOR non-document — never neither, never both', () => {
    const resources = new Set(API_KEY_SCOPES.map((scope) => scope.slice(0, scope.lastIndexOf(':'))));
    const unclassified: string[] = [];
    const doubleClassified: string[] = [];
    for (const resource of resources) {
      const isDocument = documentResources.has(resource);
      const isNonDocument = NON_DOCUMENT_RESOURCES.includes(resource);
      if (!isDocument && !isNonDocument) unclassified.push(resource);
      if (isDocument && isNonDocument) doubleClassified.push(resource);
    }
    // A resource landing in neither list is exactly the failure mode this file fixes: a scope added
    // to `API_KEY_SCOPES` and classified nowhere used to join the document sets silently; now it is
    // excluded silently instead — collecting the offenders (rather than asserting per-resource) is
    // what turns "silently" into one red test naming every scope nobody classified.
    expect(unclassified).toEqual([]);
    expect(doubleClassified).toEqual([]);
  });
});
