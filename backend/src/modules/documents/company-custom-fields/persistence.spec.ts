/**
 * Real Prisma (the same "construct the plain persistence layer directly, real DB" convention
 * `payment-methods/persistence.spec.ts` and `clients.mass-assignment.spec.ts` already hold) — no
 * NestJS DI needed, these are plain functions.
 */
import prisma from '@/prisma/prisma.service';

import {
  applyCompanyCustomFieldsView,
  archiveCompanyCustomField,
  assertClientCustomFieldValuesValid,
  createCompanyCustomField,
  listCompanyCustomFields,
  resolveDocumentCustomFieldDescriptors,
  restoreCompanyCustomField,
  updateCompanyCustomField,
} from './persistence';
import { DocumentFieldDescriptor } from '../descriptors/types';
import { validateAgainstDescriptor } from '../descriptors/validate';
import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';

const fieldKindRegistry = new FieldKindRegistry();
registerCoreFieldKinds(fieldKindRegistry);

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

  it('applyCompanyCustomFieldsView appends active definitions as real fields — required + kind-shape then validate exactly like a native field', async () => {
    const scopeType = 'expense';
    await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: scopeType,
      label: 'Cost Center',
      kind: 'text',
      required: true,
    });

    const baseFields: DocumentFieldDescriptor[] = [
      { key: 'description', kind: 'text', label: 'Description', required: true },
    ];
    const fields = await applyCompanyCustomFieldsView(companyId, scopeType, baseFields);
    expect(fields.find((f) => f.key === 'custom:cost_center')).toMatchObject({ required: true });
    // The BASE fields are untouched, not replaced — an "add", never a substitution.
    expect(fields.find((f) => f.key === 'description')).toBeDefined();

    expect(validateAgainstDescriptor(fields, { description: 'x' }, fieldKindRegistry)).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'custom:cost_center' })]),
    );
    expect(
      validateAgainstDescriptor(
        fields,
        { description: 'x', 'custom:cost_center': 'CC-42' },
        fieldKindRegistry,
      ),
    ).toEqual([]);
    expect(
      validateAgainstDescriptor(fields, { description: 'x', 'custom:cost_center': 42 }, fieldKindRegistry),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'custom:cost_center' })]));
  });

  it('applyCompanyCustomFieldsView never offers an ARCHIVED definition — it must not become required again here', async () => {
    const definition = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: 'received-invoice',
      label: 'Archived And Required',
      kind: 'text',
      required: true,
    });
    await archiveCompanyCustomField(companyId, definition.id);

    const fields = await applyCompanyCustomFieldsView(companyId, 'received-invoice', []);
    expect(fields.find((f) => f.key === `custom:${definition.key}`)).toBeUndefined();
  });

  /**
   * The cross-scope collision `findAvailableKey` (persistence.ts) now guards against: a
   * `documentTypeId: null` ("every type") definition and a specific type's own definition are
   * COMPOSED TOGETHER the moment `applyCompanyCustomFieldsView` resolves that type's fields — see
   * that function's own header. Before this fix, two labels that slugify to the same key — one
   * created for "every type", the other for one specific type — could both be created (each check
   * only looked at its OWN exact `documentTypeId`), and `applyFieldOverlay` would then THROW the
   * moment anyone asked for that one type's fields (a duplicate `add`). Proven both directions.
   */
  it('a wildcard ("every type") field never collides with an existing specific-type field sharing a slug, or vice versa', async () => {
    const scopeType = 'quote';
    await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: scopeType,
      label: 'Shared Slug',
      kind: 'text',
    });
    const wildcard = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      label: 'Shared Slug',
      kind: 'text',
    });
    expect(wildcard.key).not.toBe('shared_slug');

    // The reverse order: a wildcard first, then a specific-type field with the same label.
    await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      label: 'Other Shared Slug',
      kind: 'text',
    });
    const specific = await createCompanyCustomField(companyId, {
      target: 'DOCUMENT',
      documentTypeId: scopeType,
      label: 'Other Shared Slug',
      kind: 'text',
    });
    expect(specific.key).not.toBe('other_shared_slug');

    // Both compositions resolve without ever throwing a duplicate-key FieldOverlayError.
    await expect(applyCompanyCustomFieldsView(companyId, scopeType, [])).resolves.toBeDefined();
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

  it('a company with no definitions at all costs nothing — applyCompanyCustomFieldsView is a true no-op, same fields reference', async () => {
    const other = await makeCompany('empty');
    const baseFields: DocumentFieldDescriptor[] = [{ key: 'x', kind: 'text', label: 'X' }];

    const fields = await applyCompanyCustomFieldsView(other.id, 'invoice', baseFields);
    expect(fields).toBe(baseFields); // short-circuits before ever cloning/composing anything.

    await expect(assertClientCustomFieldValuesValid(other.id, { anything: 'goes' })).resolves.toBeUndefined();
    await prisma.company.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
