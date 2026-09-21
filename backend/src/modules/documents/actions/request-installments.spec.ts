import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ActionRegistry } from './action-registry';
import {
  computeMilestoneSplit,
  MilestoneInput,
  registerRequestInstallmentsAction,
} from './request-installments';
import * as persistence from '../persistence';

vi.mock('../persistence');

/** Dates are carried through the split untouched — the arithmetic under test never reads them. */
function thirds(): MilestoneInput[] {
  return [
    { percent: 33.33, dueDate: '2026-10-01' },
    { percent: 33.33, dueDate: '2026-11-01' },
    { percent: 33.34, dueDate: '2026-12-01' },
  ];
}

/**
 * What a one-line invoice carrying this net at this rate will total, gross — `compute-totals.ts`'s
 * own single-rate formula, restated here on purpose: these tests check the split against the
 * arithmetic the INVOICES apply, never against the split's own copy of it.
 */
function grossOfInvoiceFor(netMinor: number, ratePercent: number): number {
  return netMinor + Math.round((netMinor * ratePercent) / 100);
}

/**
 * `computeMilestoneSplit` is pure — no mocks needed, exactly the "math split pure from I/O"
 * discipline this file's own header holds (mirroring compute-totals.spec.ts's own style for the
 * arithmetic this function itself calls into).
 */
