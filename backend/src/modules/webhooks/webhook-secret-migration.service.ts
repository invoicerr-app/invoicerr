/**
 * Runs the plaintext-secret catch-up on every backend boot, from both the API and worker modules, so
 * every replica converges the table. Never throws.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { migratePlaintextWebhookSecrets } from './webhook-secret-migration';

@Injectable()
export class WebhookSecretMigrationService implements OnModuleInit {
  private readonly logger = new Logger(WebhookSecretMigrationService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await migratePlaintextWebhookSecrets(prisma);

      if (summary.migrated > 0) {
        this.logger.warn(`Encrypted ${summary.migrated} legacy plaintext webhook secret(s) at boot.`);
      }

      if (summary.skippedNoKey > 0) {
        this.logger.warn(
          `${summary.skippedNoKey} webhook secret(s) remain plaintext — CREDENTIALS_ENCRYPTION_KEY is ` +
            'not configured on this instance. They will be encrypted automatically the next time this ' +
            'process boots with a key set.',
        );
      }
    } catch (error) {
      // Never throw: a transient DB error must not crash the app, and a row simply stays plaintext
      // until a later boot succeeds.
      this.logger.error(
        'Failed to run the webhook-secret encryption catch-up at boot — some secrets may remain ' +
          `plaintext until this succeeds on a later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
