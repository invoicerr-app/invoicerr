/**
 * M-2 (COMPLIANCE_AUDIT.md) — swallowed compliance errors are now surfaced.
 *
 * PaymentsService.createPayment() commits the Payment row first, then calls
 * ComplianceService.markPaid() as a non-blocking side-effect. Before this fix, a markPaid() failure
 * was caught and thrown away into a bare `logger.warn('… non-blocking')` — the payment already
 * existed, so nothing failed loudly, but the linked ComplianceDocument never got its PAID / national
 * "encaissée" status recorded and nothing showed it had failed.
 *
 * This test drives the real PaymentsService.createPayment() (prisma mocked; ComplianceService
 * mocked) and asserts BOTH halves of the M-2 contract:
 *   (a) the payment is still created — the non-blocking contract is preserved, and
 *   (b) ComplianceService.recordWiringFailure() was called with the compliance document id + the
 *       'markPaid' operation label instead of the failure being silently dropped.
 */
import { PaymentsService } from './payments.service';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import type { ComplianceService } from '@/compliance/operations/compliance-service';

// See invoices.service.spec.ts for why: the real WebhookDispatcherService pulls in the Discord
// driver → `@teever/ez-hook`, which ts-jest cannot resolve when required directly. This suite
// passes its own dispatcher double anyway, so short-circuit the require entirely.
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  __esModule: true,
  WebhookDispatcherService: jest.fn(),
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    invoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    payment: {
      findMany: jest.fn(),
    },
    complianceDocument: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

function makeComplianceServiceMock() {
  return {
    markPaid: jest.fn(),
    recordWiringFailure: jest.fn().mockResolvedValue(undefined),
  };
}

describe('PaymentsService — M-2: compliance wiring failures are recorded, not silently swallowed', () => {
  let complianceService: ReturnType<typeof makeComplianceServiceMock>;
  let webhookDispatcher: { dispatch: jest.Mock };
  let numberingService: { nextNumber: jest.Mock };
  let mailService: { sendMail: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'error').mockResolvedValue(undefined as any);
    jest.spyOn(logger, 'warn').mockResolvedValue(undefined as any);
    jest.spyOn(logger, 'info').mockResolvedValue(undefined as any);

    complianceService = makeComplianceServiceMock();
    webhookDispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    numberingService = { nextNumber: jest.fn().mockResolvedValue({ counter: 1, rawNumber: 'PAY-0001' }) };
    mailService = { sendMail: jest.fn().mockResolvedValue(undefined) };

    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: 'UNPAID',
      currency: 'EUR',
      totalTTC: 100,
      totalTTCMinor: 10000,
    });
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([{ totalPaid: 100, totalPaidMinor: 10000 }]);
    (prisma.invoice.update as jest.Mock).mockResolvedValue({});
  });

  function buildService(): PaymentsService {
    return new PaymentsService(
      mailService as any,
      webhookDispatcher as any,
      numberingService as any,
      complianceService as unknown as ComplianceService,
    );
  }

  it('createPayment() still creates the payment AND records a WIRING_FAILED event when ComplianceService.markPaid() throws', async () => {
    const invoice = {
      id: 'inv-1',
      companyId: 'co-1',
      currency: 'EUR',
      company: { id: 'co-1' },
      client: { id: 'client-1' },
      items: [],
    };
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(invoice);

    const createdPayment = { id: 'pay-1', totalPaid: 100, items: [] };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb({ payment: { create: jest.fn().mockResolvedValue(createdPayment) } }),
    );
    (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    const wiringError = new Error('KSeF session expired');
    complianceService.markPaid.mockRejectedValue(wiringError);

    const service = buildService();
    const result = await service.createPayment('co-1', {
      invoiceId: 'inv-1',
      items: [{ invoiceItemId: 'item-1', amountPaid: '100' }],
    } as any);

    // (a) the payment write itself is NOT blocked by the compliance failure.
    expect(result).toEqual(createdPayment);

    // (b) the failure is now a persisted, first-class signal on the compliance document instead of
    // a bare log line.
    expect(complianceService.recordWiringFailure).toHaveBeenCalledWith('doc-1', 'markPaid', wiringError);
  });

  it('createPayment() logs at error (not recordWiringFailure) when no compliance document exists for the invoice', async () => {
    const invoice = {
      id: 'inv-2',
      companyId: 'co-1',
      currency: 'EUR',
      company: { id: 'co-1' },
      client: { id: 'client-1' },
      items: [],
    };
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(invoice);

    const createdPayment = { id: 'pay-2', totalPaid: 100, items: [] };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
      cb({ payment: { create: jest.fn().mockResolvedValue(createdPayment) } }),
    );
    (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue(null);

    const service = buildService();
    const result = await service.createPayment('co-1', {
      invoiceId: 'inv-2',
      items: [{ invoiceItemId: 'item-1', amountPaid: '100' }],
    } as any);

    expect(result).toEqual(createdPayment);
    expect(complianceService.markPaid).not.toHaveBeenCalled();
    expect(complianceService.recordWiringFailure).not.toHaveBeenCalled();
  });
});
