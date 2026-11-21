/**
 * Runs `digestLegacyInvitationCodes` on every backend boot, the same "detect-first, never throws"
 * contract `webhooks/webhook-secret-migration.service.ts` already holds for its own catch-up: a
 * transient database hiccup must not take the API down, and the worst case is a row that stays in its
 * pre-existing (already-shipped, already-plaintext) state until the next boot.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { digestLegacyInvitationCodes } from './invitation-code-backfill';

@Injectable()
export class InvitationCodeBackfillService implements OnModuleInit {
  private readonly logger = new Logger(InvitationCodeBackfillService.name);

  async onModuleInit(): Promise<void> {
    try {
      const summary = await digestLegacyInvitationCodes(prisma);

      // Only the counts — never a code, a digest or a company name.
      if (summary.migrated > 0) {
        this.logger.warn(`Replaced ${summary.migrated} legacy plaintext invitation code(s) with digests.`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to digest legacy invitation codes at boot — any remaining plaintext code will be ' +
          `retried on a later boot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
