import { vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

import {
  MANUAL_ISSUE_PREFIX,
  type PaidStripeInvoice,
  parsePaidStripeInvoice,
  readInvoiceIssuerCompanyId,
  readStoredLines,
  recordPaidSubscriptionInvoiceEvent,
  toInvoiceLines,
} from './subscription-invoice';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: vi.fn() },
    subscriptionInvoice: { createMany: vi.fn() },
  },
}));
vi.mock('@/logger/logger.service', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const JAN_1 = Date.UTC(2027, 0, 1) / 1000;
const FEB_1 = Date.UTC(2027, 1, 1) / 1000;

const paidInvoice = (over: Partial<PaidStripeInvoice> = {}): PaidStripeInvoice => ({
  id: 'in_1',
  customer: 'cus_1',
  currency: 'eur',
  amount_paid: 1800,
  status_transitions: { paid_at: JAN_1 },
  lines: {
    has_more: false,
    data: [
      {
        description: '3 x Standard (monthly)',
        amount: 1800,
        quantity: 3,
        period: { start: JAN_1, end: FEB_1 },
      },
    ],
  },
  ...over,
});

afterEach(() => vi.resetAllMocks());

describe('reading a paid Stripe invoice', () => {
  it('keeps the lines, the amount paid and the payment date', () => {
    expect(parsePaidStripeInvoice(paidInvoice())).toEqual({
      kind: 'paid',
      record: {
        stripeInvoiceId: 'in_1',
        stripeCustomerId: 'cus_1',
        currency: 'EUR',
        amountPaid: 1800,
        lines: [
          {
            description: '3 x Standard (monthly)',
            amount: 1800,
            quantity: 3,
            periodStart: JAN_1,
            periodEnd: FEB_1,
          },
        ],
        paidAt: new Date(JAN_1 * 1000),
        problem: null,
      },
    });
  });

  it('reads an expanded customer', () => {
    const parsed = parsePaidStripeInvoice(paidInvoice({ customer: { id: 'cus_2' } }));
    expect(parsed.kind === 'paid' && parsed.record.stripeCustomerId).toBe('cus_2');
  });

  it.each([
    ['no invoice id', { id: '' }],
    ['no customer', { customer: null }],
    ['nothing paid', { amount_paid: 0 }],
  ] as const)('ignores an invoice with %s', (reason, over) => {
    expect(parsePaidStripeInvoice(paidInvoice(over))).toEqual({ kind: 'ignored', reason });
  });

  it.each([
    ['more lines than the event holds', { lines: { has_more: true, data: [{ amount: 100 }] } }],
    ['no lines', { lines: { data: [] } }],
    ['a negative line (credit)', { lines: { data: [{ amount: 2000 }, { amount: -200 }] } }],
    ['a discount', { lines: { data: [{ amount: 1800, discount_amounts: [{ amount: 200 }] }] } }],
  ] as const)('flags an invoice with %s for a manual invoice', (problem, over) => {
    const parsed = parsePaidStripeInvoice(paidInvoice(over));
    expect(parsed.kind === 'paid' && parsed.record.problem).toBe(problem);
  });
});

describe('recording a paid invoice from the webhook', () => {
  const event = (object: PaidStripeInvoice, type = 'invoice.paid') => ({ type, data: { object } });

  it('stores it once, linked to the company holding the customer', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue({ id: 'co_1' });
    (prisma.subscriptionInvoice.createMany as Mock).mockResolvedValue({ count: 1 });

    await recordPaidSubscriptionInvoiceEvent(event(paidInvoice()));

    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_1' },
      select: { id: true },
    });
    expect(prisma.subscriptionInvoice.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          stripeInvoiceId: 'in_1',
          companyId: 'co_1',
          currency: 'EUR',
          amountPaid: 1800,
          lastError: null,
        }),
      ],
      skipDuplicates: true,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps a customer without a company, for the issuer to report', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue(null);
    (prisma.subscriptionInvoice.createMany as Mock).mockResolvedValue({ count: 1 });

    await recordPaidSubscriptionInvoiceEvent(event(paidInvoice()));

    expect((prisma.subscriptionInvoice.createMany as Mock).mock.calls[0][0].data[0].companyId).toBeNull();
  });

  it('stores a refused invoice with its reason and warns once', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue({ id: 'co_1' });
    (prisma.subscriptionInvoice.createMany as Mock)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const credit = event(paidInvoice({ lines: { data: [{ amount: 2000 }, { amount: -200 }] } }));

    await recordPaidSubscriptionInvoiceEvent(credit);
    await recordPaidSubscriptionInvoiceEvent(credit);

    expect((prisma.subscriptionInvoice.createMany as Mock).mock.calls[0][0].data[0].lastError).toBe(
      `${MANUAL_ISSUE_PREFIX}: a negative line (credit)`,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('lets a failed write throw, so Stripe retries the event', async () => {
    (prisma.company.findUnique as Mock).mockResolvedValue({ id: 'co_1' });
    (prisma.subscriptionInvoice.createMany as Mock).mockRejectedValue(new Error('db down'));

    await expect(recordPaidSubscriptionInvoiceEvent(event(paidInvoice()))).rejects.toThrow('db down');
  });

  it.each([
    ['another event', event(paidInvoice(), 'invoice.created')],
    ['a zero invoice', event(paidInvoice({ amount_paid: 0 }))],
  ])('ignores %s', async (_label, ignored) => {
    await recordPaidSubscriptionInvoiceEvent(ignored);
    expect(prisma.subscriptionInvoice.createMany).not.toHaveBeenCalled();
  });
});

describe('the issuer company setting', () => {
  it('reads a trimmed id', () => {
    expect(
      readInvoiceIssuerCompanyId({ BILLING_INVOICE_ISSUER_COMPANY_ID: ' co_pub ' } as NodeJS.ProcessEnv),
    ).toBe('co_pub');
  });

  it.each([undefined, '', '  '])('is null when unset (%s)', (value) => {
    expect(
      readInvoiceIssuerCompanyId({ BILLING_INVOICE_ISSUER_COMPANY_ID: value } as NodeJS.ProcessEnv),
    ).toBeNull();
  });
});

describe('invoice lines from Stripe lines', () => {
  it('gives one line per Stripe line, at its amount, with the period in the text', () => {
    expect(
      toInvoiceLines([
        {
          description: '3 x Standard (monthly)',
          amount: 1850,
          quantity: 3,
          periodStart: JAN_1,
          periodEnd: FEB_1,
        },
      ]),
    ).toEqual([
      {
        description: '3 x Standard (monthly) (2027-01-01 to 2027-02-01)',
        quantity: 1,
        unit: 'unit',
        unitPrice: 18.5,
        vatRate: '20',
      },
    ]);
  });

  it('names a line Stripe left without a description', () => {
    expect(
      toInvoiceLines([
        { description: '', amount: 100, quantity: null, periodStart: null, periodEnd: null },
      ])[0].description,
    ).toBe('Invoicerr subscription');
  });

  it('drops malformed stored lines', () => {
    expect(readStoredLines([{ description: 'a', amount: 1 }, { amount: 'x' }, null])).toEqual([
      { description: 'a', amount: 1 },
    ]);
    expect(readStoredLines({})).toEqual([]);
  });
});
