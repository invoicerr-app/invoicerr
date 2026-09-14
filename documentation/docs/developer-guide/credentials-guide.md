---
sidebar_position: 11
---

# E-Invoicing Credentials Guide

> Step-by-step guide for obtaining the credentials of every e-invoicing platform the
> project can transmit to. **The deployed app takes these per-tenant in each company's
> settings (stored encrypted in the DB) — env vars / GitHub secrets are only for the live CI
> tests.** Generated 2026-07-12; each section was researched against official sources (listed
> inline). Revised 2026-09-13 to remove sections for channels no longer in this codebase.

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
  cross-border, which also carries Germany's XRechnung B2G content — see
  [Live Testing](./live-testing.md)).

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

Legend — **Repo:** ✅ set · 🟡 partial · 🔴 missing

| # | Platform | Country | Repo | Realistic effort / hardest blocker |
|--:|----------|---------|:----:|------------------------------------|
| 1 | KSeF | 🇵🇱 Poland | ✅ | Already set. Token auth sunsets end-2026 → certificate path later |
| 2 | PDP (superpdp) | 🇫🇷 France | 🟡 | Sandbox set; routing IDs optional; prod = commercial PDP contract |
| 3 | Chorus Pro (PISTE) | 🇫🇷 France | ✅ | Qualification round-trip proven live 2026-09-14 (deposit reached terminal `IN_INTEGRE`); production needs a dedicated production PISTE app + Chorus Pro production raccordement, neither attempted |
| 4 | SdI (SDICoop/SDIFTP) | 🇮🇹 Italy | 🔴 | Partita IVA on Entratel + channel accreditation (collaudo) |
| 4bis | SdI via PEC | 🇮🇹 Italy | 🔴 | No accreditation at all — only blocker is provisioning a PEC mailbox |
| 5 | Peppol | 🌍 cross-border | ✅/🔴 | peppol.sh live-proof harness proven zero-secret; generic AP (the only one production sends through) = commercial AP account + SMP |

This project's channels are the five numbered above, matching the five countries it supports
(FR/PL/IT/PT/DE) plus cross-border Peppol, plus #4bis — the SAME Italian Sistema di Interscambio as #4,
reached over a certified-email mailbox instead of the accredited web service — see
`backend/src/modules/documents/transports/` and `reporting/providers/` on disk.

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
`backend/src/modules/documents/signing/registry.ts`.

**Per-portal test parameters** — `*_COUNTRY`, `*_SELLER_VAT`, `*_BUYER_VAT`, `*_TAXPAYER_ID`
are **not credentials**; they're the identifiers the live test invoice is issued with. Use the
sandbox/test entity's own IDs (e.g. the CUIT/CNPJ/NIP tied to your test certificate). They only
matter for the country whose live leg you actually run.

---

## 1. KSeF — Poland (national clearance / B2B mandatory)

> **GitHub secrets:** `KSEF_AUTH_TOKEN`, `KSEF_NIP` &nbsp;•&nbsp; **Live flag:** `KSEF_LIVE=1` &nbsp;•&nbsp; **Sandbox:** yes (ksef-test) &nbsp;•&nbsp; **Repo status:** ✅ already set — the secrets exist in CI (confirmed by name, not value); see `live-testing.md`'s own KSeF row for why "set" is not the same claim as "proven today"

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

> **GitHub secrets:** `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET`, `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING` &nbsp;•&nbsp; **Live flag:** `PDP_LIVE=1` &nbsp;•&nbsp; **Sandbox:** yes (superpdp) &nbsp;•&nbsp; **Repo status:** ✅ mostly set (routing optional)

