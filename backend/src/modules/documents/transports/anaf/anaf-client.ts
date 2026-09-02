/**
 * Romania ANAF SPV / e-Factura client — RO's national clearance channel (Legea 296/2023's own
 * e-Factura obligation, resting on the EU's own derogation, Council Implementing Decision (EU)
 * 2023/1553 — see `../channel-policy/data/ro.json`'s own citation).
 *
 * REPRISED AND ADAPTED from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/anaf-client.ts` + `anaf-transmission.ts`) — the SHAPE kept,
 * unchanged: `PUT {baseUrl}/upload?standard=UBL&cif={cif}` (raw UBL bytes, `Content-Type: text/plain`),
 * `GET {baseUrl}/stareMesaj?id_incarcare={id}`, and `mapAnafStatus` (`ok`→CLEARED, `nok`→REJECTED, else
 * PENDING) — the repère's own reading of this API's lifecycle, kept as this file's own.
 *
 * TWO deliberate DEPARTURES from the repère's own scaffold, both because this session had a real,
 * reachable source the repère (its own header: "no ANAF sandbox credentials available") did not:
 *
 *  1. HOST — the repère guessed `https://api.anaf.ro/{test,prod}/FCTEL/rest`. This session fetched
 *     ANAF's own published endpoint page directly
 *     (`static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/url_eFactura.html`, verified reachable
 *     2026-09-02) and the REAL host is `webserviceapl.anaf.ro` — already documented in
 *     `CREDENTIALS_GUIDE.md` §5, and now also `../anaf-transport.ts`'s own `ANAF_URLS`. Shipping the
 *     repère's unverified guess would have built a client that could never reach the real sandbox even
 *     with real credentials — the same class of mistake `chorus-pro/choruspro-client.ts`'s own header
 *     caught, independently, for PISTE's own OAuth host.
 *  2. RESPONSE SHAPE — the repère modeled `uploadInvoice`/`getStatus` as JSON (`data.id_incarcare`,
 *     `data.stare`). ANAF's real e-Factura REST API answers with a small XML `<header>` element
 *     (`ExecutionStatus`/`index_incarcare` on upload; `stare` on `stareMesaj`; a child `<Errors
 *     errorMessage="…">` on failure) — well-documented, well-known behavior of this API, never a JSON
 *     body. Modeling it as JSON would silently fail to read every real ANAF response, the exact "looks
 *     fine but isn't" failure this codebase's own discipline exists to catch before a live round-trip
 *     ever does. `@xmldom/xmldom` is already a whitelisted dependency (`transports/sdi/xml-helpers.ts`)
 *     — reused here, never a hand-written XML parser of this file's own.
 *
 * OAuth2 — the repère's own `_getToken` used `client_credentials` as an ADMITTED placeholder ("actual
 * live flow requires PKI cert"). The REAL ANAF flow needs a qualified Romanian certificate presented
 * ONCE, interactively, in a browser (`logincert.anaf.ro`'s own "Select a Certificate" prompt —
 * `CREDENTIALS_GUIDE.md` §5, "Hard blocker for CI/automation: … no headless/service-account path").
 * What this channel's CONNECTED credentials actually are, then, is exactly what a company can obtain
 * without this app ever driving that browser flow itself: the REFRESH token that interactive step
 * produces (365-day validity), plus the OAuth client id/secret needed to exchange it for a fresh access
 * token (`grant_type=refresh_token`, Basic-Auth'd) — never an access token pasted directly (90-day
 * validity, and pointless to make a company keep re-pasting one by hand). This client caches the access
 * token it obtains FROM that refresh token in memory, the same "one instance per call, no shared state
 * beyond a short-lived token cache" discipline `pdp/pdp-client.ts#authenticate`/
 * `chorus-pro/choruspro-client.ts` already hold.
 *
 * VERIFIED LIVE, THIS SESSION (2026-09-02), from this checkout's own network: `POST
 * https://logincert.anaf.ro/anaf-oauth2/v1/token` (Basic-Auth'd, `grant_type=refresh_token`) resolves
 * and answers a REAL, deterministic `HTTP 400 {"error":"invalid_client","error_description":"Invalid
 * client_id …"}` for a garbage client id/secret/refresh token — a genuine rejection, not a network-level
 * guess (`31-national-channels.cy.ts`'s own ANAF wave sends exactly this against the real host).
 *
 * NOT independently verified live: the exact attribute name ANAF's upload response carries for the
 * upload id (no ANAF sandbox credentials exist in this checkout — `CREDENTIALS_GUIDE.md` §5, "Repo
 * status: 🔴 missing" — so an actual `PUT /upload` was never attempted). Public documentation and OSS
 * implementations of this API agree on `index_incarcare`; this client also probes the camelCase
 * spelling defensively, the same dual-key hedge the repère's own JSON parsing already made
 * (`data.id_incarcare ?? data.idIncarcare`) for the identical reason: nothing here has actually SEEN a
 * real response to be certain of the casing.
 *
 * OUT OF SCOPE, same as the repère: `listaMesajeFactura`/`descarcare` (downloading ANAF's own signed
 * response). Nothing in this wave's own transport/poller needs them; a future inbound/archival flow can
 * add them from the endpoint list already documented in `CREDENTIALS_GUIDE.md` §5, never guessed at.
 */
