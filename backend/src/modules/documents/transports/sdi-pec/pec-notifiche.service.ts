/**
 * The PEC-route twin of `sdi/sdi-notifiche.service.ts`. Same PARSE + JOURNAL scope, same
 * `DocumentAuthorityEvent` destination, same "never throw for a business-level reason" contract — the
 * only real difference is HOW a notifica arrives: `sdi-notifiche.service.ts`'s controller receives it
 * PUSHED over SOAP by SdI itself; this service is handed one message at a time by
 * `pec-inbox-poller.service.ts`, which actively drains a company's own PEC mailbox (`PecInboxPort`).
 * The notifica XML itself is IDENTICAL either way (see `pec-protocol.ts`'s own header, "What differs
 * between the PEC route and the SdICoop route" — nothing, for the message format), so this file reuses
 * `sdi/sdi-notifiche.ts#parseSdiNotifica` and `sdi/sdi-client.ts#SdiClient.mapNotifica` UNCHANGED rather
 * than re-deriving the same taxonomy a second time.
 *
 * ## Reconciliation key: `NomeFile`, never `IdentificativoSdI`
 *
 * `sdi-notifiche.service.ts` reconciles by `IdentificativoSdI` because the PUSH-based SOAP route has
 * no reference of its own until SdI assigns one. The PEC route is different: `sdi-pec-transport.ts`
 * NEVER learns an `IdentificativoSdI` synchronously at send time (a PEC message's own SMTP acceptance
 * only proves "handed to the next mail hop", nothing about SdI's own processing) — so
 * `DocumentInstance.transportRef` is set, at send time, to the FILENAME this codebase itself chose
 * (`pec-protocol.ts#buildPecAttachmentFilename`, drawn from a persistent per-idTrasmittente counter —
 * see that function's own header for why). Every one of the six
 * notifica types carries that SAME filename back in its own `NomeFile` field (`fileSdI_Type`, shared by
 * all six per `sdi/sdi-notifiche.ts`'s own header) — so reconciling by `NomeFile` works uniformly for
 * the FIRST notifica this document ever receives and for every one after it, with no separate
 * "learn the real IdentificativoSdI, then switch keys" step. The `IdentificativoSdI` SdI itself
 * assigns is still recorded (in `rawPayload`, for a human to look up on SdI's own portal) — it is
 * simply never the PRIMARY key here.
 *
 * ## Learning the reply address
 *
 * §3.1.1 of the read specification (see `pec-protocol.ts`'s own header) is explicit that SdI's FIRST
 * response names the PEC address every LATER submission must target. This service updates that
 * learned address (`pec-protocol.ts`'s own "sdi-pec" channel config, `sdiReplyAddress`) once a
 * notifica has been reconciled with a real, previously-sent document AND every one of three things is
 * true: the notifica PARSED as one of the message kinds the specification actually documents as
 * carrying a reply address (`SDI_REPLY_ADDRESS_HINT_TYPES` — read, never "every recognized notifica",
 * see below), and the message's own envelope `From` lands under SdI's own registered domain
 * (`isFromSdi`). Learning it from the mere SHAPE of an attachment — as this file used to, before
 * either of those two checks existed — meant ANY message a company's mailbox receives, from anyone,
 * carrying something `parseSdiNotifica` recognizes, could redirect every subsequent FatturaPA
 * submission (client data, amounts, full fiscal identifiers) to an address of the sender's choosing.
 * Restricted to the hint types, not "every recognized notifica": simpler code is not worth trusting a
 * field this codebase can act on for message kinds the specification never actually documents as
 * carrying one.
 */
import { Inject, Injectable, Optional } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import {
  createAuthorityEvents,
  findOwnedDocumentByTransportRef,
} from '../../conformity/authority-events.persistence';
import { RawAuthorityEvent } from '../../conformity/authority-status-poller';
import { DocumentEventsPublisher } from '../../queue/document-events-publisher';
import { dispatchDocumentAuthorityEventWebhook } from '../../queue/document-authority-webhook';
import { DOCUMENT_WEBHOOK_EMITTER, DocumentWebhookEmitter } from '../../queue/document-webhooks';
import { NOTIFICA_TYPE_LABELS, parseSdiNotifica, SdiNotificaType } from '../sdi/sdi-notifiche';
import { SdiClient, SdiNotificaOutcome } from '../sdi/sdi-client';
import { PecInboundMessage } from './pec-inbox-port';
import { SDI_REPLY_ADDRESS_HINT_TYPES } from './pec-protocol';

