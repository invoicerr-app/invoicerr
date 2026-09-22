import { vi } from 'vitest';

import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

describe('TransferController — delegation', () => {
  it('initiates against the active company and the caller identity, never a body-supplied one', async () => {
    const initiateTransfer = vi.fn().mockResolvedValue({ message: 'ok' });
    const controller = new TransferController({ initiateTransfer } as unknown as TransferService);
    const user = { id: 'owner-1', email: 'owner@example.com' };

    await controller.initiate('company-1', user as never, { email: 'target@example.com', otp: '12345678' });

    expect(initiateTransfer).toHaveBeenCalledWith('company-1', user, 'target@example.com', '12345678');
  });

  it('reads the current transfer for the active company', async () => {
    const getCurrentTransfer = vi.fn().mockResolvedValue(null);
    const controller = new TransferController({ getCurrentTransfer } as unknown as TransferService);

    const result = await controller.current('company-1');

    expect(getCurrentTransfer).toHaveBeenCalledWith('company-1');
    expect(result).toBeNull();
  });

  it('cancels scoped to the active company', async () => {
    const cancelTransfer = vi.fn().mockResolvedValue({ success: true });
    const controller = new TransferController({ cancelTransfer } as unknown as TransferService);

    await controller.cancel('company-1', 'transfer-1');

    expect(cancelTransfer).toHaveBeenCalledWith('company-1', 'transfer-1');
  });
});