describe('computeMilestoneSplit', () => {
  it('30/40/30 of a quote: nets and grosses each sum EXACTLY to the quote totals', () => {
    // Quote: net 250.00 EUR (25000 cents), VAT 20% -> 5000, gross 30000. This one divides evenly on
    // both axes at once, which is exactly why it cannot see the defect the next two tests are about.
    const milestones: MilestoneInput[] = [
      { percent: 30, dueDate: '2026-10-01' },
      { percent: 40, dueDate: '2026-11-01' },
      { percent: 30, dueDate: '2026-12-01' },
    ];
    const result = computeMilestoneSplit(25000, 30000, 20, milestones);

    expect(result).toEqual([
      { percent: 30, dueDate: '2026-10-01', netMinor: 7500, vatMinor: 1500, grossMinor: 9000 },
      { percent: 40, dueDate: '2026-11-01', netMinor: 10000, vatMinor: 2000, grossMinor: 12000 },
      { percent: 30, dueDate: '2026-12-01', netMinor: 7500, vatMinor: 1500, grossMinor: 9000 },
    ]);
    expect(result.reduce((sum, entry) => sum + entry.netMinor, 0)).toBe(25000);
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(30000);
  });

  it('a third of a hundred: the three invoices total the quote, and the spare cent lands in the VAT', () => {
    // Quote: net 100.00 (10000 cents) @ 20% -> VAT 2000, gross 12000. The most banal split there is.
    //
    // Splitting the NET is what the invoices then contradict: nets 3333/3333/3334 each get their OWN
    // VAT rounded by `compute-totals.ts`, and 3334 at 20% is 666.8 -> 667, so that third invoice
    // totals 4001 and the plan asks for 120.01 against a 120.00 quote. No arrangement of three
    // whole-cent nets summing to 10000 avoids it: at 20% a net must reach halfway past a multiple of
    // 5 cents for its rounded VAT to tick up, which a third of a hundred never does.
    const netAxisSplit = [3333, 3333, 3334];
    expect(netAxisSplit.reduce((a, b) => a + b, 0)).toBe(10000); // the net axis, exact
    expect(netAxisSplit.map((net) => grossOfInvoiceFor(net, 20))).toEqual([4000, 4000, 4001]);
    expect(netAxisSplit.reduce((sum, net) => sum + grossOfInvoiceFor(net, 20), 0)).toBe(12001);

    const result = computeMilestoneSplit(10000, 12000, 20, thirds());

    // So the GROSS is what gets split, and each net is derived back out of it: three invoices of
    // 33.33 + 6.67 = 40.00 — both what a human would have written and what totals the quote.
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(12000); // what they pay
    expect(result.map((entry) => entry.netMinor)).toEqual([3333, 3333, 3333]);
    expect(result.map((entry) => entry.vatMinor)).toEqual([667, 667, 667]);
    expect(result.map((entry) => entry.grossMinor)).toEqual([4000, 4000, 4000]);
    // The axis that gives: the nets total a cent under the quote's own net, the VAT a cent over it.
    // Every invoice stays internally exact (667 really is 3333 at 20%, rounded once) and the cent
    // sits on figures nobody is asked to pay.
    expect(result.reduce((sum, entry) => sum + entry.netMinor, 0)).toBe(9999);
    expect(result.reduce((sum, entry) => sum + entry.vatMinor, 0)).toBe(2001);
  });

  it('a rate whose own tax leaves a remainder: 5.5% in thirds still totals the quote', () => {
    // Quote: net 100.00 (10000) @ 5.5% -> VAT 550, gross 10550. Neither axis divides by three.
    // Splitting the net gives 3333/3333/3334, whose invoices total 10549 — a cent SHORT this time,
    // the same defect pointing the other way.
    const netAxisSplit = [3333, 3333, 3334];
    expect(netAxisSplit.reduce((sum, net) => sum + grossOfInvoiceFor(net, 5.5), 0)).toBe(10549);

    const result = computeMilestoneSplit(10000, 10550, 5.5, thirds());

    expect(result.map((entry) => entry.netMinor)).toEqual([3333, 3333, 3335]);
    expect(result.map((entry) => entry.grossMinor)).toEqual([3516, 3516, 3518]);
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(10550);
  });

  it('a final share no net can reach: the cent is bought back from an earlier milestone', () => {
    // Quote: net 500.06 (50006) @ 20% -> VAT 10001, gross 60007. Thirds give the first two 20000
    // each, leaving 20007 for the last — and 20007 is a gross NO net produces at 20%: 16672 totals
    // 20006, 16673 totals 20008, nothing in between. So the second milestone is nudged by one cent
    // of net (16667 -> 16668, i.e. 200.00 -> 200.02 once its own VAT ticks up), which leaves the
    // last one a share it CAN actually be billed for.
    expect([16672, 16673].map((net) => grossOfInvoiceFor(net, 20))).toEqual([20006, 20008]);

    const result = computeMilestoneSplit(50006, 60007, 20, thirds());

    expect(result.map((entry) => entry.netMinor)).toEqual([16667, 16668, 16671]);
    expect(result.map((entry) => entry.grossMinor)).toEqual([20000, 20002, 20005]);
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(60007);
  });

  it('every entry is what its own invoice recomputes, never a figure imposed on it', () => {
    // Quote: net 1.33 (133) @ 5% -> VAT round(6.65) = 7, gross 140. 33/33/34 of it divides evenly on
    // no axis at all. The two fields besides the net used to be decoration — nothing read them, so
    // nothing noticed they disagreed with the invoices; here they are asserted against the invoice's
    // own arithmetic, entry by entry.
    const result = computeMilestoneSplit(133, 140, 5, [
      { percent: 33, dueDate: '2026-10-01' },
      { percent: 33, dueDate: '2026-11-01' },
      { percent: 34, dueDate: '2026-12-01' },
    ]);

    expect(result.map((entry) => entry.netMinor)).toEqual([44, 44, 46]);
    for (const entry of result) {
      expect(entry.grossMinor).toBe(grossOfInvoiceFor(entry.netMinor, 5));
      expect(entry.vatMinor).toBe(entry.grossMinor - entry.netMinor);
    }
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(140);
  });

  it('holds for every rate, amount and split swept over here — never a cent out', () => {
    // The guarantee is not "it works on the examples above": it is that what the client is asked to
    // pay totals the quote's gross, whatever the division. Swept rather than argued.
    const rates = [0, 2.1, 5, 5.5, 7, 10, 13, 20, 21, 22, 23, 27];
    const splits = [
      [50, 50],
      [30, 40, 30],
      [33.33, 33.33, 33.34],
      [33, 33, 34],
      [10, 20, 30, 40],
      [16.66, 16.66, 16.66, 16.67, 16.67, 16.68],
    ];
    const failures: string[] = [];

    for (const rate of rates) {
      for (let netMinor = 101; netMinor <= 20000; netMinor += 13) {
        const grossMinor = grossOfInvoiceFor(netMinor, rate);
        for (const percents of splits) {
          const milestones = percents.map((percent, index) => ({
            percent,
            dueDate: `2026-01-0${index + 1}`,
          }));
          const entries = computeMilestoneSplit(netMinor, grossMinor, rate, milestones);
          const combined = entries.reduce((sum, entry) => sum + entry.grossMinor, 0);
          const misreported = entries.some(
            (entry) =>
              entry.grossMinor !== grossOfInvoiceFor(entry.netMinor, rate) ||
              entry.vatMinor !== entry.grossMinor - entry.netMinor,
          );
          if (combined !== grossMinor || misreported) {
            failures.push(`rate ${rate}, net ${netMinor}, split ${percents.join('/')} -> ${combined}`);
          }
        }
      }
    }

    expect(failures.slice(0, 5)).toEqual([]);
  });

  it('refuses a quote whose gross is not its own net taxed at the single rate found', () => {
    // One line at 20% beside one line carrying no usable rate: `compute-totals.ts` counts the second
    // "in net only", so the quote's breakdown still holds a SINGLE rate and the handler's mono-rate
    // check waves it through — but a 200.00 net carrying 20.00 of VAT is not 200.00 taxed at 20%,
    // and no single-rate invoice reproduces it. Splitting it would tax the untaxed half.
    expect(() =>
      computeMilestoneSplit(20000, 22000, 20, [
        { percent: 50, dueDate: '2026-10-01' },
        { percent: 50, dueDate: '2026-11-01' },
      ]),
    ).toThrow(/no usable VAT rate/);
  });

  it('refuses fewer than two milestones', () => {
    expect(() => computeMilestoneSplit(10000, 12000, 20, [{ percent: 100, dueDate: '2026-10-01' }])).toThrow(
      BadRequestException,
    );
  });

  it('refuses a milestone whose percentage is not strictly positive', () => {
    const milestones: MilestoneInput[] = [
      { percent: 0, dueDate: '2026-10-01' },
      { percent: 100, dueDate: '2026-11-01' },
    ];
    expect(() => computeMilestoneSplit(10000, 12000, 20, milestones)).toThrow(BadRequestException);
  });

  it('refuses percentages that do not sum to exactly 100, without normalizing them', () => {
    const milestones: MilestoneInput[] = [
      { percent: 30, dueDate: '2026-10-01' },
      { percent: 30, dueDate: '2026-11-01' },
    ];
    expect(() => computeMilestoneSplit(10000, 12000, 20, milestones)).toThrow(BadRequestException);
  });
});