**What each secret is / where it comes from**
- `PDP_BASE_URL` — the PDP's API root, e.g. `https://api.superpdp.tech` (SuperPDP's sandbox/prod endpoint; other PA vendors each publish their own).
- `PDP_CLIENT_ID` / `PDP_CLIENT_SECRET` — an OAuth2 client-credentials pair. On SuperPDP these are created per test *enterprise* under **Applications → New Application**, are enterprise-scoped (a `seller_client_id`/`seller_client_secret` pair and a separate `buyer_client_id`/`buyer_client_secret` pair when testing both sides of a flow), and are shown **only once** at creation time. Token endpoint: `https://api.superpdp.tech/oauth2/token`.
- `PDP_API_STYLE` — the underlying `PdpClient` (`backend/src/modules/documents/transports/pdp/pdp-client.ts`, `PdpApiStyle = 'superpdp' | 'afnor'`) can speak either SuperPDP's proprietary REST "API Flux" or the AFNOR **XP Z12-013** interoperability API (standardized May 2025, meant to work identically across any conformant PA) — but **nothing in this codebase currently reads this env var or wires it from config**: the production transport (`pdp-transport.ts`) and every live spec hardcode `apiStyle: 'superpdp'`. There is no separate AFNOR live test today.
- `PDP_SELLER_ROUTING` / `PDP_BUYER_ROUTING` — optional routing identifiers used for **annuaire** (directory) lookups, i.e. which PA a given counterparty is registered with. These are SIREN/SIRET-based identifiers of the seller/buyer companies (see `pdp-client.ts` "SuperPDP French Directory (annuaire routing)"); without them the client falls back to direct routing to the configured `PDP_BASE_URL`.
- `PDP_LIVE=1` — feature-flags the real network round-trip in two Jest specs: `pdp.live.spec.ts` (the deposit itself) and `pdp-conformity.live.spec.ts` (the post-deposit conformity poller, DB-connected); unset, those tests stay mocked.

**Prerequisites**
- A French **SIREN/SIRET** (real or fictional-but-well-formed for sandbox) to register a test "enterprise" on the sandbox PA.
- A choice of PA: the project already targets **SuperPDP** (sandbox) for both API styles. For AFNOR-style testing against a *different* PA, that PA must also have shipped its own AFNOR (XP Z12-013) endpoint — as of the SuperPDP announcement, this is still rolling out ("API Flux" available now, "API Annuaire" was "coming soon").
- Production use requires the chosen platform to be **immatriculée** (registered) by the DGFiP as a Plateforme Agréée (PA, formerly called PDP) — see below.

**Step-by-step: getting superpdp sandbox credentials**
1. Go to `https://www.superpdp.tech/` and create a free account.
2. Create one or more **test enterprises** (fictional companies with a SIREN-like identifier) inside the sandbox.
3. Go to **Applications → New Application**, select the enterprise from the dropdown, click **Create**.
4. Copy the generated `client_id` / `client_secret` immediately — they are shown only once. Repeat for a second enterprise if you need to test both seller and buyer sides of a flow (`seller_client_id`/`seller_client_secret` + `buyer_client_id`/`buyer_client_secret`).
5. Set `PDP_BASE_URL=https://api.superpdp.tech` and `PDP_CLIENT_ID`/`PDP_CLIENT_SECRET` from step 4 (this codebase always speaks SuperPDP's proprietary "API Flux" — see the `PDP_API_STYLE` note above for why the AFNOR alternative isn't currently reachable through it).
6. Full technical/API reference: `https://www.superpdp.tech/documentation/` and `https://www.superpdp.tech/openapi/` (the exact in-page mechanics of the "New Application" flow were confirmed via a third-party forum walkthrough, not directly scraped from superpdp.tech, which renders as a JS app — see note below).
7. Optional: set `PDP_SELLER_ROUTING` / `PDP_BUYER_ROUTING` to the test enterprises' SIREN-based identifiers to exercise annuaire routing instead of direct base-URL routing.

Note: superpdp.tech's own pages are a client-rendered SPA — automated fetches of `/documentation/` and `/openapi/` returned only page titles, no body HTML. The signup-flow specifics above come from a third-party (Ubuntu-fr forum) walkthrough that quotes the documentation's step text; verify against the live site during actual onboarding.

