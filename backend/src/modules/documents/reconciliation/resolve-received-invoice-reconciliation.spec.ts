import { vi, type Mock } from 'vitest';

import * as persistence from '../persistence';
import { resolveReceivedInvoiceReconciliation } from './resolve-received-invoice-reconciliation';
import * as settings from './reconciliation-settings';
import * as varianceAcceptance from './variance-acceptance';

vi.mock('../persistence');
vi.mock('./reconciliation-settings');
vi.mock('./variance-acceptance');

/**
 * Proves the WIRING (extraction, filtering, acceptance overlay) — never the engine's own math, which
 * `three-way-match.spec.ts` already covers on its own, the same "prove the glue, not the shared
 * engine again" split `actions/purchase-order-actions.spec.ts`'s own header documents.
 */
describe('resolveReceivedInvoiceReconciliation', () => {
  const findOwnedDocument = persistence.findOwnedDocument as Mock;
  const listDocuments = persistence.listDocuments as Mock;
  const getReconciliationSettings = settings.getReconciliationSettings as Mock;
  const getVarianceAcceptance = varianceAcceptance.getVarianceAcceptance as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    getReconciliationSettings.mockResolvedValue({ tolerancePercent: 2 });
    getVarianceAcceptance.mockReturnValue(null);
  });

  it('returns hasPurchaseOrder: false when the received invoice has no purchaseOrder reference', async () => {
    findOwnedDocument.mockResolvedValue({ id: 'ri1', status: 'received', data: {} });

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    expect(result).toEqual({ hasPurchaseOrder: false });
    expect(listDocuments).not.toHaveBeenCalled();
  });

  it('composes the PO, only RECORDED matching receipts, and the invoice into the engine, tolerance included', async () => {
    findOwnedDocument
      .mockResolvedValueOnce({
        id: 'ri1',
        status: 'received',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }] },
      })
      .mockResolvedValueOnce({
        id: 'po1',
        status: 'sent',
        data: { lines: [{ description: 'Widget', quantity: 10, unitPrice: 100 }] },
      });
    listDocuments.mockResolvedValue([
      {
        id: 'gr1',
        status: 'recorded',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantityReceived: 10 }] },
      },
      {
        // A DRAFT receipt against the same PO — must NOT count towards quantityReceived.
        id: 'gr2',
        status: 'draft',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantityReceived: 999 }] },
      },
      {
        // A recorded receipt against a DIFFERENT PO — must not leak in either.
        id: 'gr3',
        status: 'recorded',
        data: { purchaseOrder: 'po-other', lines: [{ description: 'Widget', quantityReceived: 5 }] },
      },
    ]);

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    expect(findOwnedDocument).toHaveBeenNthCalledWith(1, 'c1', 'received-invoice', 'ri1');
    expect(findOwnedDocument).toHaveBeenNthCalledWith(2, 'c1', 'purchase-order', 'po1');
    expect(listDocuments).toHaveBeenCalledWith('c1', 'goods-receipt', expect.any(Number));

    if (!result.hasPurchaseOrder) throw new Error('expected hasPurchaseOrder: true');
    expect(result.purchaseOrderId).toBe('po1');
    expect(result.tolerancePercent).toBe(2);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].quantityReceived).toBe(10); // gr1 only — gr2 (draft) and gr3 (other PO) excluded
    expect(result.overallVerdict).toBe('within-tolerance');
    expect(result.acceptance).toBeNull();
  });

  it('turns a to-review verdict into "accepted" once a stored acceptance exists', async () => {
    findOwnedDocument
      .mockResolvedValueOnce({
        id: 'ri1',
        status: 'received',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantity: 8, unitPrice: 100 }] },
      })
      .mockResolvedValueOnce({
        id: 'po1',
        status: 'sent',
        data: { lines: [{ description: 'Widget', quantity: 5, unitPrice: 100 }] },
      });
    listDocuments.mockResolvedValue([
      {
        id: 'gr1',
        status: 'recorded',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantityReceived: 5 }] },
      },
    ]);
    getVarianceAcceptance.mockReturnValue({
      acceptedByUserId: 'u1',
      acceptedByLabel: 'Jane Doe',
      acceptedAt: '2026-09-15T00:00:00.000Z',
    });

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    if (!result.hasPurchaseOrder) throw new Error('expected hasPurchaseOrder: true');
    // Invoiced (8) vs received (5) is a real variance — the pure engine alone would say "to-review";
    // the acceptance record must turn BOTH the line and the overall verdict into "accepted".
    expect(result.overallVerdict).toBe('accepted');
    expect(result.lines[0].verdict).toBe('accepted');
    expect(result.acceptance?.acceptedByLabel).toBe('Jane Doe');
  });

  it('skips rows with no usable description rather than crashing on malformed data', async () => {
    findOwnedDocument
      .mockResolvedValueOnce({
        id: 'ri1',
        status: 'received',
        data: { purchaseOrder: 'po1', lines: [{ quantity: 10, unitPrice: 100 }, null, 'not-a-row'] },
      })
      .mockResolvedValueOnce({ id: 'po1', status: 'sent', data: { lines: 'not-an-array' } });
    listDocuments.mockResolvedValue([]);

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    if (!result.hasPurchaseOrder) throw new Error('expected hasPurchaseOrder: true');
    expect(result.lines).toEqual([]);
    expect(result.overallVerdict).toBe('within-tolerance');
  });
});
