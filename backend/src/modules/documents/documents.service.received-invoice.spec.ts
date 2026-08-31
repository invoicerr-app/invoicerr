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
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.credit-note.spec.ts's own header for why this module is mocked here: the
// real decision logic is proven against real Prisma in country-policy/country-policy.spec.ts. The
// default "allowed" is (re-)installed in beforeEach, since `afterEach(() => jest.resetAllMocks())`
// would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');

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
      { supplier: 'Acme Supplies', fileRef: 'abc123', fileName: 'invoice.pdf', fileMime: 'application/pdf' },
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
    expect(persistedData).toEqual({ fileRef: 'deadbeef', fileName: 'scan.pdf', fileMime: 'application/pdf' });
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
