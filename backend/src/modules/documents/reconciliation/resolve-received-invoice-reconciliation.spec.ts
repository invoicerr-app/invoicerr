import { vi, type Mock } from 'vitest';

import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
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
  const listAllDocuments = persistence.listAllDocuments as Mock;

  /** Hands the code under test only the rows the QUERY would have returned. The client/status/type
   *  narrowing moved into SQL when the read stopped being capped, so a mock returning a fixture
   *  verbatim would feed it rows production never sees. Fixtures here stay small on purpose — they
   *  prove the rules around the read; the cap-crossing fixtures live in `*.read-cap.spec.ts`. */
  function seedDocuments(rows: DocumentInstanceResult[]): void {
    listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
      filterLikeListAllDocuments(rows, options),
    );
  }

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
    expect(listAllDocuments).not.toHaveBeenCalled();
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
    seedDocuments([
      {
        id: 'gr1',
        typeId: 'goods-receipt',
        status: 'recorded',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantityReceived: 10 }] },
      },
      {
        // A DRAFT receipt against the same PO — must NOT count towards quantityReceived.
        id: 'gr2',
        typeId: 'goods-receipt',
        status: 'draft',
        data: { purchaseOrder: 'po1', lines: [{ description: 'Widget', quantityReceived: 999 }] },
      },
      {
        // A recorded receipt against a DIFFERENT PO — must not leak in either.
        id: 'gr3',
        typeId: 'goods-receipt',
        status: 'recorded',
        data: { purchaseOrder: 'po-other', lines: [{ description: 'Widget', quantityReceived: 5 }] },
      },
    ]);

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    expect(findOwnedDocument).toHaveBeenNthCalledWith(1, 'c1', 'received-invoice', 'ri1');
    expect(findOwnedDocument).toHaveBeenNthCalledWith(2, 'c1', 'purchase-order', 'po1');
    // Both narrowing conditions are in the QUERY now, so the fixture's draft receipt and its
    // other-PO receipt are excluded before a single row reaches this function.
    expect(listAllDocuments).toHaveBeenCalledWith('c1', {
      typeId: 'goods-receipt',
      status: ['recorded'],
      dataEquals: { purchaseOrder: 'po1' },
    });

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
    seedDocuments([
      {
        id: 'gr1',
        typeId: 'goods-receipt',
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
    seedDocuments([]);

    const result = await resolveReceivedInvoiceReconciliation('c1', 'ri1');

    if (!result.hasPurchaseOrder) throw new Error('expected hasPurchaseOrder: true');
    expect(result.lines).toEqual([]);
    expect(result.overallVerdict).toBe('within-tolerance');
  });
});
