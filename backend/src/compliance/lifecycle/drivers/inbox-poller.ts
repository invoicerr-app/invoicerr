/**
 * InboxPoller — scheduled inbox polling driver (§4).
 *
 * Mirrors the poll/timer driver pattern: `SweepProcessor` (compliance-sweep BullMQ repeatable —
 * QUEUE_IMPL_PLAN.md §4.5/§9 Phase 3; formerly an `@Interval` tick in the now-removed
 * `ComplianceCron`) calls `tick()`, which iterates registered `InboxPort`s, retrieves new
 * messages, and feeds them into `InboundRouter.receive()` for dedup + correlation.
 *
 * Design:
 *   - Ports are swappable (inject `NullInboxPort` when unconfigured → safe offline).
 *   - Dedup is handled by `InboundRouter.receive()` via the (channel, rawRef) pair.
 *   - No lock is needed here: BullMQ dedups the `compliance-sweep` repeatable by its repeat key
 *     across the whole cluster, so only one worker instance ever runs a given tick.
 *   - `tick()` returns a report for observability.
 */

import type { InboxPort, InboxMessage } from './inbox-port';
import type { InboundRouter } from './inbound-router';
import type { InboundDocumentSink } from './inbound-document-sink';
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
  /** InboundRouter for dedup + correlation + signal delivery (status-ping messages). */
  router: InboundRouter;
  /**
   * Sink for full-document messages (`InboxMessage.documentBytes` set) — e.g. KSeF purchase
   * invoices. Optional: when omitted, a port that yields a document-bearing message is a
   * misconfiguration and that message is dropped with a warning + counted as an error (never
   * silently routed through the status-correlation router, which would just come back UNMATCHED).
   */
  documentSink?: InboundDocumentSink;
  log?: ComplianceLogger;
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

export class InboxPoller {
  private readonly ports: InboxPort[];
  private readonly router: InboundRouter;
  private readonly documentSink?: InboundDocumentSink;
  private readonly log: ComplianceLogger;

  constructor(deps: InboxPollerDeps) {
    this.ports = deps.ports;
    this.router = deps.router;
    this.documentSink = deps.documentSink;
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
          // Full-document messages (KSeF purchase invoices, …) bypass the status-correlation
          // router entirely — there is no CallbackRegistration to match against a document we
          // never transmitted. Route to the InboundDocumentSink instead (§ inbound-document-sink.ts).
          if (message.documentBytes) {
            if (!this.documentSink) {
              this.log.warn(
                'inbox-poller',
                `port ${port.id} yielded a full document (${message.messageId}) but no documentSink ` +
                  'is configured — dropped',
              );
              report.errors++;
              continue;
            }
            if (!message.companyId) {
              this.log.warn(
                'inbox-poller',
                `port ${port.id} message ${message.messageId} carries documentBytes but no ` +
                  'companyId — dropped',
              );
              report.errors++;
              continue;
            }

            const sinkResult = await this.documentSink.receive({
              companyId: message.companyId,
              channel: message.channel,
              providerId: message.providerId,
              externalId: message.rawRef ?? message.messageId,
              rawPayload: message.documentBytes.toString('utf-8'),
              syntax: message.syntax,
              senderId: message.senderId,
            });

            if (sinkResult.kind === 'STORED') {
              this.log.info(
                'inbox-poller',
                `stored [${message.channel}] ${message.messageId} → received invoice ${sinkResult.id}`,
              );
              report.routed++;
            } else {
              this.log.info(
                'inbox-poller',
                `duplicate [${message.channel}] ${message.messageId} (received invoice ${sinkResult.id}) dropped`,
              );
              report.duplicates++;
            }
            continue;
          }

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
