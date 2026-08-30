import { NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerCreditNoteActions } from './actions/credit-note-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import { ROW_ID_KEY } from './row-selection/row-selection';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.spec.ts's own comment on this mock — the real decision code is proven
// elsewhere (country-policy/country-policy.spec.ts, documents.service.country-policy.spec.ts). The
// default "allowed" is (re-)installed in `beforeEach` below, not just here, since
// `afterEach(() => jest.resetAllMocks())` would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');

/**
 * The THIRD document type written entirely as a descriptor (credit-note.descriptor.ts) — this is
 * where the "a document type is a descriptor" claim gets its strongest test, because unlike the
 * invoice (which mostly restates the quote's fields), the credit note is a genuinely different shape
 * (it references an INVOICE, not a client-plus-lines-from-scratch document with no upstream link).
 * Same wiring discipline as the other two: real descriptor, real core field kinds, real action
 * registration, only persistence.ts mocked.
 *
 * The `invoice` type is ALSO registered here (unlike the other two files, which each register only
 * their own type) — the credit note's `correctedLines` (kind: 'rowSelection') declares
 * `sourceEntity: 'invoice'`, and resolving it needs that type's own descriptor to exist in the
 * registry, exactly the way it would in the real DocumentsModule wiring.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildCreditNoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());

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
    new ContributionRegistry(),
  );
  return { service };
}

/** A minimal, already-saved invoice a credit note can correct — its "lines" carry the stable
 *  ROW_ID_KEY a real invoice would only have once it has been saved through runAction at least once
 *  since this kind shipped (row-selection.ts's stampRowIds). Built by hand here since persistence is
 *  mocked, not derived from a real save — the stamping mechanism itself is row-selection.spec.ts's job. */
function invoiceDocument(id: string, lineRowIds: string[]) {
  return {
    id,
    typeId: 'invoice',
    status: 'draft',
    data: {
      client: 'client-1',
      issueDate: '2026-01-15',
      dueDate: '2026-02-15',
      currency: 'EUR',
      lines: lineRowIds.map((rowId) => ({
        [ROW_ID_KEY]: rowId,
        description: 'Widget',
        quantity: 1,
        unitPrice: 9.9,
      })),
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const validCreditNoteData = {
  invoice: 'invoice-doc-1',
  issueDate: '2026-02-01',
  currency: 'EUR',
  correctedLines: ['line-1'],
};

describe('DocumentsService — the credit note type, the THIRD descriptor-only type', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  it('is registered', () => {
    expect(buildService().service.listTypes()).toEqual(
      expect.arrayContaining([{ id: 'credit-note', label: 'Credit note' }]),
    );
  });

  it('declares exactly one action: "save-draft" — "au minimum enregistrer le brouillon", nothing more', () => {
    const descriptor = buildService().service.getType('credit-note');
    expect(descriptor.actions.map((a) => a.id)).toEqual(['save-draft']);
  });

  it('declares "correctedLines" as a rowSelection sourced from the invoice\'s own "lines"', () => {
    const descriptor = buildService().service.getType('credit-note');
    const field = descriptor.fields.find((f) => f.key === 'correctedLines');
    expect(field).toMatchObject({
      kind: 'rowSelection',
      sourceField: 'invoice',
      sourceEntity: 'invoice',
      sourceArrayField: 'lines',
    });
  });

  it('a complete credit note, correcting a line that genuinely exists on the invoice, is persisted', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-doc-1', ['line-1']),
    );
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
    expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', 'invoice', 'invoice-doc-1');
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'credit-note',
      undefined,
      'draft',
      // correctedLines isn't an 'array' field itself, so nothing here gets a $rowId stamped onto
      // it — stamping only ever touches 'array' rows (the INVOICE's own lines), never this field.
      validCreditNoteData,
    );
  });

  it('requires the invoice it corrects — an empty credit note is rejected before ever touching persistence', async () => {
    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: {} }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.findOwnedDocument).not.toHaveBeenCalled();
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('rejects the multi-target OBJECT shape — "invoice" never declared more than one possible target', async () => {
    const dataWithObjectRef = { ...validCreditNoteData, invoice: { entity: 'invoice', id: 'invoice-doc-1' } };

    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: dataWithObjectRef }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  // THE case this task singled out: a corrected line that has since disappeared from the invoice it
  // targets. This must block through the REAL, wired path (runAction), not merely in the pure
  // validator's own unit tests (resolve-row-selection.spec.ts) — a regression that wired the
  // mechanism but never actually called it from runAction would pass every test in that file while
  // failing this one.
  it('blocks saving a credit note whose corrected line no longer exists on the invoice — never a silent save', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      invoiceDocument('invoice-doc-1', ['line-1']),
    );

    const dataWithGhostLine = { ...validCreditNoteData, correctedLines: ['a-line-that-was-removed'] };

    await expect(
      buildService().service.runAction('company-1', 'credit-note', 'save-draft', { data: dataWithGhostLine }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('blocks, naming the invoice, when the invoice it references no longer exists at all', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockRejectedValue(new NotFoundException('gone'));

    let caught: unknown;
    try {
      await buildService().service.runAction('company-1', 'credit-note', 'save-draft', {
        data: validCreditNoteData,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    const response = (
      caught as { getResponse: () => { errors: { key: string; message: string }[] } }
    ).getResponse();
    expect(response.errors).toContainEqual(
      expect.objectContaining({ key: 'correctedLines', message: expect.stringMatching(/no longer exists/) }),
    );
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});
