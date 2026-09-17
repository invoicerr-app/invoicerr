process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { decryptJson, encryptJson } from '@/utils/secret-crypto';

import { migratePlaintextWebhookSecrets, WebhookSecretMigrationPrisma } from './webhook-secret-migration';

function fakePrisma(rows: { id: string; secret: string | null }[]): {
  prisma: WebhookSecretMigrationPrisma;
  updates: Map<string, string>;
} {
  const updates = new Map<string, string>();
  const prisma: WebhookSecretMigrationPrisma = {
    webhook: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn(async ({ where, data }) => {
        updates.set(where.id, data.secret);
      }),
    },
  };
  return { prisma, updates };
}

describe('migratePlaintextWebhookSecrets — boot catch-up', () => {
  const previousKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

  afterEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = previousKey;
  });

  it('encrypts a legacy plaintext secret in place', async () => {
    const { prisma, updates } = fakePrisma([{ id: 'wh-1', secret: 'legacy-hmac-secret' }]);

    const summary = await migratePlaintextWebhookSecrets(prisma);

    expect(summary).toEqual({ scanned: 1, migrated: 1, skippedNoKey: 0 });
    const stored = updates.get('wh-1');
    expect(stored).toBeDefined();
    expect(stored).not.toBe('legacy-hmac-secret'); // no longer the raw value
    expect(decryptJson<string>(stored as string)).toBe('legacy-hmac-secret'); // round-trips back to it
  });

  it('is idempotent: a row already encrypted is left untouched on a second run', async () => {
    const alreadyEncrypted = encryptJson('already-safe');
    const { prisma, updates } = fakePrisma([{ id: 'wh-2', secret: alreadyEncrypted }]);

    const summary = await migratePlaintextWebhookSecrets(prisma);

    expect(summary).toEqual({ scanned: 1, migrated: 0, skippedNoKey: 0 });
    expect(updates.size).toBe(0);
    expect(prisma.webhook.update).not.toHaveBeenCalled();
  });

  it('skips a webhook with no secret at all (empty string) without counting or writing it', async () => {
    const { prisma, updates } = fakePrisma([{ id: 'wh-3', secret: '' }]);

    const summary = await migratePlaintextWebhookSecrets(prisma);

    expect(summary).toEqual({ scanned: 0, migrated: 0, skippedNoKey: 0 });
    expect(updates.size).toBe(0);
  });

  it('reports skippedNoKey and leaves the value plaintext when no encryption key is configured', async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    const { prisma, updates } = fakePrisma([{ id: 'wh-4', secret: 'still-plaintext' }]);

    const summary = await migratePlaintextWebhookSecrets(prisma);

    expect(summary).toEqual({ scanned: 1, migrated: 0, skippedNoKey: 1 });
    expect(updates.size).toBe(0);
  });

  it('handles a mixed batch: migrates the plaintext row, leaves the already-encrypted one alone', async () => {
    const alreadyEncrypted = encryptJson('other-secret');
    const { prisma, updates } = fakePrisma([
      { id: 'wh-plain', secret: 'plain-one' },
      { id: 'wh-enc', secret: alreadyEncrypted },
      { id: 'wh-none', secret: null },
    ]);

    const summary = await migratePlaintextWebhookSecrets(prisma);

    expect(summary).toEqual({ scanned: 2, migrated: 1, skippedNoKey: 0 });
    expect(updates.has('wh-plain')).toBe(true);
    expect(updates.has('wh-enc')).toBe(false);
    expect(decryptJson<string>(updates.get('wh-plain') as string)).toBe('plain-one');
  });
});
