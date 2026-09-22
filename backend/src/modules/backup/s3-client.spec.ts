import { S3Client } from '@aws-sdk/client-s3';

import { buildS3ClientFromEnv } from './s3-client';

const ENV_KEYS = [
  'BACKUP_S3_REGION',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_S3_FORCE_PATH_STYLE',
] as const;

describe('backup/s3-client — buildS3ClientFromEnv', () => {
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

  it('builds a client from BACKUP_S3_* when everything required is set', () => {
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'ak';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'sk';

    const client = buildS3ClientFromEnv('BACKUP_S3');
    expect(client).toBeInstanceOf(S3Client);
    expect(client.config.forcePathStyle).toBe(false);
  });

  it('reads forcePathStyle as a truthy flag ("1" or "true")', () => {
    process.env.BACKUP_S3_REGION = 'us-east-1';
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'ak';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'sk';
    process.env.BACKUP_S3_FORCE_PATH_STYLE = '1';

    expect(buildS3ClientFromEnv('BACKUP_S3').config.forcePathStyle).toBe(true);
  });

  it('fails loud, naming the missing var, rather than silently building a half-configured client', () => {
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'ak';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'sk';
    // BACKUP_S3_REGION left unset.

    expect(() => buildS3ClientFromEnv('BACKUP_S3')).toThrow('"BACKUP_S3_REGION" is not set');
  });

  it('keeps ARCHIVE_S3_* and BACKUP_S3_* fully independent (different env-var families)', () => {
    process.env.BACKUP_S3_REGION = 'eu-west-1';
    process.env.BACKUP_S3_ACCESS_KEY_ID = 'backup-ak';
    process.env.BACKUP_S3_SECRET_ACCESS_KEY = 'backup-sk';
    // No ARCHIVE_S3_* set at all — must not be read by this call.
    expect(() => buildS3ClientFromEnv('BACKUP_S3')).not.toThrow();
  });
});
