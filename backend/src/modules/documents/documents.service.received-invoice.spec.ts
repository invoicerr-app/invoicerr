import { ConflictException, ForbiddenException } from '@nestjs/common';

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
import * as settlementPayments from './settlement/payments';
import { PdpReceptionStatusPusher } from './transports/pdp/pdp-reception';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// See documents.service.credit-note.spec.ts's own header for why this module is mocked here: the
// real decision logic is proven against real Prisma in country-policy/country-policy.spec.ts. The
// default "allowed" is (re-)installed in beforeEach, since `afterEach(() => jest.resetAllMocks())`
// would otherwise wipe it after the first test.
jest.mock('./country-policy/country-policy');
// Mocked for the SAME reason as `./persistence` above: this file's own
// concern is DocumentsService's WIRING ("receive" calls `markClientAsSupplier` with the right args
// when a link is present, never otherwise"), not `markClientAsSupplier`'s own real Prisma behaviour
// (companyId scoping, idempotence — proven for real in
// `received-invoices/supplier-reconciliation.spec.ts`).
jest.mock('./received-invoices/supplier-reconciliation');
// "record-payment" writes through settlement/payments.ts, which reaches Prisma directly — mocked for
// the identical reason `documents.service.invoice.spec.ts` already mocks it for the invoice's own
// "record-payment": this file's concern is the ACTION's wiring, not `DocumentPayment` persistence
// itself (proven for real elsewhere).
jest.mock('./settlement/payments');

/**
 * Received-invoice reception — the FIFTH document type written entirely as data.
 * Same wiring discipline as documents.service.credit-note.spec.ts (the THIRD): a real descriptor,
 * real core field kinds, real action registration, only persistence.ts and country-policy.ts mocked.
 */
/** A bare stub, never a real `ChannelCredentialsService`/`PdpClient` — the same "depend on the
 *  narrow interface" discipline `transports/pdp/pdp-reception.ts`'s own header documents; tests that
 *  care which method fired pass their own `jest.fn()`-backed stub instead. */
const NOOP_PDP_STATUS_PUSHER: PdpReceptionStatusPusher = {
  pushTakenInCharge: async () => {},
  pushApproved: async () => {},
  pushRejected: async () => {},
  pushPaid: async () => {},
};

