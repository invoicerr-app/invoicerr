/**
 * Real Prisma (the same "construct the plain persistence layer directly, real DB" convention
 * `payment-methods/persistence.spec.ts` and `clients.mass-assignment.spec.ts` already hold) — no
 * NestJS DI needed, these are plain functions.
 */
import prisma from '@/prisma/prisma.service';

import {
  archiveCompanyCustomField,
  assertClientCustomFieldValuesValid,
  assertDocumentCustomFieldValuesValid,
  createCompanyCustomField,
  listCompanyCustomFields,
  resolveDocumentCustomFieldDescriptors,
  restoreCompanyCustomField,
  updateCompanyCustomField,
} from './persistence';

async function makeCompany(suffix: string) {
  return prisma.company.create({
    data: {
      name: `Custom Fields Co ${suffix}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `custom-fields-${suffix}-${Date.now()}@example.com`,
    },
  });
}

describe('company-custom-fields/persistence', () => {
  let companyId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    const company = await makeCompany('a');
    companyId = company.id;
    const other = await makeCompany('b');
    otherCompanyId = other.id;
  });

  afterAll(async () => {
    await prisma.companyCustomField.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  it('creates a DOCUMENT-target definition, slugifying the key from the label', async () => {
    const created = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'invoice',
      label: 'Internal Ref!',
      kind: 'text',
    });
    expect(created.key).toBe('internal_ref');
    expect(created.target).toBe('DOCUMENT');
    expect(created.documentTypeId).toBe('invoice');
    expect(created.archivedAt).toBeNull();
  });

  it('de-duplicates a colliding key within the same (company, target, documentTypeId) scope', async () => {
    const first = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'quote',
      label: 'Priority',
      kind: 'text',
    });
    const second = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'quote',
      label: 'Priority',
      kind: 'text',
    });
    expect(first.key).toBe('priority');
    expect(second.key).toBe('priority_2');
  });

  it('rejects a kind outside the allowed subset', async () => {
    await expect(
      createCompanyCustomField(companyId, { target: 'DOCUMENT', label: 'Bad', kind: 'array' }),
    ).rejects.toThrow(/allowed custom field kind/);
  });

  it('requires at least one option for a "select" field, and rejects duplicate option values', async () => {
    await expect(
      createCompanyCustomField(companyId, { target: 'DOCUMENT', label: 'Priority Level', kind: 'select' }),
    ).rejects.toThrow(/at least one option/);

    await expect(
      createCompanyCustomField(companyId, {
        target: 'DOCUMENT',
        label: 'Priority Level 2',
        kind: 'select',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'low', label: 'Also low' },
        ],
      }),
    ).rejects.toThrow(/Duplicate option/);
  });

  it('lets label/options/required/order be edited, but never key/kind/target', async () => {
    const created = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'invoice',
      label: 'Editable',
      kind: 'text',
      required: false,
      order: 1,
    });

    const updated = await updateCompanyCustomField(companyId, created.id, {
      label: 'Renamed Field',
      required: true,
      order: 5,
    });

    expect(updated.label).toBe('Renamed Field');
    expect(updated.required).toBe(true);
    expect(updated.order).toBe(5);
    // The storage key never moves — a rename never strands already-persisted values.
    expect(updated.key).toBe(created.key);
    expect(updated.kind).toBe('text');
  });

  it('scopes every read/write by company — another company can neither see nor mutate it', async () => {
    const mine = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'invoice',
      label: 'Tenant Scoped',
      kind: 'text',
    });

    const listedByOther = await listCompanyCustomFields(otherCompanyId, { includeArchived: true });
    expect(listedByOther.find((f) => f.id === mine.id)).toBeUndefined();

    await expect(updateCompanyCustomField(otherCompanyId, mine.id, { label: 'Hijacked' })).rejects.toThrow(
      /No custom field definition/,
    );
    await expect(archiveCompanyCustomField(otherCompanyId, mine.id)).rejects.toThrow(
      /No custom field definition/,
    );
  });

  it('archiving hides a field from the ACTIVE resolution but keeps it resolving with includeArchived', async () => {
    const definition = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'credit-note',
      label: 'Soon Archived',
      kind: 'text',
    });

    const beforeArchive = await resolveDocumentCustomFieldDescriptors(companyId, 'credit-note');
    expect(beforeArchive.some((f) => f.key === `custom:${definition.key}`)).toBe(true);

    await archiveCompanyCustomField(companyId, definition.id);

    const activeOnly = await resolveDocumentCustomFieldDescriptors(companyId, 'credit-note');
    expect(activeOnly.some((f) => f.key === `custom:${definition.key}`)).toBe(false);

    const includingArchived = await resolveDocumentCustomFieldDescriptors(companyId, 'credit-note', {
      includeArchived: true,
    });
    expect(includingArchived.some((f) => f.key === `custom:${definition.key}`)).toBe(true);

    const restored = await restoreCompanyCustomField(companyId, definition.id);
    expect(restored.archivedAt).toBeNull();
    const activeAgain = await resolveDocumentCustomFieldDescriptors(companyId, 'credit-note');
    expect(activeAgain.some((f) => f.key === `custom:${definition.key}`)).toBe(true);
  });

  it('a DOCUMENT-target definition with `documentTypeId: null` applies to every document type', async () => {
    const wildcard = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      label: 'Applies Everywhere',
      kind: 'text',
    });

    const invoiceFields = await resolveDocumentCustomFieldDescriptors(companyId, 'invoice');
    const expenseFields = await resolveDocumentCustomFieldDescriptors(companyId, 'expense');
    expect(invoiceFields.some((f) => f.key === `custom:${wildcard.key}`)).toBe(true);
    expect(expenseFields.some((f) => f.key === `custom:${wildcard.key}`)).toBe(true);
  });

  it("validates a document's data against active definitions — required + kind-shape", async () => {
    const scopeType = 'expense';
    await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: scopeType,
      label: 'Cost Center',
      kind: 'text',
      required: true,
    });

    await expect(assertDocumentCustomFieldValuesValid(companyId, scopeType, {})).rejects.toThrow(
      /Invalid custom field data/,
    );

    await expect(
      assertDocumentCustomFieldValuesValid(companyId, scopeType, { 'custom:cost_center': 'CC-42' }),
    ).resolves.toBeUndefined();

    await expect(
      assertDocumentCustomFieldValuesValid(companyId, scopeType, { 'custom:cost_center': 42 }),
    ).rejects.toThrow(/Invalid custom field data/);
  });

  it("validates a CLIENT's customFields the same way, unprefixed", async () => {
    await createCompanyCustomField(companyId, {
      target: 'CLIENT',
      label: 'Loyalty Tier',
      kind: 'select',
      options: [
        { value: 'gold', label: 'Gold' },
        { value: 'silver', label: 'Silver' },
      ],
      required: true,
    });

    await expect(assertClientCustomFieldValuesValid(companyId, {})).rejects.toThrow(
      /Invalid custom field data/,
    );
    await expect(
      assertClientCustomFieldValuesValid(companyId, { loyalty_tier: 'gold' }),
    ).resolves.toBeUndefined();
    await expect(assertClientCustomFieldValuesValid(companyId, { loyalty_tier: 'platinum' })).rejects.toThrow(
      /Invalid custom field data/,
    );
  });

  it('a company with no definitions at all costs nothing — instant no-op validation', async () => {
    const other = await makeCompany('empty');
    await expect(
      assertDocumentCustomFieldValuesValid(other.id, 'invoice', { anything: 'goes' }),
    ).resolves.toBeUndefined();
    await expect(assertClientCustomFieldValuesValid(other.id, { anything: 'goes' })).resolves.toBeUndefined();
    await prisma.company.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
