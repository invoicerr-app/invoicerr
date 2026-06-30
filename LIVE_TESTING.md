# Live Testing Guide

All live tests are **SKIPPED by default** in CI and in any offline run. They are opt-in:
only when the channel-specific flag is set to `1` **AND** the required credential env vars
are present does the suite actually run — otherwise `describe.skip` fires silently.

The shared gate helper is at:
`backend/src/compliance/providers/transmission/live-gate.ts`

Hard-success contract (enforced per-spec):
- A `REJECTED` or `SKIPPED` transmission result **fails** the test (not tolerates it).
- An empty or missing authority reference/id **fails** the test.
- Async portals must reach `CLEARED` within the specified poll window.

---

## Channel summary

| Channel | Flag | Key creds | Spec file | Status |
|---|---|---|---|---|
| KSeF (PL) | `KSEF_LIVE=1` | `KSEF_AUTH_TOKEN`, `KSEF_NIP` | `ksef/ksef-live.spec.ts` | ✅ Proven live |
| PDP superpdp (FR) | `PDP_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp-live.spec.ts` | ✅ Proven live |
| PDP AFNOR (FR) | `PDP_AFNOR_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp-afnor-live.spec.ts` | ✅ Transport proven (content TBD) |
| Email SMTP | `EMAIL_LIVE=1` | _(none — Ethereal auto-creates account)_ | `email-live.spec.ts` | ✅ Proven live |
| SdI (IT) | `SDI_LIVE=1` | `SDI_ID_TRASMITTENTE`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` | `sdi/sdi-live.spec.ts` | 🔴 Deferred (AdE accreditation) |
| Peppol | `PEPPOL_LIVE=1` | `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | `peppol/peppol-live.spec.ts` | 🔴 Deferred (AP required) |
| National portals | `<PREFIX>_LIVE=1` (per portal) | `<PREFIX>_*` namespaced creds | `portal-live.spec.ts` | 🟡 Parametrized (per-portal namespaced creds) |
| Chorus Pro (FR B2G) | `CHORUSPRO_LIVE=1` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET` | `europe/choruspro-live.spec.ts` | 🔴 Deferred (PISTE account required) |
| RFC 3161 TSA (-T signing) | `TSA_LIVE=1` | `TSA_URL` | `signing/tsa-live.spec.ts` | 🟡 Wired (run to prove FreeTSA) |

---

## Running a single live spec

```bash
# KSeF (PL) — proven live against ksef-test.mf.gov.pl
KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> [KSEF_NIP=<nip>] \
  npx jest ksef-live --no-coverage --runInBand

# PDP superpdp (FR) — proven live against https://api.superpdp.tech
set -a; . .env.pdp.local; set +a
PDP_LIVE=1 npx jest pdp-live --no-coverage --runInBand

# PDP AFNOR (FR) — transport proven live (content validation TBD)
PDP_AFNOR_LIVE=1 PDP_BASE_URL=<url> PDP_CLIENT_ID=<id> PDP_CLIENT_SECRET=<secret> \
  npx jest pdp-afnor-live --no-coverage --runInBand

# Email (Ethereal SMTP — no creds needed)
EMAIL_LIVE=1 npx jest email-live --no-coverage

# SdI (IT) — requires AdE accreditation + qualified PFX certificate
SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 SDI_CERTIFICATE=<base64-pfx> \
  SDI_CERT_PASSWORD=<pass> [SDI_CHANNEL=SDICoop] \
  npx jest sdi-live --no-coverage --runInBand

# Peppol — requires a connected Access Point
PEPPOL_LIVE=1 PEPPOL_PARTICIPANT_ID=0009:12345678900011 PEPPOL_AP_URL=https://ap.example.com \
  PEPPOL_API_KEY=<key> PEPPOL_RECEIVER_ID=0009:98765432100022 [PEPPOL_ENV=TEST] \
  npx jest peppol-live --no-coverage --runInBand

