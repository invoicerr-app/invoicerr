/**
 * Inbound status parsers — translate channel-native webhook payloads into the canonical
 * `InboundInput` that `InboundRouter.receive()` understands.
 *
 * Design: pure functions with no I/O (easy to unit-test). Transport (the HTTP controller
 * that calls these) lives in `nest/compliance.controller.ts`.
 *
 * Dedup: each parser sets `rawRef` to a stable, unique string derived from the provider
 * ref + status (or timestamp). The store deduplicates by (channel, rawRef).
 *
 * Correlation key strategy (per channel):
 *   - PDP      : invoiceId (SuperPDP) or flowId (AFNOR) — the external PDP document ID.
 *   - SdI      : idSdI — SdI's numeric document identifier.
 *   - Peppol   : messageId — the AP gateway message ID.
 *   - KSeF     : invoiceRef (the invoice reference number returned at submission).
 *
 * IMPORTANT: For these correlationKeys to resolve against a WAITING CallbackRegistration,
 * the registration must have been created with the same external ID as its correlationKey.
 * The current `ApplySignalService` defaults to `documentId` when no correlationKey is
 * supplied by the runtime effect; the transition to per-channel external IDs is a TODO
 * in `ComplianceService.send()` (arm callback with transmit ref after success).
 *
 * Until that wiring is complete, the generic `/compliance/inbound/:channel` endpoint
 * (which accepts a caller-supplied `correlationKey`) remains the authoritative path.
 * These parsers are the correct foundation for when the full wiring is in place.
 */

import { ChannelType } from '../../types';
import { InboundInput } from './inbound-router';

// ---------------------------------------------------------------------------
// PDP — France Plateforme de Dématérialisation Partenaire
// ---------------------------------------------------------------------------

/**
 * SuperPDP proprietary webhook payload.
 * Sent when the lifecycle status of a deposited invoice changes.
 *
 * SuperPDP pushes to a registered webhook URL; authenticate via `x-compliance-secret`
 * or HMAC signature (TODO: add HMAC verification once the spec is published).
 */
export interface PdpWebhookPayload {
  /** SuperPDP numeric invoice ID (matches the ref stored at transmit time). */
  invoice_id: number;
  /** Latest lifecycle code (fr:200, fr:205, fr:210, api:accepted, …). */
  status_code: string;
  /** Our own tracking ID passed at submission (`external_id`). */
  external_id?: string;
  /** ISO timestamp of the status change. */
  timestamp?: string;
  /** Raw event type (invoice.status_updated, invoice.accepted, …). */
  event?: string;
}

