# E-Invoicing Credentials — Setup Guide

> Step-by-step guide for obtaining the credentials of every e-invoicing platform the
> project can transmit to. **The deployed app takes these per-tenant in each company's
> settings (stored encrypted in the DB) — env vars / GitHub secrets are only for the live CI
> tests.** Generated 2026-07-12. Each section was researched against official sources (listed inline).

---

## Read this first — you almost certainly need *zero* of these to ship

- **The pull-request CI is green with no secrets at all.** The gating workflows
  (`Tests`, `Business Scenarios`, `Verify Docker Build`) run entirely offline and mocked.
  Nothing in this guide is required to merge.
- These credentials only feed **`.github/workflows/compliance-live.yml`** — a **separate,
  opt-in** workflow that runs the real external round-trips. It fires **only** on the manual
  *Run workflow* button or the nightly cron. It **does not gate the PR**.
- Every channel **self-gates**: a leg runs only when its `<PREFIX>_LIVE=1` flag **and** its
  credential secrets are both present. Missing secrets ⇒ that leg is **skipped**, never failed.
  So you can add secrets **one country at a time** — you never need the whole list.
- **Priority:** the project's real markets are **France, Poland, Italy** (+ Peppol for
  cross-border). Everything else is long-tail — document­ed here for completeness, not urgency.

## Two separate credential paths — the deployed app vs the CI tests

The app is **multi-tenant**. There are two entirely separate places credentials can live, and
they must not be confused:

**① Deployed app (production — this is what real usage relies on).**
Each company enters **its own** channel credentials in the app UI — no env vars, no GitHub
secrets involved:
- **Settings → Channels** → connect a channel (e.g. FR→PDP, PL→KSeF) and paste that tenant's
  API credentials → stored in `CompanyChannelConfig` (one row per `companyId` + provider +
  `TEST`/`PROD` environment).
- **Settings → Signing certificates** → upload the tenant's `.pfx/.p12` + password → stored in
  `CompanySigningCertificate`.
- Both are **AES-256-GCM encrypted at rest** (`backend/src/utils/secret-crypto.ts`), scoped by
  `companyId`. The **only** server-side env var the deployed app needs for this is
  **`CREDENTIALS_ENCRYPTION_KEY`** (see Transverse secrets). Tenant A never sees tenant B's keys.

**② CI live tests (`compliance-live.yml`) — the only reason env/GitHub secrets exist here.**
A CI job has no tenant and no UI, so the live test specs read credentials from **env vars /
GitHub repository secrets** instead. That is the *sole* purpose of every `<PREFIX>_*` secret named
in this guide. It never touches the deployed app's per-tenant storage.

**What this means for the per-platform sections below:** the "how to obtain this credential from
the authority" steps are **identical** for both paths — you get the same client_id / token /
certificate from the same portal. Only the **destination** differs:
- for **production** → paste it into that company's *Settings → Channels / Signing certificates*;
- for a **CI live test** → put it in a **GitHub secret** (below).

### Adding a GitHub secret (CI-test path only)

**UI:** repo → *Settings → Secrets and variables → Actions → New repository secret*.

**CLI:**
```bash
gh secret set KSEF_AUTH_TOKEN --body '<value>'
# certificates are base64 of the .pfx/.p12 file:
base64 -w0 cert.pfx | gh secret set SDI_CERTIFICATE
```
Constants like `*_LIVE`, `*_ENVIRONMENT`, `*_ENV` are **not** secrets — they live directly in
`compliance-live.yml`. Only credentials go in Secrets.

---

## At-a-glance status

Legend — **Repo:** ✅ set · 🟡 partial · 🔴 missing &nbsp;|&nbsp; **Market:** ⭐ primary (FR/PL/IT + Peppol) · ▫️ long-tail

| # | Platform | Country | Repo | Market | Realistic effort / hardest blocker |
|--:|----------|---------|:----:|:------:|------------------------------------|
| 1 | KSeF | 🇵🇱 Poland | ✅ | ⭐ | Already set. Token auth sunsets end-2026 → certificate path later |
| 2 | PDP (superpdp) | 🇫🇷 France | 🟡 | ⭐ | Sandbox set; routing IDs optional; prod = commercial PDP contract |
| 3 | Chorus Pro (PISTE) | 🇫🇷 France | 🔴 | ⭐ | Needs a SIRET structure + "Gestionnaire principal" to create the tech account |
| 4 | SdI | 🇮🇹 Italy | 🔴 | ⭐ | Partita IVA on Entratel + channel accreditation (collaudo) |
| 5 | ANAF e-Factura | 🇷🇴 Romania | 🔴 | ▫️ | Interactive OAuth w/ qualified cert; only the 365-day refresh token automates |
| 6 | Peppol | 🌍 cross-border | ✅/🔴 | ⭐ | peppol.sh proven zero-secret; generic AP = commercial AP account + SMP |
| 7 | AFIP/ARCA | 🇦🇷 Argentina | 🔴 | ▫️ | Personal Clave Fiscal N2+ to click WSASS; no headless bootstrap |
| 8 | SEFAZ / NF-e | 🇧🇷 Brazil | 🔴 | ▫️ | 27 state portals + paid ICP-Brasil A1 cert (human ID check) |
| 9 | SII | 🇨🇱 Chile | 🔴 | ▫️ | Per-taxpayer "set de pruebas" review; no vendor sandbox |
| 10 | SRI | 🇪🇨 Ecuador | 🔴 | ▫️ | Paid firma electrónica + test authorization granted in SRI en línea |
| 11 | DGI | 🇺🇾 Uruguay | 🔴 | ▫️ | PSC digital cert before postulación; no OAuth (client_id/secret don't exist) |
| 12 | ZATCA Fatoora | 🇸🇦 Saudi Arabia | 🔴 | ▫️ | Fatoora portal OTP w/ KSA VAT; 2 of 6 secrets aren't ZATCA concepts |
| 13 | GİB e-Fatura | 🇹🇷 Turkey | 🔴 | ▫️ | Mali mühür seal; API creds only exist once a private integrator is chosen |
| 14 | ETA | 🇪🇬 Egypt | 🔴 | ▫️ | HSM/cloud signing procurement + manual ERP registration |
| 15 | FIRS | 🇳🇬 Nigeria | 🔴 | ▫️ | New system; the key-generation screen isn't publicly documented yet |
| 16 | KRA eTIMS | 🇰🇪 Kenya | 🔴 | ▫️ | Requires a Kenyan KRA PIN (local entity); no published vetting SLA |
| 17 | IRP (GST) | 🇮🇳 India | 🔴 | ▫️ | Two-layer creds (app + per-GSTIN) don't fit the 4-secret shape |
| 18 | MyInvois | 🇲🇾 Malaysia | 🔴 | ▫️ | client_id/secret free & instant; signing cert is paid (RM1.5k–15k, 3–5 d) |
| 19 | Coretax / e-Faktur | 🇮🇩 Indonesia | 🔴 | ▫️ | No public sandbox; PJAP appointment or reseller middleman |

### ⚠️ The secret list is a superset — some secrets are placeholders
`compliance-live.yml` declares a uniform `CLIENT_ID / CLIENT_SECRET / API_KEY / CERTIFICATE`
shape per country, but several tax authorities don't issue all of those. Research flagged, in
particular, that these **have no real counterpart** at the authority and only become meaningful
via a chosen third-party integrator (or not at all): `ZATCA_CLIENT_ID`, `ZATCA_API_KEY`,
`GIB_CLIENT_ID/SECRET/API_KEY`, `SII_CLIENT_ID/SECRET`, `UY_DGI_CLIENT_ID/SECRET`. Treat the
per-section "What each secret is" notes as authoritative over the uniform shape.

---

## Transverse secrets (not country-specific)

**`CREDENTIALS_ENCRYPTION_KEY`** — 🔴 *self-generate, no external service.* Encrypts channel
credentials at rest (AES-256-GCM, `backend/src/utils/secret-crypto.ts`). Must be **32 bytes**,
as **hex (64 chars)** or **base64 (44 chars)**. Generate:
```bash
openssl rand -hex 32   # → paste into CREDENTIALS_ENCRYPTION_KEY
```

**`TSA_URL`** — ✅ *already set.* RFC 3161 timestamp authority for signature level -T. Set it to a
public TSA to get level T, leave empty for level BES (offline-safe). FreeTSA's endpoint is
`https://freetsa.org/tsr` (free, no account). Consumed by
`backend/src/compliance/providers/signing/registry.ts`.

**Per-portal test parameters** — `*_COUNTRY`, `*_SELLER_VAT`, `*_BUYER_VAT`, `*_TAXPAYER_ID`
are **not credentials**; they're the identifiers the live test invoice is issued with. Use the
sandbox/test entity's own IDs (e.g. the CUIT/CNPJ/NIP tied to your test certificate). They only
matter for the country whose live leg you actually run.

---

## 1. KSeF — Poland (national clearance / B2B mandatory)

> **GitHub secrets:** `KSEF_AUTH_TOKEN`, `KSEF_NIP` &nbsp;•&nbsp; **Live flag:** `KSEF_LIVE=1` &nbsp;•&nbsp; **Sandbox:** yes (ksef-test) &nbsp;•&nbsp; **Repo status:** ✅ already set

**What each secret is / where it comes from**
- `KSEF_AUTH_TOKEN` → the "token KSeF" (token uwierzytelniający), a bearer token used to authenticate machine-to-machine calls to the KSeF API. It is generated (not assigned by an admin) by a person who already has KSeF permissions for the given NIP, after they authenticate to the taxpayer application with a Trusted Profile (Profil Zaufany), qualified signature, qualified electronic seal, or mObywatel. Generated in the "Tokeny" screen of the MCU — Moduł Certyfikatów i Uprawnień (Certificates & Permissions Module), inside Aplikacja Podatnika KSeF 2.0. It is shown once at creation and cannot be retrieved again. Scope (issue invoices / view-download invoices / manage permissions) is chosen at generation time.
- `KSEF_NIP` → the 10-digit Polish tax identification number (NIP, with a checksum) of the entity issuing invoices. It is used as the `ContextIdentifier` both when authenticating to the API and when addressing which taxpayer's invoice session/session token applies.

**Prerequisites**
- A Polish NIP for the issuing entity (real for production; any checksum-valid NIP works for test, fictitious is fine).
- Someone with KSeF permissions for that NIP: sole proprietors (JDG) get "owner" rights automatically via their own Trusted Profile/qualified signature; companies either (a) have a qualified electronic seal embedding the company NIP — anyone using it gets automatic owner-level access — or (b) must file form **ZAW-FA** with the tax office naming a natural person as the authorized representative (must be signed by someone entitled to represent the company per KRS/company agreement).
- A way for that authorized person to log in: Profil Zaufany, qualified certificate, qualified seal, or mObywatel (production); none of these are required in the test environment.

**Step-by-step: getting TEST/sandbox credentials**
1. Go to the test taxpayer application (linked from the official KSeF portal, currently reachable at `ap-test.ksef.mf.gov.pl`, or via the "wersja testowa" tools section on `ksef.podatki.gov.pl`).
2. Click "Uwierzytenij do aplikacji testowej" — the test environment simulates authentication, so no real Profil Zaufany/qualified signature is needed; just supply any mathematically valid NIP (e.g. a generated test NIP).
3. Once in, open the Tokeny / MCU (Moduł Certyfikatów i Uprawnień) tab and click "Generuj token." Name it and pick a permission scope (at minimum invoice issuing; add invoice viewing if the integration also downloads/queries invoices).
4. Copy the displayed token immediately — it is shown only once. This is `KSEF_AUTH_TOKEN` for test; the NIP you used is `KSEF_NIP`.
5. API base URL for test is `https://ksef-test.mf.gov.pl/api`. (Programmatic alternative: call the challenge endpoint for the given NIP, then submit a signed/encrypted auth request — the test environment accepts self-signed certificates as equivalents to qualified certificates for the XAdES path, but the token path above is simpler for sandbox use.)

**Step-by-step: getting production credentials** (differences vs test)
1. Confirm the company's real NIP is registered with the Polish tax administration.
2. Establish real KSeF authorization for a person: sole proprietors need nothing extra; companies must either present a qualified electronic seal (paid, from a qualified trust service provider) or file **ZAW-FA** with their tax office (paper, or through an authorized channel) naming the person who will act in KSeF — this filing is processed by the tax office and is not instantaneous.
3. That authorized person logs into the production taxpayer application (via `ksef.podatki.gov.pl`, production Aplikacja Podatnika KSeF 2.0) using Profil Zaufany, a qualified signature, a qualified seal, or mObywatel — real identity verification applies (OCSP/CRL checks against the certificate issuer), unlike the instant test-env simulation.
4. In the same Tokeny/MCU module, generate the production KSeF token with the required scope; copy it immediately (one-time display) → this is the production `KSEF_AUTH_TOKEN`; `KSEF_NIP` is the company's real NIP.
5. Point the integration at the production API base and set `KSEF_LIVE=1`.

**Cost, lead time & blockers**
- The KSeF service and token generation themselves are free; test-environment access is instant with no registration or company verification (fictitious NIP allowed).
- Production blockers are all on the identity/authorization side, not the API: obtaining a Trusted Profile is free but needs a Polish e-ID/bank confirmation or in-person visit; a qualified certificate/seal is a paid commercial product (issued by providers such as KIR, Certum, EuroCert, Sigillum) and involves identity vetting that can take days; for companies, ZAW-FA must be filed with and processed by the tax office (turnaround varies, must be signed by a properly authorized company representative).
- **Forward-looking blocker:** KSeF tokens are being sunset — the ability to *generate* new tokens is withdrawn from 31 Dec 2026, and from 1 Jan 2027 existing tokens stop working entirely; only KSeF certificates (qualified/organizational certificate-based XAdES signing) remain a supported authentication method. Any integration relying purely on `KSEF_AUTH_TOKEN` will need a certificate-based auth path before that cutover.
- Mandatory rollout timeline (Act of 5 Aug 2025, Journal of Laws item 852): 1 Feb 2026 for large taxpayers (>200M PLN 2024 VAT sales), 1 Apr 2026 for all other businesses (minor statutory exclusions), 1 Jan 2027 for "digitally excluded" taxpayers. 2026 is treated as a penalty-free transition year for KSeF-related errors/non-adaptation.

**Official sources**
- https://ksef.podatki.gov.pl/wyjasnienia/generowanie-tokenow-w-module-mcu-juz-dostepne/
- https://ksef.podatki.gov.pl/ksef-news/uprawnienia-i-autoryzacja/
- https://ksef.podatki.gov.pl/
- https://ksef-test.mf.gov.pl/
- https://ap-test.ksef.mf.gov.pl/
- https://ksef.podatki.gov.pl/media/jxgjepcn/instrukcja-uwierzytelnienia-w-aplikacji-podatnika-ksef-20-wersja-testowa.pdf
- https://github.com/CIRFMF/ksef-docs/blob/main/uwierzytelnianie.md
- https://www.gov.pl/web/finanse/obowiazkowy-ksef-odroczony-do-1-lutego-2026-r

---

## 2. PDP — France (Plateforme de Dématérialisation Partenaire, B2B reform)

> **GitHub secrets:** `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET`, `PDP_API_STYLE`, `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING` &nbsp;•&nbsp; **Live flags:** `PDP_LIVE=1`, `PDP_AFNOR_LIVE=1` &nbsp;•&nbsp; **Sandbox:** yes (superpdp) &nbsp;•&nbsp; **Repo status:** ✅ mostly set (routing optional)

**What each secret is / where it comes from**
- `PDP_BASE_URL` — the PDP's API root, e.g. `https://api.superpdp.tech` (SuperPDP's sandbox/prod endpoint; other PA vendors each publish their own).
- `PDP_CLIENT_ID` / `PDP_CLIENT_SECRET` — an OAuth2 client-credentials pair. On SuperPDP these are created per test *enterprise* under **Applications → New Application**, are enterprise-scoped (a `seller_client_id`/`seller_client_secret` pair and a separate `buyer_client_id`/`buyer_client_secret` pair when testing both sides of a flow), and are shown **only once** at creation time. Token endpoint: `https://api.superpdp.tech/oauth2/token`.
- `PDP_API_STYLE` — selects which wire protocol the repo's `PdpTransmissionProvider` speaks: `superpdp` (SuperPDP's proprietary REST "API Flux") or `afnor` (the AFNOR **XP Z12-013** interoperability API, standardized May 2025, meant to work identically across any conformant PA). Code: `backend/src/compliance/providers/transmission/pdp/pdp-client.ts` (`PdpApiStyle = 'superpdp' | 'afnor'`).
- `PDP_SELLER_ROUTING` / `PDP_BUYER_ROUTING` — optional routing identifiers used for **annuaire** (directory) lookups, i.e. which PA a given counterparty is registered with. These are SIREN/SIRET-based identifiers of the seller/buyer companies (see `pdp-client.ts` "SuperPDP French Directory (annuaire routing)"); without them the client falls back to direct routing to the configured `PDP_BASE_URL`.
- `PDP_LIVE=1` / `PDP_AFNOR_LIVE=1` — feature-flag the real network round-trip in Jest specs (`pdp-live.spec.ts`, `pdp-afnor-live.spec.ts`); unset, those tests stay mocked.

**Prerequisites**
- A French **SIREN/SIRET** (real or fictional-but-well-formed for sandbox) to register a test "enterprise" on the sandbox PA.
- A choice of PA: the project already targets **SuperPDP** (sandbox) for both API styles. For AFNOR-style testing against a *different* PA, that PA must also have shipped its own AFNOR (XP Z12-013) endpoint — as of the SuperPDP announcement, this is still rolling out ("API Flux" available now, "API Annuaire" was "coming soon").
- Production use requires the chosen platform to be **immatriculée** (registered) by the DGFiP as a Plateforme Agréée (PA, formerly called PDP) — see below.

