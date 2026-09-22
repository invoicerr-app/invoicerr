import { backupS3Bucket, backupS3Prefix, isBackupEnabled, readBackupScheduleCron } from './backup.constants';

const ENV_KEYS = ['BACKUP_S3_BUCKET', 'BACKUP_S3_PREFIX', 'BACKUP_S3_SCHEDULE'] as const;

describe('backup.constants', () => {
  const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('backupS3Bucket / isBackupEnabled', () => {
    it('is undefined/disabled with no BACKUP_S3_BUCKET set', () => {
      expect(backupS3Bucket()).toBeUndefined();
      expect(isBackupEnabled()).toBe(false);
    });

    it('is enabled the moment BACKUP_S3_BUCKET is set', () => {
      process.env.BACKUP_S3_BUCKET = 'my-backup-bucket';
      expect(backupS3Bucket()).toBe('my-backup-bucket');
      expect(isBackupEnabled()).toBe(true);
    });

    it('treats an empty string the same as unset (disabled)', () => {
      process.env.BACKUP_S3_BUCKET = '';
      expect(backupS3Bucket()).toBeUndefined();
      expect(isBackupEnabled()).toBe(false);
    });
  });

  describe('backupS3Prefix', () => {
    it('defaults to an empty string, never undefined', () => {
      expect(backupS3Prefix()).toBe('');
    });

    it('strips exactly one trailing slash', () => {
      process.env.BACKUP_S3_PREFIX = 'instance-1/';
      expect(backupS3Prefix()).toBe('instance-1');
    });

    it('leaves a prefix with no trailing slash untouched', () => {
      process.env.BACKUP_S3_PREFIX = 'instance-1';
      expect(backupS3Prefix()).toBe('instance-1');
    });
  });

  describe('readBackupScheduleCron', () => {
    it('defaults to daily at 03:00', () => {
      expect(readBackupScheduleCron()).toBe('0 3 * * *');
    });

    it('honours an explicit BACKUP_S3_SCHEDULE', () => {
      process.env.BACKUP_S3_SCHEDULE = '0 */6 * * *';
      expect(readBackupScheduleCron()).toBe('0 */6 * * *');
    });
  });
});
