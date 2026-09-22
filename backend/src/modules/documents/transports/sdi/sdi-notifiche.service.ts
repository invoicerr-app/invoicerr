/**
 * The minimal PUSH receiver for SdI's own `TrasmissioneFatture` notifiche —
 * "implemented-awaiting-accreditation" for SdI (see `sdicoop-client.ts`'s own header for the
 * full status). Explicit scope: PARSE + JOURNAL into
 * `DocumentAuthorityEvent` (the existing conformity mechanism, `conformity/authority-events.persistence.ts`)
 * — reconciled by `IdentificativoSdI` = `DocumentInstance.transportRef` — NOTHING more. This is
 * deliberately NOT an `AuthorityStatusPoller` (`conformity/authority-status-poller.ts`): "sdi"
 * registers none, and stays that way — this is a PUSH mechanism, a different shape entirely, journaling
 * directly rather than being polled for.
 *
 * ## What accreditation will still need to add (NOT built here, said plainly)
 *
 *  - Server-side mTLS: AdE's own Sistema di Accreditamento issues a SEPARATE server certificate/key
 *    pair (distinct RSA key from the client one — `documentation/docs/developer-guide/credentials-guide.md` §4) that this endpoint would
 *    need to terminate TLS with, so SdI's OWN client certificate can be verified on our side. This
 *    server (nginx in front of `main.ts`, see `entrypoint.sh`) does not do per-route mTLS today — this
 *    endpoint is reachable exactly like any other `@Public()` route until that is wired.
 *  - The endpoint URL itself must be DECLARED to AdE through the Sistema di Accreditamento (the exact
 *    "Tale servizio viene esposto sulla base di endpoint che vengono comunicati in fase di
 *    accreditamento" sentence `sdi-notifiche.ts`'s own header cites) — nothing registers it there
 *    automatically; that is an operational step for whoever holds the accreditation.
 *  - Until both of the above exist, this endpoint is dormant in practice: nothing routes real SdI
 *    traffic to it because AdE has never been told it exists. It is built now, gated, so accreditation
 *    has somewhere real to point on day one — the same "implemented, never yet exercised for real"
 *    state the whole SdI channel is in.
 *
 * ## The "unknown reference" rule
 *
 * The read spec never states what SdI expects back on THESE six one-way operations beyond "non
 * prevede Response SOAP" — no retry policy is documented either way. The rule here is explicit
 * regardless: an unknown `IdentificativoSdI` must never be journaled onto an arbitrary
 * document (see this file's own test) and must still answer 200 — SdI must not retry forever on
 * a notifica this codebase has no matching deposit for (a document from
 * before this channel existed, a stale test notifica, a bug on SdI's own side — all indistinguishable
 * from here, and none of them warrant an infinite retry storm). Logged NAMED, nothing silent.
 *
 * ## No company scoping is exactly as dangerous as it sounds — and exactly what the two rules below fix
 *
 * `IdentificativoSdI` is assigned by SdI itself, sequentially, across EVERY intermediary and EVERY
 * company using this channel — it is not a secret, and it is enumerable. Resolving a document by that
 * value ALONE (as this service used to) means any caller who can pass `sdi-notifiche.controller.ts`'s
 * own shared-secret gate — a single, PER-DEPLOYMENT secret, not a per-company one — could forge a
 * `<notificaScarto>` carrying a transportRef belonging to a DIFFERENT company's real invoice and have
 * it journaled, webhook and all, onto that company's own document. Two independent mitigations, in
 * order of strength:
 *
 *  1. **The path token** (`sdi-notifiche.controller.ts`'s own `:token` route,
 *     `CompanyChannelConfig.pushToken`): a caller that presents a specific company's own token can
 *     only ever resolve a document THAT company itself sent (`findOwnedDocumentByTransportRef` below,
 *     scoped by the token's own `companyId` — never by `transportRef` alone). This is the endpoint a
 *     company should register with AdE at SDICoop accreditation time; see this class's own
 *     `resolveDocumentForToken` for the exact lookup.
 *  2. **The legacy, un-tokened route** (`POST /public/sdi/notifiche`, kept so a company that already
 *     registered THAT URL with AdE before this fix shipped keeps receiving real notifiche — dropping
 *     it silently would turn "this endpoint is over-permissive" into "a rejected invoice this company
 *     never learns about", which is worse). It cannot know which company a caller speaks for, so it
 *     falls back to a SECOND, content-based check instead of the URL: `resolveDocumentLegacy` below
 *     requires the notifica's own `NomeFile` to start with the resolved document's own company's
 *     currently-connected `idTrasmittente` (`sdi-transport.ts#send` builds `NomeFile` as exactly
 *     `${idTrasmittente}_…` — see that file's own header). `idTrasmittente` is a Codice
 *     Fiscale/Partita IVA, discoverable, not a secret — so this does not fully close the hole the way
 *     the token does — but it does mean a forgery must now also target a SPECIFIC company's own known
 *     identifier, never merely guess an integer some unrelated company happens to own. Today this
 *     branch is close to moot in practice: SdI SOAP push is "implemented-awaiting-accreditation" (see
 *     `sdi-transport.ts`'s own header) — no company has ever registered ANY URL with AdE for this
 *     channel — but the check is built now, honestly, rather than assumed away.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import {
  createAuthorityEvents,
  findDocumentByTransportRef,
  findOwnedDocumentByTransportRef,
} from '../../conformity/authority-events.persistence';
import { RawAuthorityEvent } from '../../conformity/authority-status-poller';
import { dispatchDocumentAuthorityEventWebhook } from '../../queue/document-authority-webhook';
import { DOCUMENT_WEBHOOK_EMITTER, DocumentWebhookEmitter } from '../../queue/document-webhooks';
import { DocumentEventsPublisher } from '../../queue/document-events-publisher';
import { NOTIFICA_TYPE_LABELS, ParsedSdiNotifica, parseSdiNotifica, SdiNotificaType } from './sdi-notifiche';

export const SDI_PROVIDER_ID = 'sdi';

interface ResolvedNotificaDocument {
  id: string;
  companyId: string;
  typeId: string;
}

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
  // `@Optional()` for the same "side channel, never load-bearing"
  // reason `ConformitySweepRunner`/`ReportingRunner` hold theirs: every EXISTING spec constructs this
  // service with zero args and must keep passing unchanged. `sdi-notifiche.module.ts` deliberately
  // imports nothing from `DocumentsCoreModule` (see that module's own header) — this still resolves
  // in production because `DocumentEventsPublisher` comes from the `@Global()` `DocumentQueueModule`,
  // registered elsewhere in the app graph (`DocumentsModule`/`DocumentsCoreModule`), which Nest makes
  // available everywhere once bootstrapped, with no explicit import needed here.
  constructor(
    @Optional() private readonly eventsPublisher?: DocumentEventsPublisher,
    // `DOCUMENT_AUTHORITY_EVENT`'s own emitter. UNLIKE `eventsPublisher`,
    // the `DOCUMENT_WEBHOOK_EMITTER` token's own provider (`WebhooksModule`) is NOT `@Global()` —
    // `sdi-notifiche.module.ts` now imports `WebhooksModule` directly (a small, one-line addition;
    // `WebhooksModule` itself imports nothing of its own, so this touches nothing this module graph
    // already avoids — see that module's own header) specifically so this resolves. Injected by TOKEN, never
    // the concrete `WebhookDispatcherService` class — see that token's own header
    // (`queue/document-webhooks.ts`) for why: the concrete class drags `webhooks.service.ts` →
    // `drivers/discord.driver.ts` → `@teever/ez-hook` into every file that imports it, breaking this
    // class's own spec under ts-jest. Still `@Optional()`: every EXISTING spec constructs this service
    // with zero/one arg and must keep passing unchanged.
    @Optional() @Inject(DOCUMENT_WEBHOOK_EMITTER) private readonly webhookDispatcher?: DocumentWebhookEmitter,
    // `@Optional()` for the identical reason: every EXISTING spec constructs this service with
    // zero/one/two args and must keep passing unchanged. Genuinely absent only in a test that never
    // exercises the token or legacy-content-check paths below — a real boot always resolves it
    // (`sdi-notifiche.module.ts` now provides `ChannelCredentialsService` directly, the same
    // "duplicate-provide a dependency-free class" shape `documents-core.module.ts` already uses).
    @Optional() private readonly channelCredentials?: ChannelCredentialsService,
  ) {}

  /**
   * Handles ONE incoming `TrasmissioneFatture` push. Never throws for a business-level reason
   * (malformed body, unknown reference) — the controller always answers 200 regardless (see this
   * file's own header); only a genuine infrastructure failure (the database itself unreachable) is
   * allowed to propagate, and even that is caught by `createAuthorityEvents`'s own Prisma call
   * surfacing normally rather than being swallowed here — a controller-level catch-all still keeps
   * the HTTP contract "200 either way" true even then (see `sdi-notifiche.controller.ts`).
   *
   * `token` is the path segment from `POST /public/sdi/notifiche/:token` — present for a company
   * that has migrated to its own per-company callback URL, `undefined` for the legacy
   * `POST /public/sdi/notifiche` route. See this file's own header for what each path does with it.
   */
  async handleNotifica(rawXml: string, token?: string): Promise<HandleNotificaResult> {
    const parsed = parseSdiNotifica(rawXml);
    if (!parsed) {
      logger.warn('SdI notifica received but could not be parsed as one of the six known operations', {
        category: 'documents',
        details: { rawXmlPreview: rawXml.slice(0, 300) },
      });
      return { journaled: false };
    }

    const document = token
      ? await this.resolveDocumentForToken(token, parsed)
      : await this.resolveDocumentLegacy(parsed);
    if (!document) {
      // Journaling onto an arbitrary/wrong document here
      // instead of returning early would be exactly the bug this branch exists to prevent.
      logger.warn(
        `SdI notifica ${parsed.notificaType} received for an IdentificativoSdI this caller could not ` +
          "be shown to own — nothing journaled (see this file's own header for the token/legacy split)",
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
      {
        category: 'documents',
        // Explicit, not left to the ambient context: this is a `@Public()` push endpoint (see
        // `sdi-notifiche.controller.ts`'s own header) with no company context of its own — `companyId`
        // is only known from here on, once `document` above resolved it.
        companyId: document.companyId,
        details: { documentId: document.id, notificaType: parsed.notificaType },
      },
    );
    // Only on a genuinely new row (count > 0, never for a
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
      await dispatchDocumentAuthorityEventWebhook(
        this.webhookDispatcher,
        document.companyId,
        document.typeId,
        document.id,
        SDI_PROVIDER_ID,
        event.statusCode,
      );
    }
    return {
      journaled: count > 0,
      notificaType: parsed.notificaType,
      identificativoSdI: parsed.identificativoSdI,
    };
  }

  /**
   * The PRIMARY, recommended path — `POST /public/sdi/notifiche/:token`. `token` is resolved to the
   * ONE company that owns it (`ChannelCredentialsService#resolvePushToken`, `null` for an unknown/
   * inactive/wrong-provider token — see that method's own header); the document lookup is then
   * scoped to exactly that company (`findOwnedDocumentByTransportRef`), never a bare `transportRef`
   * lookup — a caller presenting company A's own token can never resolve company B's document, no
   * matter what `IdentificativoSdI` it guesses.
   */
  private async resolveDocumentForToken(
    token: string,
    parsed: ParsedSdiNotifica,
  ): Promise<ResolvedNotificaDocument | null> {
    const owner = await this.channelCredentials?.resolvePushToken(SDI_PROVIDER_ID, token);
    if (!owner) {
      logger.warn(
        'SdI notifica: rejected — the path token does not identify a connected, active "sdi" channel',
        { category: 'documents', details: { notificaType: parsed.notificaType } },
      );
      return null;
    }
    return findOwnedDocumentByTransportRef(owner.companyId, SDI_PROVIDER_ID, parsed.identificativoSdI);
  }

  /**
   * The LEGACY path — `POST /public/sdi/notifiche`, no token. Kept answering (see this file's own
   * header on why silently dropping it would be worse than the bug it used to carry), but a bare
   * `transportRef` lookup alone is exactly the vulnerability this whole file's header describes: any
   * caller past the shared-secret gate could otherwise forge a reference belonging to a company it
   * has no relationship with. The SECOND line of defense stands in for the URL-level scoping the
   * token gives the primary path: the resolved document's own company must have an ACTIVE "sdi"
   * channel whose `idTrasmittente` is actually the prefix of this notifica's own `NomeFile` — the
   * exact string `sdi-transport.ts#send` builds `NomeFile` from at submission time. A forger who only
   * knows an enumerable `IdentificativoSdI` — never a company's own Codice Fiscale/Partita IVA — fails
   * this check; one who targets a SPECIFIC known company by both facts does not, which is why this is
   * documented as a narrowing, not a fix on the order of the token above.
   */
  private async resolveDocumentLegacy(parsed: ParsedSdiNotifica): Promise<ResolvedNotificaDocument | null> {
    const document = await findDocumentByTransportRef(SDI_PROVIDER_ID, parsed.identificativoSdI);
    if (!document) return null;

    const sdiConfig = await this.channelCredentials?.resolveActive(document.companyId, SDI_PROVIDER_ID);
    const idTrasmittente =
      typeof sdiConfig?.config.idTrasmittente === 'string' ? sdiConfig.config.idTrasmittente : undefined;
    if (!idTrasmittente || !parsed.nomeFile.startsWith(`${idTrasmittente}_`)) {
      logger.warn(
        'SdI notifica: rejected on the legacy (un-tokened) endpoint — NomeFile does not start with ' +
          "the resolved document's own company idTrasmittente; refusing rather than journaling a " +
          "notifica that cannot be shown to belong to it (see this file's own header, second line of " +
          'defense)',
        {
          category: 'documents',
          details: { identificativoSdI: parsed.identificativoSdI, notificaType: parsed.notificaType },
        },
      );
      return null;
    }
    return document;
  }
}
