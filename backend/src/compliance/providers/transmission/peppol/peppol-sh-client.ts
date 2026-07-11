/**
 * peppol.sh hosted Access Point adapter — implements PeppolApPort.
 *
 * peppol.sh (https://peppol.sh) is a hosted Peppol AP with a JSON REST API and a free,
 * unlimited sandbox (zero-secret self-signup — the Ethereal-email of Peppol).
 *
 * API surface (VERIFIED against the live OpenAPI at https://api.peppol.sh/v1/openapi.json
 * and a real sandbox round-trip on 2026-07-11 — see PEPPOL_AP_RESEARCH.md / LIVE_TESTING.md):
 *
 *   - POST https://api.peppol.sh/v1/signup           {email,name?} → 201 {id, api_key: ps_test_…}
 *     (public, no auth — new accounts get a sandbox key instantly)
 *   - POST {base}/v1/companies                        {name, tax_id, country, address} → 201 {id: com_…}
 *   - POST {base}/v1/documents                        JSON document + company_id → 202 {id: doc_…, status}
 *   - GET  {base}/v1/documents/{id}?company_id=com_…  → 200 full document incl. status + events
 *     (the company_id QUERY PARAM is required — undocumented in the OpenAPI, verified live)
 *
 * Environments (verified live): sandbox keys (ps_test_) are REJECTED on api.peppol.sh with
 * 403 wrong_environment — all authed sandbox calls must hit https://sandbox.peppol.sh.
 * Sandbox delivers by email instead of routing to the real Peppol network (same code path).
 *
 * Status model: queued → sending → delivered | failed
 *   → mapped to our QUEUED / SENT / DELIVERED / FAILED.
 *
 * IMPORTANT ARCHITECTURAL NOTE: unlike the generic AP gateway, peppol.sh does NOT accept raw
 * UBL bytes on POST /v1/documents (JSON model only; UBL upload exists only on POST /v1/validate).
 * This adapter therefore extracts the JSON payload from the UBL we generated ourselves
 * (invoice-rendering's EN16931 UBL builder) — a read-only extraction of a document shape we
 * control, not a home-grown schema layer. peppol.sh re-serializes to Send-ready UBL on their side
 * (GET /v1/documents/{id}/ubl).
 *
 * Peppol Invoice Response: NOT exposed by the peppol.sh API (no ApplicationResponse endpoint)
 * → sendInvoiceResponse() throws; the provider maps that to its QUEUED/note error path.
 */

import { DOMParser } from '@xmldom/xmldom';
import type {
  PeppolApPort,
  PeppolDeliveryStatus,
  PeppolInvoiceResponseRequest,
  PeppolSendRequest,
  PeppolSendResult,
  PeppolStatusResult,
} from './peppol-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Production base URL (real Peppol network; requires a ps_live_ key). */
export const PEPPOL_SH_PROD_URL = 'https://api.peppol.sh';
/** Sandbox base URL (email delivery; ps_test_ keys ONLY work here — verified live). */
export const PEPPOL_SH_SANDBOX_URL = 'https://sandbox.peppol.sh';

// ---------------------------------------------------------------------------
// peppol.sh JSON document model (subset we emit)
// ---------------------------------------------------------------------------

export interface PeppolShParty {
  name: string;
  /** VAT / tax ID — peppol.sh resolves the Peppol scheme from it. */
  tax_id: string;
  /** Explicit Peppol participant ID (scheme:id) — overrides tax_id lookup. */
  peppol_id?: string;
}

export interface PeppolShLine {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  /** UN/CEFACT unit code (default C62). */
  unit?: string;
}

export interface PeppolShDocumentPayload {
  type: 'invoice' | 'credit_note';
  number: string;
  issue_date: string;
  due_date?: string;
  currency: string;
  from: PeppolShParty;
  to: PeppolShParty;
  lines: PeppolShLine[];
}

// ---------------------------------------------------------------------------
// UBL → peppol.sh JSON extraction (operates on OUR generated EN16931/BIS UBL)
// ---------------------------------------------------------------------------

type XmlElement = ReturnType<DOMParser['parseFromString']>['documentElement'];

/** Direct children of `el` whose localName matches (namespace-agnostic). */
function childrenByLocalName(el: XmlElement, localName: string): XmlElement[] {
  const out: XmlElement[] = [];
  const nodes = el?.childNodes;
  if (!nodes) return out;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes.item(i) as XmlElement | null;
    if (n && n.nodeType === 1 && n.localName === localName) out.push(n);
  }
  return out;
}

function child(el: XmlElement, localName: string): XmlElement | null {
  return childrenByLocalName(el, localName)[0] ?? null;
}

