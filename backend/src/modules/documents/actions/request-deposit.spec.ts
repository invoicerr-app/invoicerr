import { BadRequestException } from '@nestjs/common';

import { ActionRegistry } from './action-registry';
import { registerRequestDepositAction } from './request-deposit';
import * as persistence from '../persistence';

jest.mock('../persistence');

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

describe('request-deposit', () => {
  afterEach(() => jest.resetAllMocks());

  it("mono-rate quote: the deposit line reuses the quote's single VAT rate", async () => {
    mockQuote({
      lines: [
        { description: 'A', quantity: 2, unitPrice: 100, vatRate: '20' },
        { description: 'B', quantity: 1, unitPrice: 50, vatRate: '20' },
      ],
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
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
    // Deposit = 10% of 30000 = 3000 cents = 30 EUR (major units, this document's own convention).
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
            unitPrice: 30,
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
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
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

    const [, , , , invoiceData] = (persistence.upsertDocument as jest.Mock).mock.calls[0];
    expect(invoiceData.lines[0]).not.toHaveProperty('vatRate');
    expect(result.message).toContain("multiple VAT rates on the quote — pick the deposit's rate yourself");
  });

  it('the deposit amount is N% of the gross total, in MINOR units — proven on JPY (0 decimals)', async () => {
    mockQuote({
      currency: 'JPY',
      lines: [{ description: 'A', quantity: 1, unitPrice: 1000, vatRate: '10' }],
    });
    (persistence.upsertDocument as jest.Mock).mockResolvedValue({
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

    // Quote gross: 1000 + 10% VAT = 1100 (JPY, 0 decimals, so major === minor). 50% of 1100 = 550.
    const [, , , , invoiceData] = (persistence.upsertDocument as jest.Mock).mock.calls[0];
    expect(invoiceData.currency).toBe('JPY');
    expect(invoiceData.lines[0].unitPrice).toBe(550);
    expect(invoiceData.lines[0].vatRate).toBe('10'); // mono-rate here too
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
