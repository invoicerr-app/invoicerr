/**
 * The five actions really ASK the profile — proven per endpoint, not per function.
 *
 * `action-conditions.spec.ts` proves `checkAction` itself, with a fictional country. That is the
 * mechanism, and it says nothing about whether anyone calls it. Only `ISSUE` used to; the other five
 * were unguarded, so a country could forbid deletion and the delete endpoint would delete anyway.
 * A tested function nobody invokes is the exact failure this repository keeps producing.
 *
 * So the profile is made to refuse, and each service method must refuse with it. If a call site is
 * removed or moved after an early return, its test here stops throwing and fails.
 *
 * Note what this does NOT claim: no shipped profile declares a single condition today, so nothing
 * blocks in production. This proves the wire is connected, not that current is flowing through it.
 */
import { BadRequestException } from '@nestjs/common';
import { checkAction } from '@/compliance/profiles/action-conditions';
import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';
import type { ComplianceService } from '@/compliance/operations/compliance-service';
import { InvoicesService } from './invoices.service';

jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  __esModule: true,
  WebhookDispatcherService: jest.fn(),
}));

// `checkIssuable` stays permissive: this suite is about the OTHER five actions, and a blocked
// issuance would stop `sendInvoiceByEmail` before it ever reaches its own guard.
jest.mock('@/compliance/profiles/action-conditions', () => ({
  __esModule: true,
  checkAction: jest.fn(),
  checkIssuable: jest.fn(() => ({ allowed: true, blockers: [] })),
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    invoice: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
    complianceDocument: { findFirst: jest.fn() },
    client: { findFirst: jest.fn() },
    company: { findUniqueOrThrow: jest.fn() },
    $transaction: jest.fn(),
  },
}));

const REFUSED = {
  allowed: false,
  blockers: [
    {
      predicate: 'never',
      kind: 'INVOICE',
      action: 'EDIT',
      description: 'Le pays de ce test refuse tout',
    },
  ],
};

/** An issued French invoice — France only so that `guessCountryCode` yields an ISO at all. */
const anInvoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  companyId: 'co-1',
  status: 'ISSUED',
  number: 1,
  kind: 'INVOICE',
  items: [],
  client: { contactEmail: 'buyer@example.org', partyIdentifiers: [] },
  company: { country: 'France', partyIdentifiers: [] },
  ...over,
});

describe('every action consults the country profile, not just ISSUE', () => {
  let service: InvoicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(logger, 'error').mockResolvedValue(undefined as never);
    jest.spyOn(logger, 'warn').mockResolvedValue(undefined as never);
    jest.spyOn(logger, 'info').mockResolvedValue(undefined as never);

    (checkAction as jest.Mock).mockReturnValue(REFUSED);

    service = new InvoicesService(
      { dispatch: jest.fn().mockResolvedValue(undefined) } as never,
      { nextNumber: jest.fn().mockResolvedValue({ counter: 1, rawNumber: 'INV-0001' }) } as never,
      {
        createDraft: jest.fn(),
        editDraft: jest.fn().mockResolvedValue(undefined),
        issue: jest.fn(),
        send: jest.fn(),
        recordAuditEvent: jest.fn(),
        recordWiringFailure: jest.fn().mockResolvedValue(undefined),
      } as unknown as ComplianceService,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  /** The action the profile was asked about — the whole point is that it is the RIGHT one. */
  const askedAbout = () => (checkAction as jest.Mock).mock.calls.map((c) => c[2]);

  it('DELETE asks, and refuses — before the product’s own draft-only rule', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice({ status: 'DRAFT' }));

    await expect(service.deleteInvoice('co-1', 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(askedAbout()).toContain('DELETE');
    // A country that says "nothing is ever deleted here" must win over the product's own rule, so
    // the refusal has to happen even for the draft the product would have deleted happily.
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it('EDIT asks, and refuses', async () => {
    (prisma.client.findFirst as jest.Mock).mockResolvedValue({ id: 'cl-1', partyIdentifiers: [] });
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice({ status: 'DRAFT' }));

    await expect(
      service.editInvoice('co-1', { id: 'inv-1', clientId: 'cl-1', items: [] } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(askedAbout()).toContain('EDIT');
  });

  it('CANCEL asks, and refuses', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice());

    await expect(service.cancelInvoice('co-1', 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(askedAbout()).toContain('CANCEL');
  });

  it('CORRECT asks, and refuses', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice());
    (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      status: 'DELIVERED',
      plan: { lifecycle: { correctionModel: 'CREDIT_NOTE' } },
    });

    await expect(service.correctInvoice('co-1', 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(askedAbout()).toContain('CORRECT');
  });

  it('SEND asks, and refuses before any channel is touched', async () => {
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice());
    (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      status: 'ISSUED',
      plan: { lifecycle: {} },
    });

    await expect(service.sendInvoiceByEmail('co-1', 'inv-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(askedAbout()).toContain('SEND');
  });

  it('and when the profile allows, none of them is blocked by this guard', async () => {
    // Without this the whole suite would pass against a service that throws unconditionally.
    (checkAction as jest.Mock).mockReturnValue({ allowed: true, blockers: [] });
    (prisma.invoice.findFirst as jest.Mock).mockResolvedValue(anInvoice({ status: 'DRAFT' }));
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', isActive: false });
    (prisma.complianceDocument.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.deleteInvoice('co-1', 'inv-1')).resolves.toEqual({
      id: 'inv-1',
      isActive: false,
    });
  });
});