export function parsePdpWebhook(body: PdpWebhookPayload): InboundInput {
  const invoiceId = String(body.invoice_id);
  return {
    channel: 'PDP' as ChannelType,
    correlationKey: invoiceId,
    status: body.status_code,
    rawRef: `pdp:${invoiceId}:${body.status_code}:${body.timestamp ?? Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// SdI — Italy Sistema di Interscambio
// ---------------------------------------------------------------------------

/**
 * SdI notifica payload (canonical JSON form, as delivered by the intermediary).
 *
 * SdI is XML-native (SDICoop SOAP); the intermediary translates notifiche to JSON
 * before pushing to the webhook. Authenticity verification: mTLS or HMAC at the
 * transport layer (TODO: intermediary-specific; add a seam for signature check).
 *
 * Notifica types that drive the lifecycle (see SdiClient.mapNotifica for full mapping):
 *   RC — Ricevuta di Consegna → CLEARED
 *   NS — Notifica di Scarto   → REJECTED
 *   MC — Mancata Consegna     → PENDING (retry)
 *   NE — Notifica Esito       → CLEARED (EC01) or REJECTED (EC02)
 *   DT — Decorrenza Termini   → CLEARED
 *   AT — Avvenuta Trasmissione → CLEARED
 */
export interface SdiNotificaWebhookPayload {
  /** Notifica type. */
  type: 'RC' | 'NS' | 'MC' | 'NE' | 'DT' | 'AT';
  /** SdI document identifier (numeric). */
  idSdI: number;
  /** ISO timestamp from SdI. */
  dataOraRicezione: string;
  /** Present on NS — description of the rejection error. */
  descrizioneErrore?: string;
  /** Present on NE — buyer outcome code. */
  esitoCommittente?: 'EC01' | 'EC02';
}

/**
 * Convert a SdI notifica webhook payload to an InboundInput.
 *
 * The `status` string is designed to match the keywords in `LifecycleRuntime.eventForStatus()`:
 *   RC/AT/DT/NE-EC01 → includes "consegn" or "accept" → CLEAR event
 *   NS/NE-EC02        → includes "scart" or "refus"   → REJECT event
 *   MC                → includes nothing terminal      → NOOP (stays PENDING)
 */
export function parseSdiNotifica(body: SdiNotificaWebhookPayload): InboundInput {
  const idSdI = String(body.idSdI);

  let status: string;
  switch (body.type) {
    case 'RC': status = 'notifica RC - consegnata (delivery receipt)'; break;
    case 'NS': status = `notifica NS - scartata${body.descrizioneErrore ? `: ${body.descrizioneErrore}` : ''}`; break;
    case 'MC': status = 'notifica MC - mancata consegna (retry pending)'; break;
    case 'NE':
      status = body.esitoCommittente === 'EC01'
        ? 'notifica NE - esito accettazione EC01'
        : body.esitoCommittente === 'EC02'
          ? 'notifica NE - esito rifiuto EC02'
          : 'notifica NE - esito sconosciuto';
      break;
    case 'DT': status = 'notifica DT - decorrenza termini (consegnata - deemed delivered)'; break;
    case 'AT': status = 'notifica AT - avvenuta trasmissione (consegnata)'; break;
    default: status = `notifica ${body.type}`; break;
  }

  return {
    channel: 'SDI' as ChannelType,
    correlationKey: idSdI,
    status,
    rawRef: `sdi:${idSdI}:${body.type}:${body.dataOraRicezione}`,
  };
}

// ---------------------------------------------------------------------------
// Peppol — Invoice Response / Message Level Response (MLR)
// ---------------------------------------------------------------------------

/**
 * Peppol Invoice Response (IMR) or MLR webhook payload.
 *
 * This is pushed to us by the AP gateway when:
 *   1. The receiver's AP returns an AS4 receipt (delivery confirmed).
 *   2. The receiver (buyer) sends back a structured Invoice Response (BIS 36a / BIS 3 CIUS).
 *
 * Response codes (BIS 3 / ISO 20022):
 *   AB = accepted (invoice received and will be processed)
 *   RE = rejected (invoice rejected by buyer)
 *   UQ = under query (buyer is querying)
 *   AP = acknowledged (in process)
 *
 * LIVE PROOF: DEFERRED — requires a connected Access Point.
 */
export interface PeppolMlrWebhookPayload {
  /** AP gateway message ID (matches the ref stored at transmit time). */
  messageId: string;
  /**
   * Response / delivery status code.
   * DELIVERED = AS4 receipt; AB/RE/UQ/AP = Invoice Response.
   */
  responseCode: 'DELIVERED' | 'AB' | 'RE' | 'UQ' | 'AP' | 'FAILED';
  /** Human-readable description (rejection reason, MLR note, etc.). */
  description?: string;
  /** ISO timestamp of the event. */
  timestamp?: string;
}

export function parsePeppolMlr(body: PeppolMlrWebhookPayload): InboundInput {
  let status: string;
  switch (body.responseCode) {
    case 'DELIVERED': status = 'peppol AS4 delivered - consegnata'; break;
    case 'AB':        status = 'peppol invoice response AB - accepted'; break;
    case 'RE':        status = `peppol invoice response RE - rejected${body.description ? `: ${body.description}` : ''}`; break;
    case 'UQ':        status = 'peppol invoice response UQ - under query'; break;
    case 'AP':        status = 'peppol invoice response AP - in process'; break;
    case 'FAILED':    status = `peppol delivery failed${body.description ? `: ${body.description}` : ''}`; break;
    default:          status = `peppol status: ${body.responseCode}`; break;
  }

  return {
    channel: 'PEPPOL' as ChannelType,
    correlationKey: body.messageId,
    status,
    rawRef: `peppol:${body.messageId}:${body.responseCode}:${body.timestamp ?? Date.now()}`,
  };
}