**Step-by-step: choosing/onboarding a production PDP (now called Plateforme Agréée, PA)**
1. Consult the official DGFiP registry of registered platforms: `https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees` (also referenced as `https://www.impots.gouv.fr/liste-des-plateformes-de-dematerialisation-partenaires-pdp-immatriculees-sous-reserve`), reached from `https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees`. As of ~July 2026 there are ~137 registered PAs (status "sous réserve" = provisional pending conformance tests, or "définitif" once conformance tests are passed and reported to the DGFiP).
2. Pick a PA that offers the API style you need (proprietary vs AFNOR/XP Z12-013) and supports the invoice formats you produce (Factur-X, UBL, CII). SuperPDP is one option and is itself DGFiP-registered (positions itself as "the simplest and cheapest PA").
3. Sign a contract / onboarding agreement with that PA (each vendor's own commercial process — not a government step). Registration is valid 3 years, renewable.
4. If instead your own product wants to *become* a PA (not applicable here, but for completeness): apply via `https://demarche.numerique.gouv.fr/commencer/immatpdp` (Démarches Simplifiées), submitting SIREN + Kbis extract (less than 3 months old), legal representative ID, a valid ISO/IEC 27001 certificate covering the relevant systems, GDPR compliance docs, and technical specs for transmission/security. Contact: `immat.pdp@dgfip.finances.gouv.fr`.
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

> **GitHub secrets:** `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` &nbsp;•&nbsp; **Live flag:** `CHORUSPRO_LIVE=1` (`CHORUSPRO_ENVIRONMENT=SANDBOX`) &nbsp;•&nbsp; **Sandbox:** yes (qualification) &nbsp;•&nbsp; **Repo status:** ✅ full qualification round-trip proven live 2026-09-14 — deposit reached the terminal authority state `IN_INTEGRE`; production never attempted

**Full qualification round-trip PROVEN LIVE, 2026-09-14.** Both credential layers now exist — a PISTE
OAuth application AND a Chorus Pro "compte technique", both obtained without any real company (see
Prerequisites below) — and a real Factur-X deposit went all the way to a terminal authority state,
read directly off `consulterCRDetaille`:

```
CPP0011117000000000425903   IN_INTEGRE   listeErreurDP=[]   2026-09-14T22:57:02+02:00
```

Getting there took three iterations, each one a real product defect found only by trying: two
deposits (`...425895`, `...425899`) were REJECTED before `...425903` was accepted and later polled
into `IN_INTEGRE` — a wrong BT-23 "cadre de facturation" value colliding with the 2026 CGI-reform
one, a recipient SIRET wrongly truncated to its SIREN, and a hardcoded (rather than company-derived)
payment-means code. See commits `67a94d58`, `7de5a90c`, `ecce4d35` for the sourced detail of each.

**What this DOES prove:** PISTE OAuth authentication; a Chorus Pro deposit accepted past both the
synchronous gate and the asynchronous validation; the deposit reaching the terminal `IN_INTEGRE`
state. **What this does NOT prove:** production — this checkout has no production PISTE application
and no production Chorus Pro raccordement, everything above ran under
`CHORUSPRO_ENVIRONMENT=SANDBOX` qualification — or anything in the invoice's life AFTER
`IN_INTEGRE`: a real public buyer's own downstream processing (`MISE_A_DISPOSITION`, `MANDATEE`,
`MISE_EN_PAIEMENT`…) has never been exercised, because qualification has no real public buyer to do
it with.

One measurement worth keeping in mind while hunting a bad credential: PISTE returns the SAME
`400 invalid_client` for an unknown `client_id` and for a valid one with a wrong secret — the two
responses are byte-identical (measured 2026-09-14). Nothing short of a successful token proves a
pair is good.

A separate, real gap this round-trip surfaced — and which has SINCE been fixed, same day, worth
flagging here rather than only in code: `mapChorusProStatus` (`choruspro-client.ts`) used to
recognize ONLY the BARE values inherited from the pre-refonte reference client (`VALIDE`, `REJETE`,
`DEPOSE`, …) — every value actually observed live carries an `IN_` prefix instead
(`IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP`, `IN_REJETE`, `IN_INTEGRE`), none of which matched,
so they all fell through to the function's own `PENDING` default: a real rejection silently read as
pending, forever, and the real terminal success never read as CLEARED. Now fixed: `mapChorusProStatus`
recognizes all three `IN_`-prefixed values (confirmed by this exact round-trip, not by any published
enumeration — the official Swagger declares no `enum` for `etatCourantDepotFlux`, and AIFE's own EDI
annex documents a *different* status mechanism, the older `CPPStatut`/`AIFE_Statut` push formats, not
this one), and a value it still does not recognize now maps to its own `UNKNOWN` outcome — never
silently `PENDING` again — persisted-logged by `chorus-pro-status-poller.ts#poll()` every time it is
observed. See `mapChorusProStatus`'s own doc comment for the full detail.

**What each secret is / where it comes from**

Two *completely separate* systems issue these four values — mixing them up is the #1 support question in the Chorus Pro community:

