/**
 * Catch-up migration — upgrades every `Webhook.secret` still sitting in the clear (any row
 * written before this module started encrypting secrets at rest, or written while
 * `CREDENTIALS_ENCRYPTION_KEY` was unset — see `webhooks.service.ts#encryptSecretForStorage`'s own
 * header) to the same AES-256-GCM blob every other integration credential in this codebase already
 * uses (`utils/secret-crypto.ts#encryptJson`).
 *
 * Idempotent by construction, the same "detect-first" discipline `country-policy/boot-reseed.ts`
 * already established for a different table: `isEncryptedWebhookSecret` recognizes a row already in
 * the new format (migrated on a previous boot, or written post-fix by `WebhooksService` itself) and
 * skips it untouched — safe to run on EVERY boot, forever, at the cost of one read when there is
 * nothing left to do.
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

/** The only two Prisma calls this migration needs — kept minimal so a unit test can supply an
 *  in-memory fake instead of pulling in the whole generated client. */
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
    // An empty string is Prisma's own "not null" for a webhook created with no secret at all
    // (`WebhooksService.create`'s `body.secret ?? ''`) — nothing to encrypt, and encrypting it anyway
    // would turn every secret-less webhook into an unnecessary write on every boot until the key
    // exists, for a value that carries no confidentiality to begin with.
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