function childText(el: XmlElement | null, localName: string): string | null {
  if (!el) return null;
  const c = child(el, localName);
  const text = c?.textContent?.trim();
  return text ? text : null;
}

function descend(el: XmlElement | null, ...path: string[]): XmlElement | null {
  let cur: XmlElement | null = el;
  for (const name of path) {
    if (!cur) return null;
    cur = child(cur, name);
  }
  return cur;
}

function extractParty(root: XmlElement, containerName: string): PeppolShParty {
  const party = descend(root, containerName, 'Party');
  const name =
    childText(descend(party, 'PartyLegalEntity'), 'RegistrationName') ??
    childText(descend(party, 'PartyName'), 'Name');
  // PartyTaxScheme/CompanyID is the VAT ID; PartyLegalEntity/CompanyID is the legal reg number.
  const taxId =
    childText(descend(party, 'PartyTaxScheme'), 'CompanyID') ??
    childText(descend(party, 'PartyLegalEntity'), 'CompanyID');

  if (!name) throw new Error(`peppol.sh adapter: UBL ${containerName} is missing a party name`);
  if (!taxId) {
    throw new Error(`peppol.sh adapter: UBL ${containerName} is missing a tax ID (PartyTaxScheme/CompanyID)`);
  }
  return { name, tax_id: taxId };
}

function extractLines(root: XmlElement, lineName: string, qtyName: string): PeppolShLine[] {
  return childrenByLocalName(root, lineName).map((line) => {
    const item = child(line, 'Item');
    const description = childText(item, 'Name') ?? childText(item, 'Description') ?? 'Line item';
    const quantity = Number.parseFloat(childText(line, qtyName) ?? '1');
    const unit = child(line, qtyName)?.getAttribute('unitCode') ?? undefined;
    const unitPrice = Number.parseFloat(childText(child(line, 'Price'), 'PriceAmount') ?? '0');
    const taxRate = Number.parseFloat(childText(descend(item, 'ClassifiedTaxCategory'), 'Percent') ?? '0');
    return {
      description,
      quantity: Number.isFinite(quantity) ? quantity : 1,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
      tax_rate: Number.isFinite(taxRate) ? taxRate : 0,
      ...(unit ? { unit } : {}),
    };
  });
}

/**
 * Extract the peppol.sh JSON document payload from a UBL Invoice / CreditNote we generated.
 * Throws with a descriptive message when a required field is absent (mapped to the provider's
 * REJECTED path — better than silently sending an invalid payload).
 */
