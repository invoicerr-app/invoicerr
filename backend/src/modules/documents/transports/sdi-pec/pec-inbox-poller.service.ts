/**
 * Drains ONE company's own "sdi-pec" mailbox — `PecInboxPort.fetchUnseen()`, hand each message to
 * `PecNotificheService.handleMessage()`, then `markSeen()` ONLY after that has actually resolved (a
 * crash mid-drain leaves a message unseen for the NEXT run rather than silently losing it — see
 * `pec-inbox-port.ts`'s own header). No mailbox-agnostic "poll every connected company" loop is built
 * here on purpose: `imapflow-pec-inbox-port.ts` needs real credentials to construct, and this service's
 * OWN job (given a port, drain it) is what stays fully testable without one.
 *
 * NOT YET WIRED to a schedule (a BullMQ repeatable job or `@nestjs/schedule` `@Cron`, the same
 * mechanism `documents-core.module.ts`'s other sweeps use) — that is deliberately left as the next
 * step, not built blind: the right cadence (and whether it should be one job per company or one job
 * fanning out to every company with an active "sdi-pec" config) is an operational decision nobody can
 * make responsibly before a real mailbox has ever been drained even once. `pollOnce()` below is a
 * complete, callable, tested unit ready for whichever caller adds that wiring.
 */
import { Injectable } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { runWithCompanyId } from '@/lib/request-context';

import { PecInboxPort } from './pec-inbox-port';
import { PecNotificheService } from './pec-notifiche.service';

export interface PecInboxPollResult {
  fetched: number;
  handled: number;
}

@Injectable()
export class PecInboxPollerService {
  constructor(private readonly notifiche: PecNotificheService) {}

  /**
   * Drains every unseen message currently in `port`, for `companyId`'s own mailbox. Never throws for
   * ONE message's own failure — the same "a poller must never be taken down by one bad message"
   * contract `PecNotificheService.handleMessage` itself already holds; a genuine infrastructure error
   * from `handleMessage` (the database itself unreachable) is logged and that ONE message is left
   * unseen, but the drain continues with the rest.
   */
  async pollOnce(companyId: string, port: PecInboxPort): Promise<PecInboxPollResult> {
    // Wrapped in `runWithCompanyId` — not yet wired to a schedule (see this file's own header), but its
    // one caller-to-be has no request context either; self-scoping here means `PecNotificheService.
    // handleMessage`'s own `Log` writes (journaled notifiche, unknown NomeFile) are correct the moment
    // it is.
    return runWithCompanyId(companyId, async () => {
      const messages = await port.fetchUnseen();
      let handled = 0;
      for (const message of messages) {
        try {
          const result = await this.notifiche.handleMessage(companyId, message);
          if (result.handled) handled += 1;
          await port.markSeen(message.id);
        } catch (error) {
          logger.error('SdI PEC inbox poll: failed to process one message — left unseen for the next poll', {
            category: 'documents',
            details: {
              companyId,
              messageId: message.id,
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      return { fetched: messages.length, handled };
    });
  }
}
