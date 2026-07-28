/**
 * Storecove hosted Access Point adapter — implements PeppolApPort.
 *
 * Storecove (https://www.storecove.com) is an established Peppol/DBNAlliance service provider
 * with a REST API. Shapes below were verified against the public API reference
 * (https://www.storecove.com/docs/, fetched 2026-07-11):
 *
 *   - POST https://api.storecove.com/api/v2/document_submissions
 *       body DocumentSubmission: { legalEntityId: integer, routing: { eIdentifiers:
 *       [{ scheme, id }] }, document: { documentType: 'invoice', rawDocumentData:
 *       { document: <base64>, parseStrategy: 'ubl' } }, idempotencyGuid? (36 chars) }
 *       → 200 DocumentSubmissionResult { guid }
 *   - GET  /document_submissions/{guid}/evidence[/{evidence_type: sending|clearing}]
 *       → 200 DocumentSubmissionEvidence { network, sender, receiver, evidence: { message_id … },
 *         documents: [...] } once the document was transmitted (404 while still processing)
 *   - Invoice Response: POST /document_submissions with document.documentType='invoice_response',
 *       document.invoiceResponse: { responseCode: enum(AB,IP,UQ,CA,RE,AP,PD), note? } and
 *       forDocumentGuid referencing the received document.
 *   - Auth: Authorization: Bearer <api key>.
 *
 * Sending raw UBL: rawDocumentData.document carries our base64 UBL with parseStrategy 'ubl'
 * (enum ubl|cii|idoc|setu14) — a direct fit for PeppolApPort's documentBytes, no re-modelling.
 *
 * Routing schemes: Storecove eIdentifiers use country-scheme codes ('PL:VAT', 'DE:VAT', 'GLN' …),
 * NOT numeric ISO 6523 ICDs. We map the common Peppol EAS cases (99xx national VAT schemes and
 * 0088 GLN) and fall back to the raw ICD string — flagged for verification at live-proof time.
 *
 * LIVE PROOF: DEFERRED — Storecove's sandbox is a 30-day trial behind a manual account request
 * (no self-serve signup API), so this adapter ships mocked-only until credentials exist.
 * See PEPPOL_AP_RESEARCH.md §D and LIVE_TESTING.md.
 */

import type {
  PeppolApPort,
  PeppolInvoiceResponseRequest,
  PeppolSendRequest,
  PeppolSendResult,
  PeppolStatusResult,
} from './peppol-client';

export const STORECOVE_API_URL = 'https://api.storecove.com/api/v2';

export interface StorecoveClientConfig {
  /** Storecove API key (Bearer). */
  apiKey: string;
  /** The Storecove LegalEntity id documents are sent on behalf of. */
  legalEntityId: number;
  /** Optional base-URL override (default https://api.storecove.com/api/v2). */
  baseUrl?: string;
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map a Peppol participant ID (icd:identifier) to a Storecove RoutingIdentifier.
 * Verified from the docs' JSON examples: { "scheme": "PL:VAT", "id": "PL0101010101" }.
 * - 99xx EAS codes are national VAT schemes; the identifier itself starts with the country
 *   prefix (e.g. 9930:DE811907980) → scheme '<CC>:VAT'.
 * - 0088 → 'GLN'.
 * - Anything else: pass the raw ICD through (to be verified when live credentials exist).
 */
export function participantToStorecoveIdentifier(participantId: string): {
  scheme: string;
  id: string;
} {
  const [icd, ...rest] = participantId.split(':');
  const id = rest.join(':');
  if (icd === '0088') return { scheme: 'GLN', id };
  if (/^99\d{2}$/.test(icd) && /^[A-Za-z]{2}/.test(id)) {
    return { scheme: `${id.slice(0, 2).toUpperCase()}:VAT`, id };
  }
  return { scheme: icd, id };
}

export class StorecoveApClient implements PeppolApPort {
  private readonly baseUrl: string;

  constructor(private readonly config: StorecoveClientConfig) {
    this.baseUrl = (config.baseUrl ?? STORECOVE_API_URL).replace(/\/$/, '');
  }

  async send(request: PeppolSendRequest): Promise<PeppolSendResult> {
    const body = {
      legalEntityId: this.config.legalEntityId,
      routing: {
        eIdentifiers: [participantToStorecoveIdentifier(request.receiverParticipantId)],
      },
      document: {
        documentType: 'invoice',
        rawDocumentData: {
          document: request.documentBytes.toString('base64'),
          parseStrategy: 'ubl',
        },
      },
      // idempotencyGuid must be a 36-char GUID; only forward keys that already are one.
      ...(request.idempotencyKey && GUID_RE.test(request.idempotencyKey)
        ? { idempotencyGuid: request.idempotencyKey }
        : {}),
    };

    const response = await fetch(`${this.baseUrl}/document_submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Storecove send failed: HTTP ${response.status} — ${text.slice(0, 300)}`);
    }

    const result = (await response.json()) as { guid: string };
    if (!result.guid) throw new Error('Storecove send: no guid in response');
    return { messageId: result.guid, status: 'QUEUED' };
  }

  async getStatus(messageId: string): Promise<PeppolStatusResult> {
    const url = `${this.baseUrl}/document_submissions/${encodeURIComponent(messageId)}/evidence`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    // Evidence exists only after the document was transmitted; 404 = still processing.
    if (response.status === 404) {
      return { messageId, status: 'SENT' };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Storecove evidence check failed: HTTP ${response.status} — ${text.slice(0, 300)}`);
    }

    const result = (await response.json()) as {
      network?: string;
      evidence?: { message_id?: string };
    };

    return {
      messageId,
      status: 'DELIVERED',
      ...(result.evidence?.message_id
        ? { mlrDescription: `network=${result.network ?? 'peppol'} message_id=${result.evidence.message_id}` }
        : {}),
    };
  }

  /**
   * Peppol Invoice Response (BIS 3 CIUS ApplicationResponse) via Storecove:
   * documentType 'invoice_response' + forDocumentGuid referencing the original document.
   * Our AB/RE/UQ/AP codes are a strict subset of Storecove's UNCL4343 enum (AB,IP,UQ,CA,RE,AP,PD).
   */
  async sendInvoiceResponse(request: PeppolInvoiceResponseRequest): Promise<PeppolSendResult> {
    const body = {
      forDocumentGuid: request.originalMessageId,
      document: {
        documentType: 'invoice_response',
        invoiceResponse: {
          responseCode: request.responseCode,
          ...(request.description ? { note: request.description } : {}),
        },
      },
      ...(request.idempotencyKey && GUID_RE.test(request.idempotencyKey)
        ? { idempotencyGuid: request.idempotencyKey }
        : {}),
    };

    const response = await fetch(`${this.baseUrl}/document_submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Storecove invoice response failed: HTTP ${response.status} — ${text.slice(0, 300)}`);
    }

    const result = (await response.json()) as { guid: string };
    return { messageId: result.guid, status: 'QUEUED' };
  }
}