- **`CHORUSPRO_CLIENT_ID` / `CHORUSPRO_CLIENT_SECRET`** → come from **PISTE** (piste.gouv.fr, AIFE's shared government-API gateway that has hosted all Chorus Pro API access since Jan 2021, replacing the old certificate auth). Inside a PISTE **application**, the config screen has two distinct panels that look similar and get confused:
  - **"API Keys"** — a generic per-API key used by *some other* PISTE-hosted APIs that don't do OAuth. **Not what Chorus Pro uses.**
  - **"OAuth Credentials" / Authentication tab** — shows a `Client ID` (UUID) and a `Secret Key` (revealed via a "view/regenerate client secret" button). **This is the pair you want.** It's used with the OAuth2 `client_credentials` grant against `oauth.piste.gouv.fr` (sandbox: `sandbox-oauth.piste.gouv.fr`) to obtain a short-lived Bearer token before every Chorus Pro API call.

  That the Chorus Pro API is OAuth2-only — never an API-key plan — is **established, not assumed**.
  Three concordant sources plus one live measurement (2026-09-14):
  - AIFE's own migration notice: *"à compter du 1er janvier 2021, le mode d'authentification par
    certificat ne sera plus accepté. Seuls les appels API en mode Oauth2 seront possibles."*
    (`communaute.chorus-pro.gouv.fr/raccordement-a-chorus-pro-en-api-le-passage-sur-piste-devient-obligatoire/`)
  - The PISTE sandbox catalog entry for this exact API (`api_rfa: cpro.factures`) carries
    `url_oauth_sdbx: sandbox-oauth.piste.gouv.fr` and no API-key field; no entry on that page has one.
  - The official developer guide's own curl recipe sends exactly the two headers this repo's client
    sends (`Authorization: Bearer`, `cpro-account`) and no key header.
  - Measured: `POST https://sandbox-api.piste.gouv.fr/cpro/factures/v1/consulter/cr` with no auth
    answers `400` with `WWW-Authenticate: Bearer realm="DefaultRealm", error="invalid_request",
    error_description="Unable to find token in the message"` — a Gravitee OAuth2 policy challenge.
    An API-key plan would complain about a missing key, not challenge for a Bearer token.

  The sandbox OAuth host above was **corrected** here: this section previously named
  `sandbox-oauth.aife.economie.gouv.fr`, which does not resolve. `choruspro-client.ts`'s own header
  records the same correction.
- **`CHORUSPRO_TECH_LOGIN` / `CHORUSPRO_TECH_PASSWORD`** → come from Chorus Pro itself (the "**compte technique**", created inside the Chorus Pro portal, *not* PISTE). It exists purely so external systems can call the API — it cannot log into the Chorus Pro web portal. Login format looks like `TECH_n_xxxxxx@cpro.fr`; the password is auto-generated and shown **once**. This login:password pair is base64-encoded and sent as a `cpro-account` HTTP header on every API call — it's a second, independent layer of auth stacked on top of the PISTE OAuth Bearer token. It must be rotated by the org's Manager every 424 days (~14 months).

So a real Chorus Pro API call needs **both**: a PISTE OAuth Bearer token (CLIENT_ID/SECRET) **and** the `cpro-account` header (TECH_LOGIN/PASSWORD).

**Prerequisites**

- A **structure** on the Chorus Pro portal, identified by a SIRET, with a user holding the
  **"Gestionnaire principal"** role — only that role can create or reset a technical account.

  **In qualification, neither the company nor the SIRET has to be real, and this is the point that
  unblocks the whole channel.** The qualification space generates a fictitious dataset for you — a
  supplier structure with its own SIRET and its own Gestionnaire principal account. AIFE's own
  step-by-step says so: *"Descendez jusqu'au bloc **Mon matelas de données** et cliquez sur le bouton
  **Créer** […] Notez les LOGIN compte GP et le Mot de passe Compte GP, de la structure fournisseur
  partenaire de votre jeu de données […] Notez également **son SIRET (fictif)** : c'est ce dernier que
  vous utiliserez pour votre raccordement."*
  (`communaute.chorus-pro.gouv.fr/espd-connection-at-qualification-space/`)

  Even the PISTE signup asks for no SIRET for this usage — AIFE's setup sheet says to pick
  `Universelle` as the organisation name. A real SIRET is required only at the **production**
  raccordement. Earlier revisions of this section stated a real SIRET'd structure was needed at all;
  that was wrong, and it is what made this channel look blocked for anyone without a French company.
- A PISTE account (free, self-service signup).
- For production later: the same steps repeated in a dedicated production PISTE application + a production "raccordement" declaration — out of scope while `CHORUSPRO_ENVIRONMENT=SANDBOX`.

**Step-by-step: creating a PISTE account + OAuth application (sandbox)**
1. Go to `https://piste.gouv.fr/registration` ("Créer un compte"). Fill name, email (becomes your login), password (≥12 chars, upper+lower+digit+special), accept the CGU checkbox. Click the activation link emailed to you within 5 days (AIFE deletes unactivated accounts after that).
2. Log in and open **"Mes applications"** (`https://piste.gouv.fr/apps`). PISTE auto-provisions one application named `APP_SANDBOX_<your-email>` — this is your qualification-environment app; you don't create it manually.
3. Open the API catalog at `https://piste.gouv.fr/api-catalog-sandbox` and locate the Chorus Pro APIs (**Factures**, **Structures**, **Utilisateurs**, **Transverses** — plus `FacturesTravaux`/`Engagements` if needed). Each API is listed twice — Sandbox and Production — click **"Demander l'accès"** on the Sandbox versions.
4. Back in the sandbox application, click **"Modifier l'application"**, check the CGU box for each Chorus Pro API you selected, click **"Valider mes choix CGU"**, then **"Sauvegarder l'application"**.
5. Open the application's **Authentication / OAuth Credentials tab** (not the separate "API Keys" list) and copy the **Client ID** and **Secret Key** (click "view client secret" to reveal it). These are `CHORUSPRO_CLIENT_ID` and `CHORUSPRO_CLIENT_SECRET`.

**Step-by-step: creating the Chorus Pro technical account + subscribing to the Chorus Pro API on PISTE**
1. Create an account on the qualification portal (`chorus-pro.gouv.fr/qualif/`), then generate a
   **"matelas de données"** from it — that is what gives you a supplier structure, its fictitious
   SIRET, and the **Gestionnaire principal** login you need for the next steps. No real company and
   no real SIRET are involved (see Prerequisites above for the official wording).
2. In the Chorus Pro portal, open **"Raccordement EDI et API"** → tab **"Gérer raccordement API"** → click **"Déclarer un raccordement PISTE"**. Fill in: the structure, the PISTE sandbox application name (`APP_SANDBOX_...` from step above), usage type, and a technical contact.
3. Still in the portal, create the technical account: choose request type **"Création d'un compte technique"**, then **"Choisir la structure"**. Chorus Pro auto-generates a **login** and **password**, shown once on screen — save immediately. This is `CHORUSPRO_TECH_LOGIN` / `CHORUSPRO_TECH_PASSWORD`. The account activates ~30 minutes later; a confirmation email "[Chorus Pro] Création du compte utilisateur technique" follows.
4. At call time, base64-encode `login:password` and send it as the `cpro-account` header alongside the PISTE OAuth Bearer token on every request to the Chorus Pro sandbox API host.
5. Only when qualification testing passes: repeat both the PISTE step (create a dedicated **production** application via "créer une application") and the Chorus Pro step (production raccordement + a second technical account) — not needed now since the repo runs `CHORUSPRO_ENVIRONMENT=SANDBOX`.

**Cost, lead time & blockers**
- Both PISTE and Chorus Pro are free state services — no pricing found anywhere in AIFE/PISTE/community docs; this is the mandatory, no-cost B2G invoicing channel.
- Lead time: PISTE account email-activation is near-instant but community guidance mentions up to 24–48h AIFE-side delay in some cases; Chorus Pro technical-account creation is effective ~30 minutes after request.
- Current repo blocker: **none for qualification** — both credential layers exist and a deposit has
  reached the terminal `IN_INTEGRE` state (see above). The whole path was self-service and needed
  **no real company** (see Prerequisites) — a PISTE account for the OAuth pair, then a qualification
  account whose "matelas de données" supplied the structure, the fictitious SIRET and the
  Gestionnaire principal that created the technical account. The only remaining blocker is
  **production**: a dedicated production PISTE application plus a production Chorus Pro
  raccordement, neither attempted.
- Common trap to flag in the setup guide: picking the wrong credential panel in PISTE ("API Keys" vs "OAuth Credentials") — Chorus Pro only accepts the OAuth Credentials pair.

**Official sources**
- https://piste.gouv.fr/registration
- https://piste.gouv.fr/apps
- https://piste.gouv.fr/api-catalog-sandbox
- https://communaute.chorus-pro.gouv.fr/documentation/piste-presentation/?lang=en
- https://communaute.chorus-pro.gouv.fr/chorus-pro-piste-comment-reussir-son-raccordement-api-oauth2/?lang=en
- https://communaute.chorus-pro.gouv.fr/raccordement-a-chorus-pro-en-api-le-passage-sur-piste-devient-obligatoire/?lang=en
- https://communaute.chorus-pro.gouv.fr/quest-ce-que-le-compte-technique-sur-chorus-pro/?lang=en
- https://communaute.chorus-pro.gouv.fr/espd-connection-at-qualification-space/?lang=en — the
  "matelas de données" procedure, and the source for the fictitious SIRET quoted above
- https://communaute.chorus-pro.gouv.fr/documentation/aides-aux-developpeurs-api-en-mode-oauth2/ —
  the official curl recipe, header for header what `choruspro-client.ts` sends
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
- Re-verified on 2026-09-01 against https://www.fatturapa.gov.it/it/sistemainterscambio/ (sections
  «Accreditamento al Sistema di Interscambio» and «sperimentazione»): the procedure above is still
  accurate — accreditation portal https://accreditamento.fatturapa.gov.it/, the test environment
  «rimane disponibile permettendo la trasmissione e/o la ricezione dei file come se fosse in
  produzione ma privi di valore legale» (remains available, allowing files to be sent and/or
  received as if in production but without legal value), test recipient codes under «Test di
  interoperabilità - Gestione test interoperabilità», and a daily file limit in test.
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

