/**
 * InboxPoller — scheduled inbox polling driver (§4).
 *
 * Mirrors the poll/timer driver pattern: an `@Interval` tick in `ComplianceCron`
 * calls `tick()`, which iterates registered `InboxPort`s, retrieves new messages,
 * and feeds them into `InboundRouter.receive()` for dedup + correlation.
 *
 * Design:
 *   - Ports are swappable (inject `NullInboxPort` when unconfigured → safe offline).
 *   - Dedup is handled by `InboundRouter.receive()` via the (channel, rawRef) pair.
 *   - No cron-lock is acquired here; the caller (`ComplianceCron`) applies it.
 *   - `tick()` returns a report for observability.
 */

import type { InboxPort, InboxMessage } from './inbox-port';
import type { InboundRouter } from './inbound-router';
import type { ComplianceLogger } from '../../execution/logger';
import { defaultLogger } from '../../execution/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InboxPollReport {
  /** Total messages polled across all ports. */
  fetched: number;
  /** Messages successfully routed (or deduplicated) by the InboundRouter. */
  routed: number;
  /** Messages that could not be matched to a waiting registration. */
  unmatched: number;
  /** Duplicate messages dropped. */
  duplicates: number;
  /** Messages that caused an error during routing. */
  errors: number;
}

export interface InboxPollerDeps {
  /** The inbox transports to poll. Inject [NullInboxPort] to disable polling. */
  ports: InboxPort[];
  /** InboundRouter for dedup + correlation + signal delivery. */
  router: InboundRouter;
  log?: ComplianceLogger;
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

export class InboxPoller {
  private readonly ports: InboxPort[];
  private readonly router: InboundRouter;
  private readonly log: ComplianceLogger;

  constructor(deps: InboxPollerDeps) {
    this.ports = deps.ports;
    this.router = deps.router;
    this.log = deps.log ?? defaultLogger;
  }

  /**
   * Run one poll cycle across all registered inbox ports.
   * Safe to call when no ports are configured (returns an empty report).
   */
  async tick(): Promise<InboxPollReport> {
    const report: InboxPollReport = { fetched: 0, routed: 0, unmatched: 0, duplicates: 0, errors: 0 };

    if (this.ports.length === 0) {
      return report;
    }

    for (const port of this.ports) {
      let messages: InboxMessage[];
      try {
        messages = await port.poll();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn('inbox-poller', `poll error on port ${port.id}: ${msg}`);
        report.errors++;
        continue;
      }

      this.log.info('inbox-poller', `port ${port.id}: fetched ${messages.length} message(s)`);
      report.fetched += messages.length;

      for (const message of messages) {
        try {
          const result = await this.router.receive({
            channel: message.channel,
            correlationKey: message.correlationKey,
            status: message.status,
            rawRef: message.rawRef ?? message.messageId,
          });

          switch (result.kind) {
            case 'ROUTED':
              this.log.info(
                'inbox-poller',
                `routed [${message.channel}] ${message.messageId} → document ${result.documentId}`,
              );
              report.routed++;
              break;
            case 'DUPLICATE':
              this.log.info('inbox-poller', `duplicate [${message.channel}] ${message.messageId} dropped`);
              report.duplicates++;
              break;
            case 'UNMATCHED':
              this.log.warn(
                'inbox-poller',
                `unmatched [${message.channel}] ${message.messageId} (correlationKey=${message.correlationKey})`,
              );
              report.unmatched++;
              break;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.warn('inbox-poller', `routing error for message ${message.messageId}: ${msg}`);
          report.errors++;
        }
      }
    }

    return report;
  }
}
