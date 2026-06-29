/**
 * Peppol Access Point (AP) gateway client.
 *
 * The 4-corner model:
 *   C1 (Sender)  → C2 (Sender's AP)  →[AS4]→ C3 (Receiver's AP)  → C4 (Receiver)
 *
 * This client wraps a hosted AP gateway (corner 2), which handles the AS4/ebMS3 SOAP
 * protocol, digital signatures, and message delivery to the receiver's AP (corner 3).
 * We do NOT implement raw AS4/ebMS3 crypto here — that is the AP vendor's responsibility.
 *
 * API model: HTTP POST to {accessPointUrl}/send with JSON or multipart payload.
 * Each AP vendor has a slightly different REST API; we model the common denominator:
 *   - POST /send: body = { sender, receiver, documentTypeId, processId, document }
 *   - GET  /status/{messageId}: returns delivery status
 *
 * Peppol Invoice Response (IMR) / Message Level Response (MLR):
 *   The receiver's AP returns an MLR (BIS 36a v3) or Invoice Response (BIS 3 CIUS) as an
 *   async callback or polled status. We model the AP gateway's status poll for simplicity.
 *
 * LIVE PROOF: DEFERRED — requires a Peppol-connected Access Point (e.g. Basware, Pagero,
 * Qvalia, or a self-hosted oxalis-ng). All tests use a mocked PeppolApPort.
 *
 * Supported document types (primary markets FR/PL/IT per primary-markets memory):
 *   - urn:oasis:names:specification:ubl:schema:xsd:Invoice-2 (UBL Invoice BIS 3)
 *   - urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100 (CII)
 *   - urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2 (UBL Credit Note BIS 3)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeppolSendRequest {
  /** Sender Peppol participant ID (e.g. '0009:12345678900011'). */
  senderParticipantId: string;
  /** Receiver Peppol participant ID (icd:identifier). */
  receiverParticipantId: string;
  /** Peppol document type identifier (full BUSDOX URN). */
  documentTypeId: string;
  /** Peppol process identifier (default: urn:fdc:peppol.eu:2017:poacc:billing:01:1.0). */
  processId: string;
  /** The UBL/CII XML document bytes. */
  documentBytes: Buffer;
  /** Optional idempotency key. */
  idempotencyKey?: string;
}

export interface PeppolSendResult {
  /** AP-assigned message ID (used to poll status). */
  messageId: string;
  /** AP-reported initial status (queued / submitted). */
  status: 'QUEUED' | 'SENT';
}

export type PeppolDeliveryStatus =
  | 'QUEUED'
  | 'SENT'          // AP transmitted to receiver AP
  | 'DELIVERED'     // Receiver AP acknowledged (AS4 receipt)
  | 'FAILED'        // Delivery failed permanently
  | 'UNKNOWN';

export interface PeppolStatusResult {
  messageId: string;
  status: PeppolDeliveryStatus;
  /** Optional MLR/Invoice Response details. */
  mlrCode?: string;
  mlrDescription?: string;
}

// ---------------------------------------------------------------------------
// Port — swappable AP transport (real HTTP or mock in tests)
// ---------------------------------------------------------------------------

/** Peppol Invoice Response (IMR / BIS 36a / BIS 3 CIUS) send request. */
export interface PeppolInvoiceResponseRequest {
  /** Sender (buyer) Peppol participant ID. */
  senderParticipantId: string;
  /** Original seller's Peppol participant ID. */
  receiverParticipantId: string;
  /** Reference to the original invoice message ID. */
  originalMessageId: string;
  /** AB = accepted, RE = rejected, UQ = under query, AP = in process */
  responseCode: 'AB' | 'RE' | 'UQ' | 'AP';
  /** Human-readable description (reason for rejection, etc.). */
  description?: string;
  /** Optional idempotency key. */
  idempotencyKey?: string;
}

/**
 * Port for the Peppol Access Point gateway REST API.
 * Inject a mock for tests; production uses the real HTTP implementation.
 */
export interface PeppolApPort {
  /**
   * Submit a document to the Peppol network via the configured AP gateway.
   * Returns a messageId for status tracking.
   */
  send(request: PeppolSendRequest): Promise<PeppolSendResult>;

  /**
   * Poll the AP gateway for the delivery status of a previously sent message.
   */
  getStatus(messageId: string): Promise<PeppolStatusResult>;

