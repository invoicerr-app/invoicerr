/**
 * France Chorus Pro B2G transmission client — PISTE gateway.
 *
 * REPRISED, structurally verbatim, from git tag `avant-refonte-documents`
 * (`compliance/providers/transmission/choruspro-client.ts`) — the reference's client was written
 * against the real documentation, so every endpoint path, every request/response shape, and every
 * status-mapping table is kept exactly as that file had them. Two
 * deliberate ADAPTATIONS to the CURRENT contract, both documented at their own call site below:
 *
 *  1. `deposerFlux` takes a `Buffer` (`fileBytes`), not a UTF-8 `string` — the reference's own signature
 *     assumed a plain XML string (`Buffer.from(xmlContent, 'utf-8')`), which is safe for pure text but
 *     would CORRUPT the actual payload: the B2G FR rule (`b2g-routing/data/fr.json`) names
 *     `formatSyntax: "facturx"`, and Factur-X is a PDF/A-3 BINARY with an embedded XML (see
 *     `formats/facturx-provider.ts`) — round-tripping arbitrary binary bytes through a UTF-8 string
 *     first (`Buffer.from(str, 'utf-8')`) is lossy for any byte sequence that isn't valid UTF-8, which
 *     a PDF's binary body routinely is not. Base64-encoding the Buffer directly (`fileBytes.toString
 *     ('base64')`) is the only correct way to carry it — this is the ONE structural change from the
 *     reference, not a stylistic one.
 *  2. A REAL `FetchChorusProHttpPort` is added at the bottom (the reference's own `choruspro-transmission
 *     .ts` shipped only a `STUB_HTTP` that always threw "not implemented" — this codebase's sibling
 *     clients (`ksef/fetch-http-client.ts`) already ship a real fetch adapter, and
 *     `transports/chorus-pro-transport.ts` needs one to ever actually reach PISTE).
 *
 * Architecture (unchanged from the reference):
 *  - Platform: PISTE (Plateforme d'Intermédiation de Services pour la Transformation de l'État)
 *  - Authority: AIFE / DGFiP — Chorus Pro is the mandatory B2G invoicing portal (see
 *    `b2g-routing/data/fr.json`'s own sourced legal text: Code de la commande publique L.2192-1/-2/-5).
 *  - Scope: invoices FROM suppliers TO public entities (B2G); B2B goes via PDP (a separate channel,
 *    `transports/pdp-transport.ts`).
 *
 * Auth (two-layer, unchanged):
 *  1. PISTE OAuth2 client_credentials → Bearer token for API access.
 *     POST https://[sandbox-]oauth.piste.gouv.fr/api/oauth/token
 *       grant_type=client_credentials&client_id=…&client_secret=…&scope=openid
 *  2. Chorus Pro technical account ("compte technique") → sent in cpro-account header.
 *     cpro-account: base64(login:password)   (always present)
 *
 * API "Factures" v1.0.0 — PISTE base:
 *   Sandbox: https://sandbox-api.piste.gouv.fr
 *   Prod:    https://api.piste.gouv.fr
 *   Base path: /cpro/factures/v1
 *
 * Key operations:
 *  - deposerFlux  : POST /cpro/factures/v1/deposer/flux            (API "Factures" — cpro.factures)
 *  - consulterCr  : POST /cpro/transverses/v1/consulterCRDetaille  (API "Transverses" — cpro.transverses)
 *    ^ NOT under /cpro/factures — see the dated correction note below. This is the single most
 *    consequential fact in this file: get it wrong and every deposit round-trips a 404 on read-back.
 *
 * VERIFIED LIVE (2026-09-02): the OAuth endpoint at
 * `https://sandbox-oauth.piste.gouv.fr/api/oauth/token` (the reference's own hostname) resolves and
 * answers a REAL `HTTP 400 {"error":"invalid_client", ...}` for a garbage client_id/secret — a real,
 * deterministic rejection, not a network-level guess. `documentation/docs/developer-guide/credentials-guide.md` §3 names a DIFFERENT
 * sandbox OAuth hostname (`sandbox-oauth.aife.economie.gouv.fr`), which does NOT resolve from here at
 * all (`curl`: "Could not resolve host") — the reference's own hostname is the one this file keeps, being
 * the one actually reachable and answering the expected OAuth error shape; `documentation/docs/developer-guide/credentials-guide.md`'s
 * name is flagged, not silently trusted or silently overwritten (a real PISTE account is still needed
 * to know for certain which one a production application should target).
 *
 * CORRECTED 2026-09-14 — the reference's own `consulterCr` route (`/cpro/factures/v1/consulter/cr`,
 * kept verbatim from `avant-refonte-documents` and never independently re-verified) does NOT exist.
 * Established on the OFFICIAL Swagger 2.0 definitions for BOTH PISTE sandbox APIs, fetched by `curl`
 * (`index.php?...&task=ajaxrequest.swaggerLoad&apiId=...`, the same JSON the "Download the
 * documentation — Swagger 2.0" button on https://piste.gouv.fr/api-catalog-sandbox serves — no
 * authentication required beyond the guest session PISTE hands out to a plain page load):
 *  - API "Factures" v1.0.0 (apiId `10175213-109c-4423-a7ab-05e7a051ea82`, `resourcePath: "/cpro/factures"`)
 *    lists exactly 22 operations. `deposer/flux` (nickname `deposerFluxFacture`) IS one of them, at the
 *    EXACT path this file already had: `/cpro/factures/v1/deposer/flux`, `responseClass:
 *    "WsRetourDeposerFluxFacture"` (properties: `codeRetour`, `dateDepot`, `libelle`,
 *    `numeroFluxDepot`, `syntaxeFlux` — no `statut`/`statutFlux` field at all; `numeroFluxDepot` IS the
 *    field this file reads for the deposit id, confirmed). `consulter/cr` is NOT among the 22 — no
 *    operation on that resource path resembles it.
 *  - API "Transverses" v1.0.0 (apiId `5c95c27b-4f81-49d1-aa13-722cff2474f5`, `resourcePath:
 *    "/cpro/transverses"`, SAME `basePath: "https://sandbox-api.piste.gouv.fr"` as Factures — one
 *    PISTE gateway host, many resource path prefixes) carries the actual CR-retrieval operations, verbatim
 *    from its Swagger `summary`/`notes`:
 *      `POST /v1/consulterCR` (nickname `consulterCR`, `responseClass: "WsRetourConsulterCR"`):
 *        "Le service ConsulterCR permet de consulter les informations liées au dépôt d'un flux et de
 *         récupérer au format PDF le compte rendu de traitement du flux déposé via le portail ou le
 *         service exposé DeposerFluxFacture."
 *      `POST /v1/consulterCRDetaille` (nickname `consulterCRDetaille`, `responseClass:
 *        "WsRetourConsulterCRDetaille"`):
 *        "Le service ConsulterCRDetaille permet de consulter l'état d'intégration d'un flux émis en
 *         API, avec le cas échéant les erreurs identifiées par le système pour l'irrecevabilité du
 *         flux ou le rejet d'une ou plusieurs demandes de paiement."
 *    Both take `{ numeroFluxDepot, syntaxeFlux? }` (`ConsulterCRParam` additionally allows a
 *    `dateDepot`; `ConsulterCRDetailleParam` does not). This client uses `consulterCRDetaille`, not
 *    `consulterCR` — see `consulterCr()`'s own doc comment for why (`WsRetourConsulterCR`'s own job is
 *    handing back a human-readable PDF this codebase has no reader for; `WsRetourConsulterCRDetaille`
 *    hands back the SAME machine-readable current-state field this poller already wants, PLUS
 *    structured rejection errors `chorus-pro-status-poller.ts` did not have any source for before).
 *    Corroborated independently the same day by a live route-existence probe against
 *    `https://sandbox-api.piste.gouv.fr` (real PISTE OAuth token, deliberately-garbage `cpro-account`,
 *    empty JSON body — the gateway authorizes per ROUTE, so 401 means "declared and reachable, auth
 *    layer rejected the bogus account" and 403 means "not declared on this subscription"):
 *    `/cpro/factures/v1/deposer/flux` → 401, `/cpro/transverses/v1/consulterCR` → 401,
 *    `/cpro/transverses/v1/consulterCRDetaille` → 401, `/cpro/factures/v1/consulter/cr` → 403,
 *    `/cpro/transverses/v1/consulter/cr` → 403 (the slash-separated guess — wrong on TWO counts at
 *    once: wrong API AND wrong path shape, `consulterCR` being one camelCase segment, never
 *    `consulter/cr`).
 *
 * NOT independently re-verified: the ACTUAL VALUE VOCABULARY `etatCourantDepotFlux` returns at runtime
 * (VALIDE/REJETE/…, see `mapChorusProStatus`'s own comment) — the Swagger types that field as a bare
 * `string`, no `enum`, for both `consulterCR` and `consulterCRDetaille`. Only the ROUTE, the request
 * shape, and the response FIELD NAMES are Swagger-sourced; a real PISTE application + Chorus Pro compte
 * technique (`documentation/docs/developer-guide/credentials-guide.md` §3) is still needed for a live
 * round-trip that observes an actual value — `choruspro.live.spec.ts`'s own header names this same gap.
 *
 * References:
 *  - https://piste.gouv.fr/api-catalog-sandbox — PISTE sandbox API catalog (no account needed to browse)
 *  - Chorus Pro EDI integration guide (AIFE)
 *  - "API Dépôt flux G2B" v5.2.0 on PISTE (RFA: g2b.apidepotfluxg2b) — the reference's own citation,
 *    kept for `deposerFlux`'s original provenance; superseded by the Factures v1.0.0 Swagger above for
 *    anything the two disagree on.
 */

