import * as persistence from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerGoodsReceiptActions } from './goods-receipt-actions';

jest.mock('../persistence');

/**
 * Purchase orders & goods receipts, second pass (three-way match / rapprochement à 3 voies) — proves
 * the goods receipt's own bespoke handler ("record")
 * plus the two generic ones it wires (`save-draft`/`delete`, generic-actions.ts's own job to prove —
 * not re-proven here, only that this file actually registers them under the right id).
 */
describe('registerGoodsReceiptActions', () => {
  function buildRegistry() {
    const registry = new ActionRegistry();
    registerGoodsReceiptActions(registry);
    return registry;
  }

  it('registers save-draft, record, and delete', () => {
    const registry = buildRegistry();
    expect(registry.resolve('goods-receipt', 'save-draft')).toBeDefined();
    expect(registry.resolve('goods-receipt', 'record')).toBeDefined();
    expect(registry.resolve('goods-receipt', 'delete')).toBeDefined();
  });

  describe('record', () => {
    it('throws for a never-saved record (defensive — availableWhen already refuses this)', async () => {
      const registry = buildRegistry();
      const handler = registry.resolve('goods-receipt', 'record')!;
      await expect(
        handler({ companyId: 'c1', typeId: 'goods-receipt', data: {}, params: {} }),
      ).rejects.toThrow(/has not been saved yet/);
    });

    it('flips the status to "recorded" via a plain status-only write, no data rewrite', async () => {
      const updateDocumentStatus = persistence.updateDocumentStatus as jest.Mock;
      updateDocumentStatus.mockResolvedValue({ id: 'gr1', status: 'recorded' });

      const registry = buildRegistry();
      const handler = registry.resolve('goods-receipt', 'record')!;
      const result = await handler({
        companyId: 'c1',
        typeId: 'goods-receipt',
        documentId: 'gr1',
        data: {},
        params: {},
      });

      expect(updateDocumentStatus).toHaveBeenCalledWith('c1', 'goods-receipt', 'gr1', 'recorded');
      expect(result.changed).toBe(true);
      expect(result.document).toEqual({ id: 'gr1', status: 'recorded' });
    });
  });
});
