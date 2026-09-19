import { vi, type Mock } from 'vitest';
import * as storage from './storage';
import { ArchiveStorageSharingBootCheckService } from './storage-sharing-boot-check.service';

vi.mock('./storage');

/**
 * THE MUTATION TARGET: `checkArchiveStorageSharing` (storage.ts) existed but was never actually
 * called anywhere in a real boot sequence — a split API/worker deployment with a misconfigured
 * `DOCUMENTS_ARCHIVE_DIR` would only ever discover the problem the first time someone ran a real
 * archive-integrity verification, long after the fact. These tests prove this boot-time service
 * actually calls the check with the right role, logs a warning (never throws, never blocks boot)
 * when the check reports `shared: false`, and stays quiet-but-logged on a genuine success.
 */
describe('ArchiveStorageSharingBootCheckService', () => {
  const originalRole = process.env.ROLE;

  afterEach(() => {
    vi.resetAllMocks();
    if (originalRole === undefined) delete process.env.ROLE;
    else process.env.ROLE = originalRole;
  });

  it('defaults to role "api" when ROLE is unset — mirrors entrypoint.sh\'s own default', () => {
    delete process.env.ROLE;
    (storage.checkArchiveStorageSharing as Mock).mockReturnValue({ shared: true, reason: 'ok' });
    const service = new ArchiveStorageSharingBootCheckService();

    expect(() => service.onModuleInit()).not.toThrow();

    expect(storage.checkArchiveStorageSharing).toHaveBeenCalledWith('api');
  });

  it('reads ROLE=worker and passes it straight through', () => {
    process.env.ROLE = 'worker';
    (storage.checkArchiveStorageSharing as Mock).mockReturnValue({ shared: true, reason: 'ok' });
    const service = new ArchiveStorageSharingBootCheckService();

    service.onModuleInit();

    expect(storage.checkArchiveStorageSharing).toHaveBeenCalledWith('worker');
  });

  it('a shared:false result never throws — logged as a warning, boot proceeds regardless', () => {
    (storage.checkArchiveStorageSharing as Mock).mockReturnValue({
      shared: false,
      reason: 'DOCUMENTS_ARCHIVE_DIR is not writable by this "api" process',
    });
    const service = new ArchiveStorageSharingBootCheckService();

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('the underlying check itself throwing is swallowed too — a boot-time check must never take the process down', () => {
    (storage.checkArchiveStorageSharing as Mock).mockImplementation(() => {
      throw new Error('unexpected filesystem explosion');
    });
    const service = new ArchiveStorageSharingBootCheckService();

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('a shared:true result resolves cleanly, without throwing', () => {
    (storage.checkArchiveStorageSharing as Mock).mockReturnValue({
      shared: true,
      reason: 'Confirmed readable from this role too: .archive-storage-witness-worker.json.',
    });
    const service = new ArchiveStorageSharingBootCheckService();

    expect(() => service.onModuleInit()).not.toThrow();
  });
});
