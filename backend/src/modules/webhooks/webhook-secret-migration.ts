/**
 * Boot catch-up: encrypts every `Webhook.secret` still in the clear with the same AES-256-GCM blob as
 * the other integration credentials. Idempotent: rows already in the new format are recognised and
 * skipped, so it is safe on every boot.
 */
import { encryptJson, isEncryptionAvailable } from '@/utils/secret-crypto';

import { isEncryptedWebhookSecret } from './webhook-secret-format';

export interface WebhookSecretMigrationSummary {
  /** Rows that carried a non-empty secret at all (encrypted or not). */
  scanned: number;
  /** Rows rewritten from plaintext to an encrypted blob this run. */
  migrated: number;
  /** Rows still plaintext because no encryption key was available to migrate them with. */
  skippedNoKey: number;
}

interface WebhookSecretRow {
  id: string;
  secret: string | null;
}

/** The only two Prisma calls this needs, so a unit test can supply an in-memory fake. */
export interface WebhookSecretMigrationPrisma {
  webhook: {
    findMany(args: {
      where: { secret: { not: null } };
      select: { id: true; secret: true };
    }): Promise<WebhookSecretRow[]>;
    update(args: { where: { id: string }; data: { secret: string } }): Promise<unknown>;
  };
}

export async function migratePlaintextWebhookSecrets(
  prisma: WebhookSecretMigrationPrisma,
): Promise<WebhookSecretMigrationSummary> {
  const rows = await prisma.webhook.findMany({
    where: { secret: { not: null } },
    select: { id: true, secret: true },
  });

  const summary: WebhookSecretMigrationSummary = { scanned: 0, migrated: 0, skippedNoKey: 0 };

  for (const row of rows) {
    // Empty string is how a secret-less webhook is stored: nothing to encrypt, and rewriting it would
    // cost a write on every boot.
    if (!row.secret) continue;
    summary.scanned++;

    if (isEncryptedWebhookSecret(row.secret)) continue; // already migrated — the common case after boot 1

    if (!isEncryptionAvailable()) {
      summary.skippedNoKey++;
      continue;
    }

    await prisma.webhook.update({ where: { id: row.id }, data: { secret: encryptJson(row.secret) } });
    summary.migrated++;
  }

  return summary;
}