export function ublToPeppolShDocument(xml: string): PeppolShDocumentPayload {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  if (!root) throw new Error('peppol.sh adapter: could not parse UBL document');

  const isCreditNote = root.localName === 'CreditNote';
  if (!isCreditNote && root.localName !== 'Invoice') {
    throw new Error(`peppol.sh adapter: unsupported UBL root element <${root.localName}>`);
  }

  const number = childText(root, 'ID');
  const issueDate = childText(root, 'IssueDate');
  if (!number || !issueDate) {
    throw new Error('peppol.sh adapter: UBL document is missing cbc:ID or cbc:IssueDate');
  }

  const lines = isCreditNote
    ? extractLines(root, 'CreditNoteLine', 'CreditedQuantity')
    : extractLines(root, 'InvoiceLine', 'InvoicedQuantity');
  if (lines.length === 0) throw new Error('peppol.sh adapter: UBL document has no lines');

  const dueDate = childText(root, 'DueDate');
  return {
    type: isCreditNote ? 'credit_note' : 'invoice',
    number,
    issue_date: issueDate,
    ...(dueDate ? { due_date: dueDate } : {}),
    currency: childText(root, 'DocumentCurrencyCode') ?? 'EUR',
    from: extractParty(root, 'AccountingSupplierParty'),
    to: extractParty(root, 'AccountingCustomerParty'),
    lines,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface PeppolShClientConfig {
  /** ps_test_ (sandbox) or ps_live_ (production) API key. */
  apiKey: string;
  /** peppol.sh company ID (com_…) whose provider credentials send the documents. */
  companyId: string;
  environment: 'TEST' | 'PROD';
  /** Optional base-URL override; defaults from environment (TEST → sandbox host). */
  baseUrl?: string;
}

/** Canonical peppol.sh error envelope (subset). */
interface PeppolShErrorBody {
  error?: { type?: string; code?: string; message?: string };
}

export class PeppolShApClient implements PeppolApPort {
  private readonly baseUrl: string;

  constructor(private readonly config: PeppolShClientConfig) {
    this.baseUrl =
      config.baseUrl?.replace(/\/$/, '') ||
      (config.environment === 'PROD' ? PEPPOL_SH_PROD_URL : PEPPOL_SH_SANDBOX_URL);
  }

  /**
   * Zero-secret sandbox signup (Ethereal pattern): creates an account and returns a one-time
   * ps_test_ API key. Public endpoint — always on the production host (verified live).
   */
  static async signup(email: string, name?: string): Promise<{ accountId: string; apiKey: string }> {
    const response = await fetch(`${PEPPOL_SH_PROD_URL}/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, ...(name ? { name } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`peppol.sh signup failed: HTTP ${response.status} — ${text}`);
    }
    const body = (await response.json()) as { id: string; api_key: string };
    if (!body.api_key) throw new Error('peppol.sh signup: no api_key in response');
    return { accountId: body.id, apiKey: body.api_key };
  }

  /** Create a sending company (com_…) under the account owning `apiKey`. */
  static async createCompany(
    apiKey: string,
    company: {
      name: string;
      taxId?: string;
      country?: string;
      address?: { street?: string; city?: string; postal_code?: string };
    },
    baseUrl = PEPPOL_SH_SANDBOX_URL,
  ): Promise<{ companyId: string }> {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        name: company.name,
        ...(company.taxId ? { tax_id: company.taxId } : {}),
        ...(company.country ? { country: company.country } : {}),
        ...(company.address ? { address: company.address } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`peppol.sh company creation failed: HTTP ${response.status} — ${text}`);
    }
    const body = (await response.json()) as { id: string };
    if (!body.id) throw new Error('peppol.sh company creation: no id in response');
    return { companyId: body.id };
  }

  async send(request: PeppolSendRequest): Promise<PeppolSendResult> {
    const payload = ublToPeppolShDocument(request.documentBytes.toString('utf-8'));
    // Explicit receiver Peppol ID (scheme:id) overrides peppol.sh's tax_id-based lookup.
    if (request.receiverParticipantId) payload.to.peppol_id = request.receiverParticipantId;

    const body = {
      company_id: this.config.companyId,
      ...payload,
      ...(request.idempotencyKey ? { idempotency_key: request.idempotencyKey } : {}),
    };

    const response = await fetch(`${this.baseUrl}/v1/documents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    // Verified live: peppol.sh answers 202 Accepted with {id: doc_…, status: 'queued', url}.
    if (!response.ok) {
      throw new Error(`peppol.sh send failed: ${await this.describeError(response)}`);
    }

    const result = (await response.json()) as { id: string; status?: string };
    if (!result.id) throw new Error('peppol.sh send: no document id in response');
    return {
      messageId: result.id,
      status: result.status === 'queued' ? 'QUEUED' : 'SENT',
    };
  }

  async getStatus(messageId: string): Promise<PeppolStatusResult> {
    // Verified live: the company_id query parameter is REQUIRED (400 missing_company_id without).
    const url = `${this.baseUrl}/v1/documents/${encodeURIComponent(messageId)}?company_id=${encodeURIComponent(this.config.companyId)}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`peppol.sh status check failed: ${await this.describeError(response)}`);
    }

    const result = (await response.json()) as {
      id: string;
      status: string;
      events?: { type?: string; message?: string | null }[];
    };

    const lastEventMessage = result.events?.length
      ? (result.events[result.events.length - 1]?.message ?? undefined)
      : undefined;

    return {
      messageId: result.id,
      status: this.normalizeStatus(result.status),
      ...(result.status === 'failed' && lastEventMessage ? { mlrDescription: lastEventMessage } : {}),
    };
  }

  /**
   * peppol.sh exposes no Peppol Invoice Response (ApplicationResponse) endpoint.
   * Throw so the provider surfaces its standard QUEUED/note error path.
   */
  async sendInvoiceResponse(_request: PeppolInvoiceResponseRequest): Promise<PeppolSendResult> {
    throw new Error(
      'peppol.sh does not support sending Peppol Invoice Responses (no ApplicationResponse endpoint)',
    );
  }

  /** queued → QUEUED, sending → SENT, delivered → DELIVERED, failed → FAILED (verified enum). */
  private normalizeStatus(raw: string): PeppolDeliveryStatus {
    switch (raw?.toLowerCase()) {
      case 'queued':
        return 'QUEUED';
      case 'sending':
        return 'SENT';
      case 'delivered':
        return 'DELIVERED';
      case 'failed':
        return 'FAILED';
      default:
        return 'UNKNOWN';
    }
  }

  /** Render the canonical error envelope ({error:{type,code,message}}) without leaking the key. */
  private async describeError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    try {
      const parsed = JSON.parse(text) as PeppolShErrorBody;
      if (parsed.error?.code) {
        return `HTTP ${response.status} — ${parsed.error.code}: ${parsed.error.message ?? ''}`;
      }
    } catch {
      // fall through to raw text
    }
    return `HTTP ${response.status} — ${text.slice(0, 300)}`;
  }
}