## 4bis. SdI via PEC — Italy (no accreditation required)

> **GitHub secrets:** none — connected per company through the settings screen ("sdi-pec" channel), the same encrypted `CompanyChannelConfig` mechanism every other transport uses &nbsp;•&nbsp; **Live flag:** `PEC_LIVE=1` &nbsp;•&nbsp; **Sandbox:** no — any real PEC mailbox works &nbsp;•&nbsp; **Repo status:** 🔴 missing (no PEC mailbox provisioned) &nbsp;•&nbsp; **Code status:** implemented-awaiting-credentials

**Why this exists, distinct from section 4 above**: SDICoop/SDIFTP need the FULL accreditation
procedure in section 4 (Entratel/Fisconline, CSRs, AdE-issued client certificate). The PEC route needs
NONE of it — confirmed on fatturapa.gov.it's own "Inviare la FatturaPA" page: «L'utilizzo del canale
PEC non presuppone alcun tipo di accreditamento preventivo presso il Sistema di Interscambio.» Any
sender with a PEC (Posta Elettronica Certificata) mailbox — obtainable from any AgID-listed PEC
provider, an ordinary commercial purchase, no government relationship required — can email the
FatturaPA XML straight to SdI. See `backend/src/modules/documents/transports/sdi-pec/pec-protocol.ts`'s
own header for the full citation trail (exact URLs, dates read, verbatim Italian quotes) this section
summarizes.

