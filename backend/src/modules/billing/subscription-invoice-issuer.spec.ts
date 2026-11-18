import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';
import type { ClientsService } from '@/modules/clients/clients.service';
import type { DocumentsService } from '@/modules/documents/documents.service';

import { assertCanSend } from './send-gate';
import { MANUAL_ISSUE_PREFIX } from './subscription-invoice';
import { MAX_ISSUE_ATTEMPTS, SubscriptionInvoiceIssuer } from './subscription-invoice-issuer';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    subscriptionInvoice: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    company: { findUnique: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));
vi.mock('./send-gate', () => ({ assertCanSend: vi.fn() }));
vi.mock('@/lib/request-context', () => ({ runWithCompanyId: (_id: string, fn: () => unknown) => fn() }));

const NOW = new Date('2027-01-10T12:00:00.000Z');
const ISSUER = 'co_pub';
const LINES = [
  { description: '3 x Standard (monthly)', amount: 1800, quantity: 3, periodStart: null, periodEnd: null },
];

const row = (over: Record<string, unknown> = {}) => ({
  id: 'row_1',
  stripeInvoiceId: 'in_1',
  stripeCustomerId: 'cus_1',
  companyId: 'co_sub',
  currency: 'EUR',
  amountPaid: 1800,
  lines: LINES,
  paidAt: new Date('2027-01-01T08:00:00.000Z'),
  issuerCompanyId: null,
  clientId: null,
  documentId: null,
  issuedAt: null,
  paymentRecordedAt: null,
  attempts: 0,
  lastError: null,
  ...over,
});

const subscriber = {
  id: 'co_sub',
  name: 'Acme',
  email: 'billing@acme.test',
  address: '1 rue de la Paix',
  addressLine2: null,
  postalCode: '75002',
  city: 'Paris',
  state: null,
  country: 'France',
  countryCode: 'FR',
  partyIdentifiers: [
    { scheme: 'SIREN', value: '123456789' },
    { scheme: 'VAT', value: 'FR12123456789' },
  ],
};

function build() {
  const documents = {
    runAction: vi.fn(),
    getDocument: vi.fn(),
    getSettlement: vi.fn().mockResolvedValue({ settlement: { outstandingMinor: 1800 } }),
  };
  const clients = { createClient: vi.fn().mockResolvedValue({ id: 'cl_new' }) };
  const issuer = new SubscriptionInvoiceIssuer(
    documents as unknown as DocumentsService,
    clients as unknown as ClientsService,
  );
  return { issuer, documents, clients };
}

const updates = () => (prisma.subscriptionInvoice.update as Mock).mock.calls.map((call) => call[0].data);