import { DOMParser, Element as XmlElement } from '@xmldom/xmldom';

export interface AnafClientConfig {
  /** e.g. `https://webserviceapl.anaf.ro/test/FCTEL/rest` (sandbox) or `.../prod/FCTEL/rest`. */
  baseUrl: string;
  /** `https://logincert.anaf.ro/anaf-oauth2/v1/token` — the SAME host for TEST and PROD
   *  (`CREDENTIALS_GUIDE.md` §5: "ANAF does not separate test vs prod OAuth apps or certificates"). */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** The 365-day refresh token a company obtained through the interactive certificate flow — see this
   *  file's own header on why this, never a pasted access token, is the credential this client keeps. */
  refreshToken: string;
  /** The SELLER's own CUI/CIF, digits only, no "RO" prefix — identifies which SPV-enrolled company is
   *  uploading, never the buyer's (see `../anaf-transport.ts`'s own header on why no separate
   *  recipient-identifier gate exists here, unlike Peppol's participant id or Chorus Pro's SIRET). */
  cif: string;
}

export class AnafApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(`ANAF ${endpoint}: ${message}`);
    this.name = 'AnafApiError';
  }
}

export interface AnafUploadResult {
  /** `index_incarcare` — the upload id used to poll `stareMesaj`. Never empty: see `uploadInvoice`'s
   *  own hard-success contract below — this field only ever carries a genuine, non-empty id. */
  idIncarcare: string;
  /** The raw XML `<header>` response, kept verbatim — same "diagnose from what was actually received"
   *  discipline `RawAuthorityEvent.rawPayload` already holds. */
  raw: string;
}

export interface AnafStatusResult {
  /** ANAF's own vocabulary: `'in prelucrare'` (still processing) | `'ok'` (cleared) | `'nok'`
   *  (rejected) | any other string ANAF happens to answer with — see `mapAnafStatus` below for how this
   *  maps to the canonical CLEARED/REJECTED/PENDING trio. */
  stare: string;
  /** Populated from the response's own `<Errors errorMessage="…">` children — empty when ANAF gave
   *  none (the ordinary case while still `'in prelucrare'`). */
  errors: string[];
  raw: string;
}

interface AnafTokenState {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Reads the response's own `<header …>` element attributes and any `<Errors errorMessage="…">`
 * children — namespace-agnostic (`getElementsByTagNameNS('*', …)`), the same defensive stance
 * `sdi/xml-helpers.ts#firstByLocalName` already takes for the identical reason: the read spec fixes
 * element/attribute NAMES, never which namespace prefix a given response happens to bind them to.
 * Never throws — a response that fails to parse as XML at all yields no attributes and no errors, and
 * the caller's own "no id_incarcare" / "stare defaults to in prelucrare" fallbacks take it from there.
 */
function parseAnafHeader(xml: string): { attr: (name: string) => string | undefined; errors: string[] } {
  let header: XmlElement | null = null;
  try {
    const doc = new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
    header = doc?.documentElement ?? null;
  } catch {
    header = null;
  }
  const errors: string[] = [];
  if (header) {
    const errorNodes = header.getElementsByTagNameNS('*', 'Errors');
    for (let i = 0; i < errorNodes.length; i++) {
      const msg = errorNodes.item(i)?.getAttribute('errorMessage');
      if (msg) errors.push(msg);
    }
  }
  return { attr: (name: string) => header?.getAttribute(name) || undefined, errors };
}

export class AnafClient {
  private token: AnafTokenState | null = null;

