import { ConflictException } from '@nestjs/common';

import * as persistence from '../persistence';
import { ActionRegistry } from './action-registry';
import { registerGoodsReceiptActions } from './goods-receipt-actions';

jest.mock('../persistence');

/**
 * Purchase orders & goods receipts, second pass (three-way match) — proves
 * the goods receipt's own bespoke handler ("record")
 * plus the two generic ones it wires (`save-draft`/`delete`, generic-actions.ts's own job to prove —
 * not re-proven here, only that this file actually registers them under the right id).
 */
describe('registerGoodsReceiptActions', () => {
  // The mocked `persistence` module's `jest.fn()`s otherwise accumulate call counts ACROSS tests in
  // this file (no `clearMocks`/`resetMocks` in the jest config) — the concurrency test below counts
  // calls, so a leftover call from an earlier test would read as a phantom duplicate write.
  afterEach(() => jest.resetAllMocks());

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

      expect(updateDocumentStatus).toHaveBeenCalledWith(
        'c1',
        'goods-receipt',
        'gr1',
        'recorded',
        null,
        undefined,
        undefined,
        ['draft'],
      );
      expect(result.changed).toBe(true);
      expect(result.document).toEqual({ id: 'gr1', status: 'recorded' });
    });

    it('two concurrent "record" calls on the same draft: the loser gets the 409 persistence.ts raises on a lost compare-and-swap', async () => {
      let calls = 0;
      (persistence.updateDocumentStatus as jest.Mock).mockImplementation(async () => {
        calls += 1;
        if (calls === 1) return { id: 'gr1', status: 'recorded' };
        throw new ConflictException('Document "gr1" is no longer in one of the expected statuses.');
      });

      const registry = buildRegistry();
      const handler = registry.resolve('goods-receipt', 'record')!;
      const call = () =>
        handler({ companyId: 'c1', typeId: 'goods-receipt', documentId: 'gr1', data: {}, params: {} });

      const results = await Promise.allSettled([call(), call()]);

      // Which of the two literally wins is a scheduling detail — what matters is that EXACTLY one
      // does, never both and never neither.
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(persistence.updateDocumentStatus).toHaveBeenCalledTimes(2);
    });
  });
});