// ---------------------------------------------------------------------------
// Seam / Port
// ---------------------------------------------------------------------------

export interface ChorusProHttpPort {
  post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }>;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ChorusProClientConfig {
  /** OAuth token base URL — e.g. https://sandbox-oauth.piste.gouv.fr */
  oauthBaseUrl: string;
  /** API base URL — e.g. https://sandbox-api.piste.gouv.fr */
  apiBaseUrl: string;
  /** PISTE OAuth2 client_id */
  clientId: string;
  /** PISTE OAuth2 client_secret (encrypted at rest) */
  clientSecret: string;
  /** Chorus Pro technical account login */
  technicalAccountLogin: string;
  /** Chorus Pro technical account password (encrypted at rest) */
  technicalAccountPassword: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ChorusProDepositResult {
  /** Flux deposit ID (numeroFluxDepot) — used as ref for polling. */
  numeroFluxDepot: string;
  /** Immediate status returned by Chorus Pro (DEPOSE = accepted for processing). */
  statut: string;
  httpStatus: number;
  raw: unknown;
}

/** One entry of `WsRetourConsulterCRDetaille.listeErreurDP` — a rejected/irrecevable payment request
 *  (demande de paiement) inside the flux, Swagger model `WsRetourConsulterCRDetailleErreurDP`. */
export interface ChorusProErreurDP {
  numeroDP?: string;
  identifiantFournisseur?: string;
  identifiantDestinataire?: string;
  libelleErreurDP?: string;
}

/** One entry of `WsRetourConsulterCRDetaille.listeErreurTechnique` — a technical rejection reason for
 *  the flux itself (irrecevabilité), Swagger model `WsRetourConsulterCRDetailleErreurTechnique`. */
export interface ChorusProErreurTechnique {
  codeErreur?: string;
  libelleErreur?: string;
  natureErreur?: string;
}

export interface ChorusProCrResult {
  /** Same numeroFluxDepot as at deposit time — NOT echoed by `WsRetourConsulterCRDetaille` itself
   *  (that response has no `numeroFluxDepot` field), so this is the caller's own request argument,
   *  passed through. */
  numeroFluxDepot: string;
  /** `WsRetourConsulterCRDetaille.etatCourantDepotFlux` — overall flux status. The FIELD NAME is
   *  Swagger-sourced (see this file's own header, "CORRECTED 2026-09-14"); the VALUE VOCABULARY
   *  (VALIDE | REJETE | EN_COURS_DE_TRAITEMENT | DEPOSE | SUSPENDU | …) is NOT — that field has no
   *  `enum` in the Swagger, so these values are inherited from the reference implementation, still
   *  unverified against a live response. Named `statutFlux` here (not `etatCourantDepotFlux`) because
   *  every caller of this client already speaks that vocabulary (`mapChorusProStatus`,
   *  `chorus-pro-status-poller.ts`) — only the wire field this value is READ FROM changed, not this
   *  result type's own shape. */
  statutFlux: string;
  /** `WsRetourConsulterCRDetaille.listeErreurDP` — empty when the flux carries no per-payment-request
   *  rejection. */
  erreursDP: ChorusProErreurDP[];
  /** `WsRetourConsulterCRDetaille.listeErreurTechnique` — empty when the flux itself was not rejected
   *  outright (irrecevabilité). */
  erreursTechniques: ChorusProErreurTechnique[];
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Chorus Pro flux syntax codes (UBL / CII / Factur-X)
// ---------------------------------------------------------------------------
/** Map from a `formats/format-registry.ts` syntax (`DocumentFormatProvider.syntax` — e.g. "FACTURX",
 *  the SAME string `facturx-provider.ts` exports) to the Chorus Pro `syntaxeFlux` code. */
const SYNTAX_MAP: Record<string, string> = {
  EN16931_UBL: 'IN_DP_E1_UBL_201',
  EN16931_CII: 'IN_DP_E2_CII_16B',
  FACTURX: 'IN_DP_E3_FACTUR_X_10',
  // Fallback to UBL 2.1 for generic UBL
  UBL: 'IN_DP_E1_UBL_201',
};

export function resolveChorusProSyntax(artifactSyntax: string): string {
  return SYNTAX_MAP[artifactSyntax] ?? 'IN_DP_E1_UBL_201';
}

// ---------------------------------------------------------------------------
// Exact path table — update here if the swagger shows different paths
// ---------------------------------------------------------------------------
/** @internal — exported for test assertions */
export const CHORUSPRO_PATHS = {
  token: '/api/oauth/token', // on oauthBaseUrl
  deposerFlux: '/cpro/factures/v1/deposer/flux', // on apiBaseUrl — API "Factures" (cpro.factures)
  // On apiBaseUrl too, but a DIFFERENT PISTE API — "Transverses" (cpro.transverses), not "Factures".
  // Both APIs share the SAME gateway host (`apiBaseUrl`/`basePath`), only the resource path prefix
  // differs (`/cpro/transverses` vs `/cpro/factures`) — each entry in this table already carries its
  // own full path, so there is no shared-prefix assumption anywhere in this client to correct.
  // See this file's own header, "CORRECTED 2026-09-14", for the Swagger source and the verbatim
  // citation that establishes this exact route.
  consulterCr: '/cpro/transverses/v1/consulterCRDetaille', // API "Transverses" v1.0.0
} as const;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ChorusProClient {
  private _cachedToken?: { token: string; expiresAt: number };

  constructor(
    private readonly config: ChorusProClientConfig,
    private readonly http: ChorusProHttpPort,
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Deposit an invoice flux to Chorus Pro.
   *
   * POST /cpro/factures/v1/deposer/flux
   * Headers:
   *   Authorization: Bearer <piste_token>
   *   cpro-account:  base64(<login>:<password>)
   *   Content-Type:  application/json;charset=utf-8
   * Body:
   *   { syntaxeFlux: string, nomFichier: string, fichierFlux: base64(fileBytes) }
   *
   * Returns (`WsRetourDeposerFluxFacture`, confirmed on the official Factures v1.0.0 Swagger 2026-09-14
   * — see this file's own header): `numeroFluxDepot` (the deposit id this method reads, CONFIRMED
   * present), `codeRetour`, `dateDepot`, `libelle`, `syntaxeFlux`. There is NO `statut` field in this
   * response at all — `this.statut` below therefore always falls back to its own default; kept (never
   * removed) only because nothing downstream reads it today (`chorus-pro-transport.ts#send()` uses
   * `numeroFluxDepot` alone) and this method's own return type still names it, so a future caller is
   * not silently handed a fabricated value with no comment explaining why it never varies.
   *
   * `fileBytes` is a `Buffer` — see this file's own header, adaptation §1, for why this is NOT a
   * `string` the way the reference had it: the payload is Factur-X (a PDF/A-3 binary), and
   * base64-encoding the raw bytes directly is the only lossless way to carry it.
   */
  async deposerFlux(
    fileBytes: Buffer,
    fileName: string,
    syntaxeFlux: string = 'IN_DP_E1_UBL_201',
  ): Promise<ChorusProDepositResult> {
    const token = await this._getToken();
    const fichierFlux = fileBytes.toString('base64');
    const body = { syntaxeFlux, nomFichier: fileName, fichierFlux };
    const resp = await this.http.post(
      `${this.config.apiBaseUrl}${CHORUSPRO_PATHS.deposerFlux}`,
      body,
      this._buildHeaders(token),
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro deposerFlux failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const numeroFluxDepot = String(data.numeroFluxDepot ?? data.numero_flux_depot ?? '');
    const statut = String(data.statut ?? 'DEPOSE');
    return { numeroFluxDepot, statut, httpStatus: resp.status, raw: data };
  }

  /**
   * Consult the compte rendu détaillé (integration state + rejection errors) for a deposited flux.
   *
   * POST /cpro/transverses/v1/consulterCRDetaille   ("Transverses" API, NOT "Factures" — see this
   * file's own header, "CORRECTED 2026-09-14", for the Swagger source).
   *
   * Chosen over the sibling `consulterCR` (`/cpro/transverses/v1/consulterCR`) deliberately: that
   * operation's own Swagger `responseClass` (`WsRetourConsulterCR`) hands back a PDF report
   * (`fichierCR`) this codebase has no reader for, plus the SAME kind of top-level `etatCourantFlux`
   * status field `consulterCRDetaille` already provides. `consulterCRDetaille`'s own `responseClass`
   * (`WsRetourConsulterCRDetaille`) gives the identical machine-readable current-state field
   * (`etatCourantDepotFlux`) PLUS `listeErreurDP`/`listeErreurTechnique` — structured rejection
   * reasons `chorus-pro-status-poller.ts#poll()` folds into its own `reason` on a REJECTED event
   * (previously just the bare status code repeated, per that poller's own former comment) — the exact
   * "diagnostic goes in the wrong direction" risk this correction exists to close.
   *
   * Body: { numeroFluxDepot: string }   (`ConsulterCRDetailleParam` also allows an optional
   * `syntaxeFlux`, unused here — this client has never needed it to look up a flux by id alone).
   *
   * Returns (`WsRetourConsulterCRDetaille`): `etatCourantDepotFlux` (flux state — see
   * `ChorusProCrResult.statutFlux`'s own doc comment for what is and is not Swagger-verified about it),
   * `listeErreurDP` / `listeErreurTechnique` (rejection detail), `codeRetour`/`libelle` (the call's own
   * outcome code, distinct from the flux's state), `dateDepotFlux`, `dateHeureEtatCourantFlux`,
   * `nomFichier`, `codeInterfaceDepotFlux`. No `numeroFluxDepot` field in the response itself — this
   * client passes the caller's own argument through instead of reading one back.
   */
  async consulterCr(numeroFluxDepot: string): Promise<ChorusProCrResult> {
    const token = await this._getToken();
    const body = { numeroFluxDepot };
    const resp = await this.http.post(
      `${this.config.apiBaseUrl}${CHORUSPRO_PATHS.consulterCr}`,
      body,
      this._buildHeaders(token),
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro consulterCRDetaille failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const statutFlux = String(data.etatCourantDepotFlux ?? 'EN_COURS_DE_TRAITEMENT');
    const erreursDP = Array.isArray(data.listeErreurDP) ? (data.listeErreurDP as ChorusProErreurDP[]) : [];
    const erreursTechniques = Array.isArray(data.listeErreurTechnique)
      ? (data.listeErreurTechnique as ChorusProErreurTechnique[])
      : [];
    return { numeroFluxDepot, statutFlux, erreursDP, erreursTechniques, raw: data };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Obtain a PISTE OAuth2 bearer token (client_credentials flow).
   * Token is cached until ~60 s before expiry.
   *
   * POST https://[sandbox-]oauth.piste.gouv.fr/api/oauth/token
   *   grant_type=client_credentials&client_id=…&client_secret=…&scope=openid
   */
  async _getToken(): Promise<string> {
    if (this._cachedToken && Date.now() < this._cachedToken.expiresAt) {
      return this._cachedToken.token;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: 'openid',
    });
    const resp = await this.http.post(
      `${this.config.oauthBaseUrl}${CHORUSPRO_PATHS.token}`,
      body.toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
    );
    if (resp.status >= 400) {
      throw new Error(`Chorus Pro PISTE authentication failed (HTTP ${resp.status})`);
    }
    const data = resp.data as Record<string, unknown>;
    const token = String(data.access_token ?? '');
    const expiresIn = Number(data.expires_in ?? 3600);
    // Cache with 60 s safety margin; never log the token value.
    this._cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 - 60_000 };
    return token;
  }

  /**
   * Build the standard header set for Chorus Pro API calls.
   *  - Authorization: Bearer <token>        — PISTE gateway auth
   *  - cpro-account: base64(<login>:<pwd>)  — Chorus Pro technical account
   *  - Content-Type: application/json;charset=utf-8
   *
   * SECURITY: cpro-account is logged nowhere. The base64 is not encryption —
   * the value is treated as a credential (stored encrypted at rest, sent only over HTTPS).
   */
  private _buildHeaders(token: string): Record<string, string> {
    const cproAccount = Buffer.from(
      `${this.config.technicalAccountLogin}:${this.config.technicalAccountPassword}`,
      'utf-8',
    ).toString('base64');
    return {
      Authorization: `Bearer ${token}`,
      'cpro-account': cproAccount,
      'Content-Type': 'application/json;charset=utf-8',
    };
  }
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * Map a Chorus Pro flux status (`ChorusProCrResult.statutFlux`, read off `consulterCRDetaille`'s own
 * `etatCourantDepotFlux`) to canonical TransmissionStatus.
 *
 * Terminal clearance: VALIDE, MISE_EN_PAIEMENT, MANDATEE, COMPTABILISEE → CLEARED
 * Terminal rejection: REJETE → REJECTED
 * In-flight: DEPOSE, EN_COURS_DE_TRAITEMENT, SUSPENDU → PENDING
 *
 * HONESTY NOTE: this value VOCABULARY (as opposed to the field NAME it is read from, corrected and
 * Swagger-sourced 2026-09-14 — this file's own header) is still inherited from the reference
 * implementation, not independently confirmed — `etatCourantDepotFlux` is typed as a bare `string` in
 * the official Swagger, with no `enum`. Left unchanged here because nothing establishes it is WRONG
 * either; a real PISTE round-trip (`choruspro.live.spec.ts`, gated `CHORUSPRO_LIVE=1`) is what would
 * confirm or correct it.
 */
export function mapChorusProStatus(statutFlux: string): 'CLEARED' | 'REJECTED' | 'PENDING' {
  const s = statutFlux.toUpperCase();
  if (s === 'VALIDE' || s === 'MISE_EN_PAIEMENT' || s === 'MANDATEE' || s === 'COMPTABILISEE') {
    return 'CLEARED';
  }
  if (s === 'REJETE') return 'REJECTED';
  // DEPOSE | EN_COURS_DE_TRAITEMENT | SUSPENDU | unknown → PENDING
  return 'PENDING';
}

// ---------------------------------------------------------------------------
// Real HTTP port — adaptation §2 (see this file's own header): the reference only ever shipped a
// STUB that threw; `transports/chorus-pro-transport.ts` needs a working one to reach PISTE at all,
// and `conformity/pollers/chorus-pro-status-poller.ts` needs the same for `consulterCr`. Mirrors
// `transports/ksef/fetch-http-client.ts`'s own shape (fetch + AbortController timeout), simplified:
// unlike KSeF's own port, `ChorusProHttpPort` has exactly one verb (`post`), and Chorus Pro's own
// 4xx responses are NEVER retried here (`ChorusProClient` itself decides pass/fail from `resp.status`)
// — retrying belongs to BullMQ's own job-level backoff (`async-send.ts`), not this transport-level
// HTTP leaf, the same division `pdp-transport.ts`/`sdi-transport.ts` already hold for their own ports.
// ---------------------------------------------------------------------------

export interface FetchChorusProHttpPortOpts {
  /** Request timeout in ms (default: 20_000) — PISTE is a remote gateway, not a local stub; a real
   *  network attempt (or its absence) must not hang a BullMQ job indefinitely. */
  timeoutMs?: number;
}

export class FetchChorusProHttpPort implements ChorusProHttpPort {
  private readonly timeoutMs: number;

  constructor(opts: FetchChorusProHttpPortOpts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  async post(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // The token call sends an already-encoded `application/x-www-form-urlencoded` STRING
      // (`ChorusProClient._getToken`'s own `body.toString()`); every other call sends a plain object
      // that this port itself must serialize — same "read the Content-Type this caller already set"
      // convention the reference's own live spec used for its ad hoc `realHttp` (`choruspro-live.spec.ts`).
      const isForm = headers['Content-Type']?.includes('x-www-form-urlencoded') ?? false;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: isForm ? String(body) : JSON.stringify(body),
        signal: controller.signal,
      });
      const contentType = res.headers.get('content-type') ?? '';
      let data: unknown;
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        // Kept as a Record so `ChorusProClient`'s own `data.numeroFluxDepot ?? ...` reads never throw
        // on a non-JSON error body (an HTML gateway error page, a plain-text 502, etc.).
        data = text ? { message: text } : {};
      }
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }
}
