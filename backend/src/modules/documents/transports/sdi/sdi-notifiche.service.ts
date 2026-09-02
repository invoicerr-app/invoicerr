/**
 * The minimal PUSH receiver for SdI's own `TrasmissioneFatture` notifiche — root TODO item 10's own
 * "implemented-awaiting-accreditation" wave for SdI (see `sdicoop-client.ts`'s own header for the
 * full status). Explicit scope, per this task's own brief: PARSE + JOURNAL into
 * `DocumentAuthorityEvent` (the existing conformity mechanism, `conformity/authority-events.persistence.ts`)
 * — reconciled by `IdentificativoSdI` = `DocumentInstance.transportRef` — NOTHING more. This is
 * deliberately NOT an `AuthorityStatusPoller` (`conformity/authority-status-poller.ts`): "sdi"
 * registers none, and stays that way — this is a PUSH mechanism, a different shape entirely, journaling
 * directly rather than being polled for.
 *
 * ## What accreditation will still need to add (NOT built here, said plainly)
 *
 *  - Server-side mTLS: AdE's own Sistema di Accreditamento issues a SEPARATE server certificate/key
 *    pair (distinct RSA key from the client one — `CREDENTIALS_GUIDE.md` §4) that this endpoint would
 *    need to terminate TLS with, so SdI's OWN client certificate can be verified on our side. This
 *    server (nginx in front of `main.ts`, see `entrypoint.sh`) does not do per-route mTLS today — this
 *    endpoint is reachable exactly like any other `@Public()` route until that is wired.
 *  - The endpoint URL itself must be DECLARED to AdE through the Sistema di Accreditamento (the exact
 *    "Tale servizio viene esposto sulla base di endpoint che vengono comunicati in fase di
 *    accreditamento" sentence `sdi-notifiche.ts`'s own header cites) — nothing registers it there
 *    automatically; that is an operational step for whoever holds the accreditation.
 *  - Until both of the above exist, this endpoint is dormant in practice: nothing routes real SdI
 *    traffic to it because AdE has never been told it exists. It is built now, gated, so accreditation
 *    has somewhere real to point on day one — the same "implemented, never yet exercised for real" the
 *    whole SdI channel status is this task.
 *
 * ## The "unknown reference" rule
 *
 * The read spec never states what SdI expects back on THESE six one-way operations beyond "non
 * prevede Response SOAP" — no retry policy is documented either way. This task's own instruction is
 * explicit regardless: an unknown `IdentificativoSdI` must never be journaled onto an arbitrary
 * document (MUTATION TARGET #2, see this file's own test) and must still answer 200 — "SdI ne doit
 * pas retenter éternellement" a notifica this codebase has no matching deposit for (a document from
 * before this channel existed, a stale test notifica, a bug on SdI's own side — all indistinguishable
 * from here, and none of them warrant an infinite retry storm). Logged NAMED, nothing silent.
 */
import { Injectable, Optional } from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import {
  createAuthorityEvents,
  findDocumentByTransportRef,
} from '../../conformity/authority-events.persistence';
import { RawAuthorityEvent } from '../../conformity/authority-status-poller';
import { DocumentEventsPublisher } from '../../queue/document-events-publisher';
import { NOTIFICA_TYPE_LABELS, parseSdiNotifica, SdiNotificaType } from './sdi-notifiche';

export const SDI_PROVIDER_ID = 'sdi';

export interface HandleNotificaResult {
  /** Whether an event was actually written to `DocumentAuthorityEvent` — `false` for a malformed
   *  body OR an unknown `IdentificativoSdI`, both of which still answer 200 (see this file's own
   *  header). */
  journaled: boolean;
  notificaType?: SdiNotificaType;
  identificativoSdI?: string;
}

