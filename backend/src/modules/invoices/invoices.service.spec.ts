/**
 * M-2 (COMPLIANCE_AUDIT.md) — swallowed compliance errors are now surfaced.
 *
 * Before this fix, every non-blocking ComplianceService integration point in InvoicesService
 * (createDraft/issue/recordAuditEvent/…) caught its own failures and threw them away into a bare
 * `logger.warn('… non-blocking')` — the invoice write already succeeded, so nothing failed loudly,
 * but the linked ComplianceDocument could silently sit at its current status (often DRAFT) forever
 * with NOTHING recorded on the document and NOTHING surfaced to the UI.
 *
 * These tests drive real InvoicesService methods (prisma mocked; ComplianceService mocked) and
 * assert BOTH halves of the contract:
 *   (a) the invoice operation still succeeds — the non-blocking contract is preserved, and
 *   (b) ComplianceService.recordWiringFailure() was called with the right document id + operation
 *       label (or, when no compliance document exists at all, the failure is logged at `error`
 *       instead of `warn` — the missing document IS the visible signal).
 */
import { BadRequestException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import type { ComplianceService } from '@/compliance/operations/compliance-service';
import { FormatValidationError } from '@/compliance/execution/types';

// The real WebhookDispatcherService pulls in the Discord driver → `@teever/ez-hook`, an unrelated
// module whose type declarations ts-jest cannot resolve when the file is required directly (no
// existing spec imports the webhooks module today, so nothing surfaced this before). This suite
// passes its own hand-rolled dispatcher double to InvoicesService's constructor anyway — the real
// class's behavior is irrelevant here — so short-circuit the require entirely instead of dragging
// an unrelated compile issue into an M-2 test.
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  __esModule: true,
  WebhookDispatcherService: jest.fn(),
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    invoice: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    complianceDocument: {
      findFirst: jest.fn(),
    },
    company: {
      findUniqueOrThrow: jest.fn(),
    },
    client: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

function makeComplianceServiceMock() {
  return {
    createDraft: jest.fn(),
    issue: jest.fn(),
    send: jest.fn(),
    recordAuditEvent: jest.fn(),
    recordWiringFailure: jest.fn().mockResolvedValue(undefined),
  };
}

describe('InvoicesService — M-2: compliance wiring failures are recorded, not silently swallowed', () => {
  let complianceService: ReturnType<typeof makeComplianceServiceMock>;
  let webhookDispatcher: { dispatch: jest.Mock };
  let numberingService: { nextNumber: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'error').mockResolvedValue(undefined as any);
    jest.spyOn(logger, 'warn').mockResolvedValue(undefined as any);
    jest.spyOn(logger, 'info').mockResolvedValue(undefined as any);

    complianceService = makeComplianceServiceMock();
    webhookDispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    numberingService = { nextNumber: jest.fn().mockResolvedValue({ counter: 1, rawNumber: 'INV-0001' }) };
  });

  function buildService(): InvoicesService {
    return new InvoicesService(
      webhookDispatcher as any,
      numberingService as any,
      complianceService as unknown as ComplianceService,
      {} as any, // InvoiceRenderingService — unused by the methods under test
      {} as any, // TransmissionProviderRegistry — unused by the methods under test
      {} as any, // ComplianceQueueDispatcher — unused by the methods under test
    );
  }

  describe('deleteInvoice()', () => {
    it('still deletes the invoice AND records a WIRING_FAILED event when recordAuditEvent(DELETED) throws', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-1',
        companyId: 'co-1',
        status: 'DRAFT',
        client: {},
        company: {},
        items: [],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', isActive: false });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-1' });
      const wiringError = new Error('compliance store unavailable');
      complianceService.recordAuditEvent.mockRejectedValue(wiringError);

      const service = buildService();
      const result = await service.deleteInvoice('co-1', 'inv-1');

      // (a) the invoice deletion itself is NOT blocked by the compliance failure.
      expect(result).toEqual({ id: 'inv-1', isActive: false });

      // (b) the failure was reported on the compliance document, not just logged away.
      expect(complianceService.recordWiringFailure).toHaveBeenCalledWith(
        'doc-1',
        'recordAuditEvent(DELETED)',
        wiringError,
      );
    });

    it('does not attempt to record a wiring failure when NO compliance document exists (nothing to attach it to)', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-2',
        companyId: 'co-1',
        status: 'DRAFT',
        client: {},
        company: {},
        items: [],
      });
      (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-2', isActive: false });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue(null);

      const service = buildService();
      const result = await service.deleteInvoice('co-1', 'inv-2');

      expect(result).toEqual({ id: 'inv-2', isActive: false });
      expect(complianceService.recordAuditEvent).not.toHaveBeenCalled();
      expect(complianceService.recordWiringFailure).not.toHaveBeenCalled();
    });
  });

  describe('issueInvoice()', () => {
    it('still issues the invoice AND records a WIRING_FAILED event when ComplianceService.issue() throws', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-3',
        companyId: 'co-1',
        status: 'DRAFT',
        number: null,
        client: {},
        company: {},
      });
      const updatedInvoice = { id: 'inv-3', rawNumber: 'INV-0001', client: {}, company: {} };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
        cb({ invoice: { update: jest.fn().mockResolvedValue(updatedInvoice) } }),
      );
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({ id: 'doc-3' });
      const wiringError = new Error('numbering blocked');
      complianceService.issue.mockRejectedValue(wiringError);

      const service = buildService();
      const result = await service.issueInvoice('co-1', 'inv-3');

      // (a) issuance succeeded (the DB write from the $transaction is returned) despite the
      // compliance failure — the non-blocking contract is preserved.
      expect(result).toEqual(updatedInvoice);

      // (b) the failure is now a persisted, first-class signal on the document instead of a
      // bare log line.
      expect(complianceService.recordWiringFailure).toHaveBeenCalledWith(
        'doc-3',
        'issueInvoice',
        wiringError,
      );
    });

    it('logs at error (not warn) — instead of calling recordWiringFailure — when no compliance document was found to issue', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-4',
        companyId: 'co-1',
        status: 'DRAFT',
        number: null,
        client: {},
        company: {},
      });
      const updatedInvoice = { id: 'inv-4', rawNumber: 'INV-0002', client: {}, company: {} };
      (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) =>
        cb({ invoice: { update: jest.fn().mockResolvedValue(updatedInvoice) } }),
      );
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue(null);

      const service = buildService();
      const result = await service.issueInvoice('co-1', 'inv-4');

      expect(result).toEqual(updatedInvoice);
      expect(complianceService.issue).not.toHaveBeenCalled();
      expect(complianceService.recordWiringFailure).not.toHaveBeenCalled();
      // The absence of any compliance document to issue is itself a warn (pre-existing
      // "No compliance document found" branch) — not the M-2 wiring-failure path.
      expect(logger.warn).toHaveBeenCalledWith(
        'No compliance document found for issued invoice',
        expect.objectContaining({ details: { invoiceId: 'inv-4' } }),
      );
    });
  });

  describe('createInvoice()', () => {
    const company = {
      id: 'co-1',
      name: 'Acme SAS',
      countryCode: 'FR',
      currency: 'EUR',
      exemptVat: false,
      partyIdentifiers: [],
    };
    const client = {
      id: 'client-1',
      companyId: 'co-1',
      name: 'Buyer Co',
      countryCode: 'FR',
      currency: 'EUR',
      type: 'COMPANY',
      partyIdentifiers: [],
    };
    const body = {
      clientId: 'client-1',
      currency: 'EUR',
      items: [
        {
          name: 'Consulting',
          description: 'Consulting',
          quantity: 1,
          unitPrice: 100,
          vatRate: 20,
          type: 'SERVICE',
        },
      ],
    } as any;

    beforeEach(() => {
      (prisma.company.findUniqueOrThrow as jest.Mock).mockResolvedValue(company);
      (prisma.client.findFirst as jest.Mock).mockResolvedValue(client);
    });

    it('still creates the invoice AND upgrades the log to ERROR (not warn) when createDraft() fails with no document to attach the failure to', async () => {
      const createdInvoice = { id: 'inv-5', client, company, items: [] };
      (prisma.invoice.create as jest.Mock).mockResolvedValue(createdInvoice);

      const wiringError = new Error('compliance engine unavailable');
      complianceService.createDraft.mockRejectedValue(wiringError);

      const service = buildService();
      const result = await service.createInvoice('co-1', body);

      // (a) invoice creation is NOT blocked by the compliance failure.
      expect(result).toEqual(createdInvoice);

      // (b) recordWiringFailure is NEVER called here — createDraft() itself is what failed, so
      // there is no ComplianceDocument row to attach a WIRING_FAILED event to. The missing
      // document is itself the visible signal; the log level is upgraded to error instead.
      expect(complianceService.recordWiringFailure).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('ComplianceService.createDraft failed'),
        expect.objectContaining({
          category: 'invoice',
          details: expect.objectContaining({
            invoiceId: 'inv-5',
            error: expect.stringContaining('compliance engine unavailable'),
          }),
        }),
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('ComplianceService.createDraft'),
        expect.anything(),
      );
    });
  });

  describe('getInvoice() — M-2: the WIRING_FAILED event is already surfaced via the raw events projection', () => {
    it('passes the compliance document events (including WIRING_FAILED) straight through, unmodified', async () => {
      const wiringFailedEvent = {
        type: 'WIRING_FAILED',
        at: new Date('2027-01-03T00:00:00Z'),
        actor: 'system',
        detail: 'markPaid: KSeF session expired',
      };
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-10',
        companyId: 'co-1',
        complianceDocuments: [
          {
            id: 'doc-10',
            status: 'ISSUED',
            number: null,
            plan: null,
            immutableHash: null,
            events: [
              { type: 'CREATED', at: new Date('2027-01-01T00:00:00Z'), actor: 'system', detail: null },
              wiringFailedEvent,
            ],
          },
        ],
      });

      const service = buildService();
      const invoice = await service.getInvoice('co-1', 'inv-10');

      expect(invoice.complianceDocuments[0].events).toContainEqual(wiringFailedEvent);
    });
  });

  describe('getAvailableActions() — M-2: surfaces the WIRING_FAILED signal as `complianceError`', () => {
    it('returns complianceError populated with the WIRING_FAILED detail when it is the most recent event', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-6',
        companyId: 'co-1',
        status: 'ISSUED',
      });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-6',
        status: 'ISSUED',
        plan: null, // no plan yet — exercises the early-return projection branch
        events: [
          { type: 'CREATED', at: new Date('2027-01-01T00:00:00Z'), detail: null },
          { type: 'ISSUE', at: new Date('2027-01-02T00:00:00Z'), detail: null },
          {
            type: 'WIRING_FAILED',
            at: new Date('2027-01-03T00:00:00Z'),
            detail: 'issueInvoice: numbering blocked',
          },
        ],
      });

      const service = buildService();
      const actions = await service.getAvailableActions('co-1', 'inv-6');

      expect(actions.complianceError).toBe('issueInvoice: numbering blocked');
    });

    it('returns complianceError: null when the compliance document has no WIRING_FAILED event', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-7',
        companyId: 'co-1',
        status: 'ISSUED',
      });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-7',
        status: 'ISSUED',
        plan: null,
        events: [{ type: 'CREATED', at: new Date('2027-01-01T00:00:00Z'), detail: null }],
      });

      const service = buildService();
      const actions = await service.getAvailableActions('co-1', 'inv-7');

      expect(actions.complianceError).toBeNull();
    });

    it('returns complianceError: null when no compliance document exists at all', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-8',
        companyId: 'co-1',
        status: 'DRAFT',
      });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue(null);

      const service = buildService();
      const actions = await service.getAvailableActions('co-1', 'inv-8');

      expect(actions.complianceError).toBeNull();
    });

    it('returns complianceError: null when a later event followed the WIRING_FAILED one (recovered/retried)', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue({
        id: 'inv-9',
        companyId: 'co-1',
        status: 'ISSUED',
      });
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-9',
        status: 'ISSUED',
        plan: null,
        events: [
          { type: 'CREATED', at: new Date('2027-01-01T00:00:00Z'), detail: null },
          { type: 'WIRING_FAILED', at: new Date('2027-01-02T00:00:00Z'), detail: 'issue: transient error' },
          { type: 'ISSUE', at: new Date('2027-01-03T00:00:00Z'), detail: null }, // retried successfully
        ],
      });

      const service = buildService();
      const actions = await service.getAvailableActions('co-1', 'inv-9');

      expect(actions.complianceError).toBeNull();
    });
  });

  describe('sendInvoiceByEmail() — a FormatValidationError must never be reported as an SMTP problem', () => {
    function issuedInvoice(id: string) {
      return {
        id,
        companyId: 'co-1',
        status: 'ISSUED',
        number: 1,
        client: { contactEmail: 'buyer@example.com' },
        company: {},
        items: [],
      };
    }

    it('surfaces a FormatValidationError from complianceService.send() as a real validation failure (rule ids included, no SMTP wording)', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(issuedInvoice('inv-fv-1'));
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-fv-1',
        plan: null, // no channels resolved → feedback 'NONE' → the synchronous send() path
      });
      const validationError = new FormatValidationError('format validation failed for 1 artifact(s)', [
        {
          syntax: 'EN16931_CII',
          role: 'AUTHORITATIVE',
          errors: [
            '[BR-S-02] An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).',
          ],
        },
      ]);
      complianceService.send.mockRejectedValue(validationError);

      const service = buildService();
      let caught: any;
      try {
        await service.sendInvoiceByEmail('co-1', 'inv-fv-1');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.message).toContain('BR-S-02');
      expect(caught.message).toContain('compliance format validation');
      expect(caught.message).not.toMatch(/SMTP/i);
    });

    it('still reports the generic SMTP message for a genuine (non-validation) transport failure', async () => {
      (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(issuedInvoice('inv-fv-2'));
      (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
        id: 'doc-fv-2',
        plan: null,
      });
      complianceService.send.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:1025'));

      const service = buildService();
      let caught: any;
      try {
        await service.sendInvoiceByEmail('co-1', 'inv-fv-2');
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught.message).toMatch(/SMTP configuration/i);
    });
  });
});