# National portal — namespaced per-provider (see "National portals" section below)
# Example: ANAF (RO)
ANAF_LIVE=1 ANAF_AUTH_TOKEN=<token> ANAF_TAXPAYER_ID=<cui> \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=anaf

# RFC 3161 TSA — level-T signing via real TSA (e.g. FreeTSA)
TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr \
  npx jest tsa-live --no-coverage --runInBand
```

---

## Verifying the gate works (no flag = skipped)

```bash
# Run the gated spec without the flag → must show as skipped
cd backend
npx jest ksef-live --no-coverage
# Expected: Test Suites: 1 skipped | Tests: 0 (suite skipped)

npx jest pdp-live pdp-afnor-live email-live sdi-live peppol-live portal-live tsa-live choruspro-live --no-coverage
# Expected: all suites skipped
```

---

## Running the full offline suite (gate must not fire)

```bash
cd backend
npx jest --no-coverage
# Live specs appear in "skipped suites" count — no live call is made.
# Baseline: ~1330 passed, live suites skipped.
```

---

## CI

Live specs are **excluded from CI by default**. The CI workflow (`Tests`) runs:
```
cd backend && npx jest --no-coverage
```
No `*_LIVE=1` flag is set in CI. All gated suites remain skipped.

---

## Credential storage

- Credentials are loaded exclusively from env vars or `.env*.local` files (gitignored).
- Never commit secrets to the repository.
- Suggested local file layout:
  - `.env.ksef.local` — `KSEF_AUTH_TOKEN`, `KSEF_NIP`
  - `.env.pdp.local` — `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET`
  - `.env.sdi.local` — `SDI_ID_TRASMITTENTE`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD`
  - `.env.peppol.local` — `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID`
- Load with: `set -a; . .env.<channel>.local; set +a`

---

### Chorus Pro (FR B2G) — PISTE gateway

```bash
# Chorus Pro PISTE sandbox
CHORUSPRO_LIVE=1 \
  CHORUSPRO_CLIENT_ID=<piste_client_id> \
  CHORUSPRO_CLIENT_SECRET=<piste_client_secret> \
  CHORUSPRO_TECH_LOGIN=<compte_technique_login> \
  CHORUSPRO_TECH_PASSWORD=<compte_technique_password> \
  [CHORUSPRO_ENV=SANDBOX] \
  [CHORUSPRO_XML_PATH=/path/to/invoice.xml] \
  npx jest choruspro-live --no-coverage --runInBand
```

| Env var | Purpose |
|---|---|
| `CHORUSPRO_CLIENT_ID` | PISTE OAuth2 `client_id` (from PISTE developer portal) |
| `CHORUSPRO_CLIENT_SECRET` | PISTE OAuth2 `client_secret` |
| `CHORUSPRO_TECH_LOGIN` | Chorus Pro "compte technique" login (required for deposerFlux) |
| `CHORUSPRO_TECH_PASSWORD` | Chorus Pro "compte technique" password |
| `CHORUSPRO_ENV` | `SANDBOX` (default) or `PROD` |
| `CHORUSPRO_XML_PATH` | Path to a pre-built Factur-X/UBL XML file (skips auto-generation) |

