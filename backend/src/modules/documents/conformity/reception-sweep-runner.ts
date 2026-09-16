/**
 * The Prisma/`DocumentsService`/BullMQ-touching half of the PDP RECEPTION sweep —
 * `reception-sweep.ts` holds the pure job-name/interval facts; this class is what actually lists
 * every company with PDP connected, asks the poller what is currently sitting in each one's inbound
 * queue, and turns anything not already imported into a `received-invoice` — the same "pure core,
 * thin persistence shell" split `conformity-sweep-runner.ts`/`schedule-sweep-runner.ts` already hold.
 *
 * ## Creating the record — through `DocumentsService.runAction`, never a shortcut
 *
 * Same discipline `document-action.processor.ts`'s own header states for the ordinary action queue:
 * "the EXACT SAME entry point the HTTP controller calls... never a shortcut straight to
 * ActionRegistry" — this runner calls `runAction(companyId, 'received-invoice', 'receive', ...)`, the
 * identical path a human confirming the manual upload dialog goes through
 * (`received-invoice-actions.ts`'s own "receive" handler already computes `lineTotalWarnings` and
 * marks a linked supplier client — reused here, not duplicated). The only work THIS runner does that
 * the manual flow's own controller route does not is: list the deposit, download it, extract fields
 * from it, and reconcile a supplier — everything `received-invoices.service.ts#upload` already does
 * for a human-driven upload, called here for a platform-driven one instead.
 *
 * ## Idempotency — by PDP identifier, scanning `data.pdpInboundId`
 *
 * No dedicated column or unique constraint: `data.pdpInboundId` is a reserved `data` key, the exact
 * same "system fact lives in `data`, not a declared field" convention `fileRef`/`fileName`/`fileMime`
 * already hold (see `received-invoice.descriptor.ts`'s own header) — a fresh migration for one more
 * lookup key would be disproportionate. The dedup check is a bounded linear scan (`listDocuments`,
 * capped the same `500` this module already uses for `received-invoices.service.ts`'s own file-hash
 * duplicate check) — NOT race-proof against two genuinely overlapping sweep passes (a real gap this
 * shares with that exact same existing dedup check, not a new weakness this runner introduces): a
 * single BullMQ repeatable job normally runs one pass at a time, and the worst case of a genuine race
 * is a rare, harmless duplicate `received-invoice` a human can delete — never data loss or a wrong
 * company.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { computeArtifactHash } from '../archive/hashing';
import { listDocuments } from '../persistence';
import { persistInboundFile } from '../received-invoices/storage';
import { reconcileSupplierClient } from '../received-invoices/supplier-reconciliation';
import { DocumentsService } from '../documents.service';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { buildPdpReceptionPoller, ReceptionPoller } from './pollers/pdp-reception-poller';
import { buildPdpReceptionStatusPusher, PdpReceptionStatusPusher } from '../transports/pdp/pdp-reception';

const TYPE_ID = 'received-invoice';
/** Same bounded-scan budget `received-invoices.service.ts#DUPLICATE_CHECK_LIMIT` already uses for the
 *  identical shape of dedup check (there: by file SHA-256; here: by `data.pdpInboundId`) — see that
 *  file's own comment for why 500 comfortably covers any real company's inbox. */
const DUPLICATE_CHECK_LIMIT = 500;

export interface RunReceptionSweepResult {
  /** How many companies have an active PDP channel connected — `listActiveByProvider`'s own count,
   *  before this pass even lists anything. */
  companies: number;
  /** How many inbound deposits this pass turned into a NEW `received-invoice`. */
  imported: number;
  /** How many inbound deposits this pass saw but already knew about (`data.pdpInboundId` match). */
  skipped: number;
  /** How many companies this pass could not even LIST for (a transient PDP outage, a network error)
   *  — logged, never fatal to the other companies' own passes. */
  failed: number;
}

@Injectable()
export class PdpReceptionSweepRunner {
  private readonly logger = new Logger(PdpReceptionSweepRunner.name);
  private readonly poller: ReceptionPoller;
  private readonly statusPusher: PdpReceptionStatusPusher;

  constructor(
    private readonly channelCredentials: ChannelCredentialsService,
    private readonly documentsService: DocumentsService,
    // Side channel, `@Optional()` — same "a missing publisher only means the SSE nudge doesn't fire"
    // posture `ConformitySweepRunner`'s own constructor already documents for the identical parameter.
    @Optional() private readonly eventsPublisher?: DocumentEventsPublisher,
  ) {
    this.poller = buildPdpReceptionPoller({ channelCredentials });
    this.statusPusher = buildPdpReceptionStatusPusher(channelCredentials);
  }