**What connecting the "sdi-pec" channel requires** (company settings → Channels → SdI via PEC, or the
GitHub secrets above for the live spec):

- `PEC_ADDRESS` — this company's own PEC mailbox address (used as the SMTP envelope/header From).
- `PEC_SMTP_HOST`/`PEC_SMTP_PORT`/`PEC_SMTP_SECURE` — the PEC provider's own SMTP submission endpoint.
- `PEC_IMAP_HOST`/`PEC_IMAP_PORT`/`PEC_IMAP_SECURE` — the same mailbox's IMAP endpoint, drained for
  SdI's own replies (`transports/sdi-pec/pec-inbox-poller.service.ts`).
- `PEC_USERNAME`/`PEC_PASSWORD` — the mailbox's own SMTP/IMAP credentials (commonly the PEC address
  itself as username).
- `PEC_ID_TRASMITTENTE` — same concept, same shape, as `SDI_ID_TRASMITTENTE` above (the `IdPaese`+fiscal
  id stamped in the FatturaPA header and used to build the PEC attachment's own filename).

There is no `sdiReplyAddress` to configure by hand: the two-step addressing rule fatturapa.gov.it
documents (first submission to `sdi01@pec.fatturapa.it`, every later one to whatever address SdI
replies from) is LEARNED automatically once a first reply has been observed — see
`pec-notifiche.service.ts`'s own header.

**Cost, lead time & blockers**: a PEC mailbox is a same-day, low-cost commercial purchase from any
AgID-listed provider — no accreditation, no CSR, no waiting on Agenzia delle Entrate. The only real
blocker for THIS project today is that no PEC mailbox has actually been provisioned yet — see
`documentation/docs/developer-guide/live-testing.md`'s own PEC row for the current live-testing status.

**Official sources** — see `pec-protocol.ts`'s own header for the full verbatim citations; summarized
here:
- https://www.fatturapa.gov.it/it/comefare/operatori-economici/inviare-la-fatturapa/ (the PEC address,
  the 30 MB size limit, the two-step addressing rule, "no accreditation" statement)
