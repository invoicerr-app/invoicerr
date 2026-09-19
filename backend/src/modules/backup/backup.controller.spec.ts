import { vi } from 'vitest';

import { BackupController } from './backup.controller';
import { BackupStatusService, BackupStatusView } from './backup-status.service';

describe('backup/BackupController', () => {
  it('delegates GET /backup/status straight to BackupStatusService', async () => {
    const view: BackupStatusView = { schedule: '0 3 * * *', lastRun: null, nextRunAt: null };
    const status = { getStatus: vi.fn().mockResolvedValue(view) } as unknown as BackupStatusService;

    const result = await new BackupController(status).getStatus();

    expect(status.getStatus).toHaveBeenCalledTimes(1);
    expect(result).toBe(view);
  });
});