export const SDI_PEC_PROVIDER_ID = 'sdi-pec';

/** The ONE domain every address the read specification documents (the first-submission address,
 *  `pec-protocol.ts#SDI_PEC_FIRST_SUBMISSION_ADDRESS`, and whatever SdI later replies from) actually
 *  lives under — see this file's own header, "Learning the reply address". Compared
 *  case-insensitively: SMTP domain parts are not case-sensitive, and a spoofed `From` could otherwise
 *  trivially dodge an exact-case check. */
const SDI_PEC_REPLY_DOMAIN = 'pec.fatturapa.it';

export interface HandlePecMessageResult {
  /** Whether an event was actually journaled — `false` for a message carrying no recognizable SdI
   *  notifica attachment (a PEC-protocol-level "ricevuta di accettazione/consegna", or anything else
   *  landing in the mailbox) OR an unknown `NomeFile` (a notifica for a document this instance never
   *  sent, or already forgot). */
  handled: boolean;
  notificaType?: SdiNotificaType;
  nomeFile?: string;
  identificativoSdI?: string;
  /** The internal status `SdiClient.mapNotifica` derived — CLEARED/REJECTED/PENDING — present only
   *  when `handled` is true. */
  internalStatus?: SdiNotificaOutcome['status'];
}

@Injectable()
export class PecNotificheService {
  constructor(
    private readonly channelCredentials: ChannelCredentialsService,
    // Same "@Optional(), side channel, never load-bearing" reasoning `SdiNotificheService`'s own
    // header already documents for these exact two dependencies.
    @Optional() private readonly eventsPublisher?: DocumentEventsPublisher,
    @Optional() @Inject(DOCUMENT_WEBHOOK_EMITTER) private readonly webhookDispatcher?: DocumentWebhookEmitter,
  ) {}

