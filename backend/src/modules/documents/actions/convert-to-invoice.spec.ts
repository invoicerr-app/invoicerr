import { vi, type Mock } from 'vitest';

import {
  mockInvoicesRaisedFromQuote,
  mockNoInvoiceRaisedYet,
  mockQuote,
  raisedInvoiceRow,
} from '../__tests__/quote-action-fixtures';
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

beforeEach(() => {
  mockNoInvoiceRaisedYet();
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
    mockInvoicesRaisedFromQuote([
      raisedInvoiceRow({
        data: { lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: '20' }] },
      }),
    ]);

    await expect(runConvert()).rejects.toMatchObject({ status: 409 });
    await expect(runConvert()).rejects.toThrow(/Refusing to invoice the same quote twice/);
    expect(persistence.upsertDocument).not.toHaveBeenCalled();
  });
});