function buildService(pdpStatusPusher: PdpReceptionStatusPusher = NOOP_PDP_STATUS_PUSHER) {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildReceivedInvoiceDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const actionRegistry = new ActionRegistry();
  registerReceivedInvoiceActions(actionRegistry, undefined, pdpStatusPusher);

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

  it('is registered, with exactly the five declared actions', () => {
    const { service } = buildService();
    expect(service.listTypes()).toEqual(
      expect.arrayContaining([{ id: 'received-invoice', label: 'Received invoice' }]),
    );
    const descriptor = service.getType('received-invoice');
    expect(descriptor.actions.map((a) => a.id)).toEqual([
      'receive',
      'approve',
      'reject',
      'record-payment',
      'delete',
    ]);
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
        // Always written, even empty: see received-invoice-actions.ts's own
        // header on "receive" for why this is computed and stored on every save, not just when there
        // is something to warn about.
        lineTotalWarnings: [],
      },
      ['received'],
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

  it('"receive" persists a non-empty `lineTotalWarnings` when the lines disagree with the stated totals', async () => {
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

  it('a "receive" edit racing a concurrent "approve" on the same record: the loser 409s instead of resetting the record back to "received"', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    let calls = 0;
    (persistence.upsertDocument as jest.Mock).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return fakeRecord({ data: { supplier: 'Acme Supplies Ltd' } });
      throw new ConflictException('Document "ri-1" is no longer in one of the expected statuses.');
    });
    const { service } = buildService();

    const call = () =>
      service.runAction('company-1', 'received-invoice', 'receive', {
        documentId: 'ri-1',
        data: { supplier: 'Acme Supplies Ltd' },
      });
    const results = await Promise.allSettled([call(), call()]);

    // Which of the two literally wins is a scheduling detail (both start from the identical "received"
    // snapshot) — what matters is that EXACTLY one does, never both and never neither.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
  });

  // "The role set at link time": both the auto-match (upload time) and a
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
      null,
      undefined,
      undefined,
      ['received'],
    );
  });

  it('"approve" pushes the PDP "approved" buyer status when this record carries a `pdpInboundId`', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(
      fakeRecord({ status: 'approved', data: { pdpInboundId: '604667' } }),
    );
    const pusher: PdpReceptionStatusPusher = {
      pushTakenInCharge: jest.fn(),
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    };

    await buildService(pusher).service.runAction('company-1', 'received-invoice', 'approve', {
      documentId: 'ri-1',
      data: {},
    });

    expect(pusher.pushApproved).toHaveBeenCalledWith('company-1', '604667');
  });

  it('"approve" pushes NOTHING to PDP for a manually-uploaded record (no `pdpInboundId`)', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    (persistence.updateDocumentStatus as jest.Mock).mockResolvedValue(fakeRecord({ status: 'approved' }));
    const pusher: PdpReceptionStatusPusher = {
      pushTakenInCharge: jest.fn(),
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    };

    await buildService(pusher).service.runAction('company-1', 'received-invoice', 'approve', {
      documentId: 'ri-1',
      data: {},
    });

    expect(pusher.pushApproved).not.toHaveBeenCalled();
  });

  it('two concurrent "approve" calls on the same record: the loser 409s and never pushes a second PDP status', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));
    let calls = 0;
    (persistence.updateDocumentStatus as jest.Mock).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) return fakeRecord({ status: 'approved', data: { pdpInboundId: '604667' } });
      throw new ConflictException('Document "ri-1" is no longer in one of the expected statuses.');
    });
    const pusher: PdpReceptionStatusPusher = {
      pushTakenInCharge: jest.fn(),
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    };
    const { service } = buildService(pusher);

    const call = () =>
      service.runAction('company-1', 'received-invoice', 'approve', { documentId: 'ri-1', data: {} });
    const results = await Promise.allSettled([call(), call()]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    // The exact bug this closes: without the CAS, both calls would have committed, each pushing its
    // OWN "approved" status to PDP for the same deposit.
    expect(pusher.pushApproved).toHaveBeenCalledTimes(1);
  });

  it('"reject": received -> rejected, requires and persists a `reason`, pushes PDP\'s "rejected" status', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      fakeRecord({ status: 'received', data: { pdpInboundId: '604667' } }),
    );
    (persistence.upsertDocument as jest.Mock).mockResolvedValue(
      fakeRecord({
        status: 'rejected',
        data: { pdpInboundId: '604667', rejectionReason: 'Wrong purchase order' },
      }),
    );
    const pusher: PdpReceptionStatusPusher = {
      pushTakenInCharge: jest.fn(),
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    };

    const result = await buildService(pusher).service.runAction('company-1', 'received-invoice', 'reject', {
      documentId: 'ri-1',
      data: {},
      params: { reason: 'Wrong purchase order' },
    });

    expect(result.document).toMatchObject({ status: 'rejected' });
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'received-invoice',
      'ri-1',
      'rejected',
      expect.objectContaining({ pdpInboundId: '604667', rejectionReason: 'Wrong purchase order' }),
      ['received'],
    );
    expect(pusher.pushRejected).toHaveBeenCalledWith('company-1', '604667', 'Wrong purchase order');
  });

  it('two concurrent "reject" calls on the same record: the loser 409s instead of silently discarding the winner\'s rejectionReason', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(
      fakeRecord({ status: 'received', data: { pdpInboundId: '604667' } }),
    );
    let calls = 0;
    (persistence.upsertDocument as jest.Mock).mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return fakeRecord({
          status: 'rejected',
          data: { pdpInboundId: '604667', rejectionReason: 'Duplicate' },
        });
      }
      throw new ConflictException('Document "ri-1" is no longer in one of the expected statuses.');
    });
    const pusher: PdpReceptionStatusPusher = {
      pushTakenInCharge: jest.fn(),
      pushApproved: jest.fn(),
      pushRejected: jest.fn(),
      pushPaid: jest.fn(),
    };
    const { service } = buildService(pusher);

    const call = (reason: string) =>
      service.runAction('company-1', 'received-invoice', 'reject', {
        documentId: 'ri-1',
        data: {},
        params: { reason },
      });
    const results = await Promise.allSettled([call('Duplicate'), call('Wrong amount')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    // The exact bug this closes: without the CAS, the second call's `mergedData` (computed from the
    // SAME stale `existing` read) would have silently overwritten the first — a real decision replaced
    // by a stale one, not merely a duplicate.
    expect(pusher.pushRejected).toHaveBeenCalledTimes(1);
  });

  it('"reject" is refused (400) without a reason — the DGFiP buyer-refusal status is "obligatoirement motivé"', async () => {
    (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));

    await expect(
      buildService().service.runAction('company-1', 'received-invoice', 'reject', {
        documentId: 'ri-1',
        data: {},
        params: {},
      }),
    ).rejects.toThrow(/Invalid document data/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  describe('"record-payment" — this company paying a SUPPLIER, mirroring invoice-actions.ts\'s own', () => {
    const approvedRecord = fakeRecord({
      status: 'approved',
      data: { currency: 'EUR', grossAmount: 120, pdpInboundId: '604667' },
    });

    beforeEach(() => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(approvedRecord);
      (settlementPayments.recordPayment as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        documentId: 'ri-1',
        amountMinor: 12000,
        currency: 'EUR',
        documentAmountMinor: 12000,
        conversionRate: null,
        conversionRateAsOf: null,
        conversionSource: null,
        method: null,
        paidAt: new Date('2026-09-16'),
        note: null,
        createdAt: new Date('2026-09-16'),
      });
      (settlementPayments.listPayments as jest.Mock).mockResolvedValue([]);
      (settlementPayments.toSettlementPaymentInputs as jest.Mock).mockImplementation(
        (payments: Array<{ amountMinor: number }>) => payments.map((p) => ({ amountMinor: p.amountMinor })),
      );
    });

    it('is only offered once "approved" — refused (409) while still "received"', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue(fakeRecord({ status: 'received' }));

      await expect(
        buildService().service.runAction('company-1', 'received-invoice', 'record-payment', {
          documentId: 'ri-1',
          data: {},
          params: { amount: 120, currency: 'EUR', paidAt: '2026-09-16' },
        }),
      ).rejects.toThrow(/not available for a document with status "received"/);
    });

    it('records a full payment, in minor units, against the SAME currency as the document', async () => {
      const { service } = buildService();

      const result = await service.runAction('company-1', 'received-invoice', 'record-payment', {
        documentId: 'ri-1',
        data: {},
        params: { amount: 120, currency: 'EUR', paidAt: '2026-09-16', method: 'bank_transfer' },
      });

      expect(settlementPayments.recordPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'company-1',
          documentId: 'ri-1',
          amountMinor: 12000,
          currency: 'EUR',
          documentAmountMinor: 12000,
          method: 'bank_transfer',
        }),
      );
      expect(result.changed).toBe(true);
      expect(result.createdPaymentId).toBe('payment-1');
    });

    it("refuses a payment currency that does not match the received-invoice's own — no silent conversion", async () => {
      await expect(
        buildService().service.runAction('company-1', 'received-invoice', 'record-payment', {
          documentId: 'ri-1',
          data: {},
          params: { amount: 100, currency: 'USD', paidAt: '2026-09-16' },
        }),
      ).rejects.toThrow(/does not match/);
      expect(settlementPayments.recordPayment).not.toHaveBeenCalled();
    });

    it('pushes PDP\'s "paid" buyer status the pass the payment reaches the full gross amount', async () => {
      const pusher: PdpReceptionStatusPusher = {
        pushTakenInCharge: jest.fn(),
        pushApproved: jest.fn(),
        pushRejected: jest.fn(),
        pushPaid: jest.fn(),
      };

      await buildService(pusher).service.runAction('company-1', 'received-invoice', 'record-payment', {
        documentId: 'ri-1',
        data: {},
        params: { amount: 120, currency: 'EUR', paidAt: '2026-09-16' },
      });

      expect(pusher.pushPaid).toHaveBeenCalledWith('company-1', '604667');
    });

    it('does NOT push "paid" for a partial payment that does not reach the full gross amount', async () => {
      const pusher: PdpReceptionStatusPusher = {
        pushTakenInCharge: jest.fn(),
        pushApproved: jest.fn(),
        pushRejected: jest.fn(),
        pushPaid: jest.fn(),
      };
      (settlementPayments.recordPayment as jest.Mock).mockResolvedValue({
        id: 'payment-1',
        documentId: 'ri-1',
        amountMinor: 5000,
        currency: 'EUR',
        documentAmountMinor: 5000,
        conversionRate: null,
        conversionRateAsOf: null,
        conversionSource: null,
        method: null,
        paidAt: new Date('2026-09-16'),
        note: null,
        createdAt: new Date('2026-09-16'),
      });

      await buildService(pusher).service.runAction('company-1', 'received-invoice', 'record-payment', {
        documentId: 'ri-1',
        data: {},
        params: { amount: 50, currency: 'EUR', paidAt: '2026-09-16' },
      });

      expect(pusher.pushPaid).not.toHaveBeenCalled();
    });
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

  // The obligatory country-policy wiring proof: a country with no rule for this
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
