import { DocumentFieldDescriptor } from '../descriptors/types';
import {
  EntityReferenceOption,
  EntityReferenceProvider,
  EntityReferenceRegistry,
} from './reference-registry';
import { validateReferenceFields } from './validate-references';

const CLIENT_FIELD: DocumentFieldDescriptor = {
  key: 'client',
  kind: 'reference',
  label: 'Client',
  required: true,
  entity: 'client',
};

const ORIGIN_FIELD: DocumentFieldDescriptor = {
  key: 'origin',
  kind: 'reference',
  label: 'Origin document',
  required: false,
  entities: ['quote', 'invoice'],
};

const ARTICLE_ID_FIELD: DocumentFieldDescriptor = {
  key: 'articleId',
  kind: 'hiddenReference',
  label: 'Article',
  required: false,
  entity: 'article',
};

/** A fake provider whose `resolve` only ever succeeds for ids in `known` — a company-scoped provider
 *  would already have filtered these down to "this tenant's own records" before this function ever
 *  sees them; this fake stands in for that filtering. */
function fakeProvider(known: Set<string>): EntityReferenceProvider {
  return {
    async search(): Promise<EntityReferenceOption[]> {
      return [];
    },
    async resolve(_companyId, id): Promise<EntityReferenceOption | null> {
      return known.has(id) ? { id, label: id } : null;
    },
  };
}

function registryWith(entries: Record<string, Set<string>>): EntityReferenceRegistry {
  const registry = new EntityReferenceRegistry();
  for (const [entity, known] of Object.entries(entries)) {
    registry.register(entity, fakeProvider(known));
  }
  return registry;
}

describe('validateReferenceFields', () => {
  it('a brand-new document (no existingData) with an id that does not resolve for this company is refused', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1']) }),
      fields: [CLIENT_FIELD],
      data: { client: 'client-999' }, // another tenant's id, or simply invented
      existingData: undefined,
    });

    expect(errors).toEqual([
      {
        key: 'client',
        message: expect.stringContaining('does not exist, or does not belong to this company'),
      },
    ]);
  });

  it('a brand-new document with an id that DOES resolve is accepted', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1']) }),
      fields: [CLIENT_FIELD],
      data: { client: 'client-1' },
      existingData: undefined,
    });

    expect(errors).toEqual([]);
  });

  it('an EXISTING document whose already-persisted value never resolves stays grandfathered — never blocks an action that does not touch this field', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1']) }), // 'client-999' NOT known
      fields: [CLIENT_FIELD],
      data: { client: 'client-999' },
      existingData: { client: 'client-999' }, // identical to what is already on file — unchanged
    });

    expect(errors).toEqual([]);
  });

  it('an EXISTING document whose value is CHANGED to something that does not resolve IS refused', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1']) }),
      fields: [CLIENT_FIELD],
      data: { client: 'client-999' },
      existingData: { client: 'client-1' }, // was a real client; the edit swaps it for a bad one
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe('client');
  });

  it('an EXISTING document whose value is changed to a DIFFERENT valid id is accepted', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1', 'client-2']) }),
      fields: [CLIENT_FIELD],
      data: { client: 'client-2' },
      existingData: { client: 'client-1' },
    });

    expect(errors).toEqual([]);
  });

  it('MULTI-TARGET: a new document naming an entity/id pair that does not resolve is refused', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ quote: new Set(['q-1']), invoice: new Set(['inv-1']) }),
      fields: [ORIGIN_FIELD],
      data: { origin: { entity: 'quote', id: 'q-999' } },
      existingData: undefined,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].key).toBe('origin');
  });

  it('MULTI-TARGET: an unchanged bad {entity, id} pair on an existing document is grandfathered', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ quote: new Set(['q-1']), invoice: new Set(['inv-1']) }),
      fields: [ORIGIN_FIELD],
      data: { origin: { entity: 'quote', id: 'q-999' } },
      existingData: { origin: { entity: 'quote', id: 'q-999' } },
    });

    expect(errors).toEqual([]);
  });

  it('MULTI-TARGET: changing which ENTITY a reference names (same id) is a change, not a no-op', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ quote: new Set(), invoice: new Set(['x-1']) }),
      fields: [ORIGIN_FIELD],
      data: { origin: { entity: 'quote', id: 'x-1' } }, // 'x-1' is only known as an invoice, not a quote
      existingData: { origin: { entity: 'invoice', id: 'x-1' } },
    });

    expect(errors).toHaveLength(1);
  });

  it('an entity nobody registered is skipped, never turned into a validation error — a wiring gap is a different, boot-level concern', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: new EntityReferenceRegistry(), // nothing registered at all
      fields: [CLIENT_FIELD],
      data: { client: 'anything-at-all' },
      existingData: undefined,
    });

    expect(errors).toEqual([]);
  });

  it("'hiddenReference' fields are out of scope for this pass — never checked, changed or not", async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ article: new Set(['art-1']) }),
      fields: [ARTICLE_ID_FIELD],
      data: { articleId: 'not-a-real-article' },
      existingData: undefined,
    });

    expect(errors).toEqual([]);
  });

  it('a missing/empty value is skipped — required-ness is validate.ts’s own job, not this pass’s', async () => {
    const errors = await validateReferenceFields({
      companyId: 'company-1',
      referenceRegistry: registryWith({ client: new Set(['client-1']) }),
      fields: [CLIENT_FIELD],
      data: {},
      existingData: undefined,
    });

    expect(errors).toEqual([]);
  });
});
