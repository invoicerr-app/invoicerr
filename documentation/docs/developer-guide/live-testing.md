---
sidebar_position: 10
---

# Live Testing Guide

All live tests are **SKIPPED by default** in CI and in any offline run. They are opt-in:
only when the channel-specific flag is set to `1` **AND** the required credential env vars
are present does the suite actually run — otherwise `describe.skip` fires silently.

The shared gate helper is at:
`backend/src/modules/documents/transports/live-gate.ts`

Hard-success contract (enforced per-spec):
- A `REJECTED` or `SKIPPED` transmission result **fails** the test (not tolerates it).
- An empty or missing authority reference/id **fails** the test.
- Async portals must reach `CLEARED` within the specified poll window.

---

## Channel summary

**Status legend — three different claims, kept visually distinct:**
- ✅ **Proven live (dated)** — a real round-trip against the real authority/network/sandbox, actually
  run and verified by reading the platform's own response, not merely a green mocked test.
- 🟡 **Implemented, awaiting credentials/accreditation** — the code exists and is ready to run, but the
  full round-trip has never actually happened in this architecture (missing token, certificate, or
  account). Where a *narrower* credential-free reachability check has been proven live, that is named
  explicitly — it proves the host/path answer for real, never that the full flow would succeed.
- 🔴 **Deferred / not implemented** — no working code path for the live leg yet, or the round-trip
  requires an account this project does not have and has not attempted to obtain.

