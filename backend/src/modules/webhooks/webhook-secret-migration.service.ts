/**
 * Runs `migratePlaintextWebhookSecrets` on EVERY backend boot — modeled directly on
 * `documents/country-policy/boot-reseed.service.ts` (same `OnModuleInit` shape, same "NEVER throws"
 * choice, same detect-first idempotence). Registered in `webhooks.module.ts`, which both `app.module.ts`
 * (API) and `worker.module.ts` import — so a scaled-out worker replica converges the table too, not
 * just the inline API process (see that file's own header on why this can't be branched on role).
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
      // NEVER throws — same reasoning as every other boot-reseed service in this codebase: a
      // transient DB hiccup here must not crash the whole app. Worst case, a row stays plaintext (its
      // pre-existing, already-shipped state) until this succeeds on a later boot — never a REGRESSION
      // relative to before this migration existed.
      this.logger.error(
        'Failed to run the webhook-secret encryption catch-up at boot — some secrets may remain ' +
          `plaintext until this succeeds on a later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