**How to obtain credentials:**
1. Create an account on **[piste.gouv.fr](https://piste.gouv.fr)**.
2. Subscribe to the API "Factures" (or "API Dépôt flux G2B" v5.2.0) in the PISTE sandbox catalog.
3. Obtain `client_id` + `client_secret` from the PISTE API key manager.
4. In the Chorus Pro sandbox, create a "compte technique" (technical account) linked to your SIRET.
5. Use the sandbox hosts: `sandbox-oauth.piste.gouv.fr` / `sandbox-api.piste.gouv.fr`.

**What the test verifies:**
- Step 1: OAuth2 client_credentials → Bearer token reachable.
- Step 2 (if compte technique provided): `POST /cpro/factures/v1/deposer/flux` → real `numeroFluxDepot` returned.
- Step 3: `POST /cpro/factures/v1/consulter/cr` → statutFlux = DEPOSE/EN_COURS_DE_TRAITEMENT/VALIDE.

---

# National portals (namespaced per-provider convention)

## `portalPrefix` — how the prefix is derived

```
prefix = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
```

| Provider id | Derived prefix |
|---|---|
| `choruspro` | `CHORUSPRO` |
| `anaf` | `ANAF` |
| `zatca` | `ZATCA` |
| `gib` | `GIB` |
| `eg-eta` | `EG_ETA` |
| `in-irp` | `IN_IRP` |
| `myinvois` | `MYINVOIS` |
| `id-coretax` | `ID_CORETAX` |
| `firs` | `FIRS` |
| `ke-kra` | `KE_KRA` |
| `afip` | `AFIP` |
| `sefaz` | `SEFAZ` |
| `sii` | `SII` |
| `sri` | `SRI` |
| `uy-dgi` | `UY_DGI` |

## Standard `<PREFIX>_*` variables

Each portal self-gates on `<PREFIX>_LIVE=1` and reads its own namespaced creds.
Empty vars are ignored — only those with values are passed to the provider.

| Suffix | Full example | Purpose |
|---|---|---|
| `_LIVE` | `ANAF_LIVE=1` | Opt-in gate — must be exactly `1` |
| `_BASE_URL` | `ANAF_BASE_URL=https://api.anaf.ro` | Portal API base URL |
| `_ENVIRONMENT` | `ANAF_ENVIRONMENT=TEST` | `TEST` or `PROD` (default: `TEST`) |
| `_API_KEY` | `ZATCA_API_KEY=<key>` | API key |
| `_AUTH_TOKEN` | `ANAF_AUTH_TOKEN=<token>` | Bearer / session token |
| `_CLIENT_ID` | `CHORUSPRO_CLIENT_ID=<id>` | OAuth2 client ID |
| `_CLIENT_SECRET` | `CHORUSPRO_CLIENT_SECRET=<sec>` | OAuth2 client secret |
| `_CERTIFICATE` | `SEFAZ_CERTIFICATE=<b64-pfx>` | PFX certificate, base64-encoded |
| `_CERT_PASSWORD` | `SEFAZ_CERT_PASSWORD=<pass>` | Certificate password |
| `_TAXPAYER_ID` | `ANAF_TAXPAYER_ID=<cui>` | Taxpayer / company identifier |
| `_SELLER_VAT` | `ANAF_SELLER_VAT=RO12345678` | Seller VAT (fixture) |
| `_BUYER_VAT` | `ANAF_BUYER_VAT=RO00000001` | Buyer VAT (fixture) |
| `_SELLER_NAME` | `CHORUSPRO_SELLER_NAME=…` | Seller company name (fixture) |
| `_BUYER_NAME` | `CHORUSPRO_BUYER_NAME=…` | Buyer company name (fixture) |
| `_COUNTRY` | `ZATCA_COUNTRY=SA` | Seller country 2-letter ISO (fixture) |
| `_BUYER_COUNTRY` | `ZATCA_BUYER_COUNTRY=SA` | Buyer country (fixture) |
| `_CURRENCY` | `ZATCA_CURRENCY=SAR` | Invoice currency (default: `EUR`) |
| `_XML_PATH` | `ANAF_XML_PATH=/path/to/invoice.xml` | Pre-built XML (skips auto-generation) |
| `_SYNTAX` | `ZATCA_SYNTAX=EN16931_UBL` | Artifact syntax (default: `EN16931_UBL`) |

Provider-specific extras (e.g. `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD`) are picked up
automatically — any `<PREFIX>_*` key not listed above is also camelCased and forwarded.

## Per-portal examples

### Chorus Pro (FR B2G)

```bash
CHORUSPRO_LIVE=1 \
  CHORUSPRO_CLIENT_ID=<piste_client_id> \
  CHORUSPRO_CLIENT_SECRET=<piste_client_secret> \
  CHORUSPRO_TECH_LOGIN=<compte_technique_login> \
  CHORUSPRO_TECH_PASSWORD=<compte_technique_password> \
  CHORUSPRO_ENVIRONMENT=SANDBOX \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=choruspro
```

### ZATCA (SA — FATOORA)

```bash
ZATCA_LIVE=1 \
  ZATCA_API_KEY=<key> \
  ZATCA_CERTIFICATE=<base64-pfx> \
  ZATCA_CERT_PASSWORD=<pass> \
  ZATCA_TAXPAYER_ID=<tin> \
  ZATCA_ENVIRONMENT=TEST \
  ZATCA_COUNTRY=SA \
  ZATCA_CURRENCY=SAR \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=zatca
```

### ANAF (RO — SPV e-factura)

```bash
ANAF_LIVE=1 \
  ANAF_AUTH_TOKEN=<token> \
  ANAF_TAXPAYER_ID=<cui> \
  ANAF_ENVIRONMENT=TEST \
  ANAF_COUNTRY=RO \
  ANAF_SELLER_VAT=RO12345678 \
  ANAF_BUYER_VAT=RO00000001 \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=anaf
```

### Running multiple portals in one invocation

```bash
ZATCA_LIVE=1 ZATCA_API_KEY=<key> ZATCA_TAXPAYER_ID=<tin> \
ANAF_LIVE=1  ANAF_AUTH_TOKEN=<tok> ANAF_TAXPAYER_ID=<cui> \
  npx jest portal-live --no-coverage --runInBand
```

---

## SdI prerequisites (currently deferred)

1. Register as an intermediary (*intermediario*) with AdE.
2. Obtain a qualified digital certificate (PFX/P12) from an accredited CA.
3. Implement `SdiHttpPort` for SDICoop SOAP (`RiceviFileService`) or PEC channel.
4. Inject the implementation into `SdiTransmissionProvider` constructor.
5. Set `SDI_LIVE=1` + creds and run the live spec.

## Peppol prerequisites (currently deferred)

1. Connect to a Peppol Access Point provider (e.g. Basware, Pagero, Qvalia, or self-hosted oxalis-ng).
2. Obtain an AP certificate (C1/C2) registered with OpenPeppol or the national Peppol Authority.
3. Implement `PeppolApPort` for the AP vendor's REST/SOAP gateway.
4. The receiver (`PEPPOL_RECEIVER_ID`) must be registered in the SMP/SML.
5. Set `PEPPOL_LIVE=1` + creds and run the live spec.

---

## Running in GitHub Actions

Workflow: **`.github/workflows/compliance-live.yml`** (manual `workflow_dispatch` + nightly cron).
- The `live` job handles proven channels (KSeF, PDP, SdI, Peppol, email, TSA).
- The `national-portals-live` job runs `portal-live.spec.ts` with all namespaced `<PREFIX>_*`
  secrets mapped. Each portal self-skips unless at least one real credential is present
  (checked: `_CLIENT_ID`, `_CLIENT_SECRET`, `_API_KEY`, `_AUTH_TOKEN`, `_CERTIFICATE`, `_TOKEN`).
  You can fill in one portal's credentials at a time.

> **`*_LIVE` and `*_ENVIRONMENT` are constants in the workflow — do NOT add them as GitHub secrets.**
> They are set as literal values directly in the YAML (`ANAF_LIVE: '1'`, `ANAF_ENVIRONMENT: 'SANDBOX'`, etc.).
> Only real credentials (`*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_API_KEY`, `*_AUTH_TOKEN`,
> `*_CERTIFICATE`, `*_CERT_PASSWORD`, `*_TAXPAYER_ID`, `*_BASE_URL`,
> `*_SELLER_VAT`, `*_BUYER_VAT`, `*_COUNTRY`) belong in secrets.

**Where to add the secrets:** repo → **Settings → Secrets and variables → Actions → New repository secret**.
- GitLab equivalent: *Settings → CI/CD → Variables*.
- Forgejo/Gitea equivalent: *Settings → Actions → Secrets* (same `${{ secrets.X }}` syntax).

**3 GitHub-specific gotchas:**
1. **Never run live tests `on: pull_request`** — GitHub does not expose repository secrets to workflows
   triggered by PRs from forks, so the secrets would be empty. Use `workflow_dispatch` / `schedule`
   (as the provided workflow does).
2. **PFX certificates** (`SDI_CERTIFICATE`, `PORTAL_CERTIFICATE`) are passed **base64-encoded, directly**
   as the secret value (the specs read the base64 string — no file decode needed). Generate with
   `base64 -w0 cert.pfx | pbcopy` (or `| xclip`).
3. Optional: create a GitHub **Environment** named `live-tests` (Settings → Environments) with a
   *required reviewer* to gate each run before spending an authority call.

**Secret names + where each credential comes from:**

| Secret(s) | Channel | Where to obtain |
|---|---|---|
| `KSEF_AUTH_TOKEN`, `KSEF_NIP` | PL KSeF | KSeF app **ksef.mf.gov.pl** (test: ksef-test.mf.gov.pl) → log in (NIP + trusted profile/qualified sig) → *Tokens*. Prod also needs the MF prod public PEM keys. |
| `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` (+ `PDP_API_STYLE`, `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING`) | FR PDP + AFNOR | PDP developer portal. Sandbox = **superpdp**. Real PDP list (annuaire): **impots.gouv.fr**. AFNOR uses the same creds + `PDP_API_STYLE=afnor`. |
| `SDI_ID_TRASMITTENTE`, `SDI_CERTIFICATE` (b64 PFX), `SDI_CERT_PASSWORD`, `SDI_CHANNEL` | IT SdI | **Agenzia delle Entrate** intermediary accreditation (fatturapa.gov.it) + qualified PFX from an eIDAS TSP (Aruba, InfoCert, Namirial). |
| `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | Peppol | A connected **Access Point** (Storecove, Ecosio, Pagero/Tickstar, Unimaze…) or self-hosted; membership via **OpenPeppol** (peppol.org). `PEPPOL_ENV` is a constant (`'TEST'`) in the workflow — not a secret. |
| `<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_API_KEY`, `<PREFIX>_AUTH_TOKEN`, `<PREFIX>_CERTIFICATE`, `<PREFIX>_CERT_PASSWORD`, `<PREFIX>_TAXPAYER_ID`, `<PREFIX>_BASE_URL`, `<PREFIX>_SELLER_VAT`, `<PREFIX>_BUYER_VAT`, `<PREFIX>_COUNTRY` (per portal) | National portals | Each authority's dev portal: AFIP (afip.gob.ar), SEFAZ (BR), SII (sii.cl), DIAN (dian.gov.co), **ZATCA Fatoora** (zatca.gov.sa), ANAF SPV (anaf.ro), **MyInvois** (myinvois.hasil.gov.my), India IRP (einvoice1.gst.gov.in)… `<PREFIX>_LIVE` and `<PREFIX>_ENVIRONMENT` are constants in the workflow YAML — **not secrets**. |
| `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | FR Chorus Pro B2G | **PISTE developer portal** (piste.gouv.fr) — subscribe to "API Dépôt flux G2B", then create a Chorus Pro "compte technique" in the sandbox. |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email | Ethereal auto-creates a throwaway account — no secret needed. ✅ proven. |

> CFDI/MX needs a **PAC** account (SAT-certified: Finkok, Facturama, SW Sapien…) + a **CSD** cert from
> **sat.gob.mx** — wired through the `pac` provider, not the gated portal harness.
> Facturae / national **XSD** files (not secrets) come from **facturae.gob.es** + each authority.