  async runSweep(): Promise<RunReceptionSweepResult> {
    const activeConfigs = await this.channelCredentials.listActiveByProvider('pdp');
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    for (const config of activeConfigs) {
      try {
        const inbound = await this.poller.listInbound(config.companyId);
        for (const deposit of inbound) {
          const pdpInboundId = String(deposit.id);
          const alreadyImported = await this.isAlreadyImported(config.companyId, pdpInboundId);
          if (alreadyImported) {
            skipped++;
            continue;
          }
          await this.importOne(config.companyId, pdpInboundId);
          imported++;
        }
      } catch (error) {
        failed++;
        // Never lets one company's failure (an expired token, a transient network error) stop the
        // pass for every OTHER company — the same "an event handler never kills the process" posture
        // `authority-status-poller.ts`'s own header holds for a single document's poll failure.
        this.logger.warn(
          `PDP reception sweep failed for company ${config.companyId}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `PDP reception sweep: ${activeConfigs.length} compan${activeConfigs.length === 1 ? 'y' : 'ies'} ` +
        `connected, ${imported} imported, ${skipped} already known, ${failed} failed.`,
    );
    return { companies: activeConfigs.length, imported, skipped, failed };
  }

  private async isAlreadyImported(companyId: string, pdpInboundId: string): Promise<boolean> {
    const existing = await listDocuments(companyId, TYPE_ID, DUPLICATE_CHECK_LIMIT);
    return existing.some(
      (doc) => (doc.data as Record<string, unknown> | null)?.pdpInboundId === pdpInboundId,
    );
  }

  private async importOne(companyId: string, pdpInboundId: string): Promise<void> {
    const { bytes, mime, fileName, extraction } = await this.poller.downloadAndExtract(
      companyId,
      Number(pdpInboundId),
    );
    const fileRef = computeArtifactHash(bytes);
    persistInboundFile(companyId, fileRef, mime, bytes);

    // Supplier reconciliation "at import" — the exact same call, at the exact same point in the flow,
    // `received-invoices.service.ts#upload` already makes for a human-driven upload (VAT first, exact
    // name fallback, ambiguity never silently resolved, never a created Client — see that function's
    // own header). `data.supplierClient`, once set here, is what makes "receive" (called below) mark
    // the linked Client `isSupplier: true` — the SAME single point every OTHER path into this type
    // already converges on.
    const supplierMatch = await reconcileSupplierClient(companyId, {
      vatId: extraction.fields.supplierVatId,
      supplierName: extraction.fields.supplier,
    });

    const data: Record<string, unknown> = {
      ...extraction.fields,
      fileRef,
      fileName,
      fileMime: mime,
      // Reserved `data` keys, never declared `DocumentFieldDescriptor`s — same convention
      // `fileRef`/`fileName`/`fileMime` already hold (see `received-invoice.descriptor.ts`'s own
      // header). `pdpProviderId` is carried alongside `pdpInboundId` so a later multi-provider
      // reception mechanism (a second channel implementing `ReceptionPoller`) never has to guess
      // which provider a bare numeric id came from.
      pdpInboundId,
      pdpProviderId: 'pdp',
      ...(supplierMatch.outcome === 'matched' ? { supplierClient: supplierMatch.clientId } : {}),
    };

    // The EXACT SAME entry point the controller/queue-processor use for every other action — see this
    // file's own header. `documentId: undefined` — a brand-new record, the same "receive" create path
    // the manual upload dialog's own confirm button takes.
    const result = await this.documentsService.runAction(companyId, TYPE_ID, 'receive', {
      documentId: undefined,
      data,
      params: {},
    });

    if (result.document) {
      await this.eventsPublisher?.publish(companyId, {
        documentId: result.document.id,
        typeId: TYPE_ID,
        kind: 'authority-event',
      });
    }

    // Automatic "reçue / prise en charge" push-back (task requirement) — "reçue" (fr:202) is already
    // emitted by the platform itself the instant the deposit reaches this account (proven live, see
    // `pdp-reception.ts`'s own header), so the ONE thing THIS codebase pushes automatically is "prise
    // en charge": this company's own software has now processed the deposit into a bookkeeping
    // record. Never fatal — see `pushReceptionStatus`'s own header in `pdp-reception.ts`.
    await this.statusPusher.pushTakenInCharge(companyId, pdpInboundId);
  }
}
