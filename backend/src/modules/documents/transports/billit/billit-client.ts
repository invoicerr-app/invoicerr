/**
 * HTTP client for Billit (`billit.be`) - a Belgian Peppol access point, also registered by the DGFiP
 * as a French "plateforme agreee". Dependency-free (bare `fetch`), the same shape
 * `transports/pdp/pdp-client.ts` and `transports/ksef/ksef-client.ts` already hold: one client per
 * platform, parameterized entirely by what the company configured, never by a module-level constant.
 *
 * ## Authentication - two headers, not one
 *
 * Billit does not use OAuth for this integration path. Every call carries BOTH:
 *   - `apikey`   - the account's secret key;
 *   - `partyID`  - which COMPANY of that account the call acts for.
 * Both header names are written exactly like that in Billit's own examples
 * (https://docs.billit.be/docs/partyid-and-key), lower-case `apikey` and a capital `ID` on `partyID`.
 * HTTP header names are case-insensitive on the wire, so the casing here is documentation rather
 * than a functional requirement - it is kept verbatim so a reader comparing this file against their
 * documentation finds the same strings.
 *
 * `partyID` is CONFIGURATION, never a constant, for two independent reasons Billit documents
 * itself: the PartyID of the same company differs between sandbox and production, and an account
 * holding several companies has one PartyID per company while a single API key covers them all. That
 * is why `BillitCredentials` below carries it alongside the key and the base URL, and why
 * `billit-transport.ts` refuses to send when any of the three is missing.
 *
 * ## The one deposit endpoint this client uses
 *
 * `POST {baseUrl}/peppol/sendxml` takes a JSON body `{ "XML": "<the UBL document>" }` and, on
 * HTTP 200, answers with the `InboxItemID` that identifies the submission from then on
 * (https://docs.billit.be/docs/send-ubl-to-peppol-1). Billit runs the Open/Peppol validation rules
 * on the document BEFORE accepting it: a non-compliant document comes back as HTTP 400 with a
 * `Code`/`Description` pair and is never sent (https://docs.billit.be/docs/possible-errors).
 *
 * Deliberately NOT the alternative `POST /v1/orders` route, which takes Billit's own JSON invoice
 * model and lets Billit build the UBL: this codebase already builds a Peppol BIS Billing 3.0
 * document and already gates it through the real EN 16931 + Peppol Schematron rulesets
 * (`formats/peppol-bis-provider.ts`), so handing Billit that exact artifact keeps ONE source of
 * truth for the wire format instead of two that can drift.
 *
 * `getParticipantInformation` is the read-only Peppol directory lookup
 * (https://docs.billit.be/docs/check-via-api) - it is NOT used by `send()`, which would only be
 * slowed down by a second round-trip that Billit itself already performs before accepting a
 * document. It exists because the live spec uses it to prove, in the same run, that the receiver it
 * deposits to is genuinely registered on the Peppol TEST network rather than assumed to be.
 */

export interface BillitCredentials {
  /** e.g. `https://api.sandbox.billit.be/v1` - sandbox and production are different hosts. */
  baseUrl: string;
  apiKey: string;
  /** Billit's own PartyID for the company this call acts for - see this file's header. */
  partyId: string;
}

/** What `POST /peppol/sendxml` answers on acceptance. `raw` is kept so a caller can log or quote the
 *  untouched response: Billit's own documentation only promises the `InboxItemID`, and this client
 *  deliberately does not pretend to know the rest of the shape. */
export interface BillitSendResult {
  inboxItemId: string;
  raw: unknown;
}

export interface BillitParticipantInformation {
  registered: boolean;
  identifier: string;
  documentTypes: string[];
  raw: unknown;
}

export class BillitApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Billit's own `Code` when it sent one (e.g. `TheCustomerDoesNotSupportPeppolForType_0`). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'BillitApiError';
  }
}

/** Billit answers a business refusal with a JSON object carrying `Code` and `Description`, but a
 *  gateway-level failure with an HTML error page (observed live: an unknown path returns IIS's own
 *  404 page, not JSON). Parsing is therefore best-effort and NEVER throws over the body shape - the
 *  status code alone is already enough to fail loudly, and a mangled body must not turn a clean
 *  "Billit refused this" into an opaque JSON parse error. */
function describeFailure(status: number, body: string): BillitApiError {
  let code: string | undefined;
  let description = body.slice(0, 500);
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.Code === 'string') code = parsed.Code;
    if (typeof parsed.Description === 'string') description = parsed.Description;
    else if (typeof parsed.Message === 'string') description = parsed.Message;
  } catch {
    // Not JSON - `description` keeps the raw (truncated) body, which is more useful than nothing.
  }
  const suffix = code ? ` (${code})` : '';
  return new BillitApiError(`Billit answered HTTP ${status}${suffix}: ${description}`, status, code);
}

/** Billit's own documentation names the field `InboxItemID`. Nothing guarantees the casing of a JSON
 *  key across an API's own versions, and the endpoint may answer with a bare number rather than an
 *  object, so every shape that can honestly be read as "the identifier Billit assigned" is accepted
 *  here - and anything else yields an EMPTY string, which `billit-transport.ts` turns into a
 *  FAILURE, never a silent success (the hard-success contract: a reference nobody can look up is not
 *  a reference at all). */
export function extractInboxItemId(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'number') return Number.isFinite(payload) ? String(payload) : '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() !== 'inboxitemid') continue;
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

export class BillitClient {
  constructor(private readonly credentials: BillitCredentials) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.credentials.apiKey,
      partyID: this.credentials.partyId,
      Accept: 'application/json',
      ...extra,
    };
  }

  private url(path: string): string {
    return `${this.credentials.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** Deposits ONE Peppol BIS Billing 3.0 UBL document. Resolves only on an accepted deposit; every
   *  other outcome throws `BillitApiError`, which `billit-transport.ts` lets propagate so BullMQ's
   *  own retries run before the send is ever recorded as failed. */
  async sendPeppolXml(xml: string): Promise<BillitSendResult> {
    const response = await fetch(this.url('/peppol/sendxml'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ XML: xml }),
    });
    const body = await response.text();
    if (!response.ok) throw describeFailure(response.status, body);

    let parsed: unknown = body.trim();
    try {
      parsed = JSON.parse(body);
    } catch {
      // A bare, unquoted identifier is still a usable answer - `extractInboxItemId` reads the string.
    }
    return { inboxItemId: extractInboxItemId(parsed), raw: parsed };
  }

  /** Peppol directory lookup for one participant identifier, e.g. `0208:0563846944` or
   *  `9925:BE0437295999`. Read-only; see this file's header for why `send()` does not call it. */
  async getParticipantInformation(identifier: string): Promise<BillitParticipantInformation> {
    const response = await fetch(
      this.url(`/peppol/participantInformation/${encodeURIComponent(identifier)}`),
      {
        method: 'GET',
        headers: this.headers(),
      },
    );
    const body = await response.text();
    if (!response.ok) throw describeFailure(response.status, body);

    const parsed = JSON.parse(body) as Record<string, unknown>;
    return {
      registered: parsed.Registered === true,
      identifier: typeof parsed.Identifier === 'string' ? parsed.Identifier : identifier,
      documentTypes: Array.isArray(parsed.DocumentTypes)
        ? parsed.DocumentTypes.filter((t): t is string => typeof t === 'string')
        : [],
      raw: parsed,
    };
  }
}
