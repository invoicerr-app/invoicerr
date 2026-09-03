import { ForbiddenException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerReceivedInvoiceActions } from './actions/received-invoice-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { buildReceivedInvoiceDescriptor } from './descriptors/received-invoice.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import * as persistence from './persistence';
import { EntityReferenceRegistry } from './references/reference-registry';
import * as supplierReconciliation from './received-invoices/supplier-reconciliation';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.credit-note.spec.ts's own header for why this module is mocked here: the
// real decision logic is proven against real Prisma in country-policy/country-policy.spec.ts. The
// default "allowed" is (re-)installed in beforeEach, since `afterEach(() => jest.resetAllMocks())`
// would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');
// TODO_PRODUIT.md T5(b) — mocked for the SAME reason as `./persistence` above: this file's own
// concern is DocumentsService's WIRING ("receive" calls `markClientAsSupplier` with the right args
// when a link is present, never otherwise"), not `markClientAsSupplier`'s own real Prisma behaviour
// (companyId scoping, idempotence — proven for real in
// `received-invoices/supplier-reconciliation.spec.ts`).
jest.mock('./received-invoices/supplier-reconciliation');

/**
 * Root TODO item 18 ("réception de factures") — the FIFTH document type written entirely as data.
 * Same wiring discipline as documents.service.credit-note.spec.ts (the THIRD): a real descriptor,
 * real core field kinds, real action registration, only persistence.ts and country-policy.ts mocked.
 */
function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildReceivedInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const actionRegistry = new ActionRegistry();
  registerReceivedInvoiceActions(actionRegistry);

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

function fakeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ri-1',
    typeId: 'received-invoice',
    status: 'received',
    data: { supplier: 'Acme Supplies', fileRef: 'abc123' },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('DocumentsService — "received-invoice", the FIFTH descriptor-only type', () => {
  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
  });
  afterEach(() => jest.resetAllMocks());

  it('is registered, with exactly the four declared actions', () => {
    const { service } = buildService();
    expect(service.listTypes()).toEqual(
      expect.arrayContaining([{ id: 'received-invoice', label: 'Received invoice' }]),
    );
    const descriptor = service.getType('received-invoice');
    expect(descriptor.actions.map((a) => a.id)).toEqual(['receive', 'approve', 'reject', 'delete']);
  });

  it('declares no numbering — a received invoice is never numbered by this company', () => {
    const descriptor = buildService().service.getType('received-invoice');
    expect(descriptor.numbering).toBeUndefined();
  });

  it('"receive" creates a brand-new record directly at "received" — no "draft" status exists for this type', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(fakeRecord());

    const { service } = buildService();
    const result = await service.runAction('company-1', 'received-invoice', 'receive', {
      data: {
        supplier: 'Acme Supplies',
        fileRef: 'abc123',
        fileName: 'invoice.pdf',
        fileMime: 'application/pdf',
      },
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ id: 'ri-1', status: 'received' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'received-invoice',
      undefined,
      'received',
      {
        supplier: 'Acme Supplies',
        fileRef: 'abc123',
        fileName: 'invoice.pdf',
        fileMime: 'application/pdf',
        // TODO_PRODUIT.md T5(a) — always written, even empty: see received-invoice-actions.ts's own
        // header on "receive" for why this is computed and stored on every save, not just when there
        // is something to warn about.
        lineTotalWarnings: [],
      },
    );
  });

  it('"receive" persists extra, undeclared keys (fileRef/fileName/fileMime) verbatim — they ride along in `data`', async () => {
    // These three keys are deliberately NOT declared `DocumentFieldDescriptor`s (see the descriptor's
    // own header) — this proves they are not silently stripped by field validation before reaching
    // the persisted record.
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(fakeRecord());
    const { service } = buildService();

    await service.runAction('company-1', 'received-invoice', 'receive', {
      data: { fileRef: 'deadbeef', fileName: 'scan.pdf', fileMime: 'application/pdf' },
    });

    const persistedData = (persistence.upsertDocument as jest.Mock).mock.calls[0][4];
    expect(persistedData).toEqual({
      fileRef: 'deadbeef',
      fileName: 'scan.pdf',
      fileMime: 'application/pdf',
      lineTotalWarnings: [],
    });
  });

  it('"receive" persists a non-empty `lineTotalWarnings` when the lines disagree with the stated totals — T5(a)', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(fakeRecord());
    const { service } = buildService();

    await service.runAction('company-1', 'received-invoice', 'receive', {
      data: {
        currency: 'EUR',
        netAmount: 500, // wrong on purpose: the one line below sums to 1000
        lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
      },
    });

    const persistedData = (persistence.upsertDocument as jest.Mock).mock.calls[0][4];
    expect(persistedData.lineTotalWarnings).toHaveLength(1);
    expect(persistedData.lineTotalWarnings[0]).toMatch(/Line total mismatch \(net \/ HT\)/);
  });

  it('"receive" persists an EMPTY `lineTotalWarnings` when the lines agree with the stated totals', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(fakeRecord());
    const { service } = buildService();

    await service.runAction('company-1', 'received-invoice', 'receive', {
      data: {
        currency: 'EUR',
        netAmount: 1000,
        vatAmount: 200,
        grossAmount: 1200,
        lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, vatRate: '20' }],
      },
    });

    const persistedData = (persistence.upsertDocument as jest.Mock).mock.calls[0][4];
    expect(persistedData.lineTotalWarnings).toEqual([]);
  });

  it('"receive" is also available to re-edit an EXISTING "received" record', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord());
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(
      fakeRecord({ data: { supplier: 'Acme Supplies Ltd' } }),
    );

    const { service } = buildService();
    const result = await service.runAction('company-1', 'received-invoice', 'receive', {
      documentId: 'ri-1',
      data: { supplier: 'Acme Supplies Ltd' },
    });

    expect(result.document).toMatchObject({ status: 'received' });
  });

  // TODO_PRODUIT.md T5(b) — "le rôle posé au moment du lien": both the auto-match (upload time) and a
  // manual pick converge on THIS one handler, so both are proven by the same two tests.
  it('"receive" marks the linked client as a supplier when `data.supplierClient` is set', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(
      fakeRecord({ data: { supplierClient: 'client-9' } }),
    );
    const { service } = buildService();

    await service.runAction('company-1', 'received-invoice', 'receive', {
      data: { supplier: 'Acme Supplies', supplierClient: 'client-9' },
    });

    expect(supplierReconciliation.markClientAsSupplier).toHaveBeenCalledTimes(1);
    expect(supplierReconciliation.markClientAsSupplier).toHaveBeenCalledWith('company-1', 'client-9');
  });

  it('"receive" never touches any client when no supplier is linked', async () => {
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(fakeRecord());
    const { service } = buildService();

    await service.runAction('company-1', 'received-invoice', 'receive', {
      data: { supplier: 'Acme Supplies' },
    });

    expect(supplierReconciliation.markClientAsSupplier).not.toHaveBeenCalled();
  });

  it('"approve": received -> approved', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(fakeRecord({ status: 'approved' }));

    const { service } = buildService();
    const result = await service.runAction('company-1', 'received-invoice', 'approve', {
      documentId: 'ri-1',
      data: {},
    });

    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ status: 'approved' });
    expect(persistence.updateDocumentStatus).toHaveBeenCalledWith(
      'company-1',
      'received-invoice',
      'ri-1',
      'approved',
    );
  });

  it('"reject": received -> rejected', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(fakeRecord({ status: 'rejected' }));

    const { service } = buildService();
    const result = await service.runAction('company-1', 'received-invoice', 'reject', {
      documentId: 'ri-1',
      data: {},
    });

    expect(result.document).toMatchObject({ status: 'rejected' });
  });

  it('"approve" is refused (409) once a record has already been approved — a review decision is one-way', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'approved' }));

    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'approve', {
        documentId: 'ri-1',
        data: {},
      }),
    ).rejects.toThrow(/not available for a document with status "approved"/);
    expect(persistence.updateDocumentStatus).not.toHaveBeenCalled();
  });

  it('"approve" is refused (409) before the record has ever been saved', async () => {
    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'approve', { data: {} }),
    ).rejects.toThrow(/not available before the document has been saved/);
  });

  it('"delete" is offered only while "received" — refused (409) once approved or rejected', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'approved' }));

    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'delete', {
        documentId: 'ri-1',
        data: {},
      }),
    ).rejects.toThrow(/not available for a document with status "approved"/);
    expect(persistence.deleteDocument).not.toHaveBeenCalled();
  });

  it('"delete" succeeds while still "received"', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    (persistence.deleteDocument as jest.Mock).mockResolvedValue(fakeRecord());

    const result = await buildService().service.runAction('company-1', 'received-invoice', 'delete', {
      documentId: 'ri-1',
      data: {},
    });

    expect(result.changed).toBe(true);
    expect(persistence.deleteDocument).toHaveBeenCalledWith('company-1', 'received-invoice', 'ri-1');
  });

  // The obligatory country-policy wiring proof this task asks for: a country with no rule for this
  // ACTION refuses with a NAMED 403 — this only proves DocumentsService's own wiring (it calls
  // evaluateCountryPolicy and turns a refusal into ForbiddenException with the exact reason); the
  // REAL, unmocked mechanism ("a country the policy catalog has no file for blocks everything, and
  // says so by name") is proven against a real Prisma mock in country-policy.spec.ts's own
  // "received-invoice" case, added alongside its existing "invoice" one.
  it('a country policy refusal becomes a NAMED 403, for "received-invoice" like any other type', async () => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({
      allowed: false,
      reason: 'No document action policy is declared for "DE".',
    });

    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'approve', {
        documentId: 'ri-1',
        data: {},
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'approve', {
        documentId: 'ri-1',
        data: {},
      }),
    ).rejects.toThrow(/No document action policy is declared for "DE"/);
  });
});