  /**
   * Handles ONE inbound PEC message for ONE company's own mailbox. Tries every attachment in turn
   * (never assumes the notifica XML is the first or only one — a PEC message legitimately carries a
   * human-readable body plus one attachment, but this stays defensive rather than assuming position);
   * the first attachment `parseSdiNotifica` recognizes wins. Never throws for a business-level reason —
   * the same contract `SdiNotificheService.handleNotifica` holds, for the identical "a poller must
   * never be taken down by one malformed or unexpected message" reason.
   */
  async handleMessage(companyId: string, message: PecInboundMessage): Promise<HandlePecMessageResult> {
    for (const attachment of message.attachments) {
      const parsed = parseSdiNotifica(attachment.content.toString('utf-8'));
      if (!parsed) continue;

      // Scoped by `companyId` — this poller already knows exactly which company's OWN mailbox it is
      // draining (`pec-inbox-poller.service.ts`), so resolving `NomeFile` WITHOUT that fact (as this
      // used to) could journal an authority event onto ANOTHER tenant's document on a filename
      // collision, or one deliberately forged by whoever controls messages landing in this mailbox —
      // see `conformity/authority-events.persistence.ts#findOwnedDocumentByTransportRef`'s own header.
      const document = await findOwnedDocumentByTransportRef(companyId, SDI_PEC_PROVIDER_ID, parsed.nomeFile);
      if (!document) {
        logger.warn(
          `SdI PEC notifica ${parsed.notificaType} received for an unknown NomeFile — nothing ` +
            'journaled (no DocumentInstance owned by this company carries this transportRef for the ' +
            '"sdi-pec" channel)',
          {
            category: 'documents',
            details: { companyId, nomeFile: parsed.nomeFile, notificaType: parsed.notificaType },
          },
        );
        return {
          handled: false,
          notificaType: parsed.notificaType,
          nomeFile: parsed.nomeFile,
          identificativoSdI: parsed.identificativoSdI,
        };
      }

      // See this file's own header, "Learning the reply address" — gated on the notifica having
      // ALREADY reconciled with a real, previously-sent document (the check just above), the message
      // kind actually being one the specification documents as carrying a reply address, AND the
      // envelope `From` genuinely being SdI's own domain. Any one of the three failing means this
      // message never gets to redirect where the NEXT real FatturaPA submission is sent.
      if (
        this.isFromSdi(message.from) &&
        (SDI_REPLY_ADDRESS_HINT_TYPES as readonly SdiNotificaType[]).includes(parsed.notificaType)
      ) {
        await this.learnReplyAddress(companyId, message.from);
      }

      const outcome = SdiClient.mapNotifica(
        {
          type: parsed.notificaType,
          idSdI: Number(parsed.identificativoSdI) || 0,
          // `fileSdI_Type` carries no timestamp of its own — see `sdi-notifiche.service.ts`'s own
          // header for the identical "now is the only honest value" reasoning.
          dataOraRicezione: new Date().toISOString(),
        },
        parsed.nomeFile,
      );

      const event: RawAuthorityEvent = {
        statusCode: `it:${parsed.notificaType}`,
        statusText: NOTIFICA_TYPE_LABELS[parsed.notificaType],
        // `mapNotifica`'s own `notes` array always opens with three boilerplate entries (idSdI,
        // notifica type, date — see that method's own body) and, for most notifica types, appends
        // exactly ONE more explaining what this codebase actually did with it. That extra entry is
        // where the AT case's "SdI accepted the invoice but could not deliver it [...] the seller
        // must tell the buyer" instruction lives (`sdi-client.ts`'s own `case 'AT'` comment claims
        // this exact text "the document screen surfaces verbatim" — true only once it actually reaches
        // `reason`, which it did not before this dropped every entry past `outcome.status`). RC alone
        // adds nothing past the boilerplate, so `reason` is correctly left unset for it.
        reason: outcome.notes.slice(3).join('; ') || undefined,
        observedAt: new Date(),
        rawPayload: {
          channel: 'pec',
          identificativoSdI: parsed.identificativoSdI,
          nomeFile: parsed.nomeFile,
          notificaType: parsed.notificaType,
          fileBase64: parsed.fileBase64,
          mappedStatus: outcome.status,
        },
      };

      const count = await createAuthorityEvents(document.companyId, document.id, SDI_PEC_PROVIDER_ID, [
        event,
      ]);
      logger.info(
        `SdI PEC notifica ${parsed.notificaType} journaled for document ${document.id} ` +
          `(NomeFile ${parsed.nomeFile}, IdentificativoSdI ${parsed.identificativoSdI})`,
        { category: 'documents', details: { documentId: document.id, notificaType: parsed.notificaType } },
      );
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
          SDI_PEC_PROVIDER_ID,
          event.statusCode,
        );
      }
      return {
        handled: count > 0,
        notificaType: parsed.notificaType,
        nomeFile: parsed.nomeFile,
        identificativoSdI: parsed.identificativoSdI,
        internalStatus: outcome.status,
      };
    }

    // No attachment parsed as one of the six known notifica types — an ORDINARY occurrence on this
    // channel (unlike sdi-notifiche.service.ts's controller, which is registered for notifiche only,
    // this mailbox also receives the PEC protocol's OWN "ricevuta di accettazione"/"ricevuta di
    // consegna" system messages for every send): logged at a low severity, never a warning, so a
    // healthy mailbox does not read as though something is wrong.
    logger.debug('SdI PEC inbox: message carried no recognizable SdI notifica attachment', {
      category: 'documents',
      details: { from: message.from, subject: message.subject },
    });
    return { handled: false };
  }

  /**
   * Persists the LEARNED reply address into this company's own "sdi-pec" channel config — a plain
   * merge-update through the SAME `ChannelCredentialsService` every transport in this module already
   * uses for its credentials (see this file's own header, "Learning the reply address"); never a
   * second credential-storage mechanism. A no-op when nothing actually changed, or when the channel
   * config has vanished between the poller listing it and this call (both harmless: the next poll
   * either re-learns the same address or has no mailbox to poll at all).
   */
  private async learnReplyAddress(companyId: string, fromAddress: string): Promise<void> {
    const trimmed = fromAddress.trim();
    if (!trimmed) return;

    const resolved = await this.channelCredentials.resolveActive(companyId, SDI_PEC_PROVIDER_ID);
    if (!resolved) return;
    if (resolved.config.sdiReplyAddress === trimmed) return;

    await this.channelCredentials.upsertChannelConfig(companyId, SDI_PEC_PROVIDER_ID, {
      environment: resolved.environment,
      isActive: resolved.isActive,
      config: { ...resolved.config, sdiReplyAddress: trimmed },
    });
  }

  /** See `SDI_PEC_REPLY_DOMAIN`'s own comment — the domain check `learnReplyAddress`'s one caller
   *  gates on. Case-insensitive; refuses an address with no `@` at all rather than throwing. */
  private isFromSdi(fromAddress: string): boolean {
    const at = fromAddress.lastIndexOf('@');
    if (at === -1) return false;
    return (
      fromAddress
        .slice(at + 1)
        .trim()
        .toLowerCase() === SDI_PEC_REPLY_DOMAIN
    );
  }
}
