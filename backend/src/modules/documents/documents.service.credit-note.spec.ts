import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerCreditNoteActions } from './actions/credit-note-actions';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');

/**
 * The THIRD document type written entirely as a descriptor (credit-note.descriptor.ts) — this is
 * where the "a document type is a descriptor" claim gets its strongest test, because unlike the
 * invoice (which mostly restates the quote's fields), the credit note is a genuinely different shape
 * (it references an INVOICE, not a client-plus-lines-from-scratch document with no upstream link).
 * Same wiring discipline as the other two: real descriptor, real core field kinds, real action
 * registration, only persistence.ts mocked.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildCreditNoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const actionRegistry = new ActionRegistry();
  registerCreditNoteActions(actionRegistry);

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
  );
  return { service };
}

const validCreditNoteData = {
  invoice: 'invoice-doc-1',
  issueDate: '2026-02-01',
  currency: 'EUR',
  lines: [{ description: 'Refund — Widget', quantity: 1, unitPrice: 9.9 }],
};

describe('DocumentsService — the credit note type, the THIRD descriptor-only type', () => {
  afterEach(() => jest.resetAllMocks());

  it('is registered', () => {
    expect(buildService().service.listTypes()).toEqual([{ id: 'credit-note', label: 'Credit note' }]);
  });

  it('declares exactly one action: "save-draft" — "au minimum enregistrer le brouillon", nothing more', () => {
    const descriptor = buildService().service.getType('credit-note');
    expect(descriptor.actions.map((a) => a.id)).toEqual(['save-draft']);
  });

  it('a complete credit note is accepted and persisted through the shared persistence layer', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'draft',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'credit-note', 'save-draft', {
      data: validCreditNoteData,
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'cn-1', status: 'draft' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      undefined,
      'draft',
      validCreditNoteData,
    );
  });

  it('requires the invoice it corrects — an empty credit note is rejected before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('the "invoice" field is a plain SINGLE-target reference (a bare id) — not the multi-target shape', async () => {
    // A bare string id is accepted (single-target 'reference', like "client" on the quote/invoice) —
    // proving this field was NOT given `entities`, unlike the invoice's own "origin".
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'draft',
      data: validCreditNoteData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { service } = buildService();
    const result = await service.runAction('company-1', 'credit-note', 'save-draft', {
      data: validCreditNoteData,
    });

    expect(result.changed).toBe(true);
    expect(typeof validCreditNoteData.invoice).toBe('string');
  });

  it('rejects the multi-target OBJECT shape — this field never declared more than one possible target', async () => {
    const dataWithObjectRef = { ...validCreditNoteData, invoice: { entity: 'invoice', id: 'invoice-doc-1' } };

    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: dataWithObjectRef }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});
