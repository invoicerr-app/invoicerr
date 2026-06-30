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
| National portal | `PORTAL_LIVE=1` | `PORTAL_ID` + portal-specific vars | `portal-live.spec.ts` | 🟡 Parametrized (per-portal creds) |
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

# National portal (parametrized)
PORTAL_LIVE=1 PORTAL_ID=anaf PORTAL_AUTH_TOKEN=<token> PORTAL_TAXPAYER_ID=<cui> \
  npx jest portal-live --no-coverage --runInBand

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

npx jest pdp-live pdp-afnor-live email-live sdi-live peppol-live portal-live tsa-live --no-coverage
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

## National portal env vars

| Env var | Purpose |
|---|---|
| `PORTAL_ID` | Provider id (e.g. `sefaz`, `anaf`, `choruspro`, `zatca`, `myinvois`, …) |
| `PORTAL_BASE_URL` | Portal API base URL (if required) |
| `PORTAL_AUTH_TOKEN` | Bearer token / session token |
| `PORTAL_API_KEY` | API key |
| `PORTAL_CLIENT_ID` | OAuth2 client ID |
| `PORTAL_CLIENT_SECRET` | OAuth2 client secret |
| `PORTAL_TAXPAYER_ID` | Taxpayer / company identifier on the portal |
| `PORTAL_CERTIFICATE` | PFX/P12 certificate (base64) |
| `PORTAL_CERT_PASSWORD` | Certificate password |
| `PORTAL_ENVIRONMENT` | `TEST` or `PROD` (default: `TEST`) |
| `PORTAL_SYNTAX` | Artifact syntax to submit (default: `EN16931_UBL`) |
| `PORTAL_XML_PATH` | Path to a pre-built XML file (skips auto-generation) |
| `PORTAL_SELLER_NAME` | Seller company name |
| `PORTAL_SELLER_VAT` | Seller VAT number |
| `PORTAL_BUYER_NAME` | Buyer company name |
| `PORTAL_BUYER_VAT` | Buyer VAT number |
| `PORTAL_COUNTRY` | Seller country code (2-letter) |
| `PORTAL_BUYER_COUNTRY` | Buyer country code (2-letter) |
| `PORTAL_CURRENCY` | Invoice currency code (default: `EUR`) |
| `PORTAL_CONFIG_<FIELD>` | Arbitrary portal-specific config field (camelCase converted) |

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
It sets every `<CHANNEL>_LIVE=1` and maps each secret as env; a channel whose secrets are empty
**self-skips**, so you can fill them in one channel at a time.

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
| `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID`, `PEPPOL_ENV` | Peppol | A connected **Access Point** (Storecove, Ecosio, Pagero/Tickstar, Unimaze…) or self-hosted; membership via **OpenPeppol** (peppol.org). |
| `PORTAL_ID` + `PORTAL_*` | National portals | Each authority's dev portal: AFIP (afip.gob.ar), SEFAZ (BR), SII (sii.cl), DIAN (dian.gov.co), **ZATCA Fatoora** (zatca.gov.sa), ANAF SPV (anaf.ro), **MyInvois** (myinvois.hasil.gov.my), India IRP (einvoice1.gst.gov.in)… |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email | Ethereal auto-creates a throwaway account — no secret needed. ✅ proven. |

> CFDI/MX needs a **PAC** account (SAT-certified: Finkok, Facturama, SW Sapien…) + a **CSD** cert from
> **sat.gob.mx** — wired through the `pac` provider, not the gated portal harness.
> Facturae / national **XSD** files (not secrets) come from **facturae.gob.es** + each authority.