| Channel | Flag | Key creds | Spec file | Status |
|---|---|---|---|---|
| KSeF (PL) | `KSEF_LIVE=1` | `KSEF_AUTH_TOKEN`, `KSEF_NIP` | `ksef/ksef.live.spec.ts` | 🟡 Credentials present, round-trip unverified — `KSEF_AUTH_TOKEN`/`KSEF_NIP` **do** exist as CI secrets today (confirmed by name via `gh secret list`, not by value). The same secrets authenticated successfully against `ksef-test.mf.gov.pl` as recently as 2026-07-14 (a CI run of the pre-refactor `compliance/providers/transmission/ksef/ksef-live.spec.ts`: real submission, a semantic `REJECTED` — code 450 — not an auth failure). No live run has exercised the current, post-refactor spec, and `compliance-live.yml` has not been triggered since the 2026-08-29 engine refactor — so whether the same credentials are still valid today is **unverified**, not proven expired. |
| PDP superpdp (FR) | `PDP_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp.live.spec.ts` | ✅ **Round-trip proven** — `fr:200 → fr:201 → fr:202`, deposit 375037, 2026-08-29 |
| Email (document "send" SMTP delivery) | `DOCUMENTS_MAIL_LIVE=1` | _(none — hits the local Mailpit container the dev/test stack already runs, SMTP `:1025` / API `:8025`; needs `DATABASE_URL` for one throwaway `Company` row)_ | `actions/send-quote.live.spec.ts` | ✅ Proven live (2026-08-31) — a real message read back from Mailpit's own API, with the PDF attachment actually present and the subject genuinely interpolated |
| SdI (IT) | `SDI_LIVE=1` | `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` | `sdi/sdicoop.live.spec.ts` | 🔴 Deferred (AdE accreditation) — code implemented-awaiting-accreditation, never yet run |
| SdI via PEC (IT) | `PEC_LIVE=1` | `PEC_ID_TRASMITTENTE`, `PEC_ADDRESS`, `PEC_SMTP_HOST`, `PEC_SMTP_PORT`, `PEC_IMAP_HOST`, `PEC_IMAP_PORT`, `PEC_USERNAME`, `PEC_PASSWORD` | `transports/sdi-pec/pec.live.spec.ts` | 🟡 Implemented, awaiting credentials — **no PEC mailbox exists in this checkout**, and unlike SdICoop this channel needs NO accreditation at all (see `credentials-guide.md` §4bis and `pec-protocol.ts`'s own header for the primary-source citations) — provisioning any PEC mailbox is the only blocker to a real round-trip |
| Chorus Pro (FR B2G) | `CHORUSPRO_LIVE=1` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | `chorus-pro/choruspro.live.spec.ts` | ✅ **Full qualification round-trip proven live 2026-09-14** — a real Factur-X deposit reached the terminal authority state `IN_INTEGRE` (`CPP0011117000000000425903`, `listeErreurDP: []`), after two earlier deposits were rejected and fixed (see `credentials-guide.md` §3 and commits `67a94d58`/`7de5a90c`/`ecce4d35`). Proven in **qualification only** — no production PISTE application or Chorus Pro production raccordement exists, and nothing after `IN_INTEGRE` (a public buyer's own `MISE_A_DISPOSITION`/`MANDATEE`/`MISE_EN_PAIEMENT`) has been exercised. |
| RFC 3161 TSA (-T signing) | `TSA_LIVE=1` | `TSA_URL` | `signing/tsa.live.spec.ts` | ✅ **Proven live** — a real TST DER from FreeTSA (`https://freetsa.org/tsr`) embedded as a genuine XAdES-T `SignatureTimeStamp`; no credential needed (FreeTSA is public/anonymous). First proven 2026-06-30; re-run 2026-09-14 — `TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr npx jest tsa.live --no-coverage --runInBand` → 3/3, exit 0 (`HttpTsaClient`, `XadesSigningProvider` level-T, the env-built signing registry) |
| Company lookup (national registers) | `COMPANY_LOOKUP_LIVE=1` | _(none — every source is keyless: 15 national registers + VIES + GLEIF + Peppol Directory)_ | `modules/company-lookup/company-lookup.live.spec.ts` | ✅ Proven live (2026-07-27) |
| Company lookup, through the onboarding wizard UI (same provider chain, driven by Cypress rather than calling the service directly) | `COMPANY_LOOKUP_LIVE=1` (passed as `--env COMPANY_LOOKUP_LIVE=1` to Cypress — note Cypress delivers it as a NUMBER, so the spec compares with `String(...)`, not `===`) | _(none, same reason as above)_ | `e2e/cypress/e2e/18-onboarding-wizard.cy.ts` (one `it` inside a shared `describe`, not a separate file — its title itself states the gate) | ✅ Proven live (created 2026-08-30; re-run 2026-09-14) — `4/4` passing with the gate open, EDF's real SIRET pre-filling the form and the persisted company read back from the database. Not run by any CI workflow (neither `cypress.yml`'s default `Tests` job nor a Cypress equivalent of `compliance-live.yml`, which does not exist) — offline, this test shows as Cypress "Pending", by design, same as the row above. |
| Mistral OCR (received-invoice PDF extraction, T5(c)) ⚙ *not a channel — the dedicated `ROLE=ocr` service's own CLOUD engine, never the main backend* | `MISTRAL_OCR_LIVE=1` | `MISTRAL_API_KEY` | `ocr-service/mistral-client.live.spec.ts` | 🟡 Credential-free reachability block **proven live 2026-09-03** (`api.mistral.ai/v1/ocr`, no/garbage auth → real `401 {"detail":"Invalid API Key"}`) — full round-trip 🔴 deferred, no Mistral API key provisioned for this task |
| Local OCR engine (the `ocr-image` repo, our own `ocrmypdf`-based image) ⚙ *not a channel — the SAME `ROLE=ocr` service's LOCAL engine, `OCR_ENGINE=local`, running our own Docker image and server rather than depending on a third-party OCR provider* | `LOCAL_OCR_LIVE=1` | _(none — no cloud key, that is the entire point; the spec `docker pull`s + runs the published image (ghcr.io/invoicerr-app/ocr-image) via `docker`, gated on a usable local Docker daemon — `docker info` — checked at load time)_ | `ocr-service/local-client.live.spec.ts` | ✅ **Round-trip proven on 2026-09-11** (engine switched from `apache/tika:latest-full` to our own image, same day) — the spec pulls and launches the real container, `POST`s a real `pdf-lib`-built invoice PDF to it, and the heuristic mapping correctly reads HT/TVA/TTC and the VAT id back; because this server force-OCRs every page (see `server.py`'s own header), this jest run now exercises REAL Tesseract recognition automatically, unlike the Tika era which needed a separate manual proof for that. A SEPARATE, MANUAL round-trip the same day against genuinely RASTERIZED (image-only) invoice PDFs — one French, one Polish (the new language pack Tika's own stock image never had) — proved the broader language coverage too; see `local-client.ts`'s own header for that citation |
| Stripe (online payment) | `STRIPE_LIVE=1` | `STRIPE_SECRET_KEY` | `payments/providers/stripe/stripe.live.spec.ts` | 🔴 Deferred — no Stripe test-mode account provisioned for this task; this row and workflow wiring were themselves missing until the Mollie/PayPal work (2026-09-15) added them retroactively for consistency. Get a key: [dashboard.stripe.com](https://dashboard.stripe.com) → Developers → API keys → "Secret key" (test mode), `sk_test_...`. |
| Mollie (online payment) | `MOLLIE_LIVE=1` | `MOLLIE_API_KEY` | `payments/providers/mollie/mollie.live.spec.ts` | 🔴 Deferred — no Mollie account provisioned for this task (2026-09-15, "aucune clé sandbox n'est encore disponible" — see this feature's own PR). Get a key: [my.mollie.com](https://my.mollie.com) → Developers → API keys → the "Test" key, `test_...`. |
| PayPal (online payment) | `PAYPAL_LIVE=1` | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (`PAYPAL_WEBHOOK_ID`, `PAYPAL_ENVIRONMENT` optional for this narrower spec — see its own header) | `payments/providers/paypal/paypal.live.spec.ts` | 🔴 Deferred — no PayPal sandbox app provisioned for this task (2026-09-15). Get credentials: [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → Sandbox → create/open an app → Client ID + Secret. |
| Polar (hosted billing, `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`) — product listing only | `POLAR_LIVE=1` | `POLAR_ACCESS_TOKEN` (sandbox organization access token — `POLAR_ORGANIZATION_ID` optional, only narrows the listing) | `billing/polar.live.spec.ts` | ✅ Proven live — lists the organization's own products (`polarClient.products.list`), confirming the token/organization are real. |
| Polar, option A (one Polar customer PER COMPANY, `hosted-billing.md`) — customer/checkout/portal/webhook-resolution round-trip | `POLAR_LIVE=1` | `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID_MONTHLY` | `billing/billing-option-a.live.spec.ts` | ✅ **Proven live 2026-09-16** — through this repo's own `checkout-session.ts`/`billing-customer.ts`/`portal-session.ts`/`webhook-handlers.ts` (never a hand-rolled duplicate of the SDK calls), for a fresh sandbox Company row: a real company-scoped Polar customer (`external_id = company.id`), a real checkout session, a real portal session, and the webhook-resolution logic run against that same real customer id, read back correctly from the DEV Postgres database. Also driven through the real UI (Settings > Billing, logged in as the e2e seed OWNER) against a locally running test-flag-enabled stack: billing-email save, "Subscribe monthly" (real redirect to `sandbox.polar.sh/checkout/...`), and "Manage subscription" (real redirect to `sandbox.polar.sh/.../portal/overview`) all confirmed live. Does NOT prove an actual Polar-delivered HTTP webhook reaching `POST /api/billing/webhooks/polar` (no reachable public endpoint here) or a completed sandbox payment (no such API exists — see the live spec's own header). |

---

> ### ✅ Round-trip proven on 2026-08-29 — after two false-greens fixed the same day
>
> **The result**, verified by querying the platform rather than trusting the spec:
> `api:uploaded → fr:200 Déposée (validée) → fr:201 Émise par la plateforme → fr:202 Reçue par la
> plateforme`. Deposit **375037** for the invoice, **375061** for the credit note. The French
> conformity check passes for both.
>
> **The credit note needed two more fixes**, each one named by the platform itself:
> 1. `BR-FR-CO-05/BT-3` — «Si le type de facture est un avoir […] au moins une référence à une
>    facture antérieure (BT-25) avec sa date (BT-26) doit être présente au niveau entête.
>    Références entête trouvées : 0.» ("If the invoice type is a credit note […] at least one
>    reference to a prior invoice (BT-25) with its date (BT-26) must be present at header level.
>    Header references found: 0.") The link had always existed in the database
>    (`Invoice.correctsInvoiceId`); nothing carried it into the document.
> 2. `Element 'qdt:DateTimeString': This element is not expected` — the namespace normalizer was
>    DROPPING the `xmlns:qdt` declaration without ever rewriting the elements, which then went out
>    with an undeclared prefix. Invisible as long as no document used it: BT-26 was the first.
>
> **What was missing**: the three mandatory mentions of C. com. art. L441-9 I al. 5. Once added, the
> `BR-FR-05` rejection disappeared — replaced by a purely structural defect the platform named for
> us: «Element 'ram:Content' must occur exactly 1 times». The generator was stacking three
> `ram:Content` elements inside a single `IncludedNote`, which is invalid in CII. Fixed in
> post-processing, which now splits one note per mention and recovers BT-21 from the `#CODE#` prefix.
>
> **TWO false-greens, not one.** The first: the spec asserted `PENDING` right after the deposit,
> before the verdict even existed — asserting a transient state is asserting that the request went
> out, not that it succeeded. The second, deeper one: **`poll()` could never return anything other
> than `PENDING`**. It read `invoice.status_code`, a field the API does not return; the lifecycle
> arrives in `events[]` instead. The poll therefore answered "no status codes" on every call, and had
> from the start. And the mapping collapsed `fr:200`, `fr:201` and `fr:202` onto `PENDING`, conflating
> "not yet judged" with "validated and received by the recipient".
>
> The spec now **fails if the document stays `PENDING`**: a transient state is no longer a success.
>
> **Two sandbox constraints**, verified the same day. superpdp refuses any deposit whose BT-2 is
> later than the current day — but that does NOT prevent testing: just date the invoice today. And
> the sandbox already contains Burger Queen (`000000002`) and Tricatel (`000000001`).
>
> ### Historical note — the intermediate diagnosis, kept for the record
>
> The transport works: OAuth, XSD, namespaces, routing, and superpdp **accepts the deposit**. Then
> it **rejects the document**. Verified by querying the platform, `GET /v1.beta/invoices/374891`:
>
> > event `fr:213 Rejetée` — «BR-FR-05/BT-22 : La mention relative aux frais de recouvrement
> > (code PMT) est absente. Elle est obligatoire dans les notes (BG-1).» ("The mention relating to
> > recovery costs (PMT code) is missing. It is mandatory in the notes (BG-1).")
>
> Same for **PMD** (late-payment penalties) and **AAB** (early-payment discount). Invoicerr emits
> none of the three: **every French invoice it produces is rejected by the conformity check.** This
> is a product gap, not a credentials problem — and the wording of these mentions comes from the
> seller's own commercial terms, so it cannot be invented.
>
> **Why nobody caught it**, and this is the transposable lesson: the spec asserted `PENDING` right
> after the deposit and polled only once, before the verdict even existed. `PENDING` is a real state,
> but a transient one — asserting a transient state is asserting that the request went out, not that
> it succeeded. The spec had also, separately, stopped compiling (a fixture missing `vatCategory`,
> which became mandatory once BT-151 moved under the engine's own resolution): it threw before ever
> reaching the network, and the live gate stayed silent.
>
> **Two sandbox constraints**, verified the same day. superpdp refuses any deposit whose BT-2 is
> later than the current day, so shifting the clock is useless: France only routes to a PDP starting
> 2026-09-01, and the two windows only overlap on that exact day. And the sandbox already contains
> Burger Queen (`000000002`) and Tricatel (`000000001`) — using a different SIREN means creating the
> company on superpdp's side first.

## Running a single live spec

```bash
# KSeF (PL) — KSEF_AUTH_TOKEN/KSEF_NIP DO exist as CI secrets (see the summary table above); whether
# they are still valid today has not been re-verified since 2026-07-14
KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> [KSEF_NIP=<nip>] \
  npx jest ksef.live --no-coverage --runInBand

# PDP superpdp (FR) — round-trip proven: deposited, validated, issued, received (see the box above)
set -a; . .env.pdp.local; set +a
PDP_LIVE=1 npx jest pdp.live --no-coverage --runInBand

# Email (document "send" SMTP delivery to the local Mailpit container — no external creds needed,
# but needs Mailpit running on :1025/:8025 and a DATABASE_URL for one throwaway Company row)
DOCUMENTS_MAIL_LIVE=1 SMTP_HOST=localhost SMTP_PORT=1025 \
  DATABASE_URL=postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db \
  npx jest send-quote.live --no-coverage

# SdI (IT) — requires AdE accreditation + qualified PFX certificate (code implemented-awaiting-accreditation)
SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 SDI_ENDPOINT=<accredited-SdIRiceviFile-url> \
  SDI_CERTIFICATE=<base64-pfx> SDI_CERT_PASSWORD=<pass> \
  npx jest sdicoop.live --no-coverage --runInBand

# SdI via PEC (IT) — NO accreditation needed, only a real PEC mailbox (code implemented-awaiting-credentials)
PEC_LIVE=1 PEC_ID_TRASMITTENTE=IT01234567890 PEC_ADDRESS=fatture@example.pec.it \
  PEC_SMTP_HOST=smtps.pec-provider.it PEC_SMTP_PORT=465 \
  PEC_IMAP_HOST=imaps.pec-provider.it PEC_IMAP_PORT=993 \
  PEC_USERNAME=fatture@example.pec.it PEC_PASSWORD=<pass> \
  npx jest pec.live --no-coverage --runInBand

# Chorus Pro (FR B2G) — full qualification round-trip proven live 2026-09-14 (deposit +
# terminal IN_INTEGRE); production never attempted. Omitting the TECH_LOGIN/PASSWORD pair
# still runs the spec, but only its OAuth half — see credentials-guide.md §3.
CHORUSPRO_LIVE=1 CHORUSPRO_CLIENT_ID=<id> CHORUSPRO_CLIENT_SECRET=<secret> \
  CHORUSPRO_TECH_LOGIN=<login> CHORUSPRO_TECH_PASSWORD=<password> \
  npx jest choruspro.live --no-coverage --runInBand

# RFC 3161 TSA — level-T signing via real TSA (e.g. FreeTSA)
TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr \
  npx jest tsa.live --no-coverage --runInBand

# Mistral OCR (cloud engine, ROLE=ocr's OWN client — real API key required)
MISTRAL_OCR_LIVE=1 MISTRAL_API_KEY=<key> \
  npx jest mistral-client.live --no-coverage --forceExit

# Local OCR engine (the ocr-image repo, our own ocrmypdf-based image — ROLE=ocr's OTHER client, NO
# cloud key at all). Requires a usable local Docker daemon (`docker info`) — the spec pulls, runs,
# uses, and tears down the published container itself; nothing needs to be started manually first
# (the first run pulls ghcr.io/invoicerr-app/ocr-image; every run after reuses Docker's layer cache).
LOCAL_OCR_LIVE=1 npx jest local-client.live --no-coverage --forceExit

# Stripe (online payment) — test-mode secret key from the Stripe dashboard
STRIPE_LIVE=1 STRIPE_SECRET_KEY=sk_test_... \
  npx jest stripe.live --no-coverage --runInBand

# Mollie (online payment) — test API key from the Mollie dashboard
MOLLIE_LIVE=1 MOLLIE_API_KEY=test_... \
  npx jest mollie.live --no-coverage --runInBand

# PayPal (online payment) — sandbox app Client ID/Secret from the PayPal developer dashboard.
# PAYPAL_WEBHOOK_ID/PAYPAL_ENVIRONMENT are read but not required by this narrower spec (order
# creation only, no webhook verification round-trip — see the spec's own header).
PAYPAL_LIVE=1 PAYPAL_CLIENT_ID=<id> PAYPAL_CLIENT_SECRET=<secret> \
  npx jest paypal.live --no-coverage --runInBand

# PAYMENT_PROVIDERS_REAL=1 wires the REAL Stripe/Mollie/PayPal clients into the RUNNING app itself
# (e.g. `npm run start:test`) instead of only inside a `*.live.spec.ts` process — the two code paths
# `documents-core.module.ts#shouldUseRealPaymentClients`'s own header explains. No effect outside
# NODE_ENV=test.
PAYMENT_PROVIDERS_REAL=1 npm run start:test

# A FULL Mollie round-trip (unlike stripe.live.spec.ts/paypal.live.spec.ts, which only prove session/
# order creation) needs Mollie's own servers to actually deliver a webhook back to this machine — set
# BACKEND_PUBLIC_URL to a tunnel exposing only :4000 (`APP_URL` itself must stay the frontend's local
# origin, see that variable's own header in `utils/backend-public-url.ts`) before starting the backend.
PAYMENT_PROVIDERS_REAL=1 BACKEND_PUBLIC_URL=https://your-tunnel.example.com npm run start:test
```

---

## Verifying the gate works (no flag = skipped)

```bash
# Run the gated spec without the flag → must show as skipped
cd backend
npx jest ksef.live --no-coverage
# Expected: Test Suites: 1 skipped | Tests: 0 (suite skipped)

npx jest pdp.live send-quote.live sdicoop.live tsa.live choruspro.live --no-coverage
# Expected: all suites skipped
```

---

## Running the full offline suite (gate must not fire)

```bash
cd backend
npx jest --no-coverage
# Live specs appear in "skipped suites" count — no live call is made.
# Baseline (2026-09-13): 2740 passed / 58 skipped, 254 of 278 suites run — this number drifts as the
# codebase grows; treat it as a sanity check, not a pinned target.
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
  - `.env.sdi.local` — `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD`
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
  [CHORUSPRO_ENVIRONMENT=SANDBOX] \
  npx jest choruspro.live --no-coverage --runInBand
```

| Env var | Purpose |
|---|---|
| `CHORUSPRO_CLIENT_ID` | PISTE OAuth2 `client_id` (from PISTE developer portal) — required by the gate |
| `CHORUSPRO_CLIENT_SECRET` | PISTE OAuth2 `client_secret` — required by the gate |
| `CHORUSPRO_TECH_LOGIN` | Chorus Pro "compte technique" login (optional — the OAuth half runs without it; the deposit half is skipped when absent) |
| `CHORUSPRO_TECH_PASSWORD` | Chorus Pro "compte technique" password (same optionality as above) |
| `CHORUSPRO_ENVIRONMENT` | `SANDBOX` (default) or `PROD` |

**How to obtain credentials:** see `credentials-guide.md` §3 for the full step-by-step (both layers
are obtainable with **no real company** — the Chorus Pro qualification space issues a fictitious
SIRET). In short:
1. Create an account on **[piste.gouv.fr](https://piste.gouv.fr)**, subscribe to the Chorus Pro APIs
   (Factures/Structures/Utilisateurs/Transverses) in the sandbox catalog, and copy the OAuth
   Credentials tab's Client ID/Secret Key.
2. Create a "matelas de données" on the Chorus Pro qualification portal
   (`chorus-pro.gouv.fr/qualif/`), then a "compte technique" from it — this is where
   `CHORUSPRO_TECH_LOGIN`/`CHORUSPRO_TECH_PASSWORD` come from.
3. Sandbox hosts: `sandbox-oauth.piste.gouv.fr` / `sandbox-api.piste.gouv.fr`.

**What the test verifies:**
- Step 1: OAuth2 `client_credentials` → Bearer token reachable — **proven live 2026-09-14**.
- Step 2 (if compte technique provided): `POST /cpro/factures/v1/deposer/flux` → real
  `numeroFluxDepot` returned — **proven live 2026-09-14** (`CPP0011117000000000425903`).
- Step 3: `POST /cpro/transverses/v1/consulterCRDetaille` (NOT `/cpro/factures/v1/consulter/cr` — that
  route does not exist, see `choruspro-client.ts`'s own header) → `etatCourantDepotFlux` reached the
  terminal state `IN_INTEGRE` with `listeErreurDP: []` — **proven live 2026-09-14**, in qualification.
  Nothing past that terminal state (a real public buyer's own processing) has been exercised, and no
  production round-trip exists.

---

## SdI prerequisites (currently deferred — code is implemented-awaiting-accreditation)

Status (2026-09-01): step 3 below is DONE — a real `SdiHttpPort` (`SdiCoopClient`,
`backend/src/modules/documents/transports/sdi/sdicoop-client.ts`) exists, built from the published
SdICoop WSDL/XSD/instructions (see [Credentials Guide](./credentials-guide.md) §4's own citation
list), and `sdi-transport.ts` already uses it whenever a company's "sdi" channel credentials are
complete. What remains is entirely OUTSIDE this codebase's control:

1. Register as an intermediary (*intermediario*) with AdE.
2. Obtain a qualified digital certificate (PFX/P12) from an accredited CA (client cert; a distinct-key
   server cert too, if the notifiche receiver is to be mTLS-authenticated server-side — see
   `sdi-notifiche.service.ts`'s own header on what that endpoint still lacks).
3. ~~Implement `SdiHttpPort` for SDICoop SOAP~~ — done (`sdicoop-client.ts`).
4. Declare the accredited `SDI_ENDPOINT` (the `SdIRiceviFile` URL AdE assigns) as this company's "sdi"
   channel credential, alongside `SDI_ID_TRASMITTENTE`/`SDI_CERTIFICATE`/`SDI_CERT_PASSWORD`.
5. Set `SDI_LIVE=1` + all four creds and run `sdicoop.live.spec.ts` — the first real run against
   collaudo may reveal envelope discrepancies reading the spec alone could not anticipate (see that
   spec's own header).

## SdI via PEC prerequisites (currently deferred — code is implemented-awaiting-credentials)

Status (2026-09-13): the "sdi-pec" transport (`sdi-pec-transport.ts`), the receipt-handling logic
(`transports/sdi-pec/pec-notifiche.service.ts`) and a real IMAP adapter
(`transports/sdi-pec/imapflow-pec-inbox-port.ts`) all exist and are unit-tested against mocked ports —
see [Credentials Guide](./credentials-guide.md) §4bis for the full citation list this was built from.
Unlike SdI's SDICoop channel, NOTHING here needs AdE accreditation. What remains:

1. Provision any PEC (Posta Elettronica Certificata) mailbox from an AgID-listed provider — a same-day
   commercial purchase, no government relationship required.
2. Declare that mailbox's SMTP + IMAP connection details as this company's "sdi-pec" channel
   credentials (`PEC_ADDRESS`/`PEC_SMTP_*`/`PEC_IMAP_*`/`PEC_USERNAME`/`PEC_PASSWORD`/
   `PEC_ID_TRASMITTENTE`).
3. Set `PEC_LIVE=1` + those credentials and run `pec.live.spec.ts` — the first real run would prove:
   the FatturaPA XML actually reaches `sdi01@pec.fatturapa.it` over real SMTP, SdI's own first reply
   (a notifica di scarto/errore, ricevuta di consegna/mancata consegna, or attestazione) actually
   arrives in the mailbox's IMAP inbox, that reply's `NomeFile` actually matches the filename this
   codebase chose, and (implicitly, by never needing a second PEC address) that the two-step
   addressing rule was read correctly. None of this has been observed for real yet.

## Running in GitHub Actions

Workflow: **`.github/workflows/compliance-live.yml`** (manual `workflow_dispatch` + nightly cron).
- The `live` job runs `npx jest live` against a disposable Postgres + Redis, which sweeps in every
  `*.live.spec.ts` / `*-live.spec.ts` file matched above (KSeF, PDP, SdI, TSA, Chorus Pro), each
  self-gating on its own flag and credentials.
- **Not yet reconciled with this architecture, named honestly rather than fixed silently**: the
  workflow file's own env block still sets flags this codebase no longer reads (`EMAIL_LIVE`,
  `PDP_AFNOR_LIVE`, `COMPLIANCE_LIVE_DB_TESTS`) — harmless (nothing consumes them) rather than
  wrong. Its separate `national-portals-live` job still runs `npx jest portal-live`, a pattern that
  matches no file in this repository (`portal-live.spec.ts` no longer exists) — that job runs and
  currently finds nothing to execute. This is a defect in the workflow file itself, out of scope for
  this guide to fix.

> **Cron caveat:** GitHub only fires the `schedule` trigger from the repository's **default branch**
> (typically `main`). On a feature branch, the nightly `cron: '0 3 * * *'` entry above is inert —
> use the **"Run workflow"** button (`workflow_dispatch`) targeting that branch instead; the cron
> starts firing automatically once the workflow file is merged to the default branch.
>
> **What "green" means with zero secrets configured:** every creds-gated spec (KSeF, PDP, SdI, TSA,
> Chorus Pro) self-skips via `liveDescribe` — see the hard-success contract at the top of this file,
> enforced by each spec, not by the gate. Only the genuinely creds-free specs actually run and must
> pass: Email/Mailpit (`DOCUMENTS_MAIL_LIVE`, though the workflow does not currently set this flag —
> see the caveat above). A fully green *real-round-trip* matrix (KSeF CLEARED, PDP PENDING/CLEARED,
> SdI CLEARED, …) additionally needs the repo secrets listed in the table below — see also
> [Credentials Guide](./credentials-guide.md) for the per-platform setup walkthrough.

> **`*_LIVE` and `*_ENVIRONMENT` are constants in the workflow — do NOT add them as GitHub secrets.**
> They are set as literal values directly in the YAML (`SDI_LIVE: '1'`, `CHORUSPRO_ENVIRONMENT:
> 'SANDBOX'`, etc.). Only real credentials (`*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_API_KEY`,
> `*_AUTH_TOKEN`, `*_CERTIFICATE`, `*_CERT_PASSWORD`, `*_TAXPAYER_ID`, `*_BASE_URL`) belong in secrets.

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
| `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` (+ optional `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING`) | FR PDP | PDP developer portal. Sandbox = **superpdp**. Real PDP list (annuaire): **impots.gouv.fr**. |
| `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE` (b64 PFX), `SDI_CERT_PASSWORD` | IT SdI | **Agenzia delle Entrate** intermediary accreditation (fatturapa.gov.it) — `SDI_ENDPOINT` (the accredited `SdIRiceviFile` URL) and the PFX are both assigned/issued during that accreditation, never a fixed constant (see [Credentials Guide](./credentials-guide.md) §4). Code side: implemented-awaiting-accreditation (`sdicoop-client.ts`), never yet run against the real endpoint. |
| `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | FR Chorus Pro B2G | **PISTE developer portal** (piste.gouv.fr) — subscribe to "API Dépôt flux G2B", then create a Chorus Pro "compte technique" in the sandbox. |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email (document "send" SMTP) | The local Mailpit container the dev/test stack already runs — no secret needed. ✅ proven (see the summary table above). |

> National **XSD** files (not secrets, e.g. PL FA(3)/IT FatturaPA) come from each authority directly.
