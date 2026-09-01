/**
 * Peppol Access Point (AP) gateway client — the GENERIC corner-2 REST adapter, REPRISED and adapted
 * from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/peppol/peppol-client.ts`) to THIS architecture's own transport
 * contract (`../transport-registry.ts`).
 *
 * The 4-corner model:
 *   C1 (Sender)  → C2 (Sender's AP)  →[AS4]→ C3 (Receiver's AP)  → C4 (Receiver)
 *
 * This client wraps a hosted AP gateway (corner 2), which handles the AS4/ebMS3 SOAP protocol,
 * digital signatures, and message delivery to the receiver's AP (corner 3). It does NOT implement raw
 * AS4/ebMS3 crypto — that is the AP vendor's own responsibility, exactly like the repère's own header
 * already documented.
 *
 * API model (unchanged from the repère — the "common denominator" every hosted AP vendor's REST API
 * shares): `POST {accessPointUrl}/api/v1/send` with a JSON body carrying the base64 document bytes,
 * returning `{messageId, status?}`; `GET {accessPointUrl}/api/v1/status/{messageId}` returning the
 * current delivery status.
 *
 * WHAT WAS DROPPED from the repère's own port, deliberately, not by oversight: `sendInvoiceResponse`
 * (Peppol Invoice Response / MLR relay) — nothing in this codebase's reception direction
 * (`reception/`... actually this branch's own `documents` module has no inbound Peppol handler at
 * all) ever calls it; carrying dead surface area across the reprise would be pretending a capability
 * exists that nothing wires up. Re-add it the day an inbound flow needs it, from the SAME repère file
 * (git show avant-refonte-documents:.../peppol-client.ts), not invented fresh.
 *
 * LIVE STATUS: this generic gateway remains what the repère already called it — "live-deferred": it
 * models the common REST denominator and needs a concrete connected AP (Basware, Pagero, Qvalia, or a
 * self-hosted phase4/oxalis-ng — see `PEPPOL_AP_RESEARCH.md`). The ACTUAL live attempt this task ran
 * went through the peppol.sh adapter instead (`peppol-sh-client.ts`, zero-secret sandbox) — see that
 * file's own header and `LIVE_TESTING.md` for the raw result.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeppolSendRequest {
  /** Sender Peppol participant ID (e.g. '0009:12345678900011') — the SELLER's own, read from this
   *  company's connected channel credentials (`../peppol-transport.ts#PeppolCredentials`). */
  senderParticipantId: string;
  /** Receiver Peppol participant ID (icd:identifier) — the CLIENT's own `PEPPOL_ENDPOINT` party
   *  identifier (`../peppol-transport.ts`'s own header on why this is required explicitly, never
   *  guessed). */
  receiverParticipantId: string;
  /** Peppol document type identifier (full BUSDOX URN) — see `PEPPOL_DOC_TYPES` below. */
  documentTypeId: string;
  /** Peppol process identifier (default: `PEPPOL_BILLING_PROCESS_ID`). */
  processId: string;
  /** The Peppol BIS UBL document bytes (`formats/peppol-bis-provider.ts`'s own build result — ALREADY
   *  gated valid by that provider's base EN 16931 + Peppol BIS Schematron before this client ever
   *  sees them). */
  documentBytes: Uint8Array;
  /** Optional idempotency key — this transport passes the document's own display number. */
  idempotencyKey?: string;
}

export interface PeppolSendResult {
  /** AP-assigned message ID, used to poll status — an EMPTY one is a failure, never a silent success
   *  (`../peppol-transport.ts`'s own hard-success contract, this task's own mutation #1). */
  messageId: string;
  status: 'QUEUED' | 'SENT';
}

export type PeppolDeliveryStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';

export interface PeppolStatusResult {
  messageId: string;
  status: PeppolDeliveryStatus;
  /** Populated only on a FAILED status, when the AP explained itself. */
  mlrCode?: string;
  mlrDescription?: string;
}