**Step-by-step: getting superpdp sandbox credentials**
1. Go to `https://www.superpdp.tech/` and create a free account.
2. Create one or more **test enterprises** (fictional companies with a SIREN-like identifier) inside the sandbox.
3. Go to **Applications → New Application**, select the enterprise from the dropdown, click **Create**.
4. Copy the generated `client_id` / `client_secret` immediately — they are shown only once. Repeat for a second enterprise if you need to test both seller and buyer sides of a flow (`seller_client_id`/`seller_client_secret` + `buyer_client_id`/`buyer_client_secret`).
5. Set `PDP_BASE_URL=https://api.superpdp.tech`, `PDP_CLIENT_ID`/`PDP_CLIENT_SECRET` from step 4, and `PDP_API_STYLE=superpdp` (or `afnor` to exercise the XP Z12-013 endpoint set — SuperPDP's "API Flux" — instead of the proprietary one).
6. Full technical/API reference: `https://www.superpdp.tech/documentation/` and `https://www.superpdp.tech/openapi/` (the exact in-page mechanics of the "New Application" flow were confirmed via a third-party forum walkthrough, not directly scraped from superpdp.tech, which renders as a JS app — see note below).
7. Optional: set `PDP_SELLER_ROUTING` / `PDP_BUYER_ROUTING` to the test enterprises' SIREN-based identifiers to exercise annuaire routing instead of direct base-URL routing.

Note: superpdp.tech's own pages are a client-rendered SPA — automated fetches of `/documentation/` and `/openapi/` returned only page titles, no body HTML. The signup-flow specifics above come from a third-party (Ubuntu-fr forum) walkthrough that quotes the documentation's step text; verify against the live site during actual onboarding.

**Step-by-step: choosing/onboarding a production PDP (now called Plateforme Agréée, PA)**
1. Consult the official DGFiP registry of registered platforms: `https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees` (also referenced as `https://www.impots.gouv.fr/liste-des-plateformes-de-dematerialisation-partenaires-pdp-immatriculees-sous-reserve`), reached from `https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees`. As of ~July 2026 there are ~137 registered PAs (status "sous réserve" = provisional pending conformance tests, or "définitif" once conformance tests are passed and reported to the DGFiP).
2. Pick a PA that offers the API style you need (proprietary vs AFNOR/XP Z12-013) and supports the invoice formats you produce (Factur-X, UBL, CII). SuperPDP is one option and is itself DGFiP-registered (positions itself as "the simplest and cheapest PA").
3. Sign a contract / onboarding agreement with that PA (each vendor's own commercial process — not a government step). Registration is valid 3 years, renewable.
4. If instead your own product wants to *become* a PA (not applicable here, but for completeness): apply via `https://demarche.numerique.gouv.fr/commencer/immatpdp` (Démarches Simplifiées), submitting SIREN + Kbis extract (<3 months), legal representative ID, a valid ISO/IEC 27001 certificate covering the relevant systems, GDPR compliance docs, and technical specs for transmission/security. Contact: `immat.pdp@dgfip.finances.gouv.fr`.
5. For AFNOR/interop testing specifically: confirm both counterparties' PAs support XP Z12-013 (`https://norminfo.afnor.org/norme/xp-z12-013/...`); the standard purposefully lets a client that speaks the AFNOR API connect to *any* conformant PA without per-vendor integration work.

**Cost, lead time & blockers**
- SuperPDP sandbox signup: free, self-service, no lead time (per the forum walkthrough); production/live use "reportedly requires submitting a separate formal request with supporting documentation" — exact cost not published on the pages fetched.
- DGFiP PA immatriculation (only relevant if *becoming* a PA): stated turnaround "environ 15 heures" best case, ~12 days for cases needing back-and-forth, ~2 months for complex/incomplete files; no application fee mentioned on the portal.
- Biggest blocker for this project: choosing/onboarding a *second*, independent production PA to prove real interop (vs. testing PDP↔PDP against the same SuperPDP instance) requires a real contract with a commercial vendor — not obtainable via self-service sandbox signup alone.
- Reform deadlines to keep in mind: receiving e-invoices mandatory for **all** businesses from **1 Sept 2026**; issuing mandatory for large/ETI companies from **1 Sept 2026**, generalized to all SMEs/micro-enterprises from **1 Sept 2027**. The PPF (Portail Public de Facturation) is not a universal free alternative — a PA is required.

**Official sources**
- https://www.superpdp.tech/documentation/
- https://www.superpdp.tech/openapi/
- https://www.superpdp.tech/documentation/9/
- https://www.superpdp.tech/actualites/2026-03-12-api-afnor-disponible/
- https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees
- https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees
- https://demarche.numerique.gouv.fr/commencer/immatpdp
- https://norminfo.afnor.org/norme/xp-z12-013/api-pour-interfacer-les-systemes-dinformations-des-entreprises-avec-les-plateformes-de-dematerialisation-partenaires/313343
- https://forum.ubuntu-fr.org/viewtopic.php?id=2094936 (third-party walkthrough of SuperPDP's Applications/New Application signup flow, since superpdp.tech itself is a JS SPA that didn't yield body content to automated fetch)

---

## 3. Chorus Pro (PISTE) — France (B2G mandatory)

> **GitHub secrets:** `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` &nbsp;•&nbsp; **Live flag:** `CHORUSPRO_LIVE=1` (`CHORUSPRO_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (qualification) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

Two *completely separate* systems issue these four values — mixing them up is the #1 support question in the Chorus Pro community:

- **`CHORUSPRO_CLIENT_ID` / `CHORUSPRO_CLIENT_SECRET`** → come from **PISTE** (piste.gouv.fr, AIFE's shared government-API gateway that has hosted all Chorus Pro API access since Jan 2021, replacing the old certificate auth). Inside a PISTE **application**, the config screen has two distinct panels that look similar and get confused:
  - **"API Keys"** — a generic per-API key used by *some other* PISTE-hosted APIs that don't do OAuth. **Not what Chorus Pro uses.**
  - **"OAuth Credentials" / Authentication tab** — shows a `Client ID` (UUID) and a `Secret Key` (revealed via a "view/regenerate client secret" button). **This is the pair you want.** It's used with the OAuth2 `client_credentials` grant against `oauth.piste.gouv.fr` (sandbox: `sandbox-oauth.aife.economie.gouv.fr`) to obtain a short-lived Bearer token before every Chorus Pro API call.
- **`CHORUSPRO_TECH_LOGIN` / `CHORUSPRO_TECH_PASSWORD`** → come from Chorus Pro itself (the "**compte technique**", created inside the Chorus Pro portal, *not* PISTE). It exists purely so external systems can call the API — it cannot log into the Chorus Pro web portal. Login format looks like `TECH_n_xxxxxx@cpro.fr`; the password is auto-generated and shown **once**. This login:password pair is base64-encoded and sent as a `cpro-account` HTTP header on every API call — it's a second, independent layer of auth stacked on top of the PISTE OAuth Bearer token. It must be rotated by the org's Manager every 424 days (~14 months).

So a real Chorus Pro API call needs **both**: a PISTE OAuth Bearer token (CLIENT_ID/SECRET) **and** the `cpro-account` header (TECH_LOGIN/PASSWORD).

**Prerequisites**

- An existing **structure** (legal entity) already registered on the Chorus Pro portal, identified by **SIRET**.
- A Chorus Pro portal user with the **"Gestionnaire principal"** (main Manager) role on that structure — only this role can create/reset a technical account.
- A PISTE account (free, self-service signup).
- For production later: the same steps repeated in a dedicated production PISTE application + a production "raccordement" declaration — out of scope while `CHORUSPRO_ENVIRONMENT=SANDBOX`.

**Step-by-step: creating a PISTE account + OAuth application (sandbox)**
1. Go to `https://piste.gouv.fr/registration` ("Créer un compte"). Fill name, email (becomes your login), password (≥12 chars, upper+lower+digit+special), accept the CGU checkbox. Click the activation link emailed to you within 5 days (AIFE deletes unactivated accounts after that).
2. Log in and open **"Mes applications"** (`https://piste.gouv.fr/apps`). PISTE auto-provisions one application named `APP_SANDBOX_<your-email>` — this is your qualification-environment app; you don't create it manually.
3. Open the API catalog at `https://piste.gouv.fr/api-catalog-sandbox` and locate the Chorus Pro APIs (**Factures**, **Structures**, **Utilisateurs**, **Transverses** — plus `FacturesTravaux`/`Engagements` if needed). Each API is listed twice — Sandbox and Production — click **"Demander l'accès"** on the Sandbox versions.
4. Back in the sandbox application, click **"Modifier l'application"**, check the CGU box for each Chorus Pro API you selected, click **"Valider mes choix CGU"**, then **"Sauvegarder l'application"**.
5. Open the application's **Authentication / OAuth Credentials tab** (not the separate "API Keys" list) and copy the **Client ID** and **Secret Key** (click "view client secret" to reveal it). These are `CHORUSPRO_CLIENT_ID` and `CHORUSPRO_CLIENT_SECRET`.

**Step-by-step: creating the Chorus Pro technical account + subscribing to the Chorus Pro API on PISTE**
1. Make sure the company's structure already exists on the Chorus Pro qualification portal and you (or someone) holds the **Gestionnaire principal** role for it.
2. In the Chorus Pro portal, open **"Raccordement EDI et API"** → tab **"Gérer raccordement API"** → click **"Déclarer un raccordement PISTE"**. Fill in: the structure, the PISTE sandbox application name (`APP_SANDBOX_...` from step above), usage type, and a technical contact.
3. Still in the portal, create the technical account: choose request type **"Création d'un compte technique"**, then **"Choisir la structure"**. Chorus Pro auto-generates a **login** and **password**, shown once on screen — save immediately. This is `CHORUSPRO_TECH_LOGIN` / `CHORUSPRO_TECH_PASSWORD`. The account activates ~30 minutes later; a confirmation email "[Chorus Pro] Création du compte utilisateur technique" follows.
4. At call time, base64-encode `login:password` and send it as the `cpro-account` header alongside the PISTE OAuth Bearer token on every request to the Chorus Pro sandbox API host.
5. Only when qualification testing passes: repeat both the PISTE step (create a dedicated **production** application via "créer une application") and the Chorus Pro step (production raccordement + a second technical account) — not needed now since the repo runs `CHORUSPRO_ENVIRONMENT=SANDBOX`.

**Cost, lead time & blockers**
- Both PISTE and Chorus Pro are free state services — no pricing found anywhere in AIFE/PISTE/community docs; this is the mandatory, no-cost B2G invoicing channel.
- Lead time: PISTE account email-activation is near-instant but community guidance mentions up to 24–48h AIFE-side delay in some cases; Chorus Pro technical-account creation is effective ~30 minutes after request.
- Current repo blocker: nothing is set up yet — needs a real SIRET'd structure on the Chorus Pro portal, a user with the **Gestionnaire principal** role to create the technical account, and a PISTE account/application for the OAuth credentials. All of this is blocked on the user completing PISTE signup first (per project notes).
- Common trap to flag in the setup guide: picking the wrong credential panel in PISTE ("API Keys" vs "OAuth Credentials") — Chorus Pro only accepts the OAuth Credentials pair.

**Official sources**
- https://piste.gouv.fr/registration
- https://piste.gouv.fr/apps
- https://piste.gouv.fr/api-catalog-sandbox
- https://communaute.chorus-pro.gouv.fr/documentation/piste-presentation/?lang=en
- https://communaute.chorus-pro.gouv.fr/chorus-pro-piste-comment-reussir-son-raccordement-api-oauth2/?lang=en
- https://communaute.chorus-pro.gouv.fr/raccordement-a-chorus-pro-en-api-le-passage-sur-piste-devient-obligatoire/?lang=en
- https://communaute.chorus-pro.gouv.fr/quest-ce-que-le-compte-technique-sur-chorus-pro/?lang=en
- https://communaute.chorus-pro.gouv.fr/documentation/help-for-api-developers-in-oauth2-mode/?lang=en
- https://communaute.chorus-pro.gouv.fr/documentation/perimetre-et-prerequis-2/
- https://portail.chorus-pro.gouv.fr/aife_documentation?id=kb_article_view&sysparm_article=KB0012860
- https://cpro-docs.choruspay.fr/en/getting-started
- https://github.com/betagouv/api.gouv.fr/blob/master/_data/api/chorus-pro.md

---

## 4. SdI (Sistema di Interscambio) — Italy (FatturaPA clearance)

> **GitHub secrets:** `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` &nbsp;•&nbsp; **Live flag:** `SDI_LIVE=1` &nbsp;•&nbsp; **Sandbox:** yes (ambiente di collaudo) &nbsp;•&nbsp; **Repo status:** 🔴 missing (credentials — see below) &nbsp;•&nbsp; **Code status:** implemented-awaiting-accreditation

**Code status, precisely** (2026-09-01): a real SdICoop SOAP client exists
(`backend/src/modules/documents/transports/sdi/sdicoop-client.ts`, `SdiCoopClient` — the `RiceviFile`
envelope, mTLS via `pfx`/`passphrase`, response parsing, named EI01/EI02/EI03/SOAP-Fault errors), built
directly from the WSDL/XSD/instructions PDFs published on fatturapa.gov.it (read and cited in that
file's own header, fetched 2026-09-01) — plus a minimal PUSH receiver for the six `TrasmissioneFatture`
notifiche (`sdi-notifiche.controller.ts`, journaling into `DocumentAuthorityEvent`). Neither has ever
been run against, or received a call from, the real Sistema di Interscambio — the four secrets above
are, as of this writing, unset everywhere (no accreditation exists yet — Step-by-step below is the
actual blocker). The code is ready the day accreditation lands; `SDI_ENDPOINT` (the `SdIRiceviFile`
HTTPS URL) is a NEW secret this status introduces — see its own bullet below for why it can't be a
fixed constant the way KSeF's base URLs are.

**What each secret is / where it comes from**

- `SDI_ID_TRASMITTENTE` — the `<IdTrasmittente><IdCodice>` value stamped in every FatturaPA XML header. For an Italian subject it is simply the **Codice Fiscale** of whoever's accredited channel is doing the sending (prefixed `IT` in `IdPaese`). It is *not* a code SdI hands you separately — it's derived from the Partita IVA/Codice Fiscale used to run the accreditation in Step 1 below.
- `SDI_ENDPOINT` — the HTTPS URL of the `SdIRiceviFile` SOAP web-service (`RiceviFile` operation) THIS trasmittente submits to. Unlike KSeF's fixed test/prod base URLs, the WSDL Invoicerr's client is built from (`SdIRiceviFile_v1.0.wsdl`, published on fatturapa.gov.it) shows only a placeholder address (`http://servizi.fatturapa.it/ricevi_file`) — the real one (collaudo, then production) is assigned to the accredited intermediary during the Sistema di Accreditamento flow below, and can change over time (see Step-by-step, "è possibile modificare gli endpoint... in qualsiasi momento"). Never a constant in the codebase — a required field on the "sdi" channel config.
- `SDI_CERTIFICATE` — base64 of a **PKCS#12/PFX** bundling (a) an RSA private key you generate yourself and (b) the **client certificate that Agenzia delle Entrate's own CA signs and issues back to you** during SDICoop accreditation, in response to a CSR you submit through the portal. This is *not* a commercially-purchased eIDAS "qualified certificate" — it's AdE's own PKI issuing an X.509 client cert for mutual-TLS authentication against the SDICoop web-service endpoint. (A separate *server* CSR/cert is also required if your channel is bidirectional — same distinct-RSA-key rule.)
- `SDI_CERT_PASSWORD` — the password protecting that PFX/P12 file.

**Prerequisites** (channel type SDICoop vs SDIFTP; qualified certificate; Italian entity / partita IVA; Fisconline/Entratel credentials)

- Accreditation is required **only** for the two "always-on" transmission channels: **SDICoop** (web-service, HTTPS/SOAP) or **SDIFTP** (SFTP). It is *not* required for PEC or for the "Fatture e Corrispettivi" web portal — those need no certificate/channel setup at all.
- The Partita IVA that will hold the channel must be registered on AdE's **Servizi Telematici (Entratel/Fisconline)**, and the person operating the Sistema di Accreditamento (SA) must be that VAT number's **Gestore Incaricato**, or a third party explicitly delegated the service **"Accreditamento e gestione dei canali trasmissivi"** via Entratel/Fisconline.
- Login to the SA is via **SPID/CIE/CNS** digital identity or **Entratel/Fisconline** credentials — this is identity/access auth, separate from the SDICoop client/server certificates described above.
- Foreign operators **without** a permanent establishment in Italy must first get a natural person an Italian **Codice Fiscale** (AdE's "identification for foreign citizens" procedure) and have the channel holder formally notify AdE of that person as the authorized operator, before SA access is granted.
- For SDICoop specifically: two CSRs (client + server) each with a **distinct RSA private key** are mandatory (AdE tightened this in a 2024/2025 security update — old setups sharing one key across both certs must regenerate).

**Step-by-step: channel accreditation (accreditamento) + collaudo/test**
1. Confirm the Partita IVA is registered on Entratel/Fisconline; assign/verify the "Accreditamento e gestione dei canali trasmissivi" delegation to whoever will run this.
2. Log into the Sistema di Accreditamento with SPID/CIE/CNS or Entratel/Fisconline. If the VAT number has no channel yet, SA starts the "new channel" flow directly.
3. Pick channel type — **SDICoop** (web-service) or **SDIFTP** (SFTP) — and supply the required technical info (service endpoints for reception, if bidirectional).
4. For SDICoop: generate two CSRs with `openssl req -new` (client key + server key, kept distinct), submit them in the channel-configuration screen.
5. AdE issues back `.CER` files signed by its CA, plus a **Test Kit** (CA certificates for the collaudo/test environment). Combine your private key + the issued `.CER` into a PKCS#12/PFX — this becomes `SDI_CERTIFICATE`/`SDI_CERT_PASSWORD`.
6. Run the **test di interoperabilità** in the ambiente di collaudo: exercise the channel end-to-end with a fixed set of technical test cases (one PA-invoicing use case). These only check technical connectivity, not invoice content. Test recipient codes are obtained inside SA under "Test di interoperabilità → Gestisci test interoperabilità → Codici destinatario." Files sent in collaudo are **not legally valid** and are never actually delivered.
7. Once tests pass, SA dynamically generates the **Accordo di Servizio** (Service Agreement) between AdE and the Sottoscrittore (channel holder); accept it ("presa visione") online. A PEC confirms the channel is "accreditato" — but it is still not live for real invoices at this point.

**Step-by-step: going to production**
1. From SA, submit the explicit **"Passaggio in produzione"** request once collaudo is validated — accreditation and production activation are two separate steps.
2. Receive PEC confirmation that the channel is active in production; the same client/server certificates now authenticate against the production SDICoop endpoint (AdE explicitly keeps the collaudo environment permanently available afterward too, for regression testing).
3. If the channel also needs to *receive* invoices (not just send), request one or more **Codice Destinatario B2B** values (up to 100) via SA's "Gestire il canale" section once reception is accredited.
4. Point Invoicerr's SdI client at the production SDICoop/SDIFTP endpoint, set `SDI_LIVE=1`, and keep `SDI_ID_TRASMITTENTE` = the Codice Fiscale used for accreditation.

**Cost, lead time & blockers**

- No accreditation fee is charged by AdE for either SDICoop or SDIFTP — the entire flow (CSR generation, CER issuance, interoperability tests, production cutover) is self-service through the portal; the official pages found do not state a fixed AdE turnaround SLA, so the real lead time is however long it takes to generate/validate certificates and pass the interoperability tests internally.
- **Materially simpler alternative for a multi-tenant SaaS like Invoicerr**: accredit **one** SDICoop/SDIFTP channel under Invoicerr's own Partita IVA and act as an **Intermediario** (fatturapa.gov.it's "Intermediari" role) transmitting FatturaPA files on behalf of all customers, rather than requiring every customer to run their own accreditation/certificate/CSR cycle. The customer's data still appears as `CedentePrestatore`; only `IdTrasmittente` is the intermediary's own Codice Fiscale.
- Hardest actual blocker: this whole procedure needs an **Italian** Partita IVA under our control (or a client's) already active on Entratel/Fisconline, plus someone able to become/delegate as Gestore Incaricato — a foreign entity without an Italian permanent establishment has an extra identification detour (Codice Fiscale issuance) before even reaching the SA login screen.

**Official sources**
- https://www.fatturapa.gov.it/it/SistemaAccreditamento/
- Re-vérifié le 2026-09-01 contre https://www.fatturapa.gov.it/it/sistemainterscambio/ (sections
  « Accreditamento al Sistema di Interscambio » et « sperimentazione ») : la procédure ci-dessus est
  toujours exacte — portail d'accréditation https://accreditamento.fatturapa.gov.it/, l'ambiente di
  test « rimane disponibile permettendo la trasmissione e/o la ricezione dei file come se fosse in
  produzione ma privi di valore legale », codici destinatario de test sous « Test di
  interoperabilità - Gestione test interoperabilità », limite quotidienne de fichiers en test.
- https://www.fatturapa.gov.it/it/SistemaAccreditamento/cose-il-sistema-di-accreditamento/
- https://www.fatturapa.gov.it/it/SistemaAccreditamento/processo-per-nuovo-accreditamento/
- https://www.fatturapa.gov.it/it/sistemainterscambio/sperimentazione/
- https://www.fatturapa.gov.it/it/faq/faq-accreditamento-canale/
- https://www.fatturapa.gov.it/it/comefare/intermediari/
- https://www.fatturapa.gov.it/it/news/Aggiornate-richieste-di-Certificate-signing-request-csr-e-chiavi-private-distinte/
- https://www.fatturapa.gov.it/export/documenti/guide/Guida-allavvio-SA-v1.0.pdf (Agenzia delle Entrate, "Sistema di Accreditamento – Guida all'avvio", v1.0, 03/02/2025)
- https://www.agenziaentrate.gov.it/portale/documents/20143/289347/Accreditamento+e+richiesta+codici+destinatario_Accreditamento+e+richiesta+codici+destinatario_v1.0.pdf/8333539f-f864-ac00-3ab0-74ce8a47db69

**SDICoop technical specs actually READ while building `sdicoop-client.ts`** (fetched 2026-09-01, via
`curl`/WebFetch — WebSearch budget was exhausted this session, direct URLs were fetched instead):
- https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/SdIRiceviFile_v1.0.wsdl
- https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneTypes_v1.0.xsd
- https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneTypes_v1.1.xsd
- https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v1.0/TrasmissioneFatture_v1.1.wsdl
- https://www.fatturapa.gov.it/export/documenti/ws/trasmissione/v3.x/Istruzioni-per-il-servizio-SDICoop-Trasmissione-versione3.3.pdf
- https://www.fatturapa.gov.it/export/documenti/ws/ricezione/v1.0/SdIRiceviNotifica_v1.0.wsdl,
  https://www.fatturapa.gov.it/export/documenti/ws/ricezione/v1.0/RicezioneFatture_v1.0.wsdl,
  https://www.fatturapa.gov.it/export/documenti/ws/ricezione/v1.0/RicezioneTypes_v1.0.xsd,
  https://www.fatturapa.gov.it/export/documenti/ws/ricezione/v3.x/Istruzioni-per-il-servizio-SDICoop-Ricezione-versione3.3.pdf
  (fetched too, for completeness — this is the RECEPTION direction, us-as-buyer, NOT built by this
  task; see `sdicoop-client.ts`'s own header)

---

## 5. ANAF e-Factura — Romania (national clearance)

> **GitHub secrets:** `ANAF_CLIENT_ID`, `ANAF_CLIENT_SECRET`, `ANAF_AUTH_TOKEN`, `ANAF_BASE_URL` &nbsp;•&nbsp; **Live flag:** `ANAF_LIVE=1` (`ANAF_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `ANAF_CLIENT_ID` / `ANAF_CLIENT_SECRET` — the OAuth2 "Client ID" / "Client Secret" pair generated when you enroll an application in the **"Editare profil Oauth"** screen inside SPV (Spațiul Privat Virtual), for the **E-Factura** service. Tied to the qualified certificate's serial number, not to a person.
- `ANAF_AUTH_TOKEN` — the JWT **access token** obtained from `https://logincert.anaf.ro/anaf-oauth2/v1/token` via an Authorization Code grant (browser prompts for the qualified certificate). Valid 90 days; refreshed with the accompanying refresh token (valid 365 days) against the same token endpoint.
- `ANAF_BASE_URL` — the e-Factura REST base host: `https://webserviceapl.anaf.ro/test/FCTEL/rest` (sandbox) or `https://webserviceapl.anaf.ro/prod/FCTEL/rest` (production).

**Prerequisites** (Romanian legal entity / CUI; qualified digital certificate; SPV enrollment)
- A Romanian legal entity with a CUI/CIF.
- A **qualified digital (electronic-signature) certificate** issued by an accredited Romanian trust provider — certSIGN, DigiSign, Trans Sped, CertDigital, etc. — issued to a natural person (legal representative, "reprezentant desemnat," or "împuternicit"). Cloud-based qualified certificates run roughly €29.9–€39/year (1‑year), up to ~€57/2 years or ~€81/3 years; a crypto token/eToken device adds ~€19.
- That certificate must be **enrolled in SPV for the company** with one of the roles: *reprezentant legal*, *reprezentant desemnat*, or *împuternicit* (SPV PJ). Enrollment is done at `https://www.anaf.ro/InregPersFizicePublic/#tabs-2` and typically needs: the certificate's ANAF confirmation document (digitally signed, obtained from the certificate issuer), a copy of the legal representative's ID, and supporting documents proving the representative/proxy quality.
- A separate **developer account** on the ANAF portal (not the same as an SPV taxpayer login, though credentials can be reused) used only to register OAuth applications.

**Step-by-step: registering the OAuth2 application + getting a token (test)**
1. Go to `https://anaf.ro` → **Servicii Online → Inregistrare utilizatori → DEZVOLTATORI APLICAȚII → Inregistrare pentru API-uri** (also reachable directly at `www.anaf.ro/InregOauth`).
2. Choose "no ANAF account yet" → fill the developer registration form (Nume, Prenume, Adresă de email, CNP, tip/serie/număr act identitate, telefon, Nume utilizator, Parolă) → accept terms → solve captcha → submit. ANAF emails a verification code; enter it to finish — this is a plain username/password developer account, distinct from the certificate.
3. Log back in at the same portal and click **"Autentificare utilizator"**, sign in with that username/password.
4. In the resulting menu pick **SPV → Editare profil Oauth**.
5. Fill the "Profil Oauth" form: **Denumire aplicație** (any name), **Callback URL 1** (your redirect URI — use `https://oauth.pstmn.io/v1/callback` if testing with Postman), **Serviciu** = **E-Factura** (the other option is E-Transport). Click **"Generare Client ID"**.
6. ANAF displays and stores the new **Client ID** / **Client Secret** for that app; clicking the row also shows the ready-made OAuth parameter block: Grant Type = Authorization Code, Callback URL, Auth URL (`https://logincert.anaf.ro/anaf-oauth2/v1/authorize`), Client ID, Client Secret.
7. Configure your OAuth client (or Postman) with: Grant Type = Authorization Code; Auth URL = `https://logincert.anaf.ro/anaf-oauth2/v1/authorize`; Access Token URL = `https://logincert.anaf.ro/anaf-oauth2/v1/token`; Client Authentication = **Send as Basic Auth header**; add a `token_content_type=jwt` parameter both on the auth request (query) and the token request (request body); leave Scope/State empty.
8. Trigger "Get New Access Token" — the browser opens `logincert.anaf.ro` and prompts **"Select a Certificate"**: pick the qualified certificate enrolled in SPV PJ. On success you receive a JWT **access_token** (`ANAF_AUTH_TOKEN`) and a refresh_token.
9. Verify the token with the test helper service: `https://api.anaf.ro/TestOauth/jaxrs/hello?name=<value>` (send `Authorization: Bearer <token>`).
10. Point `ANAF_BASE_URL` at the test host: `https://webserviceapl.anaf.ro/test/FCTEL/rest` (endpoints: `/upload`, `/stareMesaj`, `/listaMesajeFactura`, `/descarcare`).
11. To refresh without re-authenticating: `POST https://logincert.anaf.ro/anaf-oauth2/v1/token` with Basic Auth (client id/secret) and body `grant_type=refresh_token&refresh_token=<refresh_token>` (x-www-form-urlencoded) — returns a fresh access_token + refresh_token pair.

**Step-by-step: production**
1. Identical OAuth registration/token flow — ANAF does not separate "test" vs "prod" OAuth apps or certificates; the same Client ID/Secret and the same qualified certificate/SPV enrollment are used for both environments.
2. The only change is the **API host**: switch `ANAF_BASE_URL` from `https://webserviceapl.anaf.ro/test/FCTEL/rest` to `https://webserviceapl.anaf.ro/prod/FCTEL/rest`.
3. ANAF does **not allow same-day e-Factura submission** on the day SPV access is first approved — production upload only starts working the next calendar day.
4. Keep managing/rotating the OAuth app from **SPV → Editare profil Oauth → Gestionare aplicații** (also **Istoric** for an audit trail, and **Renunțare Oauth** to revoke everything and start over).

**Cost, lead time & blockers**
- Qualified certificate: ~€30–€80 depending on validity period/provider (certSIGN, DigiSign, Trans Sped), plus optional ~€19 token device; purchase + issuance is same-day to a few days.
- SPV enrollment approval: **1–3 business days** normally, up to **10 days** in peak filing periods (January, April, June).
- e-Factura usable starting the **day after** SPV access is granted — not immediately.
- Hard blocker for CI/automation: the OAuth **authorize** step is interactive — it requires a browser + physical/cloud certificate selection dialog (`logincert.anaf.ro` "Select a Certificate" prompt) tied to a human's qualified certificate. There is no headless/service-account path; only the resulting refresh token (365-day validity) can be stored and silently renewed thereafter via the token endpoint.
- Rate limit: 1000 requests/minute per app (HTTP 429 beyond that); access tokens last 90 days, refresh tokens last 365 days.

**Official sources**
- https://static.anaf.ro/static/10/Anaf/Informatii_R/API/Oauth_procedura_inregistrare_aplicatii_portal_ANAF.pdf (official OAuth registration + token procedure, endpoints, validity periods, rate limits)
- https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/url_eFactura.html (e-Factura upload/stareMesaj/listaMesajeFactura/descarcare test & prod URLs)
- https://www.anaf.ro/anaf/internet/ANAF/servicii_online/inreg_inrol_pf_pj_spv (SPV enrollment entry point for legal entities)
- https://static.anaf.ro/static/10/Anaf/Informatii_R/SPV/InregistrarePJ_15092020.pdf (legal-entity SPV registration instructions, referenced from the SPV page)
- https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice (referenced inside the official OAuth PDF as the e-Factura technical-details landing page)

---

## 6. Peppol — cross-border (Access Point network)

> **GitHub secrets (generic AP):** `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` &nbsp;•&nbsp; **Live flag:** `PEPPOL_LIVE=1` (`PEPPOL_ENV=TEST`) &nbsp;•&nbsp; **Sandbox:** yes (peppol.sh, zero-secret) &nbsp;•&nbsp; **Repo status:** ✅ peppol.sh proven (no secret) / 🔴 generic AP missing

**What each secret is / where it comes from**

- `PEPPOL_PARTICIPANT_ID` — your own Peppol address, format `scheme:id` (e.g. `0208:0123456789` BE enterprise number, `9925:BE0441797980` BE VAT, `0088:xxxxxxxxxxxxx` GS1 GLN, `0002:xxxxxxxxx` FR SIRENE, `9930:DExxxxxxxxx` DE VAT). You don't invent this — your Access Point assigns/registers it for you against your business/VAT number when you onboard.
- `PEPPOL_AP_URL` — the base REST/API URL of the generic Access Point gateway you've contracted with (repo's generic adapter model: `accessPointUrl` + `apiKey`, REST gateway in front of the AP's AS4/ebMS3 stack).
- `PEPPOL_API_KEY` — the API key that AP issues once you have an account with them.
- `PEPPOL_RECEIVER_ID` — the counterpart's Peppol participant ID (`scheme:id`) for the specific test transaction (in production this is looked up per-invoice via SMP/directory, not a fixed secret — it's fixed here only for the live-gated test fixture).
- peppol.sh path needs **no GitHub secret**: `PEPPOL_SH_API_KEY` (`ps_test_…` / `ps_live_…`) and `PEPPOL_SH_COMPANY_ID` (`com_…`) are optional overrides — when absent, `peppol-sh-live.spec.ts` self-signs-up against the public sandbox and creates its own throwaway company, proving the round-trip with zero pre-provisioned credentials.

**Route A — peppol.sh sandbox (zero cost, what the project uses)**
1. No dashboard, no credit card: `POST https://api.peppol.sh/v1/signup` with `{email}` returns `201 {id, api_key}` instantly — the key is prefixed `ps_test_` (sandbox).
2. `POST {sandbox.peppol.sh}/v1/companies` with `{name, tax_id, country, address}` (auth: `Authorization: Bearer <api_key>`) → `201 {id: com_…}` — this `com_…` is `PEPPOL_SH_COMPANY_ID`.
3. Sandbox calls must hit `sandbox.peppol.sh` (not `api.peppol.sh` — sandbox keys get `403 wrong_environment` there); invoices are delivered by email instead of the real network, same code path (`ublToPeppolShDocument` → `POST /v1/documents` → poll `GET /v1/documents/:id`).
4. To go live: `POST /v1/account/kyc` with company/identity details; once approved you can mint a `ps_live_` key, and `api.peppol.sh` then routes onto the real Peppol network.
5. Pricing (peppol.sh site): pay-per-document, from €0.10/invoice, no monthly minimum; sandbox is free forever.
6. Repo proof: `backend/src/compliance/providers/transmission/peppol/peppol-sh-live.spec.ts`, gated by `PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh`, self-signs-up when `PEPPOL_SH_API_KEY`/`PEPPOL_SH_COMPANY_ID` are absent — proven live 2026-07-11 (real `doc_…` id, polled to CLEARED). Wired in `.github/workflows/compliance-live.yml` with `PEPPOL_AP_PROVIDER: 'peppol-sh'` set as a plain env constant, not a secret.

**Route B — connecting through a real/commercial Access Point (e.g. Storecove, or a certified AP)**
1. Sign up for an account with the AP (e.g. Storecove: dashboard signup, dev accounts often start in sandbox mode automatically).
2. Generate an API key in the AP's dashboard (Storecove: "API Keys" section) — this becomes `PEPPOL_API_KEY` (generic) or the vendor-specific key the adapter expects.
3. Register your **legal entity**: submit company name, address, country, and a public identifier (VAT / Chamber-of-Commerce number) for validation (Storecove: "Senders" section; approval typically ≤1 day).
4. Create a **Peppol identifier** (participant ID) tied to that legal entity — this is `PEPPOL_PARTICIPANT_ID`. The AP does the SMP registration on your behalf; you never register directly with Peppol/OpenPeppol.
5. Submit invoices via the AP's REST API (Storecove: raw UBL upload; peppol.sh: JSON auto-converted to UBL BIS 3.0). The repo's generic adapter models this as `accessPointUrl` + `apiKey`, with a local SMP/SML DNS pre-check (`DnsSmpLookup`) to confirm the receiver is registered before send — hosted vendors (peppol.sh, Storecove) instead resolve routing themselves at corner 2, so the repo skips the local SMP pre-check for them (`apProviderHandlesRouting`).
6. `PEPPOL_RECEIVER_ID` is the counterpart's participant ID — normally resolved per-invoice (buyer directory / SMP lookup), fixed only as a static secret for the live-gated CI test.

**Prerequisites** (do you need to BE a certified AP, or just a sender through one? SMP registration)

- **Almost every business only needs to be a Peppol *participant*, sending through an AP — not become an AP itself.** Registration/SMP is done *for* you by whichever AP you sign up with; you cannot register directly with the Peppol network yourself.
- Becoming a certified Access Point / Service Provider yourself (self-hosting corner 2/3) requires: OpenPeppol membership, an ISO 27001 certificate, meeting the Peppol Authority Specific Requirements (PASR), a due-diligence review (solvency, legitimacy, background checks on senior staff), and three stages of technical testing (unit → OpenPeppol testbed → interoperability) before OpenPeppol issues certification. This is the path Storecove/peppol.sh already went through so you don't have to.
- The repo's multi-vendor abstraction (`ap-adapters.ts`, `PEPPOL_AP_PROVIDERS = ['generic', 'peppol-sh', 'storecove']`) exists precisely so the project is always a sender-through-an-AP, never a certified AP itself.

**Cost, lead time & blockers**

- peppol.sh sandbox: €0, instant, no approval — already proven. Going live needs a KYC submission (identity/company verification) before a `ps_live_` key is issued; no fixed lead time published.
- Storecove / commercial AP as a sender: no OpenPeppol certification needed, no implementation fee typically; legal-entity validation ~1 business day; ongoing cost is per-document (vendor-specific pricing).
- Becoming your own certified Access Point (not needed for this project): OpenPeppol sign-up fees €1,025–€5,000 + annual €1,800–€9,100 depending on org size and AP-only vs AP+SMP scope (2025 fee schedule), plus months of certification testing — explicitly the path the project is avoiding.
- **Blocker for Route B here:** no generic-AP or Storecove account/credentials exist yet — `PEPPOL_PARTICIPANT_ID` / `PEPPOL_AP_URL` / `PEPPOL_API_KEY` / `PEPPOL_RECEIVER_ID` are all unset; someone must pick a commercial AP (or request a Storecove trial) and complete legal-entity + Peppol-ID registration to unblock live testing of the generic/Storecove adapters.

**Official sources**
- https://peppol.sh/
- https://peppol.sh/for/nextjs
- https://www.storecove.com/blog/en/how-to-become-a-peppol-access-point/
- https://docs.peppol.eu/edelivery/codelists/old/v8.5/Peppol%20Code%20Lists%20-%20Participant%20identifier%20schemes%20v8.5.html
- https://peppol.org/join/fees-2025/

---

## 7. AFIP / ARCA — Argentina (WSFE electronic invoicing)

> **GitHub secrets:** `AFIP_CERTIFICATE`, `AFIP_CERT_PASSWORD`, `AFIP_TAXPAYER_ID` (CUIT), `AFIP_BASE_URL` &nbsp;•&nbsp; **Live flag:** `AFIP_LIVE=1` (`AFIP_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (homologación) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `AFIP_CERTIFICATE` — the X.509 digital certificate (public cert, typically packaged as PFX/PKCS12 with its private key, base64-encoded for storage) issued by ARCA's Certification Authority in exchange for a CSR you generate locally. Homologación (test) certs come from **WSASS**; producción certs come from **Administración de Certificados Digitales**.
- `AFIP_CERT_PASSWORD` — passphrase protecting the private key / PFX bundle you created when generating the CSR (not issued by ARCA — you choose it locally).
- `AFIP_TAXPAYER_ID` — the CUIT (Clave Única de Identificación Tributaria) of the taxpayer on whose behalf invoices are issued. This is the "persona to represent" selected in WSASS/Administrador de Relaciones when authorizing the web service.
- `AFIP_BASE_URL` — WSAA + WSFEv1 SOAP endpoint base, different per environment (see endpoints below).

**Prerequisites**
- An active Argentine **CUIT** (company or self-employed taxpayer).
- A **Clave Fiscal** (ARCA's fiscal password/2FA login) belonging to a **natural person** (not the legal entity itself) who will act as the one adhering to WSASS / managing certificates — AFIP/ARCA web-service self-management explicitly requires logging in with a *persona física*'s own Clave Fiscal, not a corporate account.
- OpenSSL (or equivalent) to generate an RSA key pair + CSR locally — ARCA never sees or generates your private key.

**Step-by-step: getting homologación (test) certificate + associating WSFE**
1. Log in at the WSASS access portal (`https://auth.afip.gob.ar/contribuyente_/login.xhtml`) with the individual's own Clave Fiscal — WSASS ("Autoservicio de Acceso a APIs de Homologación") is the self-service app that issues **testing-only** certificates and is reached by adhering to it via the Administrador de Relaciones (per the `certificados.asp` page).
2. Generate a local key pair + CSR (e.g. `openssl req -new -newkey rsa:2048 -nodes -keyout private.key -out request.csr`), embedding a DN that includes your CUIT and a chosen alias.
3. In WSASS: use **"Nuevo Certificado"** (first certificate for a DN) or **"Agregar Certificado a Alias"** (additional certs), upload the CSR, and download the ARCA-signed X.509 test certificate.
4. In WSASS: use **"Crear Autorización a Servicio"** — pick the CUIT to represent and select **WSFEv1** ("Factura Electrónica") from the service catalog to authorize that certificate/alias to call the service in the testing environment.
5. Call WSAA homologación (`https://wsaahomo.afip.gov.ar/ws/services/LoginCms`) with the cert + private key, signed via a CMS `LoginTicketRequest`, to obtain the TA (Ticket de Acceso: `token` + `sign`, ~12h validity).
6. Use the TA against the WSFEv1 homologación SOAP endpoint, confirmed live at `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` (operations include `FEDummy` for health-check, `FECAESolicitar` to request test CAE-authorized invoices, `FEParamGetTiposCbte`, etc.).

**Step-by-step: production**
1. Generate a **separate** key pair + CSR for production (do not reuse the homologación key).
2. Log in to the ARCA portal with the taxpayer's (or its Administrador de Relaciones apoderado's) Clave Fiscal and open **"Administración de Certificados Digitales"** to upload the CSR and download the signed production X.509 certificate.
3. Open **"Administrador de Relaciones de Clave Fiscal"** → adhere/create a new relationship → select the CUIT → search the service under **ARCA → WebServices → Facturación Electrónica** → delegate/authorize the certificate's representative to that CUIT for WSFEv1. This is the step that actually "turns on" WSFE for that taxpayer in production (distinct from just holding a valid certificate).
4. Authenticate against production WSAA (`https://wsaa.afip.gov.ar/ws/services/LoginCms`) with the production cert + key to obtain a production TA.
5. Call the production WSFEv1 SOAP endpoint, confirmed live at `https://servicios1.afip.gov.ar/wsfev1/service.asmx`.

**Cost, lead time & blockers**
- No monetary cost: certificate issuance (both environments) and WSFE web-service access are free, self-service, government functions.
- Homologación certificate + service authorization is instant/same-session via WSASS.
- Production: certificate issuance is immediate via Administración de Certificados Digitales, but the Administrador de Relaciones delegation/authorization step can take time to propagate before the service is usable.
- Hardest blocker: this cannot be done by a bot/service account — it requires a real person's personal Clave Fiscal (Nivel 2+) to log in, generate/upload a CSR, and manually click through WSASS and Administrador de Relaciones; there is no pure API/programmatic onboarding path. A foreign entity with no Argentine CUIT/Clave Fiscal holder cannot obtain these credentials at all without a local taxpayer registration or a local apoderado.

**Official sources**
- https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp
- https://www.afip.gob.ar/ws/documentacion/certificados.asp
- https://www.afip.gob.ar/ws/WSASS/html/conceptos.html
- https://www.afip.gob.ar/ws/WSASS/WSASS_como_adherirse.pdf
- https://www.afip.gob.ar/fe/documentos/AccionesarealizarparaconsumirunWebservicedeFacturaElectr.pdf
- https://www.afip.gob.ar/ws/wsaa/wsaa.obtenercertificado.pdf
- https://www.afip.gob.ar/fe/ayuda/webservice.asp
- https://www.afip.gob.ar/ws/documentacion/catalogo.asp
- https://www.afip.gob.ar/clavefiscal/ayuda/administrador-de-relaciones.asp
- https://wswhomo.afip.gov.ar/wsfev1/service.asmx (homologación WSFEv1 endpoint, confirmed live)
- https://servicios1.afip.gov.ar/wsfev1/service.asmx (producción WSFEv1 endpoint, confirmed live)

---

## 8. SEFAZ / NF-e — Brazil (Nota Fiscal Eletrônica)

> **GitHub secrets:** `SEFAZ_CERTIFICATE`, `SEFAZ_CERT_PASSWORD`, `SEFAZ_TAXPAYER_ID` (CNPJ), `SEFAZ_BASE_URL` &nbsp;•&nbsp; **Live flag:** `SEFAZ_LIVE=1` (`SEFAZ_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (homologação) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `SEFAZ_CERTIFICATE` — base64 of the company's **A1 digital certificate** (`.pfx`/`.p12` bundle: private key + cert chain), used for both mTLS client auth and XML signing on every state SEFAZ web service call. Issued by an **ICP-Brasil**-accredited Autoridade Certificadora (AC) as an **e-CNPJ A1** certificate bound to the company's CNPJ.
- `SEFAZ_CERT_PASSWORD` — the PFX export password set when the AC issues/downloads the certificate.
- `SEFAZ_TAXPAYER_ID` — the company's CNPJ (14 digits), which must be actively registered and have an **Inscrição Estadual (IE)** in the state(s) of operation before SEFAZ will accept traffic signed by its certificate.
- `SEFAZ_BASE_URL` — the state SEFAZ (or SVAN/SVC) SOAP web-service host for the chosen environment (homologação or produção); this is **per-state**, not a single national endpoint (e.g. Paraná homologação is `https://homologacao.nfe.sefa.pr.gov.br/nfe/...`, produção is `https://nfe.sefa.pr.gov.br/nfe/...`).

**Prerequisites** (CNPJ, ICP-Brasil A1 certificate purchase from an AC, state inscrição estadual, credenciamento at the state SEFAZ)
- Active CNPJ (Receita Federal) and a habilitated **Inscrição Estadual** with the SEFAZ of the state where the company is established (and of any other state it wants to authorize NF-e in).
- An **e-CNPJ A1** certificate purchased from an ICP-Brasil-accredited AC (Serasa, Certisign, Valid, AC-BR, AC PRODEMGE, etc. — full accredited-AC hierarchy is published by ITI). A1 is file-based (1-year validity, ideal for unattended/batch ERP signing); A3 is token/smartcard-based (1–3 years, needs a human present) and is not what a server-side automated flow like Invoicerr needs.
- Company must be "regularizada" with Receita Federal and the state Fazenda before credenciamento is accepted.

**Step-by-step: buying an A1 certificate + credenciamento + homologação**
1. Choose an ICP-Brasil-accredited Autoridade Certificadora (see ITI's official AC hierarchy/list) and buy an **e-CNPJ A1** certificate for the company's CNPJ. Validation typically requires the legal representative's ID + a video/in-person or remote validation step defined by the AC, and is a **paid, per-year** purchase (renews annually).
2. Download the issued certificate as a `.pfx`/`.p12` file and record the export password — this becomes `SEFAZ_CERTIFICATE` (base64) / `SEFAZ_CERT_PASSWORD`.
3. Confirm/obtain the **Inscrição Estadual** for the CNPJ with the relevant state SEFAZ (each state runs its own registration site, e.g. Goiás's `nfeweb.sefaz.go.gov.br/nfeweb/sites/credenciamento/principal`, Ceará's `nfe.sefaz.ce.gov.br`).
4. Go to that state's NF-e **credenciamento** portal and authenticate with the A1 certificate (loaded into the browser) to register/confirm the company as an NF-e issuer and select the certificate/AC on file with the state.
5. Point the integration at the state's **homologação** (test) web-service host and issue test NF-e documents there first — homologação is technically identical to produção but documents have **no legal validity**; every state publishes its own homologação/produção SOAP endpoints (WSDL) for Autorização, Consulta, Inutilização, StatusServiço, Recepção de Evento, etc.
6. Determine which authorizer actually services the state: most states run their own SEFAZ web services, but some route through shared national infrastructure — **SVAN** (currently Maranhão's primary authorizer) or **SVRS** (primary authorizer for several states: AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR, SC, SE, TO) — and **SVC-AN**/**SVC-RS** serve as *contingency* authorizers when a state's own SEFAZ is down. `SEFAZ_BASE_URL` must match whichever authorizer is correct for the taxpayer's state and environment.
7. Validate the full round trip in homologação (signed XML → mTLS call with the A1 cert → NFeAutorizacao → protocolo returned) before touching produção.

**Step-by-step: production**
1. Re-point `SEFAZ_BASE_URL` to the same authorizer's **produção** host (e.g. Paraná: `https://nfe.sefa.pr.gov.br/nfe/...` vs. homologação's `homologacao.nfe.sefa.pr.gov.br`).
2. Set `SEFAZ_ENVIRONMENT` away from `SANDBOX` (`tpAmb=1`) once homologação round-trips are clean.
3. Documents issued here have full legal/fiscal validity — no more test CNPJ/IE fixtures; use the real CNPJ, real IE, and the same A1 certificate.
4. Monitor the certificate's 1-year expiry and renew before it lapses — an expired A1 cert hard-fails every mTLS call to every state authorizer.

**Cost, lead time & blockers** (A1 cert is PAID, per-state credenciamento)
- The A1 certificate is a **paid annual purchase** from a private ICP-Brasil AC (market pricing runs roughly R$150–300+/year for A1; A3 tokens cost more and last longer but don't fit unattended server signing).
- Lead time is mostly AC-side identity validation (can be same-day to a few business days depending on AC and validation method) plus the state's own credenciamento turnaround.
- **Per-state variation is the main integration risk**: each of Brazil's 27 states runs its own SEFAZ system with its own credenciamento portal, its own homologação/produção WSDL hosts, and its own choice of shared authorizer (own infra vs. SVAN vs. SVRS) plus contingency fallback (SVC-AN/SVC-RS) — there is no single national base URL; `SEFAZ_BASE_URL` must be resolved per taxpayer state.
- Blockers for automated setup: A1 issuance requires a human identity-validation step at the AC (not scriptable), and credenciamento requires the certificate to already exist and be loaded into a browser session against the state portal — so this cannot be fully unattended end-to-end.

**Official sources**
- https://sped.fazenda.pr.gov.br/NFe/Pagina/Enderecos-dos-ambientes-de-homologacao-e-producao-Versao-400 — Paraná SEFAZ: homologação vs. produção WSDL endpoints (per-state pattern)
- https://nfeweb.sefaz.go.gov.br/nfeweb/sites/credenciamento/principal — Goiás SEFAZ: NF-e credenciamento portal, confirms credenciamento requires an ICP-Brasil-issued digital certificate
- https://www.gov.br/iti/pt-br/assuntos/icp-brasil/autoridades-certificadoras — ITI (ICP-Brasil root authority): accredited Certification Authorities hierarchy
- https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo%3D — Portal Nacional da NF-e: web services listing by state/authorizer (SVAN/SVRS/SVC-AN)
- https://hom.nfe.fazenda.gov.br/ — Portal Nacional da NF-e, homologação environment root

---

## 9. SII — Chile (DTE facturación electrónica)

> **GitHub secrets:** `SII_CERTIFICATE`, `SII_CERT_PASSWORD`, `SII_CLIENT_ID`, `SII_CLIENT_SECRET`, `SII_BASE_URL` &nbsp;•&nbsp; **Live flag:** `SII_LIVE=1` (`SII_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (maullin/certificación) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

- `SII_CERTIFICATE` — base64 of a PKCS#12/PFX bundle: the taxpayer's **certificado digital** (private key + X.509 cert) bought from an SII-accredited certificate authority (Acepta, E-CertChile, FirmaYa, Facto, ecertla, firma.digital…). This is the real credential: SII auth is "sign a random seed with this cert," not an API key.
- `SII_CERT_PASSWORD` — password protecting that PFX.
- `SII_BASE_URL` — the DTE web-service host: `https://maullin.sii.cl` (certification) or `https://palena.sii.cl` (production).
- `SII_CLIENT_ID` / `SII_CLIENT_SECRET` — **no official SII equivalent.** SII's DTE web services (`CrSeed.jws` / `GetTokenFromSeed.jws`) authenticate purely via certificado digital + semilla/token (XML-DSig signature over a seed value); there is no OAuth client_id/client_secret in the official API (confirmed in the SII developer manual "Autenticación Automática OI2007_AUTAUTOM_MDE_1.9"). These two fields look like leftovers from a generic multi-country secret schema. They'd only apply if invoicerr goes through a third-party PAC/facturación-electrónica intermediary (e.g. a commercial API wrapper) that issues its own REST API keys — that would be a different, non-SII-official integration path.

**Prerequisites** (RUT, certificado digital from an authorized provider, enrollment as emisor)

- RUT with "inicio de actividades" active, First Category taxpayer (Art. 20 Ley de Impuesto a la Renta), registered as IVA contributor if issuing VAT documents, legal representative/authorized signers with no pending SII legal/tax matters (checkable under "Mi Situación Tributaria").
- A certificado digital purchased from an SII-accredited provider — SII itself does not issue or sell certificates, only publishes/accredits the list of providers.
- Two separate SII enrollment tracks exist: (1) **Sistema de Facturación Gratuito del SII** — SII's own free web portal, no certification process required, but no programmatic API, so it's unusable for an automated system like invoicerr; (2) **Facturación de Mercado** (own/vendor software) — requires the full certification process below and is the only path that gives programmatic DTE submission.
- The postulación (application) to the Mercado track must be submitted by the legal representative, authenticated with their own certificado digital — it is inherently per-taxpayer, not something invoicerr can pre-provision generically.

**Step-by-step: certification (set de pruebas) in maullin**
1. Verify prerequisites above (inicio de actividades, primera categoría, IVA, no pending SII issues).
2. Legal representative authenticates on sii.cl with a certificado digital and submits the postulación (RUT, admin/contact emails, software name, document types to issue) under Factura Electrónica → Factura de Mercado.
3. Once accepted, get access to the maullin certification/test environment, which lets the applicant "efectuar, en modalidad de prueba, todas las operaciones de un contribuyente autorizado."
4. Complete the certification stages, in order:
   a. **Set de pruebas** (the key gate) — SII assigns a fixed batch of test-case data; the applicant must generate one DTE per case and submit it to SII, which must receive the shipment "sin rechazos ni objeciones" (zero rejections/objections) before moving on.
   b. Set de Simulación — simulated document exchange.
   c. Set de intercambio de información — information-exchange/acknowledgement testing.
   d. Envío de muestras de impresión — submit the printed/PDF representation of DTEs for approval.
   e. Declaración de cumplimiento de requisitos — applicant formally declares its system meets SII's technical/procedural requirements.
   f. Registro como emisor electrónico — SII registers the taxpayer as an authorized electronic issuer.
5. Programmatic auth against maullin during certification: call `https://maullin.sii.cl/DTEWS/CrSeed.jws?WSDL` (`getSeed`) to obtain a semilla (random seed, 2‑minute validity); sign the `<Semilla>` value with the certificado digital using XML-DSig (RSA‑SHA1, enveloped signature, canonicalized per the SII schema); POST the signed XML to `https://maullin.sii.cl/DTEWS/GetTokenFromSeed.jws?WSDL` (`getToken`) to receive a `TOKEN` used to call the rest of the DTE web services.
6. SII purges certification-environment accounts with no registered activity in 6 months — testing must stay active or the applicant must reapply.

**Step-by-step: production (palena)**
1. Once SII completes step 4f (Registro como emisor electrónico), the same certificado digital and procedure work against production — only the hostname changes.
2. Obtain semilla: `https://palena.sii.cl/DTEWS/CrSeed.jws?WSDL`.
3. Sign it the same way (XML-DSig, RSA‑SHA1) and POST to `https://palena.sii.cl/DTEWS/GetTokenFromSeed.jws?WSDL` to get a production Token.
4. Use the Token to submit real DTEs; the seed expires after 2 minutes and the token itself is short‑lived, so the seed→sign→token flow must be repeated per session.
5. Keep the certificado digital current — it expires (validity sold in 6‑month to 3‑year increments) and must be renewed/repurchased from the accredited provider; an expired cert breaks authentication with no other recourse.

**Cost, lead time & blockers**

- Certificado digital is a paid, recurring cost from a private accredited provider, not from SII — market listings found range roughly CLP $4,000–$10,000+ (+IVA) depending on validity period and vendor (Facto, FirmaYa, Acepta, E-CertChile, ecertla, firma.digital).
- SII charges no fee for postulación/certification itself, but there is no published fixed turnaround — the process is manual/iterative (SII reviews each stage's submissions) and multi-stage, so it realistically takes real engineering + review time, not a same-day activation.
- Biggest structural blocker for invoicerr: this cannot be pre-provisioned as a generic sandbox credential set. Enrollment is tied to one specific RUT, requires that taxpayer's own legal representative to authenticate with their own certificate, and certification (the set de pruebas) must be completed per-taxpayer/per-software before any production Token will work. There's no test tenant SII hands out to third-party app vendors in the abstract.
- `SII_CLIENT_ID`/`SII_CLIENT_SECRET` should be treated as not applicable to a direct SII integration unless a third-party PAC/intermediary API is used instead — flag this to whoever owns the schema.

**Official sources**
- https://www.sii.cl/factura_electronica/factura_mercado/proc_postulacion.htm
- https://www.sii.cl/factura_electronica/factura_mercado/proceso_certificacion.htm
- https://www.sii.cl/factura_electronica/factura_mercado/requisitos.htm
- https://www.sii.cl/factura_electronica/certificado_digital.htm
- https://www.sii.cl/factura_electronica/factura_mercado/autenticacion.pdf (Manual de Desarrollador — Autenticación Automática OI2007_AUTAUTOM_MDE_1.9; source of the CrSeed/GetTokenFromSeed WSDL URLs on both palena and maullin)
- https://maullin.sii.cl/cvc/dte/pe_condiciones.html
- https://www.sii.cl/destacados/factura_electronica/guias_ayuda/guia_inscripcion_fe.pdf (Inscripción en el Sistema de Facturación Gratuito del SII)

---

## 10. SRI — Ecuador (comprobantes electrónicos)

> **GitHub secrets:** `SRI_CERTIFICATE`, `SRI_CERT_PASSWORD`, `SRI_BASE_URL` &nbsp;•&nbsp; **Live flag:** `SRI_LIVE=1` (`SRI_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (ambiente de pruebas) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

- `SRI_CERTIFICATE` — the **firma electrónica**: a base64-encoded PFX/P12 file (X.509 cert + private key) issued by an ARCOTEL-accredited certification entity. The invoicing engine uses it to XAdES-sign the XML comprobante before submission.
- `SRI_CERT_PASSWORD` — the password protecting that P12 container, set when the certificate was issued/downloaded.
- `SRI_BASE_URL` — the SOAP web-service base for the target environment. Ambiente de pruebas (test): `https://celcer.sri.gob.ec/comprobantes-electronicos-ws/`; ambiente de producción: `https://cel.sri.gob.ec/comprobantes-electronicos-ws/`. Both expose `RecepcionComprobantesOffline` (submit the signed XML, get back a `RECIBIDA`/`DEVUELTA` + clave de acceso) and `AutorizacionComprobantesOffline` (poll by clave de acceso for `AUTORIZADO`/`NO AUTORIZADO`) — confirmed live by fetching their WSDLs directly.

**Prerequisites** (RUC, firma electrónica from an authorized provider, activation of facturación electrónica in SRI en línea)

- Active RUC (Registro Único de Contribuyentes) for the company.
- A firma electrónica from one of Ecuador's ARCOTEL-accredited certification entities — the SRI facturación-electrónica page lists 11, in practice the two most used are:
  - **Banco Central del Ecuador (BCE/ECI)** — cheapest, file or token format.
  - **Security Data** — cloud-based file or token, fully online issuance.
  - (Also valid: ANF AC, Uanataca, Consejo de la Judicatura, and others on the ARCOTEL list.)
- Credentials for **SRI en línea** (`https://srienlinea.sri.gob.ec/sri-en-linea/inicio/NAT`) — RUC + online password.
- Explicit authorization request in the test environment (trámite "Autorización en ambientes de pruebas de comprobantes electrónicos") before any invoice can be submitted, even in sandbox.

**Step-by-step: getting the firma electrónica + testing in ambiente de pruebas**
1. Confirm the company's RUC is active in SRI en línea.
2. Buy the firma electrónica: e.g. via BCE/ECI (`https://www.bce.fin.ec/servicios-y-tramites/...emision-y-renovacion-de-certificados-digitales-de-firma-electronica/`) — file format online in ~30 min (with in-person ID pickup for token), or Security Data (`https://www.securitydata.net.ec/firma-electronica-en-ecuador/`) — cloud file, fully online with color ID/RUC scan. You receive a `.p12`/PFX file and set its password.
3. Log in to SRI en línea, go to Facturación Electrónica → Ambiente de pruebas → Autorización, and submit the request with RUC + password (no fee; per the "Autorización en ambientes de pruebas" trámite).
4. Base64-encode the `.p12` into `SRI_CERTIFICATE`, set `SRI_CERT_PASSWORD`, and set `SRI_BASE_URL=https://celcer.sri.gob.ec/comprobantes-electronicos-ws/`.
5. Sign a sample XML comprobante (XAdES-BES) with the certificate, POST it to `RecepcionComprobantesOffline`, then poll `AutorizacionComprobantesOffline` with the returned clave de acceso until status `AUTORIZADO`.
6. Iterate until schema/signature errors are gone and `SRI_ENVIRONMENT=SANDBOX`/`SRI_LIVE=1` round-trips cleanly against the test host.

**Step-by-step: production**
1. In SRI en línea, request the equivalent production authorization (same Facturación Electrónica menu, "ambiente de producción" instead of pruebas).
2. Make sure the firma electrónica is not expired/revoked (BCE certs run 1–2 years, Security Data 1 week–5 years) — production rejects invoices signed with an invalid cert.
3. Point `SRI_BASE_URL` to `https://cel.sri.gob.ec/comprobantes-electronicos-ws/` and flip the environment flag off sandbox.
4. Send a real invoice and confirm the returned comprobante shows `AUTORIZADO` and is visible via the public validator (`https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet/publico/validezComprobantes.jsf`).
5. Track the certificate's expiry date and renew before it lapses — an expired cert silently breaks production signing.

**Cost, lead time & blockers** (the firma electrónica is a paid purchase)

- Cost: BCE file certificate ≈ $18.80 (1 yr) or $27+$22 token (2 yr, all +IVA); Security Data cloud file from $24.15/yr up to $74.41 for 5 yr, token+file ≈ $37.95/yr.
- Lead time: BCE file format ≈ 30 min fully online; BCE token/in-person pickup needs a Civil Registry/BCE-office appointment (~3 business days processing, Mon–Fri 8:00–15:30); Security Data can complete verification online/WhatsApp, generally same day to a couple of days.
- Blockers: RUC must exist and be active before requesting either the certificate or the test-environment authorization; legal-entity certs need the legal representative's appointment/constitution documents; the free "Facturador SRI" tool cannot be used by taxpayers classified as "grandes contribuyentes" (they must integrate directly against the web services, which is what these secrets are for); production authorization cannot be requested until the test environment has been authorized and exercised; certificate expiry (1–5 yr depending on provider) requires a recurring renewal/rotation of `SRI_CERTIFICATE`.

**Official sources**
- https://www.sri.gob.ec/en/facturacion-electronica
- https://www.gob.ec/sri/tramites/autorizacion-ambientes-pruebas-comprobantes-electronicos
- https://www.sri.gob.ec/en/facturador-sri
- https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
- https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl
- https://srienlinea.sri.gob.ec/comprobantes-electronicos-internet/publico/validezComprobantes.jsf
- https://www.securitydata.net.ec/firma-electronica-en-ecuador/
- https://www.bce.fin.ec/servicios-y-tramites/administracion-de-certificados-de-firma-electronica-y-servicios-relacionado/emision-y-renovacion-de-certificados-digitales-de-firma-electronica/

---

## 11. DGI — Uruguay (CFE facturación electrónica)

> **GitHub secrets:** `UY_DGI_CERTIFICATE`, `UY_DGI_CERT_PASSWORD`, `UY_DGI_CLIENT_ID`, `UY_DGI_CLIENT_SECRET`, `UY_DGI_BASE_URL` &nbsp;•&nbsp; **Live flag:** `UY_DGI_LIVE=1` (`UY_DGI_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (homologación) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

- `UY_DGI_CERTIFICATE` (base64 PFX) — the "Certificado Electrónico Reconocido" (firma electrónica avanzada) issued by an **accredited PSC** (Prestador de Servicios de Certificación): **Abitab (ID-Digital)**, **Antel**, or **Administración Nacional de Correos (ANC)**. It is what signs every CFE XML — direct equivalent exists.
- `UY_DGI_CERT_PASSWORD` — the PFX/private-key password set when the certificate is issued/exported by the PSC. Direct equivalent exists.
- `UY_DGI_CLIENT_ID` / `UY_DGI_CLIENT_SECRET` — **no direct DGI equivalent.** DGI's eFactura system has no OAuth2 client-credentials concept. Access is governed by two independent things: (1) a portal user/password ("Clave") per role — Testing / Homologación / Homologación simplificada / Producción — requested via "Solicitud de Creación de Usuario para eFactura" in DGI's Servicios en Línea, tied to a RUC + C.I.; and (2) the XML digital signature from the PFX certificate, which is what actually authenticates the sender to the web service (WS-Security style). If these fields must be populated, the closest mapping is RUC+CI → `CLIENT_ID` and the portal Clave → `CLIENT_SECRET`, but this is an approximation, not a real client-credentials flow — flag this in any implementation.
- `UY_DGI_BASE_URL` — the SOAP web-service base. Confirmed live: homologación/certificación at `https://efactura.dgi.gub.uy:6443/efactura/ws_certificacion?wsdl`; producción at `https://efactura.dgi.gub.uy/efactura/ws_efactura?wsdl`. DGI also accepts an alternate "Upload" channel (manual/portal file upload) instead of Web Service.

**Prerequisites**

- RUT (Registro Único Tributario) data up to date — must be corrected in RUT before postulación if any registral field is wrong.
- A valid digital certificate ("Certificado electrónico reconocido") from Abitab (ID-Digital), Antel, or Correo (ANC) — acquired **before** starting Postulación; this is external to DGI and is the long pole (company certs require a notarized legal-representative request form at the PSC).
- Software to build/sign/send CFEs: either in-house development or third-party software (local or foreign provider). For the simplified path, the software must come from a vendor listed in DGI's "Registro de Proveedores Habilitados."
- A DGI portal Clave (with or without contract) to request eFactura roles via Servicios en Línea.
- Contact e-mail(s) for DGI↔emisor and emisor↔emisor communications (declared during postulación, consent to notification by e-mail).

**Step-by-step: postulación + homologación with DGI**

There are two entry modes: **Ingreso tradicional** (own path, mandatory Testing) and **Ingreso simplificado** (via a DGI-registered software provider, Testing optional).

1. Obtain the digital certificate from Abitab/Antel/Correo.
2. Request a **Testing** role Clave: DGI Servicios en Línea → Otros Servicios → eFactura-Solicitud de Usuario (form "Solicitud de Creación de Usuario para eFactura", specifying C.I., e-mail, and role).
3. In the Testing environment (Portal eFactura), send free-form envelopes ("sobres") of CFEs and Daily Reports to validate XML format and signature.
4. Pass the mandatory **Prueba de Testing** (traditional path only): ≥50 accepted ("Recibido") documents for each CFE type in the minimum combo — e-Factura, e-Ticket, and their Notas de Crédito/Débito — all with the same issue date, plus a Daily Report that reaches state "Reporte Procesado" covering that date.
5. Request a **Homologación** Clave (declare the date the Prueba de Testing was passed, so DGI can verify it).
6. In Homologación → Postulación → Ingresar: accept the "Declaración de cumplimiento de requisitos y condiciones," then fill the entry form:
   - Traditional: contact phone, software (own/external + provider RUC or foreign-provider name), site URL, DGI/technical contact e-mails, CFE types to certify.
   - Simplificado: contact phone, choice of "Proveedor habilitado" from the registered list, software name/version, Webservice URL, technical contact e-mail, CFE types to certify.
7. Confirm the postulación via the confirmation code e-mailed to the declared DGI contact address.
8. Accept the "Declaración de cumplimiento de requisitos técnicos" (Postulante); for simplified entry, the chosen Proveedor Habilitado must also accept the assigned job (within 5 business days, else auto-cancelled) and sign their own equivalent declaration.
9. DGI reviews compliance and, if approved, notifies inclusion in the regime plus the authorized CFE types; the authorization takes effect the day after the notification is confirmed received.
10. A 1-month transition window follows (only for the first CFE authorization) during which paper and electronic documentation may coexist before CFEs become mandatory exclusively. Adding a *new* CFE type later ("Certificar nuevo CFE") follows the same declaration flow but has no transition month.

*(Note: the current official instructivo, v18/15-Oct-2025, no longer describes the older multi-stage "Certificación" test-set/simulation/adenda/intercambio phases that appeared in earlier versions (e.g. v11/2018) — DGI has simplified the process directly to Postulación → Declaración → DGI review, consistent with e-invoicing having become mandatory for practically all VAT taxpayers.)*

**Step-by-step: production**

1. After DGI communicates the emisor electrónico authorization, request a **Producción** role Clave via the same "Solicitud de Creación de Usuario para eFactura" form.
2. Configure the software to sign CFEs (and Daily Reports) with the PFX certificate and send them to DGI either via the SOAP **Web Service** (`ws_efactura`) or via the **Upload** portal mechanism.
3. Handle the two-step async acknowledgment for Web Service sends: a synchronous 1st ack for the "sobre" (received/rejected) plus a token/estimated wait time, then a 2nd Web Service call to retrieve the per-CFE acceptance/rejection acks.
4. Within 1 month of the authorization's effective date, invoice exclusively via CFE (no more paper) for the authorized types.
5. From the authorization date the taxpayer is also automatically a **receptor electrónico** of all CFEs sent to it, regardless of what it certified — must be able to receive/acknowledge and publish e-Tickets on its own website.
6. Maintain the CAE (Constancia de Autorización para Emisión) numbering ranges, contingency handling, and daily-report reconciliation as ongoing operational obligations declared in the compliance statement.

**Cost, lead time & blockers**

- DGI charges nothing for postulación/homologación itself — it is a free administrative process.
- The digital certificate is the paid item, billed by the PSC (Abitab/Antel/Correo), priced in UYU, varying by legal-entity type and validity (1 or 2 years); no fixed DGI-published price exists since it's a private-market service — get a quote directly from the chosen PSC. Company (persona jurídica) requests typically need a notarized signed request form, adding lead time outside DGI's control.
- Lead time is otherwise self-paced: Testing has no deadline pressure other than accumulating the ≥50-CFE minimum per type; DGI review/authorization turnaround isn't published in the instructivo.
- Biggest architectural blocker: there is no OAuth2 client-credentials equivalent for `UY_DGI_CLIENT_ID`/`UY_DGI_CLIENT_SECRET` — any integration modeled on bearer-token auth needs to be re-mapped to (RUC+CI+Clave for the portal/role) + (PFX signature for message-level authenticity/integrity), which is a materially different trust model than the OAuth channels used elsewhere in this project.

**Official sources**
- https://www.efactura.dgi.gub.uy/files/instructivo-ingreso-al-regimen-cfe-archivo-pdf?es (Instructivo Ingreso al Régimen de CFE, v18, 15/10/2025 — current)
- https://www.efactura.dgi.gub.uy/files/descargar-todas-las-preguntas-frecuentes?es (CFE Preguntas Frecuentes, v28)
- https://www.efactura.dgi.gub.uy/principal/factura-electronica-informacion-general-proveedores-de-certificado-digital (Proveedores de certificado digital: Abitab, Antel, Administración Nacional de Correos)
- https://www.efactura.dgi.gub.uy/principal/Informacion_General (eFactura DGI, Información General)
- https://www.efactura.dgi.gub.uy/principal/factura-electronica-informacion-general-instructivos (Instructivos index)
- https://www.efactura.dgi.gub.uy/principal/Preguntas_Frecuentes (Preguntas Frecuentes index)
- https://efactura.dgi.gub.uy/efactura/ws_efactura?wsdl (production SOAP WSDL — confirmed live)
- https://efactura.dgi.gub.uy:6443/efactura/ws_certificacion?wsdl (homologación/certificación SOAP WSDL — confirmed live)

---

## 12. ZATCA Fatoora — Saudi Arabia (Phase 2 integration)

> **GitHub secrets:** `ZATCA_API_KEY`, `ZATCA_CERTIFICATE`, `ZATCA_CERT_PASSWORD`, `ZATCA_CLIENT_ID`, `ZATCA_CLIENT_SECRET`, `ZATCA_BASE_URL` &nbsp;•&nbsp; **Live flag:** `ZATCA_LIVE=1` (`ZATCA_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (developer portal / simulation) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

ZATCA's real auth model is: a **CSID certificate** (`binarySecurityToken`, X.509, base64) paired with a **secret** string, used together as HTTP Basic-Auth `username:password` on every reporting/clearance/compliance call. There is no OAuth client-id/secret pair anywhere in the official flow — only OTP (one-time, human-fetched, 1h TTL) → CSR → CCSID → PCSID.

| Secret | Maps to | Notes |
|---|---|---|
| `ZATCA_CERTIFICATE` (base64) | The **CCSID or PCSID certificate** — the `binarySecurityToken` field returned by `POST /compliance` or `POST /production/csids` (the exported `.pem`/`.pfx`). This is the Basic-Auth *username*. | Clean mapping. |
| `ZATCA_CLIENT_SECRET` | The **`secret`** field returned alongside the cert in the same CCSID/PCSID response — the Basic-Auth *password* paired with `ZATCA_CERTIFICATE`. | Clean mapping, but naming is misleading (it's not an OAuth secret, it's the CSID-paired secret). |
| `ZATCA_CERT_PASSWORD` | The **local PKCS#12 (.pfx) export passphrase** chosen by the integrator when running `openssl pkcs12 -export -passout pass:$password`, protecting the private key generated at CSR time. | Clean mapping, but it is *never sent to ZATCA* — purely a local key-protection secret, not ZATCA-issued. |
| `ZATCA_BASE_URL` | The **environment gateway root**: sandbox `.../developer-portal/`, simulation `.../simulation/`, production `.../core/` under `https://gw-fatoora.zatca.gov.sa/e-invoicing/`. | Clean mapping. |
| `ZATCA_CLIENT_ID` | **Does not map to any ZATCA concept.** ZATCA's own API has no client-id. This field only makes sense if invoicerr integrates through a third-party Accredited Solution Provider/middleware that wraps ZATCA (their own API key), or it's a leftover from a generic OAuth-secret template. | 🔴 non-mapping — flag/remove or repurpose for an ASP intermediary if one is ever used. |
| `ZATCA_API_KEY` | **Does not map to any ZATCA concept either.** ZATCA issues no persistent "API key" — auth is purely the CSID-cert + secret Basic-Auth pair above, refreshed at every CSID renewal. The only other credential in the flow, the OTP, is a one-hour-lived interactive value and cannot usefully live in a long-lived GH secret. | 🔴 non-mapping — redundant with `ZATCA_CLIENT_SECRET`, or would have to hold a short-lived OTP (impractical to store). |

Net: 4 of 6 secrets map cleanly (cert, secret, PFX password, base URL); 2 (`ZATCA_CLIENT_ID`, `ZATCA_API_KEY`) have no ZATCA-side referent in the direct CSID-based integration model.

**Prerequisites**

- A legal entity registered as a **VAT taxpayer in Saudi Arabia** with a valid 15-digit VAT number (starts and ends with "3").
- Access to the **Fatoora / ERAD taxpayer portal** (`https://fatoora.zatca.gov.sa/`) via the national single sign-on used for ZATCA e-services (business/Absher-linked login) — a foreign entity with no KSA tax registration cannot self-serve this.
- A **Phase-1-compliant EGS** (e-invoice generation solution) already producing structured XML/PDF-A3 invoices with embedded QR before Phase 2 (integration) onboarding is even attempted.
- `openssl` (secp256k1 EC key support) to build the CSR locally — the private key is never sent to ZATCA.
- ZATCA notifies each taxpayer of their mandatory Phase-2 "wave" at least 6 months ahead; current waves run through 2026 (Wave 23: SAR 750k threshold, deadline 31 Mar 2026; Wave 24: SAR 375k threshold, deadline 30 Jun 2026).

**Step-by-step: sandbox / compliance CSID (CCSID) onboarding**

1. Log in to the Fatoora/ERAD portal → **Onboarding and Management Portal** tile → **Onboard new solution unit/device** → **Generate OTP code**, choosing how many OTPs (= number of EGS units/devices to onboard). OTPs are valid **1 hour**.
2. Generate an EC keypair (`secp256k1`) and a CSR whose Subject/extension fields encode: `C` (country), `OU` (10-digit TIN), `O` (org name), `CN` (device/solution name), `SN` (unique solution ID), `UID` (15-digit VAT number), `title` (4-digit TSCZ flags for which invoice types the unit will issue), plus `registeredAddress`/`businessCategory`. `certificateTemplateName` = `ZATCA-Code-Signing` for production/sandbox-core, or `PREZATCA-Code-Signing` (with `CN=PREZATCA-Code-Signing`) when targeting the **Simulation** environment instead.
3. `POST` the base64 CSR with header `OTP: <code>` and `Accept-Version: V2` to the compliance endpoint for the chosen environment:
   - Sandbox (developer portal): `https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance`
   - Simulation (Fatoora Simulation Portal, FSP): `https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance`
   - Production/core: `https://gw-fatoora.zatca.gov.sa/e-invoicing/core/compliance`
4. Response returns `requestID`, `binarySecurityToken` (the **CCSID** certificate) and `secret`. Save both — this pair is the Basic-Auth credential for the next steps (`ZATCA_CERTIFICATE` / `ZATCA_CLIENT_SECRET` in this project's naming).
5. Run **compliance checks**: `POST` sample invoices to `.../compliance/invoices` (same environment root) using Basic-Auth `CCSID:secret`. The required sample set depends on the `title` flags from the CSR: standard-only needs Standard Invoice + Debit Note + Credit Note; simplified-only needs the Simplified equivalents; if both flags are set, all six documents must be submitted and accepted.

**Step-by-step: production CSID (PCSID)**

1. Once every required compliance-check document is accepted, `POST` `{ "compliance_request_id": "<requestID>" }` with `Authorization: Basic base64(CCSID:secret)` and `Accept-Version: V2` to `https://gw-fatoora.zatca.gov.sa/e-invoicing/core/production/csids`.
2. Response returns a fresh `binarySecurityToken` (the **PCSID**) and `secret` — this pair replaces the CCSID pair for all live reporting/clearance traffic.
3. Use PCSID Basic-Auth against the live invoice endpoints: `.../core/invoices/reporting/single` (simplified invoices, async report within 24h) and `.../core/invoices/clearance/single` (standard invoices, synchronous clearance before the buyer copy is issued).
4. PCSIDs expire and must be renewed periodically by re-calling `.../production/csids` — there is no separate "renew" verb, it's the same call.

**Cost, lead time & blockers**

- CSID issuance itself is a **free** ZATCA government service — no fee for CCSID/PCSID. Real cost sits in building/buying a Phase-1-compliant EGS (ERP/POS/middleware, XML+QR signing, PDF/A-3 generation) before Phase-2 integration is even possible.
- Lead time for the CSID mechanics themselves is short (OTP → CSR → CCSID is near-real-time on the API); the actual bottleneck is (a) reaching a Phase-1-compliant baseline, (b) passing all required compliance-check invoices, and (c) the mandated wave deadline for the specific taxpayer.
- **Hardest blocker for a project like this one**: the whole flow requires a live human logged into the Fatoora/ERAD portal with a real KSA VAT registration to pull the OTP (1h TTL) — there is no headless/CI-automatable path to acquire the very first CCSID. `ZATCA_CLIENT_ID`/`ZATCA_API_KEY` also don't correspond to anything ZATCA issues in this model, so the current 6-secret shape needs reconciling before it can be filled in.

**Official sources**
- [Onboarding for electronic invoicing in Saudi Arabia — Microsoft Learn](https://learn.microsoft.com/en-us/dynamics365/finance/localizations/mea/gs-e-invoicing-sa-onboarding) (reproduces ZATCA's own CSR config, OTP flow, and the exact `gw-fatoora.zatca.gov.sa/e-invoicing/core/compliance` and `.../core/production/csids` endpoints with real request/response fields)
- [ZATCA E-Invoicing — official portal](https://zatca.gov.sa/en/E-Invoicing/Pages/default.aspx)
- [ZATCA Developer Portal Manual (PDF)](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/DEVELOPER-PORTAL-MANUAL.pdf)
- [ZATCA Fatoora Portal User Manual (PDF)](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf)
- [ZATCA E-invoicing Detailed Technical Guidelines (PDF)](https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf)
- [Fatoora Developer Community — E-Invoicing API endpoints thread](https://zatca1.discourse.group/t/e-invoicing-api-endpoints/487) (confirms sandbox/simulation/core base-URL split)
- [ZATCA Launches Fatoora Simulation Portal (FSP) — Tally Solutions](https://tallysolutions.com/mena/saudi-vat/zatca-announces-launch-of-fatoora-simulation-portal/) (sandbox vs. FSP vs. production distinction)

---

## 13. GİB e-Fatura — Turkey (Revenue Administration e-invoicing)

> **GitHub secrets:** `GIB_API_KEY`, `GIB_CERTIFICATE`, `GIB_CERT_PASSWORD`, `GIB_CLIENT_ID`, `GIB_CLIENT_SECRET`, `GIB_BASE_URL` &nbsp;•&nbsp; **Live flag:** `GIB_LIVE=1` (`GIB_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (test ortamı) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

Turkey has no single unified public "GİB API" a SaaS product can just register for — there are two structurally different integration models (see below), and the `GIB_*` secret names only map cleanly onto **one** of them:

- `GIB_CERTIFICATE` / `GIB_CERT_PASSWORD` — the **mali mühür** (financial seal / e-Seal), a PKCS#12 certificate + private key issued only to *tüzel kişi* (legal entities) by **TÜBİTAK Kamu SM**, the sole authority allowed to issue it. Every e-Fatura/e-Arşiv document must be electronically sealed with a mali mühür (either the taxpayer's own, or — if using a private integrator — the integrator's own seal applied on the taxpayer's behalf). Valid 3 years.
- `GIB_API_KEY`, `GIB_CLIENT_ID`, `GIB_CLIENT_SECRET`, `GIB_BASE_URL` — **these do not map onto GİB's own direct web service.** GİB's direct "Entegrasyon" channel is a SOAP web service (WSDL confirmed live at `https://merkeztest.gib.gov.tr/EFaturaMerkez/services/EFatura/EFatura.wsdl` for test) authenticated by VKN + mali-mühür-signed envelope + registration during the entegrasyon başvuru — **not** an OAuth client_id/client_secret/API-key REST scheme. A `client_id`/`client_secret`/`api_key`/`base_url` shape instead matches how individual **private-integrator (özel entegratör) companies** (e.g. Uyumsoft, Foriba, Nesbilgi, Logo, QNB eFinans, Mikro — each GİB-authorized, listed at `https://ebelge.gib.gov.tr/`) expose their own proprietary REST/SOAP APIs to client businesses. If Invoicerr integrates via an özel entegratör, these four secrets should really be scoped as `<INTEGRATOR>_CLIENT_ID` etc., since every integrator defines its own auth scheme and base URL — there is no one GİB-wide value to put in `GIB_BASE_URL`.
- `GIB_LIVE=1` / `GIB_ENVIRONMENT=SANDBOX` — corresponds to switching between GİB's test endpoints (`test.efatura.gov.tr`, `merkeztest.gib.gov.tr`) and production, whether direct or via an integrator's own test/prod split.

**Prerequisites**

- A Turkish **VKN** (vergi kimlik numarası, tax ID) for the legal entity — mali mühür and e-Fatura registration are only issued to tüzel kişiler.
- A **mali mühür** certificate from TÜBİTAK Kamu SM (mandatory regardless of which model is chosen, unless a private integrator applies its own seal on your behalf under contract).
- A decision on **özel entegratör vs. doğrudan entegrasyon (direct)**:
  - **Özel entegratör (private integrator) — what most companies use.** You contract with an already GİB-authorized integrator and send/receive invoices through *their* infrastructure and *their* API/credentials. No need to build/test a SOAP client against GİB yourself; the integrator has already passed GİB's certification. This is the fast, low-engineering-effort path and is what the vast majority of Turkish businesses (and any SaaS wanting to offer e-Fatura to Turkish customers) use.
  - **Doğrudan entegrasyon (direct)** — your own systems connect straight to GİB's central SOAP service to send/receive **only your own** invoices. Requires your own mali mühür, a formal entegrasyon başvurusu, and passing GİB's test-environment scenarios before going live. No ISO certification is required for this (that's only required if you want to become a certified private integrator serving *other* taxpayers, per the June 2026 update to the Özel Entegrasyon Kılavuzu, which now mandates TÜRKAK-accredited ISO 27001 — plus ISO 22301 and ISO 20000 — for that specific status).
  - **GİB Portal** — free manual web portal, no API access at all, not viable for automated integration.

**Step-by-step: private integrator route (test creds)**
1. Obtain the company's mali mühür from Kamu SM (see below) — some integrators can use their own seal instead, per contract, so confirm with the chosen integrator whether you need your own.
2. Pick a GİB-authorized özel entegratör from the official list published on `https://ebelge.gib.gov.tr/` (search results surfaced firms such as Uyumsoft, Foriba, Nesbilgi, Logo, QNB eFinans, Mikro — verify current authorization status on the GİB site before contracting).
3. Sign a service contract ("özel entegratör ile sözleşme") with the integrator; the integrator electronically reports your VKN/TCKN to GİB (per the Özel Entegrasyon Kılavuzu §2.2), and GİB activates your user account once approved.
4. The integrator provisions **its own** test/sandbox API credentials for you (their own client ID/secret/API key, per their proprietary system) — request their sandbox base URL and test credentials at this stage; these are what `GIB_CLIENT_ID` / `GIB_CLIENT_SECRET` / `GIB_API_KEY` / `GIB_BASE_URL` should actually hold in this repo.
5. Integrate against the integrator's sandbox, run their conformance tests, then request production credentials once your integration passes.

**Step-by-step: direct GİB integration / production**
1. Apply for and receive the company's mali mühür from TÜBİTAK Kamu SM (steps below).
2. Submit the e-Fatura Uygulaması Başvurusu (application) via `https://ebelgebasvuru.gib.gov.tr/e-fatura` or `https://ebelge.gib.gov.tr/anasayfa.html`, selecting the "Entegrasyon" (direct integration) method rather than Portal or Özel Entegratör, using the GİB e-imza signing applet with the mali mühür smart card/HSM.
3. Register for the entegrasyon başvurusu at `https://test.efatura.gov.tr/entegrasyonbasvuru/`, submitting the required technical/application documents.
4. Build against the GİB **test** SOAP web service, endpoint `https://merkeztest.gib.gov.tr/EFaturaMerkez/services/EFatura` (WSDL at `.../EFatura.wsdl`), sending self-to-self test invoices per GİB's test scenarios (not through the portal).
5. Once GİB confirms all test scenarios pass, GİB issues written approval and activates the production connection/endpoint (disclosed to you directly by GİB at that point — not publicly listed).
6. Switch `GIB_ENVIRONMENT` from `SANDBOX` to production and set `GIB_LIVE=1`.

**Cost, lead time & blockers**

- The **mali mühür is a paid purchase from TÜBİTAK Kamu SM**, not free: apply online at `https://onlineislemler.kamusm.gov.tr/landing` (Mali Mühür İşlemleri → Başvuru Oluşturma), pay via `https://sanalpos.kamusm.gov.tr/` or partner banks (Vakıfbank/Ziraat). Smart-card certificates are produced immediately after payment and shipped by courier within **~10 business days**; HSM-based certs require additional hardware acquisition/installation scheduling. Certificates are valid **3 years**, with renewal reminders at 3/2/1 months and 1 week before expiry. (Kamu SM's own pricing page, `mm.kamusm.gov.tr/fiyatlandirma.jsp`, renders prices via JS and didn't return figures on fetch; third-party accounting sites put a 3-year smart-card package around 1,500–1,800 TL as of 2026 — treat as approximate, not official.)
- Becoming a certified **özel entegratör yourself** (not just a client of one) is a much bigger lift: as of the June 2026 (v1.14) guide update, applicants must hold TÜRKAK-accredited ISO 27001 (or commit to obtaining it), plus ISO 22301 and ISO 20000, submit a BİS (Bilgi İşlem Sistem Raporu) technical report, and complete GİB's testing within **one year** of starting (failure to finish in that window gets the application rejected). This is not the relevant path for a normal Invoicerr customer — only for a company that wants to resell e-Fatura connectivity to third parties.
- **Direct integration** has no ISO requirement but still requires passing GİB's own test-environment scenarios (technical, GİB-reviewed) before production is granted — timeline is not fixed publicly and depends on GİB's review queue.
- **Hardest blocker for this repo's secret shape:** `GIB_CLIENT_ID`/`GIB_CLIENT_SECRET`/`GIB_API_KEY`/`GIB_BASE_URL` don't correspond to anything GİB itself issues — GİB's own channel is SOAP + mali-mühür-signed envelopes with no client-credential OAuth flow. Those four secrets only make sense once a specific private integrator is chosen, since each integrator defines its own REST/SOAP auth scheme and endpoint. Until an integrator is selected, those four secrets can't be filled in a way that's actually "GİB's" — they're integrator-specific and should probably be renamed accordingly (e.g. `GIB_INTEGRATOR_*`) once a partner is picked.

**Official sources**
- https://ebelge.gib.gov.tr/efaturaozelentegratorluk.html
- https://ebelge.gib.gov.tr/anasayfa.html
- https://ebelge.gib.gov.tr/dosyalar/kilavuzlar/e-Fatura_Uygulamasi_Ozel_Entegrasyon_Kilavuzu_v1.14.pdf
- https://ebelge.gib.gov.tr/dosyalar/Basvuru_Surecleri.pdf
- https://ebelgebasvuru.gib.gov.tr/e-fatura
- https://ebelgebasvuru.gib.gov.tr/entegrasyon
- https://test.efatura.gov.tr/entegrasyonbasvuru/
- https://merkeztest.gib.gov.tr/EFaturaMerkez/services/EFatura/EFatura.wsdl
- https://mm.kamusm.gov.tr/surecler/
- https://kamusm.bilgem.tubitak.gov.tr/SSS/
- https://mm.kamusm.gov.tr/fiyatlandirma.jsp

---

## 14. ETA e-invoicing — Egypt (Egyptian Tax Authority)

> **GitHub secrets:** `EG_ETA_CERTIFICATE`, `EG_ETA_CERT_PASSWORD`, `EG_ETA_CLIENT_ID`, `EG_ETA_CLIENT_SECRET`, `EG_ETA_BASE_URL` &nbsp;•&nbsp; **Live flag:** `EG_ETA_LIVE=1` (`EG_ETA_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (preproduction) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `EG_ETA_CLIENT_ID` / `EG_ETA_CLIENT_SECRET` — issued when the ERP system is registered under the taxpayer's "Representatives" section on the ETA portal (`invoicing.eta.gov.eg`). ETA actually issues **three** values (Client ID, Client Secret 1, Client Secret 2) — pick one secret to map to `EG_ETA_CLIENT_SECRET` (keep the other as a stored rotation spare).
- `EG_ETA_CERTIFICATE` (base64) / `EG_ETA_CERT_PASSWORD` — the company's eSeal X.509 certificate + private key, issued on a USB cryptographic token (e.g. ePass2003) by an ITIDA-licensed Certification Service Provider (Egypt Trust, MCDR, Fixed Misr, or El Delta Electronic Systems). For server-side/unattended ERP signing this must be exported off the token into a signing service/HSM (a bare USB token needs manual PIN entry per invoice/session and only suits very low volumes, under ~500/month) — base64-encode the resulting keystore for the secret.
- `EG_ETA_BASE_URL` — the API base address, different per environment: preproduction `https://api.preprod.invoicing.eta.gov.eg`, production `https://api.invoicing.eta.gov.eg`. Authentication itself happens against a separate Identity Service host, not this base URL (see below).

**Prerequisites** (Egyptian tax registration, ETA portal onboarding, e-seal certificate + token)
- Active Egyptian Tax Registration Number (TRN) / Commercial Register + Tax Card.
- Company "digital profile" registered with ETA (`profile.eta.gov.eg` / preprod: `profile.preprod.eta.gov.eg`), which gives the taxpayer admin access to invite representatives and register ERP/POS systems.
- An eSeal certificate purchased from one of the four ITIDA-accredited CSPs (source: itida.gov.eg/English/Pages/E-Signature.aspx): Egypt Trust, MCDR, Fixed Misr, El Delta Electronic Systems. Documents needed: recent Commercial Register extract (<3 months), Tax Card, VAT certificate (if applicable), valid ID of the signatory (or ID + notarized authorization for a representative), company email registered in the Commercial Register, company stamp on the application, and payment of fees.

**Step-by-step: preproduction API client + registration**
1. Request preproduction ("PreProd"/UAT) access from ETA (via the SDK contacts page) — this is a separate credential set from production and is provisioned on request.
2. Register/access the taxpayer digital profile at `https://profile.preprod.eta.gov.eg`, accept the admin invitation, and add representatives as needed.
3. On the preproduction invoicing portal (`https://preprod.invoicing.eta.gov.eg`), open **View Taxpayer Profile → Representatives → Register ERP**, enter an ERP name (other fields can stay blank), and submit.
4. ETA generates **Client ID**, **Client Secret 1**, **Client Secret 2** for that ERP registration — copy these immediately and store them securely (they are shown once).
5. Buy/activate an eSeal certificate + USB token from an ITIDA-licensed CSP for testing (preproduction accepts self-signed/test flows — document version v0.9 disables signature validation, but plan for the same certificate pipeline you'll use in prod).
6. Import the preprod Postman environment (`EEI - UAT Env.postman_environment.json`) and Root CA certificate published at `https://api.preprod.invoicing.eta.gov.eg` to sanity-check connectivity before wiring the ERP.
7. Obtain an access token to confirm the client works: `POST {identity-base}/connect/token` where identity base for preprod is `https://id.preprod.eta.gov.eg`, with header `Authorization: Basic base64(client_id:client_secret)` and body `grant_type=client_credentials&scope=InvoicingAPI`. A 200 with an `access_token` (Bearer, `expires_in` 3600s) confirms the client credentials are live.
8. Configure `EG_ETA_BASE_URL=https://api.preprod.invoicing.eta.gov.eg`, `EG_ETA_CLIENT_ID`, `EG_ETA_CLIENT_SECRET` from step 4, and the base64 cert + password from step 5 for `EG_ETA_LIVE=1` / `EG_ETA_ENVIRONMENT=SANDBOX` test runs. Never send real invoice data to preproduction.

**Step-by-step: production**
1. Repeat the same ERP registration flow (steps 2–4 above) on the production hosts: profile `https://profile.eta.gov.eg`, invoicing portal `https://invoicing.eta.gov.eg`, identity/token host `https://id.eta.gov.eg`, API base `https://api.invoicing.eta.gov.eg`.
2. Production Client ID/Secret are distinct from preprod — the SDK explicitly warns credentials differ per environment and must be swapped when moving environments (do not reuse preprod values).
3. Get the production-grade eSeal certificate issued (same ITIDA CSP, production-validity token/certificate — not the test one), and load it into whatever signs invoices (in-house signing server hosting the USB token, or an ETA-approved cloud/HSM signing service) since production requires real signature validation.
4. Verify with a real `POST https://id.eta.gov.eg/connect/token` (client_credentials, scope `InvoicingAPI`) and then a first live document submission/ERP ping (`/api/08-erp-ping/`) before flipping traffic over.
5. Set `EG_ETA_BASE_URL=https://api.invoicing.eta.gov.eg`, the production Client ID/Secret, and the production cert/password as the live secrets (drop `EG_ETA_ENVIRONMENT=SANDBOX`).

**Cost, lead time & blockers**
- eSeal certificate: ~950–3,600 EGP depending on provider (Egypt Trust, Tawtheeq, MCDR, Orange) and validity (1–3 years), plus USB token; renewal 700–2,000 EGP. Issuance takes ~24–48 business hours after documents + fees are submitted to the CSP.
- ERP/API client registration itself is free but gated behind having the taxpayer digital profile set up and a representative with permission to register systems — this is a manual portal flow, not self-service API signup, so it cannot be scripted/automated ahead of time.
- Biggest blocker for unattended CI/server signing: a plain USB token needs a human to insert it and enter a PIN per session — production-grade automated signing needs an HSM or ETA-approved cloud signing service, which is a separate procurement/integration step beyond just buying the certificate.
- Preprod and prod credentials are entirely separate (different Client ID/Secret and possibly different certificates) — budget for provisioning both, not just one "sandbox toggle."

**Official sources**
- https://sdk.invoicing.eta.gov.eg/start/ (getting-started onboarding flow: digital profile → admin → ERP/POS registration → API credentials → eSeal certificate)
- https://sdk.invoicing.eta.gov.eg/api/ (API overview, login-as-taxpayer-system reference)
- https://sdk.invoicing.eta.gov.eg/api/01-login-as-taxpayer-system/ (token endpoint: `POST /connect/token`, Basic auth with client id/secret, `grant_type=client_credentials`, `scope=InvoicingAPI`)
- https://sdk.invoicing.eta.gov.eg/faq/ (FAQ index; PreProd root CA cert + Postman setup)
- https://www.eta.gov.eg/sites/default/files/2021-09/SDK%20links_0.pdf (official preprod vs prod host list: `profile.preprod.eta.gov.eg` / `preprod.invoicing.eta.gov.eg` / `id.preprod.eta.gov.eg` / `api.preprod.invoicing.eta.gov.eg` vs `profile.eta.gov.eg` / `invoicing.eta.gov.eg` / `id.eta.gov.eg` / `api.invoicing.eta.gov.eg`)
- https://invoicing.eta.gov.eg/content/?path=userguide/register-erp-system (official "Register an ERP system" user guide — View Taxpayer Profile → Representatives → Register ERP)
- https://itida.gov.eg/English/Pages/E-Signature.aspx (ITIDA-licensed CSPs: Egypt Trust, MCDR, Fixed Misr, El Delta Electronic Systems; GOV-CA for government entities)

---

## 15. FIRS e-invoicing — Nigeria (National e-Invoice)

> **GitHub secrets:** `FIRS_API_KEY`, `FIRS_CLIENT_ID`, `FIRS_CLIENT_SECRET`, `FIRS_BASE_URL` &nbsp;•&nbsp; **Live flag:** `FIRS_LIVE=1` (`FIRS_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `FIRS_CLIENT_ID` / `FIRS_CLIENT_SECRET` / `FIRS_API_KEY` — a per-environment credential set (sandbox and live are separate values) generated from inside the taxpayer's own e-Invoice account, under **My Account → API Integration** / "Manage Cryptographic Keys" (this also issues the public key/certificate used to sign invoices). There is no separate developer-portal signup — the same taxpayer login used for enablement is where credentials are minted.
- `FIRS_BASE_URL` — confirmed directly from the live web app's own bundled code: the official FIRSMBS/NRSMBS API host is `https://api.firsmbs.com/api/`. **Caveat:** if the business integrates through an Access Point Provider (APP) rather than directly, `FIRS_BASE_URL` instead points at that APP's own API (each APP is assigned its own endpoint — the enablement confirmation email shows a "Default URL for e-Invoice platform" specific to the chosen APP, e.g. `https://einvoice1.firs.gov.ng` in FIRS's own sample screenshot).
- `FIRS_ENVIRONMENT` / sandbox toggle — sandbox and production are **not separate registrations**: the same dashboard has a sandbox/live switch ("You are currently in sandbox" → "Switch to live"), each with its own key set.

**Prerequisites**
- A Nigerian **TIN** (Tax Identification Number) tied to a CAC-registered entity, already active in **TaxPro-Max** (the FIRS/NRS tax-filing portal, now at `taxpromax.firs.gov.ng` / `nrs.gov.ng`) — e-invoicing enablement rides on top of this existing tax profile and is the first field on the enablement form.
- A working corporate email on file for that TIN (all enablement/password/APP-assignment notices go there).
- Decisions needed before filling the form: industry/sub-industry, ERP solution in use (or none), reporting method (e.g. near-real-time), aggregate turnover bracket (this determines which rollout wave applies), and whether Peppol cross-border exchange is needed (+ Peppol Participant ID if yes).
- A choice of **Access Point Provider (APP)** from FIRS's dropdown list (any one — freely changeable after onboarding) unless self-integrating as your own System Integrator.

**Step-by-step: sandbox access + API credentials**
1. Visit `https://einvoice.firs.gov.ng/` → **Businesses** → **"Get enabled for e-Invoicing."**
2. Fill the enablement form: TIN, Industry, Access Point Provider, ERP solution, Reporting method, Aggregate Turnover, Peppol Yes/No (+ Participant ID) → review the confirmation modal → **Confirm**.
3. FIRS emails the TIN's registered address ("Your e-Invoice Enablement is Complete") naming the assigned APP and a default platform URL; click **Set Password** (link expires in 60 minutes).
4. Create the account password (≥8 chars, upper+lower+digit+special char) and log in at the e-Invoice portal.
5. In the dashboard, switch to **sandbox** mode (toggle is per-account, not a separate signup).
6. Under **My Account → API Integration** (tab set: General Information / System Integrators / Access Points / API Integration / Team Members) generate the sandbox **API key / Client ID + Secret** and the signing public key/certificate.
7. Optionally under **My Account → Access Points**, pick/edit your default APP and its granted permissions (View Invoice, Submit Invoice, Request Rejection, Block Access Point); under **Team Members**, invite a developer (a "Developer" role exists) to manage the integration.
8. Build against the sandbox using the official docs navigation (Authentication, Environments, API Collection/Postman, resource lookups for currencies/tax categories/product & service codes, Access Point Provider endpoints for sign/validate/exchange/report) linked from `einvoice.firs.gov.ng`.

**Step-by-step: production**
1. No separate production application exists — it is the same enabled account; switch the dashboard toggle from sandbox to live.
2. Generate the **live** API key / Client ID + Secret / certificate from the same API Integration / cryptographic-keys screen (values differ from sandbox).
3. Confirm your turnover bracket's mandatory go-live has arrived: >₦5bn turnover taxpayers since Nov 1 2025; ₦1bn–₦5bn since Jul 1 2026; remaining VAT-registered SMEs phase in through 2027.
4. If routing through an APP instead of direct integration, complete the integration on the APP's own portal/API (the enablement email supplies its URL) — in that case `FIRS_BASE_URL` is the APP's endpoint, not `api.firsmbs.com`.
5. Keep the underlying TaxPro-Max/VAT registration active; e-invoicing enablement is suspended if the tax profile lapses.

**Cost, lead time & blockers**
- Registration and direct API access are **free**; no FIRS enablement or API fee. Cost only appears if you pay a commercial System Integrator/APP for managed integration.
- **This system is new and mid-rollout** (2025–2027 phased mandate) — official developer documentation is thin: the docs site (`einvoice.firs.gov.ng/docs/...`) is a JavaScript SPA whose route list (confirmed from its own source: `/docs/authentication`, `/docs/environments`, `/docs/api-collection`, `/docs/access-point-providers/*`, `/docs/resources/*`) could not be rendered as static text by our tooling — a human needs to log in and read it directly from the live dashboard.
- Branding is actively transitioning from **FIRS/FIRSMBS** to **NRS/NRSMBS** (Nigeria Revenue Service); some official PDFs and support links are already stale (e.g. `community.firsmbs.com` in one FIRS PDF no longer resolves — `community.nrsmbs.com` is the live replacement).
- No published SLA for enablement approval time (the manual's flow reads as same-day/automated); no published formal accreditation criteria for APPs/SIs beyond press mentions of NITDA certification.
- Exact steps/labels on the "Manage Cryptographic Keys"/API Integration screen (where the actual `FIRS_CLIENT_ID`/`FIRS_CLIENT_SECRET`/`FIRS_API_KEY` values are generated) are **not documented in any published FIRS manual found** — only third-party/community sources describe it. Flag for whoever provisions this to log into the live dashboard and screenshot the real flow.

**Official sources**
- https://einvoice.firs.gov.ng/
- https://einvoice.firs.gov.ng/documents/Navigating-the-NRSMBS-(e-Invoice)-Portal.pdf (FIRS Taxpayer's Manual v0.1 — Enablement & Onboarding)
- https://einvoice.firs.gov.ng/documents/FIRS%20E-Invoicing%20Next%20Steps%20for%20Taxpayer.pdf (FIRS "Next Steps for Taxpayers" slide deck, Feb 2025)
- https://community.nrsmbs.com/kb (official Developer's Community, linked from the FIRS taxpayer manual)

---

## 16. KRA eTIMS — Kenya (electronic Tax Invoice Management System)

> **GitHub secrets:** `KE_KRA_API_KEY`, `KE_KRA_CLIENT_ID`, `KE_KRA_CLIENT_SECRET`, `KE_KRA_BASE_URL` &nbsp;•&nbsp; **Live flag:** `KE_KRA_LIVE=1` (`KE_KRA_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `KE_KRA_BASE_URL` — the eTIMS API root. Sandbox = `https://etims-api-sbx.kra.go.ke` (fetched directly, returns `KRA eTIMS API v2.0`); production = `https://etims-api.kra.go.ke` (also confirmed live, same banner). This is the environment split, distinct from the human taxpayer portals (`https://etims-sbx.kra.go.ke` sandbox / `https://etims.kra.go.ke` production).
- `KE_KRA_CLIENT_ID` / `KE_KRA_CLIENT_SECRET` — the OSCU/VSCU integration credentials KRA issues once a taxpayer's system-to-system integration has been **vetted and certified** (see below). They authenticate API calls from the registered software instance to eTIMS and are tied to a specific KRA PIN + registered device/branch serial.
- `KE_KRA_API_KEY` — an additional device/software-instance key some OSCU/VSCU integrations require alongside the client credentials (issued together with the interim approval certificate). KRA's public pages describe the deliverable only as "API credentials issued upon certification" — the exact key/secret split is set by whichever integration path (self-built vs KRA-approved third-party SDK) is used, so treat this as the extra per-device token distinct from the client ID/secret pair.

**Prerequisites**
- A valid **Kenyan KRA PIN** for the business (obtained via iTax registration) — eTIMS onboarding is not possible without one.
- The business already onboarded onto eTIMS itself (separate, prior step from the API integration) via the taxpayer portal at `etims.kra.go.ke`, following KRA's "Procedure for eTIMS Registration" guide.
- A decision between the two system-to-system models — **both are API-based**, unlike the eTIMS Client software or eTIMS Lite (eCitizen/USSD `*222#`/mobile app) channels, which have no API:
  - **OSCU** (Online Sales Control Unit) — for taxpayers whose invoicing system is always online; invoices are validated/transmitted to eTIMS in real time.
  - **VSCU** (Virtual Sales Control Unit) — for taxpayers doing bulk invoicing who are **not** always online (e.g. POS/ERP that batches transactions).
- Device/branch serial registration: each till/branch/outlet that will transmit invoices must be registered under the taxpayer's eTIMS profile before use.
- ID copy of the company owner/director, plus a signed "eTIMS Confirmation form" (`eTIMS-confirmation-document.pdf`, confirmed present on kra.go.ke).
- Choice of **self-integration** (in-house build against the published OSCU/VSCU API spec) vs a **KRA-approved third-party integrator** — KRA publishes a dated list of approved vendors (e.g. Namiri Tech, Interswitch Group, Hiduka, STAN Best Group, Dynamic Mobility).

**Step-by-step: eTIMS onboarding + sandbox/VSCU credentials**
1. Register the company for a KRA PIN via iTax if not already done.
2. Onboard the business onto eTIMS itself at the taxpayer portal (`etims.kra.go.ke`), per the "Procedure for eTIMS Registration" guide — provide details on the nature of the business. (Non-VAT taxpayers can instead self-onboard onto **eTIMS Lite** via eCitizen, USSD `*222#`, or the "eTIMS Non VAT" app, with no KRA approval step — but that path has no API.)
3. Pick OSCU or VSCU based on connectivity model, and read the OSCU/VSCU API technical specifications published on the KRA website.
4. Pull the "eTIMS OSCU/VSCU Step-by-Step Guide on how to sign up" and the "eTIMS Bio-Data Form for OSCU and VSCU," both published under kra.go.ke/images/publications.
5. Develop and test the integration against the **sandbox**: taxpayer sandbox portal `https://etims-sbx.kra.go.ke`, API base `https://etims-api-sbx.kra.go.ke` (live-verified). This sandbox base URL is what `KE_KRA_BASE_URL` should point to while `KE_KRA_ENVIRONMENT=SANDBOX` / `KE_KRA_LIVE=1` for CI/testing.
6. Complete the Bio-Data Form and gather supporting docs (ID copy, signed confirmation form, sandbox test evidence).
7. Submit the package to KRA for **vetting** — a technical and administrative review of the integration.
8. On approval, KRA issues the sandbox/test API credentials (client ID/secret and the device-scoped API key) tied to a test KRA PIN and device serial — these populate `KE_KRA_CLIENT_ID` / `KE_KRA_CLIENT_SECRET` / `KE_KRA_API_KEY` for sandbox use.

**Step-by-step: production**
1. On final approval, KRA issues an **interim approval certificate** for the VSCU/OSCU integration.
2. KRA issues (or activates) the corresponding **production** API credentials, scoped to the taxpayer's real KRA PIN and its registered device/branch serial(s).
3. Register each production branch/device under the taxpayer's live eTIMS profile before it can transmit real invoices.
4. Point `KE_KRA_BASE_URL` to production `https://etims-api.kra.go.ke` (live-verified) and switch the app's environment/live flags accordingly; every outgoing invoice must now be transmitted through the certified integration.

**Cost, lead time & blockers**
- eTIMS onboarding itself (the prerequisite taxpayer registration) is free and self-service for eTIMS Lite (no KRA approval needed).
- No KRA fee is published on the fetched pages for the OSCU/VSCU vetting/certification process itself, but it is **not instant**: it requires a working sandbox-tested integration, submission of the Bio-Data Form + documents, and a KRA technical/administrative review cycle before an interim approval certificate (and production credentials) are issued. No fixed SLA is published on the pages fetched.
- **Hardest blocker:** a valid **Kenyan KRA PIN** is required to onboard at all — a business without a Kenya-registered taxpayer entity cannot self-onboard onto eTIMS or request OSCU/VSCU credentials; it would need a local Kenyan entity/PIN or a KRA-approved third-party integrator acting on its behalf.
- Self-integration requires in-house engineering against the OSCU/VSCU spec and surviving KRA's vetting; using one of KRA's approved third-party integrators bypasses the in-house build but adds a vendor relationship/cost outside KRA's own (unpublished/free) fee schedule.

**Official sources**
- https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/how-to-onboard-on-etims
- https://www.kra.go.ke/business/etims-electronic-tax-invoice-management-system/learn-about-etims/etims-system-to-system-integration
- https://etims.kra.go.ke/main/signup/indexLearnMore
- https://www.kra.go.ke/images/publications/OSCU_VSCU_Step-by-Step_Guide-on-how-to-sign-up.pdf
- https://www.kra.go.ke/images/publications/eTIMS-Bio-Data-Form-for-OSCU-and-VSCU.pdf
- https://www.kra.go.ke/images/publications/eTIMS-confirmation-document.pdf
- https://www.kra.go.ke/images/publications/List-of-Approved-eTIMS-3rd-party-integrators-as-at-24th-March-2025.pdf
- https://www.kra.go.ke/online-services/etims
- https://etims-api-sbx.kra.go.ke (sandbox API base, live-verified: "KRA eTIMS API v2.0")
- https://etims-api.kra.go.ke (production API base, live-verified: "KRA eTIMS API v2.0")

---

## 17. IRP (GST e-invoicing) — India (Invoice Registration Portal)

> **GitHub secrets:** `IN_IRP_API_KEY`, `IN_IRP_CLIENT_ID`, `IN_IRP_CLIENT_SECRET`, `IN_IRP_BASE_URL` &nbsp;•&nbsp; **Live flag:** `IN_IRP_LIVE=1` (`IN_IRP_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (NIC sandbox) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**

- `IN_IRP_CLIENT_ID` / `IN_IRP_CLIENT_SECRET` — the "app-level" credential pair, issued once per registering entity (GSP / ERP / e-commerce operator / notified taxpayer) on the sandbox portal (`einv-apisandbox.nic.in`) or, for production, on `einvoice1.gst.gov.in`. This pair authenticates the *software* (Invoicerr acting as an ERP/GSP-integrated client), not an individual GSTIN. It maps to `IN_IRP_API_KEY` if the repo's provider only exposes a single combined key — otherwise `IN_IRP_API_KEY` can hold the GSP's reseller/subscription key if Invoicerr integrates through a GSP rather than registering as its own ERP.
- **Username / password** (per-GSTIN) — a *second*, separate credential that each taxpayer (i.e. each end-customer company using Invoicerr, identified by their own GSTIN) creates for themselves, scoped under the Client ID above. There is one username/password per GSTIN, not per software vendor. This is not currently modeled as one of the four listed secrets and will need a per-tenant credential store, not a single global secret, once this channel is implemented for real multi-tenant use.
- `IN_IRP_BASE_URL` — the IRP API host. Sandbox: `https://einv-apisandbox.nic.in` (test-environment base for the NIC IRP APIs). Production: the taxpayer-selected IRP's own API host — NIC's is reached via `https://einvoice1.gst.gov.in` (there are now multiple GSTN-authorized IRPs beyond NIC, e.g. IRIS's `einvoice6.gst.gov.in`; a taxpayer/GSP picks one IRP and its IRN numbers are still valid GST-wide).

**Prerequisites** (GSTIN, turnover eligibility for direct API access, or a GSP)

- A valid **GSTIN** (and PAN) for every taxpayer whose invoices will be reported, plus the mobile number/email already registered against that GSTIN/PAN on the GST Common Portal (OTP is sent there).
- **Direct API eligibility**: the threshold for being allowed direct API access to the IRP has been lowered in step with the e-invoicing mandate rollout — ₹500 Cr+ (Oct 2020) → ₹100 Cr+ (Jan 2021) → ₹50 Cr+ (Apr 2021) → ₹20 Cr+ (Apr 2022) → ₹10 Cr+ (Oct 2022) → ₹5 Cr+ (Aug 2023, current mandate floor). In practice this means any GSTIN currently subject to the e-invoicing mandate (turnover > ₹5 Cr) can *technically* request direct API credentials, but doing so also requires: whitelisting up to 4 static Indian IP addresses for production, adequate dedicated bandwidth (commonly a leased/MPLS line), compliance with GoI/CERT-IN IT security standards (IT Act 2000 incl. §43A), and passing a test-report/scrutiny step before whitelisting — a real infra + compliance investment, cited by third parties at roughly ₹5 lakh in one-time + recurring cost. This is why direct integration is realistically only used by large single-GSTIN enterprises.
- **GSP route** (the practical path for smaller taxpayers and for any multi-tenant software like Invoicerr serving many different customer GSTINs): register as, or partner with, a GST Suvidha Provider / notified ERP. GSTN-authorised GSPs include (per third-party listings) Masters India, Tera Software, IRIS Business, Cygnet Infotech, ClearTax, MasterGST, and others. Each end-customer then only needs to "opt in" to that GSP/ERP on `einvoice1.gst.gov.in` and create their own username/password — no IP whitelisting or infra burden on the end customer.
- **Blocker specific to Invoicerr's architecture**: since Invoicerr is multi-tenant (one deployment serves many companies, each with their own GSTIN/turnover), the clean model is to register once as an "ERP"/GSP-integrated client (one `IN_IRP_CLIENT_ID`/`IN_IRP_CLIENT_SECRET` pair for the whole app) and then have each tenant create their own username/password under that Client ID. A single global secret quad is enough for the app-level credential, but per-tenant username/password will need to live in per-company config, not in GitHub secrets.

**Step-by-step: sandbox API registration (NIC)**
1. Go to `https://einv-apisandbox.nic.in` and click **Register**.
2. Choose the registrant category: **GSP**, **ERP**, **ECO**, or notified **Tax payer**.
3. Enter GSTIN (taxpayer) or PAN (GSP/ERP), plus the mobile number and email already registered with GSTN, complete the captcha, click **Validate**, then **Send OTP**.
4. Enter the OTP to verify.
5. On the credentials screen, select the integration mode (e.g. "GSP"), pick/confirm the company, and the portal issues a sandbox **Client ID** (and Client Secret).
6. Create a sandbox **username and password** for the specific GSTIN being tested — this is separate per GSTIN.
7. Submit; the sandbox confirms creation of the test credentials.
8. Use the sandbox's "Get public key" function to fetch the RSA public key needed to encrypt the password/app-key on every `/authenticate` call (auth uses RSA/ECB/PKCS1Padding to wrap an AES-256 session key, SEK, which then encrypts/decrypts all POST payloads).
9. Exercise the documented test suite (NIC recommends ~50 success + ~50 failure cases per API) covering Generate IRN, Cancel IRN, Get IRN details, Generate/Cancel e-Way Bill by IRN, etc., all listed and documented on the sandbox portal itself with a web-based test console.

**Step-by-step: production (direct API or via GSP)**
1. Log in to `https://einvoice1.gst.gov.in` (existing e-Way Bill portal credentials can be reused if already registered there).
2. Open **API Registration** on the dashboard and choose **Create API User**; verify via OTP sent to the registered mobile.
3. Choose the mode: **Through GSP** (select the specific GSP from the list) or **Direct** (self/ERP).
4. For the **direct** route: submit the required 4 static Indian IP addresses plus the sandbox test-completion report; NIC scrutinises/verifies the report, whitelists the IPs, and only then issues the production Client ID/Client Secret through the portal.
5. For the **GSP** route: once the GSP is selected, create a production username/password for the GSTIN under that GSP's already-whitelisted Client ID — no separate IP whitelisting needed on the taxpayer's side.
6. Store the resulting Client ID/Client Secret (app-level) as `IN_IRP_CLIENT_ID` / `IN_IRP_CLIENT_SECRET`, and the base host as `IN_IRP_BASE_URL` (production, not sandbox). Per-GSTIN username/password is a separate, per-tenant credential outside this secret quad.

**Cost, lead time & blockers**

- Sandbox registration: free, effectively instant (OTP-gated self-service).
- Direct-API production: no NIC fee for the credential itself, but real infra cost — static IP(s)/leased line, security hardening, ongoing maintenance — third parties estimate ~₹5 lakh one-time plus recurring network cost; lead time is days-to-weeks because of the test-report/scrutiny/whitelisting step.
- GSP route: per-invoice or subscription pricing set by the GSP (third-party example: one GSP quotes as low as ~18–50 paise per e-invoice depending on volume/storage tier); lead time is typically much shorter since the GSP's IPs are already whitelisted — the taxpayer only self-registers under the GSP.
- Biggest blocker for this repo: nothing is registered yet (no GSTIN/company identity picked to register under, no GSP partnership chosen), and the credential model is inherently two-layered (one app-level Client ID/Secret + one username/password per end-customer GSTIN) which the current 4-secret, single-tenant shape (`IN_IRP_API_KEY/CLIENT_ID/CLIENT_SECRET/BASE_URL`) does not yet accommodate for multi-tenant use — a per-tenant credential store will be needed alongside these global secrets before this can go live for more than one GSTIN.

**Official sources**
- https://einv-apisandbox.nic.in/ (surfaced and content-corroborated via search; direct WebFetch to this NIC host returned `ECONNREFUSED` from this environment)
- https://einv-apisandbox.nic.in/onboarding.html
- https://einv-apisandbox.nic.in/apicredentials.html
- https://einv-apisandbox.nic.in/FaqsonAPI.html
- https://einvoice1.gst.gov.in/ (production portal)
- https://einvoice6.gst.gov.in/content/ (example of an alternate GSTN-authorised IRP, IRIS IRP6)

---

## 18. MyInvois — Malaysia (LHDN/IRBM e-invoicing)

> **GitHub secrets:** `MYINVOIS_CLIENT_ID`, `MYINVOIS_CLIENT_SECRET`, `MYINVOIS_BASE_URL` &nbsp;•&nbsp; **Live flag:** `MYINVOIS_LIVE=1` (`MYINVOIS_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (preprod) &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
`MYINVOIS_CLIENT_ID` / `MYINVOIS_CLIENT_SECRET` are issued by LHDN's own "Register ERP" self-service flow inside the MyInvois taxpayer portal (not a third-party developer console). A taxpayer (or an intermediary acting on a taxpayer's behalf) logs into the portal, opens their **Taxpayer Profile**, and uses **Register ERP** to create an ERP entry (name + client-secret expiration period). The portal then displays a **Client ID** plus **two client secrets** ("Secret 1"/"Secret 2", shown once, redundant pair with the same expiry) — these map to `MYINVOIS_CLIENT_ID`/`MYINVOIS_CLIENT_SECRET`. `MYINVOIS_BASE_URL` is simply the environment's API host (see table below); auth (`/connect/token`, OAuth2 client-credentials grant) is served from the same host.

| Environment | Portal (Register ERP) | API base URL |
|---|---|---|
| Production | `myinvois.hasil.gov.my` (via `mytax.hasil.gov.my` → MyInvois tab) | `api.myinvois.hasil.gov.my` |
| Sandbox (preprod) | `preprod.myinvois.hasil.gov.my` (via `preprod-mytax.hasil.gov.my` → MyInvois (Preprod) tab) | `preprod-api.myinvois.hasil.gov.my` |

Sandbox and production credentials are **not interchangeable** — each environment needs its own taxpayer registration and its own "Register ERP" run, producing a distinct client_id/secret pair.

**Prerequisites**
- A Malaysian **TIN** (Tax Identification Number) for the business — validate via the MyTax portal (e-Daftar/Profile), the "Validate Taxpayer's TIN" API, or HASiL Contact Centre (03-8911 1000). Non-individual TINs must be normalized (e.g. `C01234567890` → `C1234567890`); individual TINs use the `IG` prefix.
- MyTax / MyInvois portal login for the taxpayer (or **Intermediary** access: taxpayer adds the intermediary's TIN/BRN under "Add Intermediary" on their Taxpayer Profile, with a representation date range and permissions enabled — the intermediary then authenticates with its **own** client_id/secret plus an `onbehalfof` header identifying the represented taxpayer).
- A **digital signing certificate** for API/ERP submissions (see below) — required once you sign and submit documents programmatically rather than keying invoices manually in the portal UI.

**Step-by-step: sandbox (preprod) ERP registration + client credentials**
1. Go to `preprod-mytax.hasil.gov.my`, log in, click the **MyInvois (Preprod)** tab.
2. Open the profile icon → **View Taxpayer Profile**.
3. Scroll to **Register ERP** and click it.
4. Enter an ERP name (e.g. "Invoicerr") and choose the client-secret expiration period (1–3 years).
5. Mark it as the primary ERP system if prompted, then submit.
6. Copy **Client ID**, **Secret 1**, and **Secret 2** immediately — they are shown only once. Store them as `MYINVOIS_CLIENT_ID` / `MYINVOIS_CLIENT_SECRET` (one of the two secrets).
7. Set `MYINVOIS_BASE_URL=https://preprod-api.myinvois.hasil.gov.my`, `MYINVOIS_ENVIRONMENT=SANDBOX`, `MYINVOIS_LIVE=1`.
8. Validate by calling `POST {base}/connect/token` with `grant_type=client_credentials`, `client_id`, `client_secret`, `scope=InvoicingAPI` (add `onbehalfof: <TIN>` header only for intermediary logins) and confirming a Bearer `access_token` comes back.
9. Sandbox notes: lower rate limits than production (e.g. Login/Cancel capped at 12 RPM per client_id), and submitted data is purged after a maximum of 3 months — treat it as disposable.

**Step-by-step: production**
1. Repeat the same flow at `mytax.hasil.gov.my` → **MyInvois** tab → Taxpayer Profile → **Register ERP**, generating a **separate** production client_id/secret pair (do not reuse sandbox credentials).
2. Point `MYINVOIS_BASE_URL` at `https://api.myinvois.hasil.gov.my` and flip `MYINVOIS_ENVIRONMENT` to production (remove/adjust the SANDBOX flag per whatever convention the app uses).
3. Obtain and install a production-grade **digital certificate** for document signing (see below) before submitting real, signed invoices — this is separate from the client_id/secret and is what makes the XML/JSON document itself legally valid.
4. If acting as an intermediary for multiple client taxpayers in production, each taxpayer must add your firm as an Intermediary on their own Taxpayer Profile (TIN/BRN, representation date range, permissions) before your single client_id/secret can submit `onbehalfof` them.

**Digital certificate for signing (not a GitHub secret, but a hard blocker)**
- Every submitted document must be digitally signed using **XAdES** (enveloped signature, SHA-256 hash, RSA signature, `xml-c14n11` canonicalization) with an **X.509** certificate.
- Certificate must be issued by a **Malaysian-licensed Certification Authority** (MCMC-approved list) — e.g. Digicert Sdn Bhd, MSC Trustgate, TM Applied Business, Raffcomm Technologies.
- Required cert fields: CN = company name, C = MY, O = company name, Organization Identifier = TIN, Serial Number = BRN (OU/E optional).
- Required extensions: Key Usage "Non-Repudiation", Enhanced Key Usage "Document Signing" (OID `1.3.6.1.4.1.311.10.3.12`).
- Two form factors: **soft certificate** (installed on the ERP server, ~RM 1,500 + 8% SST) or **roaming certificate** (for appointed tax agents/intermediaries serving multiple taxpayers, ~RM 15,000 + 8% SST). Validity is typically 1 year, extendable up to 3.
- Issuance lead time: **3–5 business days** through the CA (not instant like client_id/secret, which is self-service/immediate).
- If invoices are only ever keyed manually in the MyInvois portal UI (no API submission), the certificate may not be mandatory — but any API/ERP integration (i.e. this project) requires it.

**Cost, lead time & blockers**
- Client ID/secret: free, self-service, instant (both sandbox and production) — no external approval needed.
- Digital certificate: **RM 1,500–15,000 + SST**, 3–5 business days from a licensed Malaysian CA — this is the real lead-time and cost blocker, not the client credentials.
- Hard blocker for a non-Malaysian-registered company: you need a valid Malaysian **TIN** and BRN to register at all; a foreign entity without local tax registration cannot self-provision credentials.
- Intermediary model adds a coordination blocker: each represented taxpayer must explicitly add the intermediary in their own portal before that taxpayer's documents can be submitted.

**Official sources**
- https://sdk.myinvois.hasil.gov.my/faq/
- https://sdk.myinvois.hasil.gov.my/api/08-login-as-intermediary-system/
- https://sdk.myinvois.hasil.gov.my/api/07-login-as-taxpayer-system/
- https://sdk.myinvois.hasil.gov.my/integration-practices/
- https://sdk.myinvois.hasil.gov.my/signature/
- https://sdk.myinvois.hasil.gov.my/
- https://sdk.myinvois.hasil.gov.my/start/

---

## 19. Coretax / e-Faktur — Indonesia (DJP)

> **GitHub secrets:** `ID_CORETAX_CERTIFICATE`, `ID_CORETAX_CERT_PASSWORD`, `ID_CORETAX_CLIENT_ID`, `ID_CORETAX_CLIENT_SECRET`, `ID_CORETAX_BASE_URL` &nbsp;•&nbsp; **Live flag:** `ID_CORETAX_LIVE=1` (`ID_CORETAX_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** unclear — verify &nbsp;•&nbsp; **Repo status:** 🔴 missing

**What each secret is / where it comes from**
- `ID_CORETAX_CERTIFICATE` (base64) — the *sertifikat elektronik* (digital certificate) obtained through Coretax after requesting a "Kode Otorisasi DJP" / certificate, or issued by one of the 4 DJP-designated PSrE (Penyelenggara Sertifikasi Elektronik) providers: **Privy** (privy.id), **VIDA** (vida.id), **Vinotek** (vinotek.id), **Xignature** (xignature.co.id). Base64-encode the certificate file for storage.
- `ID_CORETAX_CERT_PASSWORD` — the passphrase created when requesting the certificate/authorization code (Coretax enforces ≥8 chars, at least one uppercase, one lowercase, one special character). Doubles as the e-signature passphrase.
- `ID_CORETAX_CLIENT_ID` / `ID_CORETAX_CLIENT_SECRET` — **not issued by DJP to ordinary taxpayers.** DJP publishes no self-service developer/OAuth portal. Programmatic ("Host-to-Host", H2H) submission is only available (a) to businesses formally appointed as a **PJAP** (Penyedia Jasa Aplikasi Perpajakan) by DJP decree, or (b) indirectly, by contracting an existing PJAP reseller (OnlinePajak, Mekari Klikpajak, Pajakku, Vinotek, etc.) whose own API these secrets would actually authenticate against.
- `ID_CORETAX_BASE_URL` — correspondingly this is very unlikely to be a DJP endpoint; Coretax itself (`coretaxdjp.pajak.go.id`) has no documented public REST API for third parties, so this must be set to whichever PJAP vendor's API base URL is chosen as the H2H channel.

**Prerequisites**: Indonesian NPWP (tax ID) + PKP status (Pengusaha Kena Pajak, VAT-registered), an activated Coretax account (login via NIK/NPWP), a sertifikat elektronik.

**Step-by-step: certificate + Coretax API onboarding**
1. Activate the Coretax account at `coretaxdjp.pajak.go.id` → "Aktivasi Akun Wajib Pajak" → enter NIK, email, registered phone → selfie verification → confirm.
2. Confirm/obtain NPWP and PKP (VAT-registered) status — required before e-Faktur can be issued at all.
3. Request the certificate: log in → "Portal Saya" → "Permintaan Kode Otorisasi/Sertifikat Elektronik" → choose "Kode Otorisasi DJP" (DJP's own basic signing code) or apply through one of the 4 PSrE providers (Privy/VIDA/Vinotek/Xignature) for a full sertifikat elektronik.
4. Set the passphrase (≥8 chars, upper/lower/special) → this becomes `ID_CORETAX_CERT_PASSWORD`.
5. Download the resulting certificate and base64-encode it → `ID_CORETAX_CERTIFICATE`.
6. For actual programmatic submission, pick a channel: **(a)** apply to DJP to become a PJAP yourself (see production steps — a multi-month formal process, not realistic for a business only invoicing on its own behalf), or **(b)** contract an existing PJAP vendor (OnlinePajak, Mekari Klikpajak, Pajakku, Vinotek) and use their API — `ID_CORETAX_CLIENT_ID`/`SECRET`/`BASE_URL` would then be that vendor's credentials/endpoint, obtained through their own commercial onboarding.
7. No public DJP sandbox for outside developers was found. Testing only happens inside DJP's internal UAT for PJAP applicants, or inside a chosen PJAP vendor's own (undocumented-to-us, vendor-specific) sandbox.

**Step-by-step: production**
1. Self-appointment as PJAP: submit a written request to DJP → 5-stage review — document completeness (~5 business days), business plan evaluation (~20 bd), technical pre-qualification (~10–30 bd), development-plan review (~30 bd, revisable), technical testing (~20 bd per iteration, up to 6 months total) → DJP issues a Keputusan Direktur Jenderal (Kepdirjen) granting H2H production access.
2. Via a PJAP vendor: complete their commercial contract/KYC, receive production API credentials from them, point `ID_CORETAX_CLIENT_ID/SECRET/BASE_URL` at their production endpoint.
3. Either way: e-Faktur data must sync back into Coretax within 2 days; transaction codes 06 (sales to foreign passport holders) and 07 (VAT-exempt/government-borne), centralized-VAT PKPs, and any PKP newly registered after 1 Jan 2025 are restricted to Coretax/PJAP channels only (cannot use offline e-Faktur Desktop).
4. Certificate renewal: the sertifikat elektronik has a PSrE-set expiry — must be renewed through the same Coretax/PSrE flow before it lapses or signing will fail.

**Cost, lead time & blockers (API access is evolving/limited)**
- PJAP self-appointment: heavy — requires an Indonesian legal entity with ≥51% local ownership, PKP status, 3 years of clean annual filings + 12 months clean monthly filings, no tax/IT-crime convictions, Indonesia-hosted infrastructure, signed SLA; review alone can run to 6 months by DJP's own published stage estimates. Not realistic for a SaaS wanting to only submit its own invoices.
- PJAP-vendor path: fastest realistic route for a normal business — cost/lead time set by the vendor (OnlinePajak, Mekari Klikpajak, Pajakku, Vinotek…), not published by DJP.
- The certificate/authorization-code step itself is quick (days) once the Coretax account is identity-verified; DJP's own "Kode Otorisasi" tier has no stated fee, but PSrE-issued full certificates may carry provider fees not disclosed on official DJP pages.
- **Biggest blocker / most evolving part**: DJP has **no public developer portal, API reference, or sandbox** for direct third-party integration post-Coretax rollout (Jan 2025). "API access" is entirely gated behind either becoming a DJP-designated PJAP or paying an existing PJAP to act as the integration middleman — the opposite of the self-service `CLIENT_ID`/`CLIENT_SECRET`/`BASE_URL` client-credentials model the current secret names imply. Before wiring these secrets, confirm which PJAP vendor (if any) is the actual intended downstream — `ID_CORETAX_BASE_URL` almost certainly needs to be that vendor's endpoint, not a DJP one.

**Official sources**
- https://pajak.go.id/en/node/118895 (Coretax account activation + "Kode Otorisasi/Sertifikat Elektronik" request steps)
- https://www.pajak.go.id/en/node/107868 (Coretax DJP overview)
- https://pajak.go.id/en/node/115238 (e-Faktur Desktop reactivation KEP-54/PJ/2025 — the 3 channels: Coretax / e-Faktur Desktop / PJAP Host-to-Host, and Coretax-only exceptions)
- https://pajak.go.id/en/node/62931 (Penyedia Jasa Aplikasi Perpajakan (PJAP) — appointment process, 5-stage review, requirements; confirms no public API/sandbox is documented)
- https://ikpi.or.id/en/djp-tunjuk-4-penyedia-sertifikat-elektronik-untuk-akses-layanan-coretax/ (the 4 DJP-designated PSrE certificate providers: Privy, VIDA, Vinotek, Xignature)

---

_Guide généré via recherche par plateforme (sources officielles citées par section). Statuts secrets vérifiés le 2026-07-12._
