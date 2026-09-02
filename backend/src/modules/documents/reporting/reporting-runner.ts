/**
 * The Prisma-touching half of the declarative-reporting mechanism — resolves a provider, rebuilds the
 * `DeclaredInvoice` (never trusting anything cached at enqueue time — the same "resolve fresh, every
 * time" discipline `conformity/conformity-sweep-runner.ts#runPoll` and
 * `schedules/schedule-sweep-runner.ts#runOccurrence` already hold), calls it, and journals the result
 * into the EXISTING `DocumentAuthorityEvent` table (`conformity/authority-events.persistence.ts`) —
 * reused verbatim, not reimplemented: a declaration IS an authority event (NAV's transactionId,
 * myDATA's MARK), so it belongs in the exact same append-only journal a conformity poll result does,
 * visible in the SAME timeline (`GET /documents/:id/authority-events`), under a DIFFERENT
 * `providerId` ("nav"/"mydata" rather than "pdp"/"ksef"/…) — see this task's own architecture note:
 * declaring is not delivering, but it IS conformity-shaped.
 *
 * Consumed by `queue/processors/document-action.processor.ts`, exactly one more `job.name` branch on
 * the SAME `Q_DOCUMENT_ACTION` queue (`report-job.ts`'s own header).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { createAuthorityEvents, journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { ChannelNotConnectedError } from '../conformity/authority-status-poller';
import { DeclarationProviderRegistry, DeclarationResult } from './declaration-provider';
import { buildDeclaredInvoice } from './build-declared-invoice';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { findOwnedDocument } from '../persistence';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { REPORT_BLOCKED_STATUS_CODE, REPORT_FAILED_STATUS_CODE, ReportJobData } from './report-job';

export class InvalidDeclarationResultError extends Error {}

/**
 * The hard contract this whole mechanism refuses to relax: a journaled declaration success must
 * carry a REAL, non-empty authority identifier — never an empty string, never `undefined` coerced to
 * a truthy-looking placeholder. Throws (never returns a verdict) so a provider bug that would
 * otherwise journal a hollow "success" is treated exactly like any other unexpected failure — left
 * to propagate, retried by BullMQ, and eventually recorded as `report:failed` if it never resolves
 * (see `runReport`'s own header) — NEVER silently accepted as a real declaration.
 */
export function assertNonEmptyDeclarationResult(result: DeclarationResult, providerId: string): void {
  if (!result.statusCode?.trim()) {
    throw new InvalidDeclarationResultError(
      `Declaration provider "${providerId}" returned an empty statusCode — refusing to journal it.`,
    );
  }
  if (!result.authorityId?.trim()) {
    throw new InvalidDeclarationResultError(
      `Declaration provider "${providerId}" returned an empty authorityId (transactionId/MARK) — ` +
        'refusing to journal it.',
    );
  }
}

@Injectable()
export class ReportingRunner {
  private readonly logger = new Logger(ReportingRunner.name);

  constructor(
    private readonly providerRegistry: DeclarationProviderRegistry,
    private readonly typeRegistry: DocumentTypeRegistry,
    // TODO_PRODUIT.md T1 / PLAN-V2 R8 — `@Optional()` for the same reason
    // `ConformitySweepRunner`'s own `eventsPublisher` is: a SIDE CHANNEL, never load-bearing for a
    // declaration's own correctness, so every EXISTING spec constructing this runner with two args
    // keeps passing unchanged. Production wiring resolves this automatically (`@Global()`
    // `DocumentQueueModule`) — no factory change needed in `documents-core.module.ts`.
    @Optional() private readonly eventsPublisher?: DocumentEventsPublisher,
  ) {}

