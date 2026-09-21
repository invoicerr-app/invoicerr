import { vi, type Mock } from 'vitest';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { DocumentsService } from '../documents.service';
import * as documentsPersistence from '../persistence';
import { BankReconciliationService } from './bank-reconciliation.service';
import * as candidateInvoices from './candidate-invoices';
import * as persistence from './persistence';

/**
 * `./persistence` (this feature's own) and `../persistence` (the generic `DocumentInstance` one — used
 * for `findOwnedDocument`, re-submitting the invoice's own current `data` on "record-payment" the same
 * way the real screen's action dialog already does, and `findOwnedDocumentsByIds`, resolving a
 * RECONCILED line's own invoice label) fully mocked — both reach Prisma directly, the same discipline
 * every other service-level spec in this module holds (documents.service.invoice.spec.ts's own
 * header). `DocumentsService` itself is never constructed for real: `reconcileLine`'s ONLY use of it
 * is a single `runAction` call, so a bare `{ runAction: vi.fn() }` is enough — the exact same "mock
 * the ONE method actually called, not the whole class" shape a plugin's own webhook emitter mock
 * already uses elsewhere in this module. `../settlement/payments` is NOT mocked here any more:
 * `reconcileLine` no longer calls `listPayments` at all — see `ActionResult.createdPaymentId`'s own
 * header and this file's "interleaved reconciliations" test below for why.
 */
vi.mock('./persistence');
vi.mock('./candidate-invoices');
vi.mock('../persistence');

const findOwnedLine = persistence.findOwnedLine as Mock;
const findOwnedStatement = persistence.findOwnedStatement as Mock;
const claimLineForReconciliation = persistence.claimLineForReconciliation as Mock;
const attachReconciledPayment = persistence.attachReconciledPayment as Mock;
const releaseLineClaim = persistence.releaseLineClaim as Mock;
const listStatementLines = persistence.listStatementLines as Mock;
const resolveOutstandingInvoices = candidateInvoices.resolveOutstandingInvoices as Mock;
const findOwnedDocument = documentsPersistence.findOwnedDocument as Mock;
const findOwnedDocumentsByIds = documentsPersistence.findOwnedDocumentsByIds as Mock;

function buildLine(
  overrides: Partial<persistence.BankStatementLineResult> = {},
): persistence.BankStatementLineResult {
  return {
    id: 'line-1',
    statementId: 'stmt-1',
    lineIndex: 0,
    date: new Date('2026-08-15T00:00:00.000Z'),
    amountMinor: 120000,
    label: 'VIR INV-2026-0001',
    reference: null,
    status: 'UNMATCHED',
    reconciledDocumentId: null,
    reconciledPaymentId: null,
    reconciledAt: null,
    ...overrides,
  };
}

function buildStatement() {
  return {
    id: 'stmt-1',
    fileName: 'releve.csv',
    format: 'CSV' as const,
    currency: 'EUR',
    importedAt: new Date(),
  };
}

function buildService() {
  const runAction = vi.fn();
  const service = new BankReconciliationService({ runAction } as unknown as DocumentsService);
  return { service, runAction };
}

beforeEach(() => {
  vi.clearAllMocks();
  findOwnedDocumentsByIds.mockResolvedValue([]);
  findOwnedDocument.mockResolvedValue({ id: 'inv-1', data: { client: 'client-1', currency: 'EUR' } });
});

