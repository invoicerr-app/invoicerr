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
 * CORRECTED 2026-09-14 (second correction, same day) — the `deposerFlux` REQUEST BODY itself, never
 * independently checked against the Swagger before now (only the ROUTE and the RESPONSE shape had
 * been). Established on the same official Swagger 2.0 `DeposerFluxFactureParam` model (API "Factures",
 * see above) plus the AIFE community documentation page "Submit flow invoice"
 * (https://communaute.chorus-pro.gouv.fr/submit-flow-invoice/?lang=en, fetched by `curl`, no auth
 * needed — a public support article, not a credentialed endpoint), which gives the exact `json in`
 * example AIFE itself publishes:
 *   { "idUtilisateurCourant": 331, "fichierFlux": "Fichier encodé en base 64", "nomFichier": "...",
 *     "syntaxeFlux": "IN_DP_E1_UBL_INVOICE", "avecSignature": true }
 * Two findings from comparing this to what `deposerFlux()` below used to send:
 *  1. `syntaxeFlux` for Factur-X was WRONG — the reference's own value, `IN_DP_E3_FACTUR_X_10`, is not
 *     a member of `DeposerFluxFactureParam.syntaxeFlux`'s enum AT ALL (that enum has 13 values, none
 *     of them "E3" — there is no E3 depot format in this Swagger). The correct value, confirmed on
 *     TWO independent sources, is `IN_DP_E2_CII_FACTURX`:
 *       (a) the Swagger enum itself lists it verbatim (also echoed in `WsRetourDeposerFluxFacture
 *           .syntaxeFlux` and `RecupererSyntaxeFluxOutput.syntaxeFlux` in the Transverses API);
 *       (b) the community "Flow examples" page
 *           (https://communaute.chorus-pro.gouv.fr/documentation/flow-examples/?lang=en, last updated
 *           16 Apr 2024) names the exact row for this payload shape: "FSO1117A - Factur-X (E2) / Type
 *           de Flux : IN_DEPOT_DP / Format du flux : IN_DP_E2_MIXTE / Syntaxe du flux :
 *           IN_DP_E2_CII_FACTURX / Exemple de flux pour le profil en16931" — "en16931" in that last
 *           line is this exact profile (base EN 16931, not Peppol BIS/XRechnung), which is what
 *           `facturx-provider.ts` builds. NOTE: that same page's "Format du flux" column reads
 *           `IN_DP_E2_MIXTE` for this row, NOT `IN_DP_E2_FACTURX` (a value that DOES exist in the
 *           Transverses API's own `RecupererSyntaxeFluxParam.formatFlux` enum, alongside
 *           `IN_DP_E1_STRUCT`/`IN_DP_E2_MIXTE` — but `formatFlux` is only ever an INPUT to
 *           `recupererSyntaxeFlux`, a lookup helper this client does not call; `deposerFlux` itself
 *           takes no `formatFlux` field at all, only `syntaxeFlux`, so this ambiguity has no bearing on
 *           the fix here). `resolveChorusProSyntax`'s other two entries (`EN16931_UBL`, `EN16931_CII`)
 *           and its UBL/unknown-syntax fallback were ALSO outside the enum (`IN_DP_E1_UBL_201`,
 *           `IN_DP_E2_CII_16B` — neither string appears in it either) — corrected alongside the
 *           Factur-X one, to the enum members the SAME "Flow examples" page names for the non-minimal
 *           E1 profiles this codebase's OWN syntax names most plausibly mean: "FSO1100A - UBL Invoice
 *           (E1) / Syntaxe du flux : IN_DP_E1_UBL_INVOICE" for `EN16931_UBL`/the generic UBL fallback,
 *           and "FSO1106A - CII16B (E1) / Syntaxe du flux : IN_DP_E1_CII_16B" for `EN16931_CII` — CII
 *           "D16B" being the UN/CEFACT syntax EN 16931 itself binds to, the same "16B" this codebase's
 *           own vendored Schematron file names (`EN16931_CII_SCH`). Neither of those two is reachable
 *           through `chorus-pro-transport.ts` today (it only ever calls `resolveChorusProSyntax`
 *           with `'FACTURX'`, `facturx-provider.ts`'s own fixed `.syntax`), so this half of the fix is
 *           defensive/for-correctness rather than something the imminent live deposit depends on.
 *  2. `avecSignature` (boolean) and `idUtilisateurCourant` (int64) were MISSING from the body entirely
 *     — the AIFE example above always sends both. `avecSignature: false` is now sent explicitly: this
 *     is a true, checkable fact about THIS codebase's OWN payload, not a guess about what Chorus Pro
 *     wants — `facturx-provider.ts` never applies a PAdES/XAdES signature to the Factur-X PDF before
 *     this call (grepped this file's own build path for any "sign" step: none), so `false` states
 *     what the file already is, not an assumption about server behaviour.
 *     `idUtilisateurCourant` is DELIBERATELY NOT ADDED — see `deposerFlux()`'s own doc comment
 *     immediately below for why this one is a genuine, NOT-YET-ESTABLISHED gap, not an oversight.
 *
 * UPDATE 2026-09-14 — the ROUTE and response FIELD NAMES above were Swagger-sourced only; a real
 * PISTE application + Chorus Pro compte technique has SINCE run the live round-trip
 * (`choruspro.live.spec.ts`, `documentation/docs/developer-guide/credentials-guide.md` §3) and it
 * CONFIRMED the vocabulary in `mapChorusProStatus`'s own comment below was WRONG, not merely
 * unverified: `etatCourantDepotFlux` returned `IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP` while
 * pending, `IN_REJETE` on a real rejection, and `IN_INTEGRE` at the terminal accepted state — every
 * one of them carrying an `IN_` prefix `mapChorusProStatus` did not recognize, so all three used to
 * fall through to that function's own `PENDING` default (a rejection silently read as pending, and
 * the terminal accepted state never reading as CLEARED). FIXED same day — see `mapChorusProStatus`'s
 * own doc comment for the corrected table, its provenance (live measurement, not Swagger — the
 * official Swagger still declares no `enum` for this field, re-checked while fixing this), and why a
 * value the table still does not recognize now maps to its own `UNKNOWN` outcome, persisted-logged by
 * `chorus-pro-status-poller.ts#poll()`, rather than silently `PENDING`.
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
   *  Swagger-sourced (see this file's own header, "CORRECTED 2026-09-14"); the VALUE VOCABULARY is
   *  NOT — that field has no `enum` in the Swagger (re-checked 2026-09-14 while fixing
   *  `mapChorusProStatus`: neither `WsRetourConsulterCRDetaille` nor its sibling `WsRetourConsulterCR`
   *  declares one). A live round-trip has observed three real, `IN_`-prefixed values
   *  (`IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP`, `IN_REJETE`, `IN_INTEGRE`) — see
   *  `mapChorusProStatus`'s own doc comment for the full table, both vocabularies it now recognizes,
   *  and what happens for a value that matches neither. Named `statutFlux` here (not
   *  `etatCourantDepotFlux`) because every caller of this client already speaks that vocabulary
   *  (`mapChorusProStatus`, `chorus-pro-status-poller.ts`) — only the wire field this value is READ
   *  FROM changed, not this result type's own shape. */
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
 *  the SAME string `facturx-provider.ts` exports) to the Chorus Pro `syntaxeFlux` code — every value
 *  below is a member of `DeposerFluxFactureParam.syntaxeFlux`'s own Swagger enum (see this file's own
 *  header, "CORRECTED 2026-09-14 (second correction, same day)", for the sourcing of each one; none of
 *  the PREVIOUS values here — `IN_DP_E1_UBL_201`, `IN_DP_E2_CII_16B`, `IN_DP_E3_FACTUR_X_10` — were
 *  members of that enum at all). `FACTURX` is the only entry `chorus-pro-transport.ts` actually
 *  reaches today (`facturx-provider.ts`'s own fixed `.syntax`); the other two are defensive
 *  correctness fixes for a caller this file does not yet have. */
const SYNTAX_MAP: Record<string, string> = {
  EN16931_UBL: 'IN_DP_E1_UBL_INVOICE',
  EN16931_CII: 'IN_DP_E1_CII_16B',
  FACTURX: 'IN_DP_E2_CII_FACTURX',
  // Fallback to the same non-minimal EN 16931 UBL profile as EN16931_UBL above, for generic UBL.
  UBL: 'IN_DP_E1_UBL_INVOICE',
};

export function resolveChorusProSyntax(artifactSyntax: string): string {
  return SYNTAX_MAP[artifactSyntax] ?? 'IN_DP_E1_UBL_INVOICE';
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
   * Body (`DeposerFluxFactureParam`, all 5 properties the Swagger model declares — see this file's own
   * header, "CORRECTED 2026-09-14 (second correction, same day)"):
   *   { syntaxeFlux: string, nomFichier: string, fichierFlux: base64(fileBytes), avecSignature: boolean,
   *     idUtilisateurCourant?: number }
   * `fichierFlux` being base64 is confirmed by the AIFE community example, not merely assumed from the
   * JSON transport (`consumes: "application/json;charset=utf-8"` — no `format: "byte"` annotation
   * exists anywhere in the Swagger itself): the "Submit flow invoice" page's own `json in` sample
   * literally writes `"fichierFlux": "Fichier encodé en base 64"` in that field's place.
   * `nomFichier` carries NO documented length/character constraint in the Swagger (plain `"type":
   * "string"`, no `maxLength`/`pattern`) — this method's own caller (`chorus-pro-transport.ts#send()`)
   * already produces a filesystem-safe, ASCII, `.pdf`-suffixed name (`facturx-<docId>.pdf`, non-alnum
   * chars stripped), which satisfies every constraint the AIFE example itself demonstrates without this
   * client needing to re-validate anything undocumented.
   *
   * `idUtilisateurCourant` (Chorus Pro's own internal numeric user id — NOT the `cpro-account`
   * login/password, a DIFFERENT identifier; the AIFE example uses `331`) is a genuine, UNRESOLVED gap,
   * left out of the body on purpose rather than guessed: the Swagger model declares NO `required` array
   * at all for `DeposerFluxFactureParam` (contrast `WsRetourDeposerPdfFacture`, which does have one),
   * so the schema itself does not establish this field as mandatory; a third-party reseller's own docs
   * (cpro-docs.choruspay.fr, not AIFE, so not trusted as a primary source here) call the same-named
   * field "required" on a DIFFERENT endpoint (`CompleterFacture`/SAISIE_API), which is suggestive but
   * not proof for THIS one. `documentation/docs/developer-guide/credentials-guide.md` §3 (the compte
   * technique provisioning steps, read in full) never surfaces a numeric user id alongside
   * `CHORUSPRO_TECH_LOGIN`/`_PASSWORD` — only the login string and an auto-generated password. What
   * WOULD settle this: either a real `deposerFlux` call succeeding/failing on this exact point (a 400
   * naming `idUtilisateurCourant` would prove it mandatory), or a call to the "Utilisateurs" PISTE API
   * (subscribed alongside Factures/Transverses per the credentials guide's own step 3) to look up the
   * compte technique's own numeric id — neither done here, since this file must not call the real API.
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
    syntaxeFlux: string = 'IN_DP_E1_UBL_INVOICE',
  ): Promise<ChorusProDepositResult> {
    const token = await this._getToken();
    const fichierFlux = fileBytes.toString('base64');
    // `avecSignature: false` — a fact about THIS payload (no PAdES/XAdES signature is ever applied to
    // the Factur-X PDF before this call, see this file's own header), not a guess about what Chorus
    // Pro requires. `idUtilisateurCourant` is deliberately absent — see this method's own doc comment
    // above for the unresolved gap and what would settle it.
    const body = { syntaxeFlux, nomFichier: fileName, fichierFlux, avecSignature: false };
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
    // A 2xx response with no (or a blank) `access_token` used to be cached anyway (`String(undefined
    // ?? '')` is `''`, not a throw) — every `deposerFlux`/`consulterCr` call for up to `expiresIn`
    // seconds would then send `Authorization: Bearer ` (empty) and fail PISTE auth, without this
    // client ever knowing WHY or re-authenticating on its own. Refusing loudly HERE, before caching
    // anything, turns that into one immediate, diagnosable failure instead — same fix as
    // `pdp-client.ts#authenticate()`'s own header explains for the identical shape of bug.
    if (!token) {
      throw new Error('Chorus Pro PISTE authentication response carried no usable access_token.');
    }
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
 * Terminal clearance: VALIDE, MISE_EN_PAIEMENT, MANDATEE, COMPTABILISEE, IN_INTEGRE → CLEARED
 * Terminal rejection: REJETE, IN_REJETE → REJECTED
 * In-flight: DEPOSE, EN_COURS_DE_TRAITEMENT, SUSPENDU, IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP
 *   → PENDING
 * Anything else → UNKNOWN (never silently PENDING — see below).
 *
 * FIXED 2026-09-14 — this table used to recognize ONLY the bare (non-`IN_`-prefixed) vocabulary
 * inherited from the pre-refonte reference client, itself never confirmed against any source
 * (`etatCourantDepotFlux` has no `enum` in the official "Transverses" Swagger — re-checked while
 * fixing this: neither `WsRetourConsulterCRDetaille` nor `WsRetourConsulterCR` declares one). The
 * three `IN_`-prefixed rows above are likewise NOT Swagger-sourced — they are LIVE MEASUREMENTS from
 * the qualification round-trip (`choruspro.live.spec.ts`, `CHORUSPRO_LIVE=1`, 2026-09-14):
 * `IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP` observed immediately after every deposit
 * (`...425895`, `...425899`, `...425903`), `IN_REJETE` observed on `...425895`'s real rejection,
 * `IN_INTEGRE` observed on `...425903`'s real terminal acceptance (`listeErreurDP: []`) — see
 * `documentation/docs/developer-guide/credentials-guide.md` §3 for the dated citation of each.
 *
 * NO EXHAUSTIVE LIST of `etatCourantDepotFlux`'s possible values exists in any source available to
 * this repository. The AIFE "Annexe relative au raccordement EDI" (V4.20) DOES enumerate a flux/
 * facture status vocabulary, but for a DIFFERENT, older mechanism — the EDI `CPPStatut`/`AIFE_Statut`
 * push-notification formats, §8.5/§13.2.3, numeric codes such as `01` "DEPOSEE" or `37` "NON
 * CONFORME_NON_INTEGRE" — which shares no string with `etatCourantDepotFlux`'s own `IN_`-prefixed
 * values (checked: zero `IN_`/`REJETE`/`INTEGRE` matches for this API's vocabulary anywhere in that
 * annex). Only the three `IN_` values above are established, by direct measurement — not by
 * documentation, and not claimed to be the complete set.
 *
 * The bare (non-`IN_`) vocabulary is KEPT, not replaced: nothing establishes it was ever wrong, only
 * that it is not the vocabulary the live round-trip happened to observe — a different endpoint,
 * environment, or reporting path could still legitimately send it. Both tables coexist for that
 * reason.
 *
 * UNKNOWN is deliberately its own outcome, never folded into PENDING — an unrecognized value silently
 * read as PENDING is the EXACT defect this fix closes: the three `IN_`-prefixed values above used to
 * fall through to PENDING, hiding a real rejection and a real terminal success alike, indefinitely.
 * `isTerminalChorusProStatus` (`chorus-pro-status-poller.ts`) treats UNKNOWN exactly like PENDING
 * (never terminal — this codebase has no basis to resolve an unrecognized code either way), but that
 * same file's `poll()` persists a log for it via `LoggerService` every time it is observed — visible
 * in Settings → Logs, not silent — so a genuinely new Chorus Pro value gets noticed and added here
 * rather than quietly stalling a document at PENDING forever. Deliberately NOT done here: this
 * function stays a pure mapper (no side effects, no `companyId`/`transportRef` context to log with) —
 * `poll()` is the one caller with enough context to make that log useful.
 */
export function mapChorusProStatus(statutFlux: string): 'CLEARED' | 'REJECTED' | 'PENDING' | 'UNKNOWN' {
  const s = statutFlux.toUpperCase();
  if (
    s === 'VALIDE' ||
    s === 'MISE_EN_PAIEMENT' ||
    s === 'MANDATEE' ||
    s === 'COMPTABILISEE' ||
    s === 'IN_INTEGRE'
  ) {
    return 'CLEARED';
  }
  if (s === 'REJETE' || s === 'IN_REJETE') return 'REJECTED';
  if (
    s === 'DEPOSE' ||
    s === 'EN_COURS_DE_TRAITEMENT' ||
    s === 'SUSPENDU' ||
    s === 'IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP'
  ) {
    return 'PENDING';
  }
  return 'UNKNOWN';
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
