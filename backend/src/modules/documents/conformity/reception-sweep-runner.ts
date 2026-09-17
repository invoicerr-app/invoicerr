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
 * ## Idempotency — by PDP identifier, a targeted lookup + a real unique index
 *
 * No dedicated COLUMN: `data.pdpInboundId` is still a reserved `data` key, the exact same "system fact
 * lives in `data`, not a declared field" convention `fileRef`/`fileName`/`fileMime` already hold (see
 * `received-invoice.descriptor.ts`'s own header) — a fresh migration for one more scalar column would
 * be disproportionate. The dedup check used to be a bounded linear scan of the last `500` received
 * invoices (`listDocuments(...).some(...)`) — a company whose received-invoice history grows past that
 * window would silently stop recognizing an OLDER
 * deposit as already-imported the moment `listInbound`'s own pagination (never documented as newest-
 * first — `pollers/pdp-reception-poller.ts`'s own header) happened to hand it back again, reimporting
 * it and re-pushing `pushTakenInCharge` a second time. `isAlreadyImported` below now queries the EXACT
 * `pdpInboundId` value directly (a targeted `WHERE data->>'pdpInboundId' = ...`, backed by a raw-SQL
 * migration, `prisma/migrations/20260917150000_pdp_inbound_id_unique_index` — a PARTIAL UNIQUE INDEX
 * on `(companyId, data->>'pdpInboundId')` scoped to this type, never a Prisma-declared `@@unique` on a
 * JSONB path, which Prisma's schema language cannot express) — no window to fall out of, regardless of
 * history size or the poller's own pagination order. That same index is also what makes the write
 * itself race-proof now, not merely the READ: two
 * genuinely overlapping sweep passes importing the SAME never-before-seen deposit concurrently both
 * pass `isAlreadyImported`, but only ONE of their two inserts can land — the other hits `P2002`, caught
 * in `runSweep`'s own loop below and counted as an ordinary dedup hit, never a failure.
 */
import { Injectable, Logger, Optional } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { runWithCompanyId } from '@/lib/request-context';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { computeArtifactHash } from '../archive/hashing';
import { persistInboundFile } from '../received-invoices/storage';
import { reconcileSupplierClient } from '../received-invoices/supplier-reconciliation';
import { DocumentsService } from '../documents.service';
import { DocumentEventsPublisher } from '../queue/document-events-publisher';
import { buildPdpReceptionPoller, ReceptionPoller } from './pollers/pdp-reception-poller';
import { buildPdpReceptionStatusPusher, PdpReceptionStatusPusher } from '../transports/pdp/pdp-reception';

const TYPE_ID = 'received-invoice';

/** True for the ONE conflict the partial unique index (this file's own header, "Idempotency") is
 *  meant to produce: a concurrent pass's insert for the SAME `(companyId, pdpInboundId)` won the race.
 *  Never matches any OTHER constraint violation this table might raise for an unrelated reason —
 *  `P2002` alone is not enough context on its own, but this runner has exactly one unique index that
 *  could ever fire from `importOne`'s own write path, so treating any `P2002` here as THIS conflict is
 *  safe in practice, the same posture `reminder-sweep-runner.ts#claimReminderTier` already holds for
 *  its own single-purpose `@@unique`. */
function isPdpInboundIdConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // The generated client's own `@ts-nocheck`'d `client.ts` (Prisma 7's own codegen output) loses
  // enough type information across the `Prisma` namespace re-export that TypeScript does not narrow
  // `error` from the `instanceof` check just above the way it does for an inline `catch (error)`
  // (untyped, effectively `any`, under this tsconfig's non-`strict` mode) — an explicit, narrow cast
  // to the one field this function actually reads, rather than trusting a narrowing that empirically
  // does not happen here.
  return (error as { code?: string }).code === 'P2002';
}

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
        // Wrapped in `runWithCompanyId` — this sweep has no request of its own, and `importOne` below
        // calls straight into `DocumentsService.runAction` (whose own `Log` writes, and every
        // downstream action handler's, need a company to be scoped correctly).
        await runWithCompanyId(config.companyId, async () => {
          const inbound = await this.poller.listInbound(config.companyId);
          for (const deposit of inbound) {
            const pdpInboundId = String(deposit.id);
            const alreadyImported = await this.isAlreadyImported(config.companyId, pdpInboundId);
            if (alreadyImported) {
              skipped++;
              continue;
            }
            try {
              await this.importOne(config.companyId, pdpInboundId);
              imported++;
            } catch (error) {
              // See this file's own header, "Idempotency" — a concurrent pass won the race for this
              // EXACT deposit between the `isAlreadyImported` check just above and this write. Counted
              // as an ordinary dedup hit, not a failure: nothing about THIS deposit needs retrying, the
              // other pass already imported it. Never swallows any OTHER error — those still propagate
              // to the per-COMPANY catch below, unchanged.
              if (isPdpInboundIdConflict(error)) {
                skipped++;
                continue;
              }
              throw error;
            }
          }
        });
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

  /**
   * A targeted lookup on the EXACT `pdpInboundId` value — see this file's own header, "Idempotency",
   * for why this replaced a bounded scan of the most recent 500 received invoices.
   *
   * Raw SQL, deliberately, rather than Prisma's own `{ path: ['pdpInboundId'], equals }` JSON filter:
   * on Postgres, that filter compiles to `("data" #> ARRAY['pdpInboundId']::text[])::jsonb = $n` (the
   * `#>` path operator, comparing JSONB to JSONB — verified by reading the actual SQL the query engine
   * emits for this exact shape) — a DIFFERENT expression, byte-for-byte, from the partial unique
   * index's own `("data"->>'pdpInboundId')` (the `->>` operator, comparing TEXT to TEXT). Postgres
   * matches an expression index by parse-tree equality, not semantic equivalence across different
   * operators, so the ORM's own filter would never have used that index — every call would silently
   * fall back to scanning this company's own `received-invoice` rows one by one, forever, regardless of
   * how the migration that created the index was justified. Written by hand instead, with the EXACT
   * operator (`->>`) and the EXACT partial condition (`"typeId" = 'received-invoice'`) the index
   * declares, so the planner can actually use it — a `col = $1` predicate is recognized as implying
   * `col IS NOT NULL`, so this does not need to restate the index's own null-exclusion clause.
   */
  private async isAlreadyImported(companyId: string, pdpInboundId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "DocumentInstance"
      WHERE "companyId" = ${companyId}
        AND "typeId" = ${TYPE_ID}
        AND ("data"->>'pdpInboundId') = ${pdpInboundId}
      LIMIT 1
    `;
    return rows.length > 0;
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