describe('BankReconciliationService.reconcileLine', () => {
  it('refuses an already-RECONCILED line — a NAMED 409, and never claims/calls runAction', async () => {
    findOwnedLine.mockResolvedValue(buildLine({ status: 'RECONCILED' }));
    const { service, runAction } = buildService();

    await expect(service.reconcileLine('company-1', 'line-1', 'inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(claimLineForReconciliation).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('refuses a debit (money-out) line — never even attempts a claim', async () => {
    findOwnedLine.mockResolvedValue(buildLine({ amountMinor: -500 }));
    const { service } = buildService();
    await expect(service.reconcileLine('company-1', 'line-1', 'inv-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(claimLineForReconciliation).not.toHaveBeenCalled();
  });

  it('a LOST RACE at the atomic claim (status flipped between the read and the claim) is a 409 too', async () => {
    findOwnedLine.mockResolvedValue(buildLine());
    claimLineForReconciliation.mockResolvedValue(false);
    const { service, runAction } = buildService();

    await expect(service.reconcileLine('company-1', 'line-1', 'inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(runAction).not.toHaveBeenCalled();
  });

  it('THE SAME LINE cannot be reconciled twice — a second attempt after a successful first is refused', async () => {
    // First call: succeeds.
    findOwnedLine.mockResolvedValueOnce(buildLine());
    claimLineForReconciliation.mockResolvedValueOnce(true);
    findOwnedStatement.mockResolvedValue(buildStatement());
    const { service, runAction } = buildService();
    runAction.mockResolvedValue({ document: {}, changed: true, message: 'ok', createdPaymentId: 'pay-1' });

    await service.reconcileLine('company-1', 'line-1', 'inv-1');
    expect(attachReconciledPayment).toHaveBeenCalledWith('company-1', 'line-1', 'pay-1');

    // Second call: the line's own persisted status is now RECONCILED — the fast-path check refuses it
    // without ever touching the claim or runAction again.
    findOwnedLine.mockResolvedValueOnce(buildLine({ status: 'RECONCILED' }));
    runAction.mockClear();
    await expect(service.reconcileLine('company-1', 'line-1', 'inv-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(runAction).not.toHaveBeenCalled();
  });

  it('a successful reconciliation calls "record-payment" with the LINE\'s own date/amount/currency', async () => {
    findOwnedLine.mockResolvedValue(buildLine({ amountMinor: 120000, label: 'VIR INV-2026-0001' }));
    claimLineForReconciliation.mockResolvedValue(true);
    findOwnedStatement.mockResolvedValue(buildStatement());
    findOwnedDocument.mockResolvedValue({
      id: 'inv-1',
      data: {
        client: 'client-1',
        issueDate: '2026-08-01',
        dueDate: '2026-08-31',
        currency: 'EUR',
        lines: [],
      },
    });
    const { service, runAction } = buildService();
    runAction.mockResolvedValue({ document: {}, changed: true, message: 'ok', createdPaymentId: 'pay-new' });

    await service.reconcileLine('company-1', 'line-1', 'inv-1', 'ADMIN' as never);

    expect(runAction).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      'record-payment',
      expect.objectContaining({
        documentId: 'inv-1',
        // The invoice's own CURRENT data, re-submitted unchanged — `runAction` validates `data`
        // against the invoice's required fields for every action, "record-payment" included (see
        // this method's own header): an empty object here would 400 against a real descriptor, a
        // regression only caught by asserting the exact shape, never merely that SOME object was sent.
        data: {
          client: 'client-1',
          issueDate: '2026-08-01',
          dueDate: '2026-08-31',
          currency: 'EUR',
          lines: [],
        },
        params: expect.objectContaining({
          amount: 1200,
          currency: 'EUR',
          paidAt: '2026-08-15T00:00:00.000Z',
          method: 'bank_transfer',
        }),
      }),
      'ADMIN',
    );
    expect(attachReconciledPayment).toHaveBeenCalledWith('company-1', 'line-1', 'pay-new');
  });

  it('rolls back the claim when "record-payment" itself throws — the line is never left stuck reconciled', async () => {
    findOwnedLine.mockResolvedValue(buildLine());
    claimLineForReconciliation.mockResolvedValue(true);
    findOwnedStatement.mockResolvedValue(buildStatement());
    const { service, runAction } = buildService();
    runAction.mockRejectedValue(new BadRequestException('country policy refuses this'));

    await expect(service.reconcileLine('company-1', 'line-1', 'inv-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(releaseLineClaim).toHaveBeenCalledWith('company-1', 'line-1');
    expect(attachReconciledPayment).not.toHaveBeenCalled();
  });

  it('a documentId not owned by this company NEVER reaches the claim — the line is never written', async () => {
    findOwnedLine.mockResolvedValue(buildLine());
    claimLineForReconciliation.mockResolvedValue(true);
    findOwnedStatement.mockResolvedValue(buildStatement());
    findOwnedDocument.mockRejectedValue(new NotFoundException('not found'));
    const { service, runAction } = buildService();

    await expect(service.reconcileLine('company-1', 'line-1', 'foreign-inv')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // THE assertion, and the reason it is "not called" rather than "rolled back": the claim WRITES
    // `reconciledDocumentId = <whatever the caller sent>`. Claiming first and compensating after
    // leaves another tenant's invoice id sitting on this line for the width of that window — and
    // permanently if the process dies inside it, since nothing ever moves a line back out of
    // RECONCILED. There is no window to compensate for if the id is never written.
    expect(claimLineForReconciliation).not.toHaveBeenCalled();
    expect(releaseLineClaim).not.toHaveBeenCalled();
    expect(runAction).not.toHaveBeenCalled();
  });

  it('resolves the invoice BEFORE claiming the line, on the SUCCESS path too — not just on failure', async () => {
    // The order itself, pinned independently of any refusal: a spec that only checks the 404 path
    // would still pass against a claim-first implementation whose compensation happened to work.
    const order: string[] = [];
    findOwnedLine.mockResolvedValue(buildLine());
    findOwnedStatement.mockResolvedValue(buildStatement());
    findOwnedDocument.mockImplementation(() => {
      order.push('findOwnedDocument');
      return Promise.resolve({ id: 'inv-1', data: { client: 'client-1', currency: 'EUR' } });
    });
    claimLineForReconciliation.mockImplementation(() => {
      order.push('claimLineForReconciliation');
      return Promise.resolve(true);
    });
    const { service, runAction } = buildService();
    runAction.mockResolvedValue({ document: {}, changed: true, message: 'ok', createdPaymentId: 'pay-1' });

    await service.reconcileLine('company-1', 'line-1', 'inv-1');

    expect(order).toEqual(['findOwnedDocument', 'claimLineForReconciliation']);
  });

  it(
    'TWO INTERLEAVED reconciliations against the SAME invoice each end with their OWN payment — ' +
      'the old before/after `listPayments` diff could not tell them apart',
    async () => {
      // Two DIFFERENT statement lines, both reconciled against the SAME invoice — the exact shape
      // the audit named: two staff working a queue, or one invoice paid in two instalments arriving
      // as two lines.
      const lineA = buildLine({ id: 'line-A', label: 'VIR A', amountMinor: 5000 });
      const lineB = buildLine({ id: 'line-B', label: 'VIR B', amountMinor: 7000 });

      findOwnedLine.mockImplementation((_companyId: string, lineId: string) =>
        Promise.resolve(lineId === 'line-A' ? lineA : lineB),
      );
      claimLineForReconciliation.mockResolvedValue(true);
      findOwnedStatement.mockResolvedValue(buildStatement());
      findOwnedDocument.mockResolvedValue({ id: 'inv-1', data: { client: 'client-1', currency: 'EUR' } });

      const { service, runAction } = buildService();

      // Deferred promises are what make the two `reconcileLine` calls GENUINELY overlap, rather than
      // merely being awaited back-to-back: line-A's own "record-payment" call is made to resolve only
      // AFTER line-B's own has already resolved and attached ITS payment — line-B's `DocumentPayment`
      // fully exists, from the caller's point of view, before line-A's own call returns. A before/
      // after `listPayments` diff (the OLD implementation) reading at that exact moment would see BOTH
      // new rows and could attribute either one to either line — precisely the defect this test pins
      // shut. With the fix, there is no diff left to get confused: each call reads its OWN
      // `ActionResult.createdPaymentId` straight off the result it was handed.
      let resolveAStarted!: () => void;
      const aStarted = new Promise<void>((resolve) => {
        resolveAStarted = resolve;
      });
      let resolveBDone!: (value: { changed: true; createdPaymentId: string }) => void;
      const bDone = new Promise<{ changed: true; createdPaymentId: string }>((resolve) => {
        resolveBDone = resolve;
      });

      runAction.mockImplementation(async (_companyId, _typeId, _actionId, payload) => {
        const note = (payload as { params: { note: string } }).params.note;
        if (note.includes('VIR A')) {
          resolveAStarted();
          return bDone.then((bResult) => ({ ...bResult, createdPaymentId: 'pay-A' }));
        }
        await aStarted;
        const result = { changed: true as const, createdPaymentId: 'pay-B' };
        resolveBDone(result);
        return result;
      });

      const [resultA, resultB] = await Promise.all([
        service.reconcileLine('company-1', 'line-A', 'inv-1'),
        service.reconcileLine('company-1', 'line-B', 'inv-1'),
      ]);

      expect(resultA.reconciledPaymentId).toBe('pay-A');
      expect(resultB.reconciledPaymentId).toBe('pay-B');
      expect(attachReconciledPayment).toHaveBeenCalledWith('company-1', 'line-A', 'pay-A');
      expect(attachReconciledPayment).toHaveBeenCalledWith('company-1', 'line-B', 'pay-B');
    },
  );
});

describe('BankReconciliationService.getStatementLines', () => {
  it("only offers suggestions for UNMATCHED lines, filtered to the statement's own currency", async () => {
    findOwnedStatement.mockResolvedValue(buildStatement());
    listStatementLines.mockResolvedValue([
      buildLine({ id: 'line-1', status: 'UNMATCHED', amountMinor: 120000 }),
      buildLine({
        id: 'line-2',
        status: 'RECONCILED',
        amountMinor: 5000,
        reconciledDocumentId: 'inv-already-settled',
      }),
    ]);
    findOwnedDocumentsByIds.mockResolvedValue([
      { id: 'inv-already-settled', displayNumber: 'INV-2026-0002' },
    ]);
    resolveOutstandingInvoices.mockResolvedValue([
      {
        documentId: 'inv-1',
        displayNumber: 'INV-2026-0001',
        clientLabel: 'ACME',
        currency: 'EUR',
        outstandingMinor: 120000,
        issueDate: null,
        dueDate: null,
      },
      {
        documentId: 'inv-usd',
        displayNumber: 'INV-USD',
        clientLabel: 'Foreign Co',
        currency: 'USD',
        outstandingMinor: 120000,
        issueDate: null,
        dueDate: null,
      },
    ]);

    const { service } = buildService();
    const view = await service.getStatementLines('company-1', 'stmt-1');

    // Only the EUR candidate survives currency filtering.
    expect(view.candidates).toHaveLength(1);
    expect(view.candidates[0].documentId).toBe('inv-1');

    const [unmatched, reconciled] = view.lines;
    expect(unmatched.suggestions).toHaveLength(1);
    expect(unmatched.suggestions[0].documentId).toBe('inv-1');
    expect(unmatched.reconciledInvoiceLabel).toBeNull();
    // A RECONCILED line never gets suggestions recomputed — pure waste, it already has its own answer.
    expect(reconciled.suggestions).toEqual([]);
    // Resolved even though the invoice is no longer in `candidates` (it may since have settled) —
    // see this method's own header on why `candidates` alone is never a reliable source for this.
    expect(reconciled.reconciledInvoiceLabel).toBe('INV-2026-0002');
  });
});
