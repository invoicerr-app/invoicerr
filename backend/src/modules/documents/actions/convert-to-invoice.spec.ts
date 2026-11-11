import { vi, type Mock } from 'vitest';

import * as persistence from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerConvertToInvoiceAction } from './convert-to-invoice';

vi.mock('../persistence');
// The new invoice's default due date reads the company row, which these unit tests do not create.
vi.mock('@/modules/company/payment-terms/load-payment-terms', () => ({
  defaultInvoiceDueDate: vi.fn(async () => undefined),
}));

/**
 * Direct coverage of the handler itself - the same style request-deposit.spec.ts uses (resolve the
 * handler off a bare `ActionRegistry`, call it with a hand-built ActionContext, mock only the Prisma
 * boundary). This file is about the ONE rule that did not exist before issue #953: a quote may be
 * converted to an invoice AT MOST ONCE, whatever its status allows.
 */
function buildRegistry() {
  const registry = new ActionRegistry();
  registerConvertToInvoiceAction(registry);
  return registry;
}

function mockQuote(overrides: { lines: Array<Record<string, unknown>> }) {
  (persistence.findOwnedDocument as Mock).mockResolvedValue({
    id: 'quote-1',
    typeId: 'quote',
    status: 'sent',
    number: 1,
    displayNumber: 'QUOTE-2026-0001',
    data: {
      client: 'client-1',
      issueDate: '2026-01-01',
      currency: 'EUR',
      lines: overrides.lines,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function runConvert() {
  const handler = buildRegistry().resolve('quote', 'convert-to-invoice')!;
  return handler({
    companyId: 'company-1',
    typeId: 'quote',
    documentId: 'quote-1',
    data: {},
    params: {},
  });
}

// Nothing has been invoiced from this quote yet - the double-invoicing guard
// (actions/quote-invoicing-guard.ts) reads that fact first. The test that wants a quote already
// invoiced overrides it with its own rows.
beforeEach(() => {
  (persistence.findInvoicesRaisedFromQuote as Mock).mockResolvedValue([]);
});
afterEach(() => vi.resetAllMocks());

describe('convert-to-invoice', () => {
  it('creates the invoice draft when nothing has been raised from this quote yet', async () => {
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '20' }] });
    (persistence.upsertDocument as Mock).mockResolvedValue({
      id: 'invoice-1',
      typeId: 'invoice',
      status: 'draft',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runConvert();

    expect(result.changed).toBe(true);
    expect(persistence.upsertDocument).toHaveBeenCalledTimes(1);
  });

  it('refuses (409) to convert the same quote twice (issue #953)', async () => {
    mockQuote({ lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '20' }] });
    (persistence.findInvoicesRaisedFromQuote as Mock).mockResolvedValue([
      {
        id: 'invoice-1',
        typeId: 'invoice',
        status: 'draft',
        displayNumber: 'INV-2026-0001',
        data: { lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '20' }] },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    await expect(runConvert()).rejects.toMatchObject({ status: 409 });
    await expect(runConvert()).rejects.toThrow(/Refusing to invoice the same quote twice/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});
