import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { ActionRegistry } from './action-registry';
import { registerRequestDepositAction } from './request-deposit';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import * as persistence from '../persistence';
import { computeDocumentTotals } from '../totals/compute-totals';

vi.mock('../persistence');

/**
 * The INVOICE's own descriptor, used below to total the invoice this action produces with the very
 * same function the rest of the product totals it with (`computeDocumentTotals` — the one behind the
 * rendered PDF, the settlement, the e-invoicing formats). Asserting the stored `unitPrice` alone
 * cannot see a deposit that charges VAT twice, because the second application happens HERE, one step
 * further down: `unitPrice` is a NET slot and the document's own rate is added on top of it.
 */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * Direct coverage of the handler itself — the same style action-registry.spec.ts already uses
 * (resolve the handler, call it with a hand-built ActionContext), rather than going through the
 * full DocumentsService: this file is about the "request-deposit" business logic (the deposit
 * amount, the mono/multi-VAT-rate decision), not the generic action-running machinery
 * documents.service.spec.ts already covers for "convert-to-invoice".
 */
function buildRegistry() {
  const registry = new ActionRegistry();
  registerRequestDepositAction(registry);
  return registry;
}

function mockQuote(overrides: {
  id?: string;
  displayNumber?: string | null;
  currency?: string;
  lines: Array<Record<string, unknown>>;
  notes?: string;
}) {
  (persistence.findOwnedDocument as Mock).mockResolvedValue({
    id: overrides.id ?? 'quote-1',
    typeId: 'quote',
    status: 'sent',
    number: 1,
    displayNumber: overrides.displayNumber ?? 'QUOTE-2026-0001',
    data: {
      client: 'client-1',
      issueDate: '2026-01-01',
      currency: overrides.currency ?? 'EUR',
      notes: overrides.notes,
      lines: overrides.lines,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('request-deposit', () => {
  afterEach(() => vi.resetAllMocks());

  it("mono-rate quote: the deposit line reuses the quote's single VAT rate", async () => {
    mockQuote({
      lines: [
        { description: 'A', quantity: 2, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 50, vatRate: '20' },
      ],
    });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = buildRegistry().resolve('quote', 'request-deposit')!;
    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { percent: 10 },
    });

    expect(result.changed).toBe(true);
    // Quote: (100*2 + 50*1) = 250 EUR net = 25000 cents; VAT 20% = 5000; gross = 30000 cents.
    // The client is asked for 10% of the quote's gross = 3000 cents = 30 EUR, and `unitPrice` is the
    // NET side of that invoice (10% of 25000 = 2500 cents = 25 EUR), never the 30 itself: the 20%
    // carried over on the next line is what turns 25 back into the 30 the client pays. The
    // end-to-end amount is asserted by "the amount the client is actually asked to pay" below.
    expect(persistence.upsertDocument).toHaveBeenCalledWith(
      'company-1',
      'invoice',
      undefined,
      'draft',
      expect.objectContaining({
        client: 'client-1',
        currency: 'EUR',
        origin: { entity: 'quote', id: 'quote-1' },
        lines: [
          expect.objectContaining({
            description: 'Deposit (10% of QUOTE-2026-0001)',
            quantity: 1,
            unitPrice: 25,
            vatRate: '20',
          }),
        ],
      }),
    );
    expect(result.message).not.toMatch(/multiple VAT rates/);
  });

  it('multi-rate quote: the deposit line has NO vatRate, and the result says so', async () => {
    mockQuote({
      lines: [
        { description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 100, vatRate: '10' },
      ],
    });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = buildRegistry().resolve('quote', 'request-deposit')!;
    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { percent: 50 },
    });

    const [, , , , invoiceData] = (persistence.upsertDocument as Mock).mock.calls[0];
    expect(invoiceData.lines[0]).not.toHaveProperty('vatRate');
    expect(result.message).toContain("multiple VAT rates on the quote — pick the deposit's rate yourself");
  });

  it('the deposit is computed in MINOR units — proven on JPY (0 decimals)', async () => {
    mockQuote({
      currency: 'JPY',
      lines: [{ description: 'A', quantity: 1, unitPrice: 1000, vatRate: '10' }],
    });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = buildRegistry().resolve('quote', 'request-deposit')!;
    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { percent: 50 },
    });

    // Quote: net 1000, VAT 10% = 100, gross 1100 (JPY, 0 decimals, so major === minor). The client is
    // asked for 50% of that gross = 550; the line's NET side is 50% of the quote's net = 500, and the
    // 10% carried over supplies the remaining 50. Totalled end to end below.
    const [, , , , invoiceData] = (persistence.upsertDocument as Mock).mock.calls[0];
    expect(invoiceData.currency).toBe('JPY');
    expect(invoiceData.lines[0].unitPrice).toBe(500);
    expect(invoiceData.lines[0].vatRate).toBe('10'); // mono-rate here too
    expect(computeDocumentTotals(INVOICE_DESCRIPTOR, invoiceData).grossMinor).toBe(550);
  });

  it('refuses a percentage that is not strictly positive', async () => {
    mockQuote({ lines: [{ description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' }] });

    const handler = buildRegistry().resolve('quote', 'request-deposit')!;
    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: { percent: 0 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});

/**
 * The END of the calculation, not its middle: every assertion here is on the GROSS of the invoice
 * this action produces — the figure the client reads at the bottom of the deposit invoice and is
 * asked to transfer — obtained by running the persisted invoice `data` through the same
 * `computeDocumentTotals` the product itself uses everywhere else.
 *
 * The distinction is the whole point of this block. A deposit whose percentage is taken against the
 * quote's GROSS and then written into `unitPrice` (a NET slot) stores a number that looks perfectly
 * right on its own line and is then taxed a SECOND time by the very rate the quote carried over: the
 * stored figure passes every `unitPrice` assertion above and the client is still billed
 * (N% of gross) x (1 + rate). Only totalling the produced document catches it.
 */
describe('request-deposit — the amount the client is actually asked to pay', () => {
  afterEach(() => vi.resetAllMocks());

  async function runDeposit(
    percent: number,
    quote: { currency?: string; lines: Array<Record<string, unknown>> },
  ) {
    mockQuote(quote);
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = buildRegistry().resolve('quote', 'request-deposit')!;
    await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: { percent },
    });

    const [, , , , invoiceData] = (persistence.upsertDocument as Mock).mock.calls[0];
    return computeDocumentTotals(INVOICE_DESCRIPTOR, invoiceData as Record<string, unknown>);
  }

  it('a 30% deposit on a 100.00 net / 20% quote bills 36.00, never 43.20', async () => {
    // Quote: net 10000, VAT 20% = 2000, gross 12000. A 30% deposit is 30% of 12000 = 3600 — and 3600
    // is what the client must be asked for, split as net 3000 + VAT 600 exactly like any other
    // invoice. 4320 (= 3600 taxed a second time) is the overcharge this test exists to refuse: it is
    // 3600 x 1.20, i.e. the quote's own rate applied to a figure that already carried it.
    const totals = await runDeposit(30, {
      lines: [{ description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' }],
    });

    expect(totals.grossMinor).toBe(3600);
    expect(totals.netMinor).toBe(3000);
    expect(totals.vatMinor).toBe(600);
  });

  it('the deposit never exceeds its share of the quote, at any rate of the five target countries', async () => {
    // One quote per rate, each 100.00 net, each asked for a 30% deposit. The expected gross is
    // 30% of that country's own gross — which is also the ONLY way a deposit can stay a fraction of
    // the quote: an amount taxed twice grows by exactly the rate, so each line below would come out
    // 19/20/22/23% too high if the percentage were taken against the gross and stored as a net.
    const cases: Array<{ rate: string; quoteGrossMinor: number; expectedGrossMinor: number }> = [
      { rate: '19', quoteGrossMinor: 11900, expectedGrossMinor: 3570 }, // DE
      { rate: '20', quoteGrossMinor: 12000, expectedGrossMinor: 3600 }, // FR
      { rate: '22', quoteGrossMinor: 12200, expectedGrossMinor: 3660 }, // IT
      { rate: '23', quoteGrossMinor: 12300, expectedGrossMinor: 3690 }, // PL, PT
    ];

    for (const testCase of cases) {
      const totals = await runDeposit(30, {
        lines: [{ description: 'A', quantity: 1, unitPrice: 100, vatRate: testCase.rate }],
      });
      expect(totals.grossMinor, `rate ${testCase.rate}%`).toBe(testCase.expectedGrossMinor);
      // Stated a second way, independent of the literal above: exactly the requested share of the
      // quote's own gross, never a cent more.
      expect(totals.grossMinor, `rate ${testCase.rate}% — share of the quote`).toBe(
        Math.round((testCase.quoteGrossMinor * 30) / 100),
      );
      vi.resetAllMocks();
    }
  });

  it('a 100% deposit bills the quote itself, to the cent', async () => {
    // The boundary the descriptor's own `max: 100` allows: asking for the whole thing up front must
    // produce exactly the quote's own gross — the single most visible way a double taxation shows up
    // (a "100% deposit" of 120.00 that asks for 144.00), and a check that needs no arithmetic of its
    // own to be convincing.
    const totals = await runDeposit(100, {
      lines: [
        { description: 'A', quantity: 2, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 50, vatRate: '20' },
      ],
    });

    expect(totals.netMinor).toBe(25000);
    expect(totals.grossMinor).toBe(30000);
  });

  it('a multi-rate quote leaves a NET amount for the human to rate, not a VAT-inclusive one', async () => {
    // No single rate governs this quote, so the line carries none and the action's message asks for
    // one (asserted by the "multi-rate quote" test above). What it stores must still be the NET side:
    // the moment someone picks a rate, that rate is applied on top of it. 50% of the quote's net
    // (20000) = 10000 — not 50% of its gross (23000), which would be a figure already carrying VAT
    // and would be taxed again the second the rate is chosen.
    const totals = await runDeposit(50, {
      lines: [
        { description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 100, vatRate: '10' },
      ],
    });

    expect(totals.netMinor).toBe(10000);
    expect(totals.grossMinor).toBe(10000); // no rate on the line yet, so nothing is added
  });
});
