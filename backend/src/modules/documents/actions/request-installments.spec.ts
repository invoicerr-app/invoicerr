import { BadRequestException } from '@nestjs/common';

import { ActionRegistry } from './action-registry';
import {
  computeMilestoneSplit,
  MilestoneInput,
  registerRequestInstallmentsAction,
} from './request-installments';
import * as persistence from '../persistence';

jest.mock('../persistence');

/**
 * `computeMilestoneSplit` is pure — no mocks needed, exactly the "math split pure from I/O"
 * discipline this file's own header holds (mirroring compute-totals.spec.ts's own style for the
 * arithmetic this function itself calls into).
 */
describe('computeMilestoneSplit', () => {
  it('30/40/30 of a quote: nets and grosses each sum EXACTLY to the quote totals', () => {
    // Quote: net 250.00 EUR (25000 cents), VAT 20% -> 5000, gross 30000.
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

  it('the last milestone absorbs a rounding remainder that a naive, uncorrected split would lose', () => {
    // Quote: net 1.33 (133 cents), VAT 5% -> round(133*0.05) = round(6.65) = 7, gross 140.
    // 33/33/34 of 133 cents: naive independent rounding gives 44/44/45 = 133 (net happens to land
    // exactly here), but a naive PER-MILESTONE gross (net + round(net*5%)) gives 46/46/47 = 139 —
    // ONE CENT short of the quote's own 140-cent gross. This is a real, verified drift (see this
    // file's own git history / task notes), not a hypothetical: 44*0.05=2.2->2, 45*0.05=2.25->2 (JS
    // Math.round rounds 2.25 down, not up, since 2.25 is not a .5 boundary), so naive VAT sums to
    // 2+2+2=6, one short of the quote's own round(133*0.05)=7.
    const naiveGrosses = [44, 44, 45].map((net) => net + Math.round((net * 5) / 100));
    expect(naiveGrosses).toEqual([46, 46, 47]);
    expect(naiveGrosses.reduce((a, b) => a + b, 0)).toBe(139); // the drift this function must avoid

    const milestones: MilestoneInput[] = [
      { percent: 33, dueDate: '2026-10-01' },
      { percent: 33, dueDate: '2026-11-01' },
      { percent: 34, dueDate: '2026-12-01' },
    ];
    const result = computeMilestoneSplit(133, 140, 5, milestones);

    // Nets: 44, 44, and the last absorbing the net remainder (133 - 88 = 45).
    expect(result.map((entry) => entry.netMinor)).toEqual([44, 44, 45]);
    // Grosses: the first two computed the ordinary way (46, 46 — matching what those two invoices'
    // OWN totals will independently recompute), the LAST forced to absorb the missing cent
    // (140 - 92 = 48, not the naively-rounded 47) — see this file's own "Two remainders, not one".
    expect(result.map((entry) => entry.grossMinor)).toEqual([46, 46, 48]);

    expect(result.reduce((sum, entry) => sum + entry.netMinor, 0)).toBe(133);
    expect(result.reduce((sum, entry) => sum + entry.grossMinor, 0)).toBe(140); // exact, no drift
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
  (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
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

describe('request-installments', () => {
  afterEach(() => jest.resetAllMocks());

  it('mono-rate quote: creates one draft invoice per milestone, dates and amounts as computed', async () => {
    // Net 250.00 EUR (25000 cents) @ 20% VAT -> gross 300.00 EUR (30000 cents).
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 250, vatRate: '20' }] });
    let call = 0;
    (persistence.upsertDocument as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        id: `invoice-${++call}`,
        typeId: 'invoice',
        status: 'draft',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

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

    const calls = (persistence.upsertDocument as jest.Mock).mock.calls;
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

    // The 30/40/30 split's own nets (75+100+75=250) and grosses (90+120+90=300) already sum exactly
    // to the quote's own totals — see computeMilestoneSplit.spec cases above for the general proof.
    expect(result.changed).toBe(true);
    expect(result.document?.id).toBe('invoice-1'); // the FIRST created invoice, see this file's header
    expect(result.message).toContain('3 draft invoices');
    expect(result.message).toMatch(/300 EUR/);
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

  it('zero-rate quote (no VAT anywhere): perfectly fine, uses rate 0', async () => {
    mockQuote({ lines: [{ description: 'A', quantity: 1, unitPrice: 200, vatRate: '' }] });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
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
    const calls = (persistence.upsertDocument as jest.Mock).mock.calls;
    expect(calls[0][4].lines[0]).toEqual(expect.objectContaining({ vatRate: '0' }));
  });
});