/**
 * Port for the Peppol Access Point gateway REST API — injectable in tests (`peppol-client.spec.ts`
 * runs this against a REAL local HTTP stub, never a `jest.mock` of `fetch`, so the actual request/
 * response wiring is proven, not merely asserted).
 */
export interface PeppolApPort {
  /** Submit a document via the configured AP gateway. Returns a messageId for status tracking. */
  send(request: PeppolSendRequest): Promise<PeppolSendResult>;
  /** Poll the AP gateway for the delivery status of a previously sent message. */
  getStatus(messageId: string): Promise<PeppolStatusResult>;
}

// ---------------------------------------------------------------------------
// Standard Peppol constants — REPRISED verbatim from the repère (unchanged, standard URNs).
// ---------------------------------------------------------------------------

/** Default Peppol BIS Billing 3 process ID. */
export const PEPPOL_BILLING_PROCESS_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** Peppol BIS Billing 3 document type — the ONE this transport ever sends (an invoice; this codebase
 *  has no credit-note transport wiring today, see `../transport-registry.ts`'s own header: "See
 *  invoice-actions.ts's 'send' for the one caller today"). */
export const PEPPOL_DOC_TYPES = {
  INVOICE_UBL:
    'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0::2.1',
};

// ---------------------------------------------------------------------------
// Real AP gateway HTTP implementation
// ---------------------------------------------------------------------------

export interface PeppolApClientConfig {
  /** AP gateway base URL (e.g. 'https://ap.myvendor.com') — a company's OWN connected credential
   *  (`PROVIDER_FIELDS.peppol` on the settings screen), never a hardcoded constant. */
  accessPointUrl: string;
  apiKey: string;
  environment: 'TEST' | 'PROD';
}

/**
 * HTTP client for a generic Peppol AP gateway REST API — the common pattern used by hosted AP
 * vendors. The actual API shape varies per vendor; this models the common JSON denominator, same as
 * the repère's own client.
 */
export class PeppolApHttpClient implements PeppolApPort {
  constructor(private readonly config: PeppolApClientConfig) {}

  async send(request: PeppolSendRequest): Promise<PeppolSendResult> {
    const url = `${this.config.accessPointUrl.replace(/\/$/, '')}/api/v1/send`;

    const body = {
      sender: request.senderParticipantId,
      receiver: request.receiverParticipantId,
      documentTypeId: request.documentTypeId,
      processId: request.processId,
      document: Buffer.from(request.documentBytes).toString('base64'),
      idempotencyKey: request.idempotencyKey,
      environment: this.config.environment,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Peppol AP send failed: HTTP ${response.status} — ${text}`);
    }

    const result = (await response.json()) as { messageId?: string; status?: string };
    return {
      messageId: result.messageId ?? '',
      status: result.status === 'SENT' ? 'SENT' : 'QUEUED',
    };
  }

  async getStatus(messageId: string): Promise<PeppolStatusResult> {
    const url = `${this.config.accessPointUrl.replace(/\/$/, '')}/api/v1/status/${encodeURIComponent(messageId)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Peppol AP status check failed: HTTP ${response.status} — ${text}`);
    }

    const result = (await response.json()) as {
      messageId?: string;
      status: string;
      mlrCode?: string;
      mlrDescription?: string;
    };

    return {
      messageId: result.messageId ?? messageId,
      status: this.normalizeStatus(result.status),
      mlrCode: result.mlrCode,
      mlrDescription: result.mlrDescription,
    };
  }

  private normalizeStatus(raw: string): PeppolDeliveryStatus {
    switch (raw?.toUpperCase()) {
      case 'QUEUED':
        return 'QUEUED';
      case 'SENT':
      case 'TRANSMITTED':
        return 'SENT';
      case 'DELIVERED':
      case 'ACKNOWLEDGED':
        return 'DELIVERED';
      case 'FAILED':
      case 'ERROR':
      case 'REJECTED':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }
}
