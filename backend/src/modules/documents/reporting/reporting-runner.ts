/**
 * The Prisma-touching half of the declarative-reporting mechanism — resolves a provider, rebuilds the
 * `DeclaredInvoice` (never trusting anything cached at enqueue time — the same "resolve fresh, every
 * time" discipline `conformity/conformity-sweep-runner.ts#runPoll` and
 * `schedules/schedule-sweep-runner.ts#runOccurrence` already hold), calls it, and journals the result
 * into the EXISTING `DocumentAuthorityEvent` table (`conformity/authority-events.persistence.ts`) —
 * reused verbatim, not reimplemented: a declaration IS an authority event (NAV's transactionId,
 * myDATA's MARK), so it belongs in the exact same append-only journal a conformity poll result does,
 * visible in the SAME timeline (`GET /documents/:id/authority-events`), under a DIFFERENT
 * `providerId` ("nav"/"mydata" rather than "pdp"/"ksef"/…) — the architecture note being:
 * declaring is not delivering, but it IS conformity-shaped.
 *
 * Consumed by `queue/processors/document-action.processor.ts`, exactly one more `job.name` branch on
 * the SAME `Q_DOCUMENT_ACTION` queue (`report-job.ts`'s own header).
 */
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { createAuthorityEvents, journalSyntheticEvent } from '../conformity/authority-events.persistence';
import { ChannelNotConnectedError } from '../conformity/authority-status-poller';
import { DeclarationProviderRegistry, DeclarationResult, DeclaredInvoice } from './declaration-provider';
import { buildDeclaredInvoice, UndeclarableDocumentError } from './build-declared-invoice';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { resolveCreditNoteFormatSource } from '../formats/credit-note-source';
import { clientToFormatParty, companyToFormatParty } from '../formats/party-snapshot';
import { findOwnedDocument } from '../persistence';
import { dispatchDocumentAuthorityEventWebhook } from '../queue/document-authority-webhook';
import { DocumentWebhookEmitter } from '../queue/document-webhooks';
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
    // `@Optional()` for the same reason
    // `ConformitySweepRunner`'s own `eventsPublisher` is: a SIDE CHANNEL, never load-bearing for a
    // declaration's own correctness, so every EXISTING spec constructing this runner with two args
    // keeps passing unchanged. Production wiring is a MANUAL `useFactory` (`documents-core.module.ts`)
    // rather than a plain class provider (unlike `ConformitySweepRunner`) — this constructor's own
    // `@Optional()` decorators only take effect when NEST itself instantiates the class via
    // reflection, never through a hand-written `new ReportingRunner(...)` call, so the factory MUST
    // pass every argument explicitly; this had silently never happened for this exact field (fixed
    // alongside adding `webhookDispatcher` below).
    @Optional() private readonly eventsPublisher?: DocumentEventsPublisher,
    // `DOCUMENT_AUTHORITY_EVENT`'s own emitter, the identical "side channel,
    // `@Optional()`" posture `eventsPublisher` holds — see that field's own comment just above for why
    // the manual factory in `documents-core.module.ts` has to pass this explicitly too. Typed as the
    // narrow `DocumentWebhookEmitter` interface, never the concrete `WebhookDispatcherService` class —
    // see `queue/document-webhooks.ts`'s own `DOCUMENT_WEBHOOK_EMITTER` token header for why: the
    // concrete class drags `webhooks.service.ts` → `drivers/discord.driver.ts` → `@teever/ez-hook`
    // into every file that imports it, breaking this class's own spec (and every OTHER spec that
    // transitively imports it) under ts-jest. The factory resolves the REAL instance via that token
    // (`inject: [..., DOCUMENT_WEBHOOK_EMITTER]`) — this parameter only ever sees the interface.
    @Optional() private readonly webhookDispatcher?: DocumentWebhookEmitter,
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
    const source = await this.resolvePricingSource(data, document);

    // The buyer: the document's own `client`, or, for a credit note, the corrected invoice's
    // (`resolvePricingSource`).
    const clientId = (source.pricingData ?? (document.data as Record<string, unknown> | null))?.client;

    const [company, client] = await Promise.all([
      prisma.company.findUniqueOrThrow({
        where: { id: data.companyId },
        include: { partyIdentifiers: true },
      }),
      // Scoped by companyId — `clientId` comes straight off the document's own `data.client`, never
      // checked for existence at write time (descriptors/field-kinds.ts's own comment on the
      // 'reference' kind), so a bare `findUniqueOrThrow` would happily hand back another tenant's
      // client instead of throwing. `findFirstOrThrow` keeps this call's existing "propagate, never
      // swallow" contract (this function's own header) for a foreign id exactly as it already did for
      // a nonexistent one.
      typeof clientId === 'string' && clientId
        ? prisma.client.findFirstOrThrow({
            where: { id: clientId, companyId: data.companyId },
            include: { partyIdentifiers: true, contacts: true },
          })
        : Promise.resolve(undefined),
    ]);

    const declaredInvoice = buildDeclaredInvoice(
      data.typeId,
      source.descriptor,
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
      { pricingData: source.pricingData, correctedInvoice: source.correctedInvoice },
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
        // Only on a genuinely new row (journaled > 0): a
        // 'report:blocked' verdict is exactly as conformity-panel-worthy as a real declaration.
        if (journaled > 0) {
          await this.eventsPublisher?.publish(data.companyId, {
            documentId: data.documentId,
            typeId: data.typeId,
            kind: 'authority-event',
          });
          await dispatchDocumentAuthorityEventWebhook(
            this.webhookDispatcher,
            data.companyId,
            data.typeId,
            data.documentId,
            data.providerId,
            REPORT_BLOCKED_STATUS_CODE,
          );
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
      await dispatchDocumentAuthorityEventWebhook(
        this.webhookDispatcher,
        data.companyId,
        data.typeId,
        data.documentId,
        data.providerId,
        result.statusCode,
      );
    }
    return { journaled };
  }

  /**
   * What a document is priced from, and what it corrects (issue #501). An invoice is priced from its
   * own descriptor and data. A credit note owns no amounts and no client: it is priced, and takes its
   * buyer, from the invoice it corrects, through `formats/credit-note-source.ts`, the one resolution
   * its e-invoicing export already uses, so the declared total is to the cent the amount settlement
   * subtracts from that invoice. A credit note that corrects no invoice cannot be declared at all:
   * it has no buyer, and the declaration must identify the corrected document (Decreto-Lei
   * n.º 198/2012, art. 3.º n.º 4 n), « Identificação do documento retificado »). That, and every
   * refusal `resolveCreditNoteFormatSource` makes (a corrected invoice with no number, no corrected
   * line left on it), becomes `UndeclarableDocumentError`, which propagates like any other failure:
   * retried, then journaled `report:failed` with its message.
   */
  private async resolvePricingSource(
    data: ReportJobData,
    document: { data: unknown },
  ): Promise<{
    descriptor: DocumentTypeDescriptor;
    pricingData?: Record<string, unknown>;
    correctedInvoice?: DeclaredInvoice['correctedInvoice'];
  }> {
    if (data.typeId !== 'credit-note') {
      return { descriptor: this.typeRegistry.resolve(data.typeId) };
    }

    const noteData = (document.data ?? {}) as Record<string, unknown>;
    if (typeof noteData.invoice !== 'string' || !noteData.invoice.trim()) {
      throw new UndeclarableDocumentError(
        `Refusing to declare credit note ${data.documentId}: it corrects no invoice. A declared ` +
          'correcting document must identify the document it corrects (Decreto-Lei n.º 198/2012, art. ' +
          '3.º n.º 4 n)), and a credit note takes its buyer from that invoice, so there is nothing ' +
          'lawful to declare.',
      );
    }

    let source: Awaited<ReturnType<typeof resolveCreditNoteFormatSource>>;
    try {
      source = await resolveCreditNoteFormatSource(data.companyId, { data: noteData });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw new UndeclarableDocumentError(
          `Refusing to declare credit note ${data.documentId}: ${error.message}`,
        );
      }
      throw error;
    }
    return {
      descriptor: source.pricingDescriptor,
      pricingData: source.pricingData,
      correctedInvoice: {
        number: source.correctedInvoice.displayNumber,
        issueDate: source.correctedInvoice.issueDate,
      },
    };
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
      // Same "only on a genuinely new row" rule as `runReport`'s own
      // two publish points above: 'report:failed' is a terminal conformity-panel-worthy verdict too.
      if (journaled > 0) {
        await this.eventsPublisher?.publish(data.companyId, {
          documentId: data.documentId,
          typeId: data.typeId,
          kind: 'authority-event',
        });
        await dispatchDocumentAuthorityEventWebhook(
          this.webhookDispatcher,
          data.companyId,
          data.typeId,
          data.documentId,
          data.providerId,
          REPORT_FAILED_STATUS_CODE,
        );
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