- https://www.fatturapa.gov.it/export/documenti/Specifiche_tecniche_SdI_v1.8.1.pdf (§2.2 filename
  convention, §3.1.1 PEC channel rules, §5.1.1 malformed/duplicate-name rejection codes)
- https://www.fatturapa.gov.it/it/sistemainterscambio/file-fatture-e-messaggi/ (the eight message
  kinds SdI sends back, channel-agnostic)

---

## 5. Peppol — cross-border (Access Point network)

> **GitHub secrets (generic AP):** `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` &nbsp;•&nbsp; **Live flag:** `PEPPOL_LIVE=1` (`PEPPOL_ENV=TEST`) &nbsp;•&nbsp; **Sandbox:** yes (peppol.sh, zero-secret) &nbsp;•&nbsp; **Repo status:** ✅ peppol.sh proven (no secret) / 🔴 generic AP missing

**What each secret is / where it comes from**

- `PEPPOL_PARTICIPANT_ID` — your own Peppol address, format `scheme:id` (e.g. `0208:0123456789` BE enterprise number, `9925:BE0441797980` BE VAT, `0088:xxxxxxxxxxxxx` GS1 GLN, `0002:xxxxxxxxx` FR SIRENE, `9930:DExxxxxxxxx` DE VAT). You don't invent this — your Access Point assigns/registers it for you against your business/VAT number when you onboard.
- `PEPPOL_AP_URL` — the base REST/API URL of the generic Access Point gateway you've contracted with (repo's generic adapter model: `accessPointUrl` + `apiKey`, REST gateway in front of the AP's AS4/ebMS3 stack).
- `PEPPOL_API_KEY` — the API key that AP issues once you have an account with them.
- `PEPPOL_RECEIVER_ID` — the counterpart's Peppol participant ID (`scheme:id`) for the specific test transaction (in production this is looked up per-invoice via SMP/directory, not a fixed secret — it's fixed here only for the live-gated test fixture).
- peppol.sh path needs **no GitHub secret**: `PEPPOL_SH_API_KEY` (`ps_test_…` / `ps_live_…`) and `PEPPOL_SH_COMPANY_ID` (`com_…`) are optional overrides — when absent, `peppol-sh.live.spec.ts` self-signs-up against the public sandbox and creates its own throwaway company, proving the round-trip with zero pre-provisioned credentials.

**Route A — peppol.sh sandbox (zero cost, what the project uses)**
1. No dashboard, no credit card: `POST https://api.peppol.sh/v1/signup` with `{email}` returns `201 {id, api_key}` instantly — the key is prefixed `ps_test_` (sandbox).
2. `POST {sandbox.peppol.sh}/v1/companies` with `{name, tax_id, country, address}` (auth: `Authorization: Bearer <api_key>`) → `201 {id: com_…}` — this `com_…` is `PEPPOL_SH_COMPANY_ID`.
3. Sandbox calls must hit `sandbox.peppol.sh` (not `api.peppol.sh` — sandbox keys get `403 wrong_environment` there); invoices are delivered by email instead of the real network, same code path (`ublToPeppolShDocument` → `POST /v1/documents` → poll `GET /v1/documents/:id`).
4. To go live: `POST /v1/account/kyc` with company/identity details; once approved you can mint a `ps_live_` key, and `api.peppol.sh` then routes onto the real Peppol network.
5. Pricing (peppol.sh site): pay-per-document, from €0.10/invoice, no monthly minimum; sandbox is free forever.
6. Repo proof: `backend/src/modules/documents/transports/peppol/peppol-sh.live.spec.ts`, gated by `PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh`, self-signs-up when `PEPPOL_SH_API_KEY`/`PEPPOL_SH_COMPANY_ID` are absent — proven live 2026-09-02 in this architecture (`BE` sending companies round-trip to `DELIVERED`; `FR` still fails at signup with `invalid_country` — see [Live Testing](./live-testing.md) for the full raw result). An older 2026-07-11 proof predates this architecture and is kept there only as superseded history. Wired in `.github/workflows/compliance-live.yml` with `PEPPOL_AP_PROVIDER: 'peppol-sh'` set as a plain env constant, not a secret.

