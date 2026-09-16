import { NO_FREE_SEAT_CODE } from '@/modules/billing/seat-sync';

import { deleteOrphanedUserAfterSeatRefusal, isNoFreeSeatRefusal } from './seat-refusal-cleanup';

describe('isNoFreeSeatRefusal', () => {
  it('recognizes a NO_FREE_SEAT_CODE refusal shaped like the better-auth APIError markInvitationAsUsed throws', () => {
    expect(isNoFreeSeatRefusal({ body: { code: NO_FREE_SEAT_CODE, message: 'no free seat' } })).toBe(true);
  });

  it('rejects any other error shape, including a plain Error and a differently-coded body', () => {
    expect(isNoFreeSeatRefusal(new Error('boom'))).toBe(false);
    expect(isNoFreeSeatRefusal({ body: { code: 'SOME_OTHER_CODE' } })).toBe(false);
    expect(isNoFreeSeatRefusal({ body: null })).toBe(false);
    expect(isNoFreeSeatRefusal(null)).toBe(false);
    expect(isNoFreeSeatRefusal(undefined)).toBe(false);
    expect(isNoFreeSeatRefusal('plain string')).toBe(false);
  });
});

describe('deleteOrphanedUserAfterSeatRefusal', () => {
  it('deletes the account created before the refusal was known — the bug this closes: a real, company-less account left behind by a refused invitation seat', async () => {
    const deleteUser = jest.fn().mockResolvedValue(undefined);
    const onCleanupFailed = jest.fn();

    await deleteOrphanedUserAfterSeatRefusal('user-1', deleteUser, onCleanupFailed);

    expect(deleteUser).toHaveBeenCalledWith('user-1');
    expect(onCleanupFailed).not.toHaveBeenCalled();
  });

  it('reports a failed cleanup instead of throwing — the seat refusal itself must still reach the caller unshadowed', async () => {
    const cleanupError = new Error('row locked');
    const deleteUser = jest.fn().mockRejectedValue(cleanupError);
    const onCleanupFailed = jest.fn();

    await expect(
      deleteOrphanedUserAfterSeatRefusal('user-1', deleteUser, onCleanupFailed),
    ).resolves.toBeUndefined();

    expect(onCleanupFailed).toHaveBeenCalledWith(cleanupError);
  });
});
