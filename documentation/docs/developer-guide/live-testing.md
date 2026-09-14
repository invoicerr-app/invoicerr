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
| Peppol via peppol.sh | `PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh` | _(none — spec self-signs-up on the peppol.sh sandbox)_ | `peppol/peppol-sh.live.spec.ts` | ✅ **Round-trip proven on 2026-09-02** — `FR` remains broken (`invalid_country`), but `BE` (+ explicit `peppol_id`) works: `doc_…` → `DELIVERED` in ~10s, reproduced twice (see below) |
| Peppol via peppol.sh — XRechnung content (DE B2G format override) | `PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh` | _(none — same zero-secret sandbox)_ | `peppol/peppol-sh-xrechnung.live.spec.ts` | ✅ **Round-trip proven on 2026-09-02** — `doc_v37PTxYOQGn78bPAnMiI0` → `DELIVERED` in ~10s; see the box below for the HONEST LIMIT of what this proves (peppol.sh never accepts raw UBL bytes — see that spec's own header) |
| Peppol generic AP | `PEPPOL_LIVE=1` | `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | _(no live spec exists yet — mocked coverage only, `peppol/peppol-client.spec.ts`)_ | 🔴 Deferred (connected AP required) |
| Chorus Pro (FR B2G) | `CHORUSPRO_LIVE=1` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | `chorus-pro/choruspro.live.spec.ts` | ✅ **Full qualification round-trip proven live 2026-09-14** — a real Factur-X deposit reached the terminal authority state `IN_INTEGRE` (`CPP0011117000000000425903`, `listeErreurDP: []`), after two earlier deposits were rejected and fixed (see `credentials-guide.md` §3 and commits `67a94d58`/`7de5a90c`/`ecce4d35`). Proven in **qualification only** — no production PISTE application or Chorus Pro production raccordement exists, and nothing after `IN_INTEGRE` (a public buyer's own `MISE_A_DISPOSITION`/`MANDATEE`/`MISE_EN_PAIEMENT`) has been exercised. |
| RFC 3161 TSA (-T signing) | `TSA_LIVE=1` | `TSA_URL` | `signing/tsa.live.spec.ts` | ✅ **Proven live** — a real TST DER from FreeTSA (`https://freetsa.org/tsr`) embedded as a genuine XAdES-T `SignatureTimeStamp`; no credential needed (FreeTSA is public/anonymous). First proven 2026-06-30 (`COMPLIANCE_TODO.md`'s own §2 note); re-run 2026-09-14 — `TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr npx jest tsa.live --no-coverage --runInBand` → 3/3, exit 0 (`HttpTsaClient`, `XadesSigningProvider` level-T, the env-built signing registry) |
| Company lookup (national registers) | `COMPANY_LOOKUP_LIVE=1` | _(none — every source is keyless: 15 national registers + VIES + GLEIF + Peppol Directory)_ | `modules/company-lookup/company-lookup.live.spec.ts` | ✅ Proven live (2026-07-27) |
| Company lookup, through the onboarding wizard UI (same provider chain, driven by Cypress rather than calling the service directly) | `COMPANY_LOOKUP_LIVE=1` (passed as `--env COMPANY_LOOKUP_LIVE=1` to Cypress — note Cypress delivers it as a NUMBER, so the spec compares with `String(...)`, not `===`) | _(none, same reason as above)_ | `e2e/cypress/e2e/18-onboarding-wizard.cy.ts` (one `it` inside a shared `describe`, not a separate file — its title itself states the gate) | ✅ Proven live (created 2026-08-30; re-run 2026-09-14) — `4/4` passing with the gate open, EDF's real SIRET pre-filling the form and the persisted company read back from the database. Not run by any CI workflow (neither `cypress.yml`'s default `Tests` job nor a Cypress equivalent of `compliance-live.yml`, which does not exist) — offline, this test shows as Cypress "Pending", by design, same as the row above. |
| Mistral OCR (received-invoice PDF extraction, T5(c)) ⚙ *not a channel — the dedicated `ROLE=ocr` service's own CLOUD engine, never the main backend* | `MISTRAL_OCR_LIVE=1` | `MISTRAL_API_KEY` | `ocr-service/mistral-client.live.spec.ts` | 🟡 Credential-free reachability block **proven live 2026-09-03** (`api.mistral.ai/v1/ocr`, no/garbage auth → real `401 {"detail":"Invalid API Key"}`) — full round-trip 🔴 deferred, no Mistral API key provisioned for this task |
| Local OCR engine (the `ocr-image` repo, our own `ocrmypdf`-based image) ⚙ *not a channel — the SAME `ROLE=ocr` service's LOCAL engine, `OCR_ENGINE=local`, running our own Docker image and server rather than depending on a third-party OCR provider* | `LOCAL_OCR_LIVE=1` | _(none — no cloud key, that is the entire point; the spec `docker pull`s + runs the published image (ghcr.io/invoicerr-app/ocr-image) via `docker`, gated on a usable local Docker daemon — `docker info` — checked at load time)_ | `ocr-service/local-client.live.spec.ts` | ✅ **Round-trip proven on 2026-09-11** (engine switched from `apache/tika:latest-full` to our own image, same day) — the spec pulls and launches the real container, `POST`s a real `pdf-lib`-built invoice PDF to it, and the heuristic mapping correctly reads HT/TVA/TTC and the VAT id back; because this server force-OCRs every page (see `server.py`'s own header), this jest run now exercises REAL Tesseract recognition automatically, unlike the Tika era which needed a separate manual proof for that. A SEPARATE, MANUAL round-trip the same day against genuinely RASTERIZED (image-only) invoice PDFs — one French, one Polish (the new language pack Tika's own stock image never had) — proved the broader language coverage too; see `local-client.ts`'s own header for that citation |

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

> ### 🔴 Peppol via peppol.sh — broken on 2026-08-29, and a useful reminder
>
> The spec fails BEFORE any transmission, at company creation:
>
> > `HTTP 400 — {"error":{"code":"invalid_country","message":"country must be an active Peppol
> > country code","param":"country"}}`
>
> It sends `country: 'FR'`. The platform no longer accepts it — a plausible hypothesis, NOT verified:
> France moved to the PDP mandate and peppol.sh may have removed it from its active destinations.
> **What would settle this**: peppol.sh's own published list of active countries, or their support.
>
> The spec itself is well built — it requires `CLEARED` and explicitly treats `PENDING` as a
> failure, which is exactly the discipline the PDP spec was missing. So this is not a false-green
> but **stale proof**: "Proven live (2026-07-11)" described a world that has since changed, and
> nobody re-ran the test since. A live channel that isn't re-run is not a proven channel.
>
> Not fixed: changing the fixture's country would make the test pass again, but would prove
> something other than what it claims to prove. The question to settle first is whether France is
> still a Peppol destination at all.

> ### ✅ Peppol via peppol.sh — RETRIED on 2026-09-02, real round-trip obtained (`peppol` transport
> rebuilt under `documents/transports/`)
>
> The new transport (`transports/peppol-transport.ts` + `transports/peppol/peppol-client.ts`, the
> generic AP adapter) is wired and tested (jest, `peppol-transport.spec.ts`). For the live attempt
> itself, the `peppol/peppol-sh.live.spec.ts` spec was carried over almost verbatim from the
> pre-rewrite reference, then RE-RUN for real (`PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh`), with
> three raw results, none guessed:
>
> 1. **`country: 'FR'` — STILL broken.** Raw response, identical to the one on 08/29:
>    `HTTP 400 — {"error":{"code":"invalid_country","message":"country must be an active Peppol
>    country code","param":"country"}}`. Neither fixed on peppol.sh's side nor a transient outage —
>    reproduced identically four days later.
> 2. **`country: 'BE'` — a NEW, different failure first, then success.** The first attempt (with no
>    explicit `peppol_id`, exactly the 2026-07-11 reference's payload) fails with
>    `HTTP 400 — {"error":{"code":"missing_peppol_id","message":"peppol_id is required and must be a
>    valid <scheme>:<value> Peppol participant identifier"}}` — so the API has changed since the
>    original proof: `tax_id` alone is no longer enough to create a sandbox company. Once an explicit
>    `peppol_id` is supplied (`createCompany` gained this optional parameter), creation succeeds:
>    `com_IO3upwIDxk45Daf8y41h7` (then `com_…` again on the second run).
> 3. **The full round-trip, end to end, SUCCEEDS — twice.** A GERMAN seller (never French, on
>    purpose — a French seller would have tripped on PEPPOL-EN16931-R002, `peppol-bis-provider.ts`'s
>    already-documented limitation, before even reaching the network) builds a real, VALID Peppol BIS
>    UBL document (the real vendored Schematron, base + delta), sent via `PeppolShApClient.send()`:
>    - Run 1: `{"messageId":"doc_tSynOlxg9LaKv4mTJVnxI","status":"QUEUED"}` → poll 2/24 →
>      `DELIVERED` (~10 s).
>    - Run 2: `{"messageId":"doc_t477L6zcVzFbp7IguAIi7","status":"QUEUED"}` → poll 2/24 →
>      `DELIVERED` (~10 s).
>
> **Conclusion, honestly stated**: peppol.sh itself works fine today (signup, company, send, status —
> all real) — the 08/29 hypothesis ("France moved to the PDP mandate and peppol.sh removed it") is
> still NOT settled as to its exact cause (BELGIUM, for its part, is accepted — so this is not a
> blanket sandbox removal), but the observation itself (FR rejected) is confirmed, reproduced, and
> worked around with an alternative country as required. This is the FIRST real Peppol send of this
> new `documents/` architecture — see `peppol-sh.live.spec.ts`'s own header for the detail and the
> `PEPPOL_SH_FALLBACK_COUNTRY` knob that automates this workaround for a future re-run.

> ### ✅ Peppol via peppol.sh — XRechnung (the German B2G gap), attempted and SUCCEEDED on 2026-09-02
>
> "The German B2G gap": `b2g-routing/data/de.json` now routes to `transportId: "peppol"` with
> `formatSyntax: "xrechnung"` (see `peppol-transport.ts`'s own header, "THE FORMAT OVERRIDE") — the
> live question this task asked was "does the peppol.sh sandbox accept a send built with
> `formats/xrechnung-provider.ts` (instead of `peppol-bis-provider.ts`) to its own test receiver?".
> Same EXACT setup as the round-trip above (BE company + explicit `peppol_id`, German seller,
> `sandbox.peppol.sh` receiver) — see `peppol/peppol-sh-xrechnung.live.spec.ts`.
>
> **Raw result, a single run, nothing guessed**:
> 1. Signup: `acc_qz9uV6XuSnda0fpFOIa1s`.
> 2. `country: 'FR'`: rejected, `invalid_country` — same failure as the Peppol BIS round-trip.
>    Fallback `country: 'BE'` (+ `peppol_id: '9925:BE999999999'`): `com_h0t5I7orCSKUrK48C2770`.
> 3. `xrechnungFormatProvider.build()` (German seller WITH an IBAN — `formats/xrechnung-provider.ts`'s
>    own BR-DE-1): `validation.valid: true`, 0 errors, a 4012-byte UBL document. Verified LOCALLY,
>    before any send: `urn:xeinkauf.de:kosit:xrechnung_3.0` present in the XML,
>    `urn:fdc:peppol.eu:2017:poacc:billing:3.0` ABSENT — this really is an XRechnung, never a Peppol
>    BIS, going out on the network.
> 4. `PeppolShApClient.send()`: `{"messageId":"doc_v37PTxYOQGn78bPAnMiI0","status":"QUEUED"}`.
> 5. Poll 1/24: `QUEUED`. Poll 2/24: `DELIVERED` (~10 s, a single poll wait — identical timing to the
>    Peppol BIS round-trip).
>
> **Conclusion, honest, with its own named limit**: the channel ACCEPTS and DELIVERS a document built
> by `xrechnung-provider.ts` exactly as it accepts and delivers one built by
> `peppol-bis-provider.ts` — no regression, no different behavior on the transport side. But read
> `peppol-sh-xrechnung.live.spec.ts`'s own header before over-interpreting this green:
> `PeppolShApClient#send()` (`peppol-sh-client.ts#ublToPeppolShDocument`) NEVER accepts raw UBL
> bytes — it EXTRACTS a handful of generic EN 16931 fields (party name, VAT, currency, dates, lines)
> and peppol.sh RE-SERIALIZES its own document server-side for the actual delivery; that extraction
> reads neither `cbc:CustomizationID` nor any XRechnung-specific element
> (BuyerReference/Contact/PaymentMeans). A `DELIVERED` here therefore proves that this deposit's
> XRechnung artifact (already judged valid by the REAL vendored KoSIT Schematron, base + delta,
> before it was even sent) is structurally compatible with the SAME generic UBL extraction path as
> Peppol BIS — not that peppol.sh transmits, judges, or retains the content as specifically being
> XRechnung. The properly XRechnung-specific proof — the CustomizationID actually present in the
> bytes sent — is the one judged LOCALLY at point 3 above, before the network, never the network's
> own.

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

# Peppol via peppol.sh — ZERO SECRETS (self-signup, like the Email leg above)
PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh \
  npx jest peppol-sh.live --no-coverage --runInBand
# Optional: reuse an existing sandbox account instead of self-signup
#   PEPPOL_SH_API_KEY=ps_test_… PEPPOL_SH_COMPANY_ID=com_… [PEPPOL_RECEIVER_ID=<scheme:id>]

# Peppol via peppol.sh — XRechnung content (DE B2G format override) — same zero-secret sandbox
PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh \
  npx jest peppol-sh-xrechnung.live --no-coverage --runInBand

# Peppol generic AP — deferred: no live spec exists yet (needs a connected Access Point first);
# only mocked coverage exists today, in peppol/peppol-client.spec.ts

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
  - `.env.peppol.local` — `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID`
    (generic AP only — the peppol.sh path needs no local secrets at all)
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

## Peppol

Production sends only through the **generic** Access Point adapter (`peppol/peppol-client.ts`) — this
architecture has no per-company `apProvider` selector. The multi-vendor switch the compliance engine
used to have (`ap-adapters.ts`), and the Storecove adapter it could dispatch to, were not carried over
when that engine was deleted (`peppol-transport.ts`'s own header names this explicitly). `peppol-sh`
(`peppol/peppol-sh-client.ts`) exists only as a separate, DB-free live-proof harness — it is never
selectable in production and never called from `peppol-transport.ts`.

### peppol.sh — ✅ PROVEN, zero secrets (the live-proof harness)

The `peppol-sh.live.spec.ts` flow is fully self-bootstrapping (no pre-provisioned account needed):

1. `POST https://api.peppol.sh/v1/signup {email}` → instant `ps_test_` API key (no KYC, no card).
2. `POST https://sandbox.peppol.sh/v1/companies` → sending company (`com_…`).
   ⚠ Verified live: `ps_test_` keys are **rejected on api.peppol.sh** (403 `wrong_environment`) —
   all authed sandbox calls go to `sandbox.peppol.sh`.
3. `POST /v1/documents` (JSON document extracted from our builder-generated UBL) → `doc_…` id.
4. `GET /v1/documents/{id}?company_id=com_…` (the query param is required — verified live) →
   `queued → sending → delivered` (sandbox delivers by email; statuses are real).

Run: `PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh npx jest peppol-sh.live --no-coverage --runInBand`
Proven live 2026-09-02 in this architecture (see the box earlier in this file for the full,
raw result): `BE` sending companies round-trip to `DELIVERED`; `FR` still fails at signup with
`invalid_country`. An older 2026-07-11 proof (document `doc_2yb9TJka7US3hBwz4rnDW` → CLEARED in
~13 s) predates this architecture and used a different sandbox behavior (`tax_id` alone was then
enough to create a company) — superseded, kept here only as history.
Production later: pass KYC → `ps_live_` key → `environment: PROD` (routes via their certified AP).

### Generic AP gateway (deferred)

1. Connect to a Peppol Access Point provider (e.g. Basware, Pagero, Qvalia, or self-hosted phase4/oxalis-ng).
2. Obtain an AP certificate (C1/C2) registered with OpenPeppol or the national Peppol Authority.
3. The receiver (`PEPPOL_RECEIVER_ID`) must be registered in the SMP/SML.
4. No live spec exists yet for this path — only mocked coverage (`peppol/peppol-client.spec.ts`).
   Set `PEPPOL_LIVE=1` + the four creds above once a live spec is written against a real connected AP.

---

## Running in GitHub Actions

Workflow: **`.github/workflows/compliance-live.yml`** (manual `workflow_dispatch` + nightly cron).
- The `live` job runs `npx jest live` against a disposable Postgres + Redis, which sweeps in every
  `*.live.spec.ts` / `*-live.spec.ts` file matched above (KSeF, PDP, SdI, Peppol via peppol.sh, TSA,
  Chorus Pro), each self-gating on its own flag and credentials.
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
> **What "green" means with zero secrets configured:** every creds-gated spec (KSeF, PDP, SdI,
> generic-AP Peppol, TSA, Chorus Pro) self-skips via `liveDescribe` — see the hard-success contract
> at the top of this file, enforced by each spec, not by the gate. Only the genuinely creds-free
> specs actually run and must pass: Email/Mailpit (`DOCUMENTS_MAIL_LIVE`, though the workflow does
> not currently set this flag — see the caveat above) and Peppol via `peppol-sh` (zero-secret sandbox
> self-signup). A fully green *real-round-trip* matrix (KSeF CLEARED, PDP PENDING/CLEARED, SdI
> CLEARED, …) additionally needs the repo secrets listed in the table below — see also
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
| _(none)_ | Peppol via peppol.sh | Self-signup in the spec — no secret needed. `PEPPOL_AP_PROVIDER` is a constant (`'peppol-sh'`) in the workflow — not a secret. ✅ proven. |
| `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | Peppol generic AP | A connected **Access Point** (Ecosio, Pagero/Tickstar, Unimaze…) or self-hosted; membership via **OpenPeppol** (peppol.org). `PEPPOL_ENV` is a constant (`'TEST'`) in the workflow — not a secret. No live spec exists yet for this path (see "Peppol" above). |
| `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | FR Chorus Pro B2G | **PISTE developer portal** (piste.gouv.fr) — subscribe to "API Dépôt flux G2B", then create a Chorus Pro "compte technique" in the sandbox. |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email (document "send" SMTP) | The local Mailpit container the dev/test stack already runs — no secret needed. ✅ proven (see the summary table above). |

> National **XSD** files (not secrets, e.g. PL FA(3)/IT FatturaPA) come from each authority directly.