**Route B — connecting through a real/commercial Access Point**

Production sends only through the **generic** Access Point adapter (`peppol/peppol-client.ts`) — there
is no per-company adapter selector in this architecture; a company simply supplies the four credentials
below for whichever AP it has an account with (Ecosio, Pagero/Tickstar, Unimaze, or a self-hosted
phase4/oxalis-ng). `peppol-sh` is not selectable in production — it exists solely as the DB-free
live-proof harness Route A above describes.

1. Sign up for an account with a commercial Access Point.
2. Generate an API key in the AP's dashboard — this becomes `PEPPOL_API_KEY`.
3. Register your **legal entity**: submit company name, address, country, and a public identifier (VAT / Chamber-of-Commerce number) for validation with the AP.
4. Create a **Peppol identifier** (participant ID) tied to that legal entity — this is `PEPPOL_PARTICIPANT_ID`. The AP does the SMP registration on your behalf; you never register directly with Peppol/OpenPeppol.
5. Submit invoices via the AP's REST API. The repo's generic adapter models this as `accessPointUrl` + `apiKey`, with a local SMP/SML DNS pre-check (`DnsSmpLookup`) to confirm the receiver is registered before send.
6. `PEPPOL_RECEIVER_ID` is the counterpart's participant ID — normally resolved per-invoice (buyer directory / SMP lookup), fixed only as a static secret for a future live-gated CI test (none exists yet for this route — see below).

**Prerequisites** (do you need to BE a certified AP, or just a sender through one? SMP registration)

- **Almost every business only needs to be a Peppol *participant*, sending through an AP — not become an AP itself.** Registration/SMP is done *for* you by whichever AP you sign up with; you cannot register directly with the Peppol network yourself.
- Becoming a certified Access Point / Service Provider yourself (self-hosting corner 2/3) requires: OpenPeppol membership, an ISO 27001 certificate, meeting the Peppol Authority Specific Requirements (PASR), a due-diligence review (solvency, legitimacy, background checks on senior staff), and three stages of technical testing (unit → OpenPeppol testbed → interoperability) before OpenPeppol issues certification. This is the path Storecove/peppol.sh already went through so you don't have to.

**Cost, lead time & blockers**

- peppol.sh sandbox: €0, instant, no approval — already proven. Going live needs a KYC submission (identity/company verification) before a `ps_live_` key is issued; no fixed lead time published.
- Commercial AP as a sender: no OpenPeppol certification needed, no implementation fee typically; legal-entity validation ~1 business day; ongoing cost is per-document (vendor-specific pricing).
- Becoming your own certified Access Point (not needed for this project): OpenPeppol sign-up fees €1,025–€5,000 + annual €1,800–€9,100 depending on org size and AP-only vs AP+SMP scope (2025 fee schedule), plus months of certification testing — explicitly the path the project is avoiding.
- **Blocker for Route B here:** no generic-AP account/credentials exist yet, and no live spec has been written for this route — `PEPPOL_PARTICIPANT_ID` / `PEPPOL_AP_URL` / `PEPPOL_API_KEY` / `PEPPOL_RECEIVER_ID` are all unset; someone must pick a commercial AP and complete legal-entity + Peppol-ID registration to unblock live testing of the generic adapter.

**Official sources**
- https://peppol.sh/
- https://peppol.sh/for/nextjs
- https://docs.peppol.eu/edelivery/codelists/old/v8.5/Peppol%20Code%20Lists%20-%20Participant%20identifier%20schemes%20v8.5.html
- https://peppol.org/join/fees-2025/

---

_Guide generated via per-platform research (official sources cited per section). Secret statuses
verified 2026-07-12. Revised 2026-09-13: only the KSeF/PDP/Chorus Pro/SdI/Peppol sections were
kept, updated to the five-country scope (FR/PL/IT/PT/DE) — see [Live Testing](./live-testing.md)
for the current channel status._