@Injectable()
export class SdiNotificheService {
  // TODO_PRODUIT.md T1 / PLAN-V2 R8 — `@Optional()` for the same "side channel, never load-bearing"
  // reason `ConformitySweepRunner`/`ReportingRunner` hold theirs: every EXISTING spec constructs this
  // service with zero args and must keep passing unchanged. `sdi-notifiche.module.ts` deliberately
  // imports nothing from `DocumentsCoreModule` (see that module's own header) — this still resolves
  // in production because `DocumentEventsPublisher` comes from the `@Global()` `DocumentQueueModule`,
  // registered elsewhere in the app graph (`DocumentsModule`/`DocumentsCoreModule`), which Nest makes
  // available everywhere once bootstrapped, with no explicit import needed here.
  constructor(@Optional() private readonly eventsPublisher?: DocumentEventsPublisher) {}

  /**
   * Handles ONE incoming `TrasmissioneFatture` push. Never throws for a business-level reason
   * (malformed body, unknown reference) — the controller always answers 200 regardless (see this
   * file's own header); only a genuine infrastructure failure (the database itself unreachable) is
   * allowed to propagate, and even that is caught by `createAuthorityEvents`'s own Prisma call
   * surfacing normally rather than being swallowed here — a controller-level catch-all still keeps
   * the HTTP contract "200 either way" true even then (see `sdi-notifiche.controller.ts`).
   */
  async handleNotifica(rawXml: string): Promise<HandleNotificaResult> {
    const parsed = parseSdiNotifica(rawXml);
    if (!parsed) {
      logger.warn('SdI notifica received but could not be parsed as one of the six known operations', {
        category: 'documents',
        details: { rawXmlPreview: rawXml.slice(0, 300) },
      });
      return { journaled: false };
    }

    const document = await findDocumentByTransportRef(SDI_PROVIDER_ID, parsed.identificativoSdI);
    if (!document) {
      // MUTATION TARGET #2 (this task's own brief): journaling onto an arbitrary/wrong document here
      // instead of returning early would be exactly the bug this branch exists to prevent.
      logger.warn(
        `SdI notifica ${parsed.notificaType} received for an unknown IdentificativoSdI — ` +
          'nothing journaled (no DocumentInstance carries this transportRef for the "sdi" channel)',
        {
          category: 'documents',
          details: { identificativoSdI: parsed.identificativoSdI, notificaType: parsed.notificaType },
        },
      );
      return {
        journaled: false,
        notificaType: parsed.notificaType,
        identificativoSdI: parsed.identificativoSdI,
      };
    }

    const event: RawAuthorityEvent = {
      statusCode: `it:${parsed.notificaType}`,
      statusText: NOTIFICA_TYPE_LABELS[parsed.notificaType],
      // `fileSdI_Type` (the type EVERY one of the six push operations uses, per
      // `TrasmissioneTypes_v1.1.xsd`) carries no timestamp of its own — unlike `RiceviFile`'s own
      // response (`DataOraRicezione`) — so "now" is the only honest value for "when THIS endpoint
      // observed it", the same fallback `ksef-status-poller.ts` already uses for the identical reason.
      observedAt: new Date(),
      rawPayload: {
        identificativoSdI: parsed.identificativoSdI,
        nomeFile: parsed.nomeFile,
        notificaType: parsed.notificaType,
        fileBase64: parsed.fileBase64,
      },
    };

    const count = await createAuthorityEvents(document.companyId, document.id, SDI_PROVIDER_ID, [event]);
    logger.info(
      `SdI notifica ${parsed.notificaType} journaled for document ${document.id} (IdentificativoSdI ${parsed.identificativoSdI})`,
      { category: 'documents', details: { documentId: document.id, notificaType: parsed.notificaType } },
    );
    // TODO_PRODUIT.md T1 / PLAN-V2 R8 — only on a genuinely new row (count > 0, never for a
    // re-delivered notifica the dedup already absorbed): this push receiver is itself a worker→API
    // boundary of its own (SdI calls straight into this API process, no BullMQ job involved), but the
    // SAME Redis pub/sub bridge still applies unchanged — every SSE consumer subscribes by companyId
    // regardless of which code path inside this API process did the writing.
    if (count > 0) {
      await this.eventsPublisher?.publish(document.companyId, {
        documentId: document.id,
        typeId: document.typeId,
        kind: 'authority-event',
      });
    }
    return {
      journaled: count > 0,
      notificaType: parsed.notificaType,
      identificativoSdI: parsed.identificativoSdI,
    };
  }
}