  constructor(private readonly config: AnafClientConfig) {}

  /**
   * Exchanges the connected refresh token for a fresh access token — see this file's own header on
   * why REFRESH, never `client_credentials` (the repère's own admitted placeholder) or a pasted access
   * token, is the real ANAF flow. Cached in memory until 60s before expiry, the same skew allowance
   * `pdp/pdp-client.ts#authenticate` already uses.
   */
  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) {
      return this.token.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken,
    });
    const basicAuth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AnafApiError(
        `authentication failed (HTTP ${res.status}) — ${text.slice(0, 300)}`,
        res.status,
        'token',
      );
    }
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      throw new AnafApiError(
        'authentication succeeded but the response carried no access_token',
        res.status,
        'token',
      );
    }
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.accessToken;
  }

  /**
   * Uploads a UBL e-Factura — `PUT {baseUrl}/upload?standard=UBL&cif={cif}`, raw XML body. Returns the
   * upload id (`index_incarcare`) needed to poll `stareMesaj`.
   * @throws AnafApiError on an HTTP-level failure, OR when ANAF answers 2xx with no usable id — an
   *   accepted upload with an EMPTY id is a FAILURE here, never a silent success (this file's own
   *   hard-success contract, the same one every transport in this directory already enforces).
   */
  async uploadInvoice(ublXml: string): Promise<AnafUploadResult> {
    const token = await this.authenticate();
    const url = `${this.config.baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(this.config.cif)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain; charset=UTF-8' },
      body: ublXml,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new AnafApiError(
        `upload failed (HTTP ${res.status}) — ${text.slice(0, 300)}`,
        res.status,
        'upload',
      );
    }
    const header = parseAnafHeader(text);
    const idIncarcare = header.attr('index_incarcare') ?? header.attr('indexIncarcare');
    if (!idIncarcare) {
      const detail =
        header.errors.length > 0 ? header.errors.join('; ') : text.slice(0, 300) || '(empty response)';
      throw new AnafApiError(`upload rejected — ${detail}`, res.status, 'upload');
    }
    return { idIncarcare, raw: text };
  }

  /**
   * Polls the processing status of a previous upload — `GET {baseUrl}/stareMesaj?id_incarcare={id}`.
   * @throws AnafApiError on an HTTP-level failure only — an ANAF `stare` of `'nok'` is a normal,
   *   successfully-read OUTCOME (see `mapAnafStatus`), never an exception.
   */
  async getStatus(idIncarcare: string): Promise<AnafStatusResult> {
    const token = await this.authenticate();
    const url = `${this.config.baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(idIncarcare)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new AnafApiError(
        `stareMesaj failed (HTTP ${res.status}) — ${text.slice(0, 300)}`,
        res.status,
        'stareMesaj',
      );
    }
    const header = parseAnafHeader(text);
    const stare = header.attr('stare') ?? 'in prelucrare';
    return { stare, errors: header.errors, raw: text };
  }
}

/**
 * ANAF's own vocabulary → the canonical CLEARED/REJECTED/PENDING trio — REPRISED verbatim from the
 * repère's own `mapAnafStatus` (same three buckets, same case-insensitive matching). Used by BOTH
 * `../conformity/pollers/anaf-status-poller.ts#isTerminal` and its own `reason` extraction — never a
 * second, poller-local copy of the same mapping table (the same discipline
 * `chorus-pro-status-poller.ts`'s own header holds for `mapChorusProStatus`).
 */
export function mapAnafStatus(stare: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const s = (stare ?? '').toLowerCase();
  if (s === 'ok') return 'CLEARED';
  if (s === 'nok' || s.includes('erori') || s.includes('error')) return 'REJECTED';
  return 'PENDING'; // 'in prelucrare' = still processing, and any other/unknown string, alike.
}