beforeEach(() => {
  vi.stubEnv('BILLING_INVOICE_ISSUER_COMPANY_ID', ISSUER);
  (prisma.company.findUnique as Mock).mockImplementation(async ({ where }) =>
    where.id === ISSUER ? { id: ISSUER } : where.id === 'co_sub' ? subscriber : null,
  );
  (prisma.subscriptionInvoice.findFirst as Mock).mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('issuing the pending subscription invoices', () => {
  it('only reads rows not done, not left to the operator and not given up on', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([]);
    const { issuer } = build();
    await expect(issuer.issuePending(NOW)).resolves.toEqual({
      skipped: null,
      completed: 0,
      waiting: 0,
      failed: 0,
    });
    expect(prisma.subscriptionInvoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paymentRecordedAt: null,
          attempts: { lt: MAX_ISSUE_ATTEMPTS },
          OR: [{ lastError: null }, { NOT: { lastError: { startsWith: MANUAL_ISSUE_PREFIX } } }],
        },
        orderBy: { paidAt: 'asc' },
      }),
    );
  });

  it('waits, issuing nothing, while no issuer company is set', async () => {
    vi.stubEnv('BILLING_INVOICE_ISSUER_COMPANY_ID', '');
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([row()]);
    const { issuer, documents } = build();
    const result = await issuer.issuePending(NOW);
    expect(result.skipped).toMatch(/BILLING_INVOICE_ISSUER_COMPANY_ID is not set/);
    expect(documents.runAction).not.toHaveBeenCalled();
    expect(prisma.subscriptionInvoice.update).not.toHaveBeenCalled();
  });

  it('issues nothing when the issuer company does not exist', async () => {
    vi.stubEnv('BILLING_INVOICE_ISSUER_COMPANY_ID', 'co_gone');
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([row()]);
    const { issuer, documents } = build();
    expect((await issuer.issuePending(NOW)).skipped).toMatch(/co_gone does not exist/);
    expect(documents.runAction).not.toHaveBeenCalled();
  });

  it('issues nothing, and counts no attempt, when the issuer company may not send', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([row()]);
    (assertCanSend as Mock).mockRejectedValue(new Error('still on its trial'));
    const { issuer, documents } = build();
    expect((await issuer.issuePending(NOW)).skipped).toMatch(/cannot send: still on its trial/);
    expect(assertCanSend).toHaveBeenCalledWith(ISSUER);
    expect(documents.runAction).not.toHaveBeenCalled();
    expect(prisma.subscriptionInvoice.update).not.toHaveBeenCalled();
  });

  it('creates the client, saves and sends the invoice, and waits while it is delivered', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([row()]);
    const { issuer, documents, clients } = build();
    documents.runAction
      .mockResolvedValueOnce({ document: { id: 'doc_1', status: 'draft', data: { d: 1 } } })
      .mockResolvedValueOnce({ document: { id: 'doc_1', status: 'sending', data: { d: 1 } } });
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'draft', data: { d: 1 } });

    await expect(issuer.issuePending(NOW)).resolves.toEqual({
      skipped: null,
      completed: 0,
      waiting: 1,
      failed: 0,
    });

    expect(clients.createClient).toHaveBeenCalledWith(
      ISSUER,
      expect.objectContaining({
        name: 'Acme',
        contactEmail: 'billing@acme.test',
        countryCode: 'FR',
        currency: 'EUR',
        type: 'COMPANY',
        vatRegistered: true,
        identifiers: subscriber.partyIdentifiers,
      }),
    );
    expect(documents.runAction).toHaveBeenNthCalledWith(1, ISSUER, 'invoice', 'save-draft', {
      data: {
        client: 'cl_new',
        issueDate: '2027-01-10',
        dueDate: '2027-01-10',
        currency: 'EUR',
        lines: [
          { description: '3 x Standard (monthly)', quantity: 1, unit: 'unit', unitPrice: 18, vatRate: '20' },
        ],
      },
    });
    expect(documents.runAction).toHaveBeenNthCalledWith(2, ISSUER, 'invoice', 'send', {
      documentId: 'doc_1',
      data: { d: 1 },
      params: {},
    });
    expect(updates()).toEqual([
      { issuerCompanyId: ISSUER, clientId: 'cl_new' },
      { documentId: 'doc_1' },
      { issuedAt: NOW },
    ]);
  });

  it('records the Stripe payment once the invoice is sent, and is then done', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([
      row({ issuerCompanyId: ISSUER, clientId: 'cl_1', documentId: 'doc_1', issuedAt: NOW }),
    ]);
    const { issuer, documents, clients } = build();
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'sent', data: { d: 2 } });
    documents.runAction.mockResolvedValue({ document: { id: 'doc_1' } });

    await expect(issuer.issuePending(NOW)).resolves.toEqual({
      skipped: null,
      completed: 1,
      waiting: 0,
      failed: 0,
    });

    expect(clients.createClient).not.toHaveBeenCalled();
    expect(documents.runAction).toHaveBeenCalledTimes(1);
    expect(documents.runAction).toHaveBeenCalledWith(ISSUER, 'invoice', 'record-payment', {
      documentId: 'doc_1',
      data: { d: 2 },
      params: {
        amount: 18,
        currency: 'EUR',
        paidAt: '2027-01-01T08:00:00.000Z',
        method: 'stripe',
        note: 'Paid via Stripe (in_1)',
      },
    });
    expect(updates()).toEqual([{ issuedAt: NOW, paymentRecordedAt: NOW, lastError: null }]);
  });

  it('leaves a sent invoice whose amount due differs from the Stripe payment to the operator', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([
      row({ issuerCompanyId: ISSUER, clientId: 'cl_1', documentId: 'doc_1', issuedAt: NOW }),
    ]);
    const { issuer, documents } = build();
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'sent', data: {} });
    documents.getSettlement.mockResolvedValue({ settlement: { outstandingMinor: 2160 } });

    await expect(issuer.issuePending(NOW)).resolves.toMatchObject({ completed: 0, waiting: 1, failed: 0 });

    expect(documents.runAction).not.toHaveBeenCalled();
    expect(updates()[0].lastError).toBe(
      `${MANUAL_ISSUE_PREFIX}: the invoice leaves 2160 due but Stripe collected 1800 (minor units)`,
    );
  });

  it('reuses the client an earlier invoice created for the same subscriber', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([row()]);
    (prisma.subscriptionInvoice.findFirst as Mock).mockResolvedValue({ clientId: 'cl_old' });
    (prisma.client.findFirst as Mock).mockResolvedValue({ id: 'cl_old' });
    const { issuer, documents, clients } = build();
    documents.runAction.mockResolvedValue({ document: { id: 'doc_1', status: 'sending', data: {} } });
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'draft', data: {} });

    await issuer.issuePending(NOW);

    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'cl_old', companyId: ISSUER },
      select: { id: true },
    });
    expect(clients.createClient).not.toHaveBeenCalled();
    expect(documents.runAction.mock.calls[0][3].data.client).toBe('cl_old');
  });

  it('counts a failed attempt with its reason and goes on with the next row', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([
      row({ id: 'row_orphan', companyId: null }),
      row({ id: 'row_2', issuerCompanyId: ISSUER, clientId: 'cl_1', documentId: 'doc_1' }),
    ]);
    const { issuer, documents } = build();
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'sending', data: {} });

    await expect(issuer.issuePending(NOW)).resolves.toEqual({
      skipped: null,
      completed: 0,
      waiting: 1,
      failed: 1,
    });

    expect(prisma.subscriptionInvoice.update).toHaveBeenCalledWith({
      where: { id: 'row_orphan' },
      data: { attempts: { increment: 1 }, lastError: 'no company holds Stripe customer cus_1' },
    });
  });

  it('fails a row whose invoice can no longer take the payment', async () => {
    (prisma.subscriptionInvoice.findMany as Mock).mockResolvedValue([
      row({ issuerCompanyId: ISSUER, clientId: 'cl_1', documentId: 'doc_1' }),
    ]);
    const { issuer, documents } = build();
    documents.getDocument.mockResolvedValue({ id: 'doc_1', status: 'send_failed', data: {} });

    await expect(issuer.issuePending(NOW)).resolves.toMatchObject({ failed: 1 });
    expect(updates()[0].lastError).toMatch(/"send_failed", so the Stripe payment cannot be recorded/);
  });
});