/**
 * Handler coverage — same style as request-deposit.spec.ts: resolve the handler directly from a
 * freshly-built registry, mock `persistence`, hand-build the ActionContext.
 */
function buildRegistry() {
  const registry = new ActionRegistry();
  registerRequestInstallmentsAction(registry);
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

function mockCreatedInvoices() {
  let call = 0;
  (persistence.upsertDocument as Mock).mockImplementation(() =>
    Promise.resolve({
      id: `invoice-${++call}`,
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
}

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * The gross total of every invoice this action actually persisted, computed the way the invoice's
 * own screen, PDF, reminders and payment ledger compute it — `computeDocumentTotals` on the stored
 * data, never on the split's own numbers. This is the end of the chain the claim is about: what the
 * client is asked to pay.
 */
function grossTotalsOfCreatedInvoices(): number[] {
  return (persistence.upsertDocument as Mock).mock.calls.map(
    (call) => computeDocumentTotals(INVOICE_DESCRIPTOR, call[4] as Record<string, unknown>).grossMinor,
  );
}

function runInstallments(percents: number[]) {
  const handler = buildRegistry().resolve('quote', 'request-installments')!;
  return handler({
    companyId: 'company-1',
    typeId: 'quote',
    documentId: 'quote-1',
    data: {},
    params: {
      milestones: percents.map((percent, index) => ({
        percent,
        dueDate: `2026-1${index}-01`,
      })),
    },
  });
}

describe('request-installments', () => {
  afterEach(() => vi.resetAllMocks());

  it('mono-rate quote: creates one draft invoice per milestone, dates and amounts as computed', async () => {
    // Net 250.00 EUR (25000 cents) @ 20% VAT -> gross 300.00 EUR (30000 cents).
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 250, vatRate: '20' }] });
    mockCreatedInvoices();

    const handler = buildRegistry().resolve('quote', 'request-installments')!;
    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: {
        milestones: [
          { percent: 30, dueDate: '2026-10-01' },
          { percent: 40, dueDate: '2026-11-01' },
          { percent: 30, dueDate: '2026-12-01' },
        ],
      },
    });

    expect(persistence.upsertDocument).toHaveBeenCalledTimes(3);

    const calls = (persistence.upsertDocument as Mock).mock.calls;
    expect(calls[0]).toEqual([
      'company-1',
      'invoice',
      undefined,
      'draft',
      expect.objectContaining({
        client: 'client-1',
        currency: 'EUR',
        dueDate: '2026-10-01',
        origin: { entity: 'quote', id: 'quote-1' },
        lines: [
          expect.objectContaining({
            description: 'Échéance 1/3 (30% de QUOTE-2026-0001)',
            quantity: 1,
            unitPrice: 75,
            vatRate: '20',
          }),
        ],
      }),
    ]);
    expect(calls[1][3]).toBe('draft');
    expect(calls[1][4]).toEqual(
      expect.objectContaining({
        dueDate: '2026-11-01',
        lines: [expect.objectContaining({ unitPrice: 100 })],
      }),
    );
    expect(calls[2][4]).toEqual(
      expect.objectContaining({ dueDate: '2026-12-01', lines: [expect.objectContaining({ unitPrice: 75 })] }),
    );

    // 30/40/30 of this quote divides evenly on both axes (90/120/90 gross), so the three invoices
    // are worth totalling but cannot, on their own, prove anything about rounding — see the two
    // tests below for splits that do not divide.
    expect(grossTotalsOfCreatedInvoices()).toEqual([9000, 12000, 9000]);
    expect(result.changed).toBe(true);
    expect(result.document?.id).toBe('invoice-1'); // the FIRST created invoice, see this file's header
    expect(result.message).toContain('3 draft invoices');
    expect(result.message).toMatch(/300 EUR/);
  });

  it('a quote split in thirds: the invoices the client receives total the quote, end to end', async () => {
    // Net 100.00 @ 20% -> gross 120.00. 33.33/33.33/33.34 divides evenly on neither axis: this is
    // the whole journey, from the quote's own lines to three stored invoices totalled by the same
    // function every other reader of an invoice uses.
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '20' }] });
    mockCreatedInvoices();

    const result = await runInstallments([33.33, 33.33, 33.34]);

    const grosses = grossTotalsOfCreatedInvoices();
    expect(grosses.reduce((a, b) => a + b, 0)).toBe(12000); // the quote's own gross, to the cent
    expect(grosses).toEqual([4000, 4000, 4000]);
    expect((persistence.upsertDocument as Mock).mock.calls.map((call) => call[4].lines[0].unitPrice)).toEqual(
      [33.33, 33.33, 33.33],
    );
    // And the message says exactly that number — read off these invoices, not off the quote.
    expect(result.message).toContain('they total 120 EUR to pay');
  });

  it('a rate that rounds too: 5.5% in thirds still totals the quote, end to end', async () => {
    // Net 100.00 @ 5.5% -> VAT 5.50, gross 105.50. The split cannot be even on either axis, and the
    // drift here points the other way (a net-axis split would have totalled 105.49).
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '5.5' }] });
    mockCreatedInvoices();

    const result = await runInstallments([33.33, 33.33, 33.34]);

    const grosses = grossTotalsOfCreatedInvoices();
    expect(grosses.reduce((a, b) => a + b, 0)).toBe(10550);
    expect(grosses).toEqual([3516, 3516, 3518]);
    expect((persistence.upsertDocument as Mock).mock.calls.map((call) => call[4].lines[0].unitPrice)).toEqual(
      [33.33, 33.33, 33.35],
    );
    expect(result.message).toContain('they total 105.5 EUR to pay');
  });

  it('multi-rate quote: refuses outright, naming the problem, and creates nothing', async () => {
    mockQuote({
      lines: [
        { description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 100, vatRate: '10' },
      ],
    });

    const handler = buildRegistry().resolve('quote', 'request-installments')!;
    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: {
          milestones: [
            { percent: 50, dueDate: '2026-10-01' },
            { percent: 50, dueDate: '2026-11-01' },
          ],
        },
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      handler({
        companyId: 'company-1',
        typeId: 'quote',
        documentId: 'quote-1',
        data: {},
        params: {
          milestones: [
            { percent: 50, dueDate: '2026-10-01' },
            { percent: 50, dueDate: '2026-11-01' },
          ],
        },
      }),
    ).rejects.toThrow(/taux de TVA unique/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('a rated line beside an unrated one: refuses, and creates nothing', async () => {
    // A single rate in the breakdown (the unrated line is counted "in net only"), so the mono-rate
    // check above passes — and the quote is still unsplittable, because no single-rate invoice can
    // carry a net that is only half taxed. Nothing is created rather than half of it taxed twice.
    mockQuote({
      lines: [
        { description: 'A', quantity: 1, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 100, vatRate: '' },
      ],
    });
    mockCreatedInvoices();

    await expect(runInstallments([50, 50])).rejects.toThrow(/no usable VAT rate/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });

  it('zero-rate quote (no VAT anywhere): perfectly fine, uses rate 0', async () => {
    mockQuote({ lines: [{ description: 'A', quantity: 1, unitPrice: 200, vatRate: '' }] });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const handler = buildRegistry().resolve('quote', 'request-installments')!;
    const result = await handler({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'quote-1',
      data: {},
      params: {
        milestones: [
          { percent: 50, dueDate: '2026-10-01' },
          { percent: 50, dueDate: '2026-11-01' },
        ],
      },
    });

    expect(result.changed).toBe(true);
    const calls = (persistence.upsertDocument as Mock).mock.calls;
    expect(calls[0][4].lines[0]).toEqual(expect.objectContaining({ vatRate: '0' }));
    expect(grossTotalsOfCreatedInvoices().reduce((a, b) => a + b, 0)).toBe(20000);
  });
});