  /**
   * Runs ONE declaration attempt. Returns normally (never throws) for the two outcomes this
   * mechanism considers "handled": a real success (journaled), or a missing/invalid credential
   * (`report:blocked`, journaled, NEVER retried — see `report-job.ts`'s own header). Any OTHER
   * failure PROPAGATES — deliberately, unlike `ConformitySweepRunner.runPoll` (which never throws at
   * all): this is a ONE-SHOT job, not a recurring sweep, so BullMQ's own `attempts`/backoff
   * (`DocumentQueueDispatcher.enqueueReport`) is the genuine retry mechanism, exactly like an
   * ordinary "send" action job. Only once every retry is exhausted does
   * `recordTerminalFailure` (called from the processor's own `onFailed`, mirroring
   * `mark-send-failed.ts`) journal `report:failed`.
   */
  async runReport(data: ReportJobData): Promise<{ journaled: number }> {
    const provider = this.providerRegistry.resolve(data.providerId);
    if (!provider) {
      // Defensive only — `report-on-send.ts` only ever enqueues a provider id a
      // `reporting/data/*.json` fact named, and the registry is built from that same set in
      // production. Loud, never a silent no-op.
      this.logger.warn(`No declaration provider registered for "${data.providerId}" — nothing declared.`);
      return { journaled: 0 };
    }

    const document = await findOwnedDocument(data.companyId, data.typeId, data.documentId);
    const descriptor = this.typeRegistry.resolve(data.typeId);

    const clientId =
      typeof document.data === 'object' && document.data !== null
        ? (document.data as Record<string, unknown>).client
        : undefined;

    const [company, client] = await Promise.all([
      prisma.company.findUniqueOrThrow({
        where: { id: data.companyId },
        include: { partyIdentifiers: true },
      }),
      typeof clientId === 'string' && clientId
        ? prisma.client.findUniqueOrThrow({ where: { id: clientId }, include: { partyIdentifiers: true } })
        : Promise.resolve(undefined),
    ]);

    const declaredInvoice = buildDeclaredInvoice(
      data.typeId,
      descriptor,
      document,
      companyToFormatParty(company),
      client
        ? clientToFormatParty(client)
        : // No buyer on file at all (unreachable for a genuinely SENT invoice — every shipped type
          // requires a client to reach "sent" — but never trusted blind): an empty party rather than
          // a crash, so a genuine platform-side rejection ("buyer identity missing") is what surfaces,
          // named, rather than a bare TypeError here.
          {
            name: '',
            address: '',
            addressLine2: null,
            city: '',
            postalCode: '',
            country: null,
            partyIdentifiers: [],
          },
    );

    let result: DeclarationResult;
    try {
      result = await provider.declare(data.companyId, declaredInvoice);
    } catch (error) {
      if (error instanceof ChannelNotConnectedError) {
        const message = error.message;
        this.logger.warn(
          `Declaration for document ${data.documentId} ("${data.providerId}") blocked: ${message}`,
        );
        const journaled = await journalSyntheticEvent(
          data.companyId,
          data.documentId,
          data.providerId,
          REPORT_BLOCKED_STATUS_CODE,
          message,
        );
        // TODO_PRODUIT.md T1 / PLAN-V2 R8 — only on a genuinely new row (journaled > 0): a
        // 'report:blocked' verdict is exactly as conformity-panel-worthy as a real declaration.
        if (journaled > 0) {
          await this.eventsPublisher?.publish(data.companyId, {
            documentId: data.documentId,
            typeId: data.typeId,
            kind: 'authority-event',
          });
        }
        return { journaled };
      }
      // Any other failure propagates — see this method's own header.
      throw error;
    }

    assertNonEmptyDeclarationResult(result, data.providerId);

    const journaled = await createAuthorityEvents(data.companyId, data.documentId, data.providerId, [result]);
    this.logger.log(
      `Declaration for document ${data.documentId} ("${data.providerId}") journaled: ` +
        `statusCode="${result.statusCode}", authorityId="${result.authorityId}".`,
    );
    // Same "only on a genuinely new row" rule as the "blocked" branch above.
    if (journaled > 0) {
      await this.eventsPublisher?.publish(data.companyId, {
        documentId: data.documentId,
        typeId: data.typeId,
        kind: 'authority-event',
      });
    }
    return { journaled };
  }

  /**
   * Called ONCE, from `queue/processors/document-action.processor.ts`'s own `onFailed` hook, after
   * BullMQ has exhausted every retry for a report job whose `runReport` attempt(s) threw something
   * other than `ChannelNotConnectedError` (that case is already handled, immediately, inside
   * `runReport` itself — it never reaches here). NEVER throws — the exact same "belt and suspenders"
   * discipline `archive/archive-on-send.ts`'s own compensating write and
   * `conformity/conformity-sweep-runner.ts#runPoll`'s own fallback journal both hold: whatever went
   * wrong already happened (every retry is genuinely spent), and recording THAT fact must never
   * itself crash the worker process.
   */
  async recordTerminalFailure(data: ReportJobData, error: Error): Promise<void> {
    try {
      const journaled = await journalSyntheticEvent(
        data.companyId,
        data.documentId,
        data.providerId,
        REPORT_FAILED_STATUS_CODE,
        error.message,
      );
      // TODO_PRODUIT.md T1 / PLAN-V2 R8 — same "only on a genuinely new row" rule as `runReport`'s own
      // two publish points above: 'report:failed' is a terminal conformity-panel-worthy verdict too.
      if (journaled > 0) {
        await this.eventsPublisher?.publish(data.companyId, {
          documentId: data.documentId,
          typeId: data.typeId,
          kind: 'authority-event',
        });
      }
      this.logger.error(
        `Declaration for document ${data.documentId} ("${data.providerId}") failed permanently after ` +
          `every retry: ${error.message}`,
      );
    } catch (journalError) {
      this.logger.error(
        `Could not even journal report:failed for document ${data.documentId} ("${data.providerId}") — ` +
          `original failure: ${error.message}; journaling failure: ` +
          `${journalError instanceof Error ? journalError.message : String(journalError)}`,
      );
    }
  }
}