  /**
   * Send a Peppol Invoice Response (IMR / BIS 3 CIUS / BIS 36a MLR).
   *
   * This is the buyer's structured acceptance/rejection relayed back through the Peppol
   * network to the original sender's AP. In the 4-corner model: C4 → C3 → AS4 → C2 → C1.
   *
   * Document type: urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2
   * Process: urn:fdc:peppol.eu:poacc:bis:invoice_response:3
   *
   * LIVE PROOF: DEFERRED — requires a connected Access Point.
   */
  sendInvoiceResponse(request: PeppolInvoiceResponseRequest): Promise<PeppolSendResult>;
}

// ---------------------------------------------------------------------------
// Standard Peppol constants
// ---------------------------------------------------------------------------

/** Default Peppol BIS Billing 3 process ID. */
export const PEPPOL_BILLING_PROCESS_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** Peppol BIS Billing 3 document types. */
export const PEPPOL_DOC_TYPES = {
  INVOICE_UBL: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
  CREDIT_NOTE_UBL: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2::CreditNote##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
  INVOICE_RESPONSE: 'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2::ApplicationResponse##urn:fdc:peppol.eu:poacc:trns:invoice_response:3::2.1',
};

// ---------------------------------------------------------------------------
// Real AP gateway HTTP implementation
// ---------------------------------------------------------------------------

export interface PeppolApClientConfig {
  /** AP gateway base URL (e.g. 'https://ap.myvendor.com'). */
  accessPointUrl: string;
  /** API key or Bearer token for the AP gateway. */
  apiKey: string;
  environment: 'TEST' | 'PROD';
}

/**
 * HTTP client for a generic Peppol AP gateway REST API.
 *
 * This models the common pattern used by hosted AP vendors (Pagero, Qvalia, OpenPeppol
 * test corner, etc.). The actual API shape varies per vendor — adapt the endpoint paths
 * as needed. We use a simple JSON model here.
 */
export class PeppolApHttpClient implements PeppolApPort {
  constructor(private readonly config: PeppolApClientConfig) {}

  async send(request: PeppolSendRequest): Promise<PeppolSendResult> {
    const url = `${this.config.accessPointUrl}/api/v1/send`;

    const body = {
      sender: request.senderParticipantId,
      receiver: request.receiverParticipantId,
      documentTypeId: request.documentTypeId,
      processId: request.processId,
      document: request.documentBytes.toString('base64'),
      idempotencyKey: request.idempotencyKey,
      environment: this.config.environment,
    };

    const response = await fetch(url, {
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
      throw new Error(`Peppol AP send failed: HTTP ${response.status} — ${text}`);
    }

    const result = (await response.json()) as { messageId: string; status?: string };
    return {
      messageId: result.messageId,
      status: result.status === 'SENT' ? 'SENT' : 'QUEUED',
    };
  }

  async getStatus(messageId: string): Promise<PeppolStatusResult> {
    const url = `${this.config.accessPointUrl}/api/v1/status/${encodeURIComponent(messageId)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Peppol AP status check failed: HTTP ${response.status} — ${text}`);
    }

    const result = (await response.json()) as {
      messageId: string;
      status: string;
      mlrCode?: string;
      mlrDescription?: string;
    };

    return {
      messageId: result.messageId,
      status: this.normalizeStatus(result.status),
      mlrCode: result.mlrCode,
      mlrDescription: result.mlrDescription,
    };
  }

  async sendInvoiceResponse(request: PeppolInvoiceResponseRequest): Promise<PeppolSendResult> {
    const url = `${this.config.accessPointUrl}/api/v1/invoice-response`;

    const body = {
      sender: request.senderParticipantId,
      receiver: request.receiverParticipantId,
      documentTypeId: PEPPOL_DOC_TYPES.INVOICE_RESPONSE,
      processId: 'urn:fdc:peppol.eu:poacc:bis:invoice_response:3',
      responseCode: request.responseCode,
      originalMessageId: request.originalMessageId,
      description: request.description,
      idempotencyKey: request.idempotencyKey,
      environment: this.config.environment,
    };

    const response = await fetch(url, {
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
      throw new Error(`Peppol AP invoice response failed: HTTP ${response.status} — ${text}`);
    }

    const result = (await response.json()) as { messageId: string; status?: string };
    return {
      messageId: result.messageId,
      status: result.status === 'SENT' ? 'SENT' : 'QUEUED',
    };
  }

  private normalizeStatus(raw: string): PeppolDeliveryStatus {
    switch (raw?.toUpperCase()) {
      case 'QUEUED': return 'QUEUED';
      case 'SENT':
      case 'TRANSMITTED': return 'SENT';
      case 'DELIVERED':
      case 'ACKNOWLEDGED': return 'DELIVERED';
      case 'FAILED':
      case 'ERROR':
      case 'REJECTED': return 'FAILED';
      default: return 'UNKNOWN';
    }
  }
}
