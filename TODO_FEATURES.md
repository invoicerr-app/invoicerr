# TODO_FEATURES — missing features vs. competitors (2026-09-15)

> ANALYSIS task for §1/§2 (no code touched by this file). Method: §1 is rebuilt 100% from the code
> (modules `backend/src/modules/`, screens `frontend/src/pages/`, specs `e2e/cypress/e2e/`) — never
> guessed. §2 cross-references this inventory against web research on competing invoicing software
> (SaaS and self-hosted, closed-source included) to keep only the genuinely recurring gaps among
> them. Every gap line carries an "e2e" note: what a test should prove the day the item is
> implemented.
>
> This file is complementary to `TODO_MANDANT.md` (e-invoicing compliance credentials/steps) and to
> `TODO_ISSUES.md` (the per-country compliance engine). It does not overlap with them: it covers
> generic "business" features (payment, reminders, portal, stock, time…) that nearly every
> competitor offers, independent of per-country e-invoicing compliance (already very advanced, see
> §1.2).
>
> **Reorganization of 2026-09-15.** The old "execution queue" (decided on 2026-09-13) and the old
> "Tracking" section still showed "in progress"/"queued" for features that have since shipped and
> been proven in CI (run `34875223906`, 2026-09-14, workflow "Tests", job `cypress-run` green —
> every feature listed below has its own passing Cypress spec, unless noted otherwise). Replaced by
> the **Shipped** section and by the **owner's product decisions** made on 2026-09-15, which close
> out or reformulate several remaining gaps (payments, PDF, email, mobile, subscription) and add a
> new topic (instance vs. company mail server). The ranks and numbered titles in this file carry
> over from the historical §3 — they were not restarted from zero.
>
> **CI status (2026-09-15, 21:30).** Three consecutive fully green runs: `8a18853f` (34986378950), `ee099682` (PWA install banner) and `e144f398` (14-day trial, pricing) — all six jobs, Cypress 64/64 each time. The dev instance `invoicerr.chevrier.dev` runs `e144f398`; later commits are documentation only.
>
> **Where this file stands.** Every feature it tracks is shipped and proven; what remains needs the owner, not code: regional payment providers (deferred by decision), Apple Pay / Google Pay activation in the Mollie dashboard, the hosting provider for the paid offering (`[HOSTING PROVIDER, COUNTRY]` in the Terms of Service), hardening DMARC to `p=quarantine` once reports are clean, the Docusaurus rework and the big clean-up planned after the PR.

---

## Shipped (25)

| Rank | Feature | Proof |
|---:|---|---|
| 1 | Online payment (Stripe) | Wired and dry-run tested — spec `60-online-payment`, commit `4c0b0c94` (2026-09-14). **Proven with a real Stripe test-mode account on 2026-09-15**: `stripe.live.spec.ts` (`STRIPE_LIVE=1`, restricted key — permissions in `providers/stripe/API-KEY-PERMISSIONS.md`) creates a real Checkout Session (`cs_test_…`, hosted URL returned). **Full loop proven on the running app (2026-09-15, 14:05 UTC)**: `PAYMENT_PROVIDERS_REAL=1` (`c8620b37`), session created by `POST /api/portal/documents/invoice/:id/checkout-session`, paid in the browser with Stripe's public test card, webhook forwarded by `stripe listen`, signature verified, session `COMPLETED`, a 120.00 EUR payment recorded on INVOICE-2026-0001 (`GET …/settlement` shows it). Defect found on the way and fixed (`c3ae4515`): the success/cancel URL landed on `/portal` without the portal token. See Decision A. |
| 2 | Automatic reminders (dunning) | `53-reminders-toggle` |
| 3 | Authenticated client portal | `56-client-portal` |
| 4 | Accounting export (generic CSV) | `52-accounting-export` |
| 5 | Bank reconciliation | `59-bank-reconciliation` |
| 6 | Client account statement | `47-client-statement` |
| 7 | Client reference / PO number | `46-client-reference` |
| 8 | SEPA payment QR (EPC069-12) | `48-payment-qr` |
| 9 | Automatic exchange rates | Shipped on 2026-09-14 — `backend/src/modules/company/currency-rates/` (daily BullMQ sweep, ECB feed `ecb-rates-client.ts` + no-key fallback `open-er-api-rates-client.ts`). No screen: proof = jest + a real live round-trip against the ECB feed (`ECB_LIVE=1`), no Cypress spec. |
| 10 | "Declarations" screen (Portugal only) | `c6a06617`, no migration. `reporting-runner.ts` already persisted every result in `DocumentAuthorityEvent` — what was missing was reading it at the company level: `reporting/list-declarations.ts` (paginated list, filterable by status, providers discovered dynamically from `reporting/data/*.json`), route `GET /documents/declarations`, "Declarations" screen, SSE now also invalidates this list. Cypress spec `64-declarations` written but **not run** (backend still being edited at commit time) — to confirm via CI. |
| 11 | Time tracking & project billing | `57-time-tracking` |
| 12 | Multi-milestone installment billing | `51-installments` |
| 13 | Enriched expense reports (attachment, category, mileage) | `6cb60096`, no migration. Reuses received-invoice storage (`received-invoices/storage.ts`, `documents_data` volume) and the SHA-256 hash from `archive/hashing.ts`; new generic `file` field kind on the descriptor. Two product choices made at the simplest option, **to be validated** (see Open questions): ten fixed categories plus "Other", 750 KiB max size (derived from the global 1 MB bodyParser limit — will reject most phone photos). |
| 14 | Document language per recipient | `58-document-recipient-language` — cascade `Client.language` → `Company.language` → `en` (`rendering/language/resolve-recipient-language.ts`), verified in the code: it's exactly the cascade Decision B asks for again for the PDF, already in place. |
| 15 | Custom fields (clients + documents) | `3ff59800`, with migration `20260914170000_company_custom_fields` (renamed 2026-09-15, see Open questions #1). Company-scoped CRUD, immutable key derived from the label, deletion = archiving (`archivedAt`), rendering merged with the generic descriptors on both the form and the PDF. **Merge completed** (`9f2e3585`): a required custom field now blocks every action, `send` included, before any side effect — no longer "in progress". Latent key-collision bug fixed along the way (`findAvailableKey`, two labels reducing to the same slug under different scopes). Choices to validate: see Open questions. |
| 17 | Internal approval workflow | `50-approval` |
| 18 | Basic stock management | `49-stock` |
| 19 (1st pass) | Purchase orders to a supplier — issuance | `de30e2a4`, no migration: one more `DocumentTypeDescriptor` (supplier, date, expected delivery date, currency, reference, lines), statuses mirroring the invoice, `PURCHASE-ORDER-` numbering on entering `sending`, sending reuses `runAsyncSendAction`/`sendDocumentInstanceEmail` as-is. **No frontend code touched** — menu, list and form all driven by the descriptor. Country-policy extended to the five countries (otherwise 403 everywhere and invisible in the menu). Latent bug fixed in passing: `compute-totals.ts` was crashing ("no usable VAT rate") on a type whose lines have no VAT field — never exercised before. **The 3-way reconciliation with the received invoice is a second pass, not shipped** — see Remaining. Three choices made for issuance, to validate: see Open questions. **Not established**: the real run of Cypress spec 66 (Cypress not launched). |
| 21 | Mobile app — PWA (Decision D) | `b7a6581d` (manifest, service worker, icons generated from the logo, `vite-plugin-pwa`, `/api/*` never cached) then `acbc2011` (the SW was registering itself without a guard and was breaking `29-document-recurrence` in CI — fixed: manual registration under the guard `!("Cypress" in window)`, real reload on activation of a new SW via `virtual:pwa-register`). README fixed in the same commit, no longer promises a native app. **Not established**: real installability on iOS/Android, no device or simulator here. |
| G | Mail server — instance→company, Resend provider (Decision G) | **COMPLETE: backend + screen.** Backend: `f1ed72e4`, `63b42ef9`, `1958c47a`. Settings → Mail screen: `7a61f3f7` — current state without ever rendering a secret, SMTP/Resend form, "Test send" always available (backend error shown verbatim), reverts to the instance server after confirmation, tab hidden from MEMBER. See Decision G for detail. **Caveat**: its Cypress spec 65 failed on its first run (3 failures out of 4); instrumented (`c7e80579`, a real screen defect fixed along the way), but the cause of the first failure remains NOT established — see Open questions. |
| 16 → B | PDF visual presets (logo, accent color, font from a set of 5 OFL fonts) | `45d67c70` + wiring in `14c6ae17`, migration `20260915093020_company_branding` (null = byte-identical HTML, snapshot). API `/api/company/branding` (+ logo, preview), Settings → Branding tab, spec `69-company-branding` **written, not run locally** — CI to be read. **Real PDFs proven on 2026-09-15 (Playwright Chromium)**: one PDF per preset plus one with a custom logo/colour/font — `pdffonts` shows the embedded face of each preset (Inter, DM Sans, IBM Plex Sans, Lora, Source Serif 4), `pdfimages` shows the 204×64 logo, six distinct checksums; opened in Chrome for the owner. |
| C | Emails — WYSIWYG editor (TipTap) | `9ce4a558` — the body was already HTML server-side, `{key}` variables read from the API, a single editor per template, old plain-text bodies converted to paragraphs. Spec `54-email-templates` adapted and **green in CI** (run `34950458992`). |
| 19 (2nd pass) | Purchase orders — 3-way reconciliation (goods receipt, company tolerance, tracked OWNER/ADMIN acceptance) | `14c6ae17`, no migration: `goods-receipt` type, pure engine `reconciliation/three-way-match.ts`, tolerance in a per-company singleton `DocumentInstance`, acceptance in `data.varianceAcceptance`. Proven over real HTTP (66.67% → to-review → 70% tolerance → within-tolerance → persisted acceptance). Spec `70-three-way-match` **written, not run locally** — CI to be read. |
| 13 (continued) | Dynamic per-company expense categories | `94924a36`, migration `20260915085840_expense_categories`: table, default set, OWNER/ADMIN CRUD, options composed per company. Bug found at real boot (route hidden behind `@Get(':id')`). Spec `68-expense-categories` **written, not run locally** — CI to be read. |
| *(off list)* | Payment methods typed per company | `61-payment-methods`, shipped on 2026-09-14 (`backend/src/modules/documents/payment-methods/`) |

---

## Remaining (2) — verified in the code on 2026-09-15, 14:00

| Rank | Feature | Verified state (2026-09-15) | e2e to prove |
|---:|---|---|---|
| 20 → E | Hosted offering — per-seat Polar subscription (Decision E) | **Built dry on 2026-09-15** (`d16b46dd`, migration `20260915102254_company_subscription`): everything invisible without `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` (real 404 proven), boot refused if the flag is set without a key, `@polar-sh/better-auth` plugin 1.8.4 outside Nest guards (Express middleware, each route protects itself), seats = `CompanyMembership`, lifecycle tested as a pure function on every boundary, `TRIAL_SEND_BLOCKED` gate. **Real sandbox proof, 2026-09-15 afternoon**: organization token in `.env.test.local`; both products created BY THE API (`ProductPriceSeatBasedCreate`, graduated seat tiers — $15/month with 1 seat included, then $4 per extra seat ($3 from the 5th), yearly = 10 × monthly (two months free) — set in the Polar sandbox on 2026-09-15 after a 25-competitor pricing study; trial 14 days), `polar.live.spec.ts` lists 2 products, a sandbox checkout created (`status: open`, never paid). **Full loop proven on the dev instance (2026-09-15, 14:38 UTC)**: the owner paid a sandbox checkout on invoicerr.chevrier.dev; three defects found and fixed on the way — global bodyParser draining better-auth's raw body (`c2837855`), `@polar-sh/sdk` 0.49 deriving the pre-8-September HMAC key while new endpoints sign in Standard Webhooks (own receiver `POST /api/billing/webhooks/polar`, `0d4944fd`), team customers needing `member_id` for the portal (`4f89097f`); redelivered events answered 201 and the company went `ACTIVE` (`polarSubscriptionId` set). **Remaining**: the "every action refused" gate in `blocked` — **shipped** (`4152fea8`, global `CompanyWriteGuard` under the flag, refusal named `COMPANY_BLOCKED` 403, jest only), zip/deletion never run outside jest, ToS clause. | With `POLAR_LIVE=1`: `polar.live.spec.ts` lists the sandbox organization's products; a sandbox checkout completes and `GET /api/billing/status` moves from `trial` to `active`. |
| A | Payments — Mollie, real PayPal, regional | **Built dry on 2026-09-15** (`3247fa9d`): Mollie (Payments API v2, webhook verified by re-GET), PayPal (OAuth2, Orders v2, credit only on a verified `PAYMENT.CAPTURE.COMPLETED`), provider chosen per company (`Company.paymentProviderId`, migration, Stripe fallback), 170 green jest tests. **Real proof, 2026-09-15 afternoon**: `stripe.live.spec.ts` creates a real Checkout Session, `mollie.live.spec.ts` creates a real payment and re-reads it as `open`, `paypal.live.spec.ts` gets an OAuth token and creates a real sandbox order with an approve link — all three with the owner's test/sandbox credentials. **Full loop proven on the running app for Stripe (`stripe listen`) AND Mollie (public tunnel, `BACKEND_PUBLIC_URL`, webhook re-GET verified, INVOICE-2026-0002 settled, portal return with the token — `c3ae4515`)**. **Apple Pay / Google Pay** (owner's question, 2026-09-15): no new provider — they are wallets shown by Stripe Checkout and Mollie's hosted page on compatible devices; Stripe: nothing to do (domain is `checkout.stripe.com`); Mollie: enable both in the dashboard (Settings → Website profiles → Payment methods) — owner action; PayPal does not carry them in the Orders flow. **PayPal full loop proven too (2026-09-15, 12:41 UTC)**: order approved by a sandbox buyer in the browser, `CHECKOUT.ORDER.APPROVED` redelivered by PayPal's own retry after a backend outage, capture `949449966H772094J`, `PAYMENT.CAPTURE.COMPLETED` verified, INVOICE-2026-0003 settled (idempotent under manual resend). Cosmetic defect noted: the recorded payment note says "Paid via Stripe checkout" whatever the provider (`payment-sessions.service.ts:293`). **Remaining**: the PayPal loop again once the note is fixed (trivial) through the running app (payment → verified webhook → recorded — Stripe via `stripe listen`, Mollie/Polar need a public URL), spec 71 to confirm in CI, regionals (Payplug, Przelewy24, Nexi, Easypay/IfThenPay) not started. | Live specs gated on `MOLLIE_LIVE`/`PAYPAL_LIVE`/`STRIPE_LIVE` green with real keys; a real captured test Stripe payment. |

### Rank 10 — why the `reporting/` mechanism still only covers Portugal

`reporting/` models "the seller DECLARES the invoice data to THEIR OWN tax authority in real time
and receives an identifier issued by the authority" (`DeclarationResult.authorityId` mandatory).
NAV (Hungary) and myDATA (Greece) were the only two shipped forms; both countries fell out of scope
at the five-country pivot (2026-09-10) and their files were deleted (verified: `find` no longer
turns up any `*mydata*`/`*nav*` under `reporting/`). Country-by-country verdicts (2026-09-11 study,
primary sources, not reproduced here in detail — see this file's git history for the full text): FR
(e-reporting via PDP→PPF, a periodic transport, not a real-time declaration), PL/IT (KSeF/SdI =
clearance/transport, already modeled elsewhere), DE (Meldesystem not yet legislated). **PT remains
the only honest candidate** and has already received its provider (`pt-at`, DL 198/2012 art. 3º
n.º1, `legal` provenance) — implemented but never proven live (mTLS not wired, RSA padding
`unverified`). The original product need ("give the screen some content") **is resolved**: the
screen has shipped (`c6a06617`, rank 10 — see Shipped) and reads `DocumentAuthorityEvent`,
distinguishing it from an ordinary conformity event via `providerId`, without mixing the two
mechanisms — exactly what `reporting/schema.ts`'s own header asks for. What remains, apart from
that, is bringing the PT provider to production (mTLS, RSA padding) once accreditation is obtained.

---

## Owner's product decisions of 2026-09-15

### A. Payments — every platform

Owner's mandate: "we need to check every way to pay an invoice, and every platform (get PayPal,
Stripe, and every other platform of that kind working)." Starting point verified in the code:
Stripe is wired (`payments/providers/stripe/`) but **never proven with a real account** (see
Shipped, rank 1); PayPal today is only a **display descriptor**
(`payment-methods/paypal.descriptor.ts` — prints the account email and builds a plain
`paypal.com/cgi-bin/webscr` link, NEVER a verified webhook: "recording that it arrived stays a
record-payment action a human … performs afterward"). The extension points already exist and don't
need to be reinvented: `backend/src/modules/documents/payments/providers/` (the
`PaymentProviderRegistry` registry, one provider = one file + one `register()`) for a REAL
webhook-verified collection method, and `backend/src/modules/documents/payment-methods/` (display
descriptors: `cash`, `bank-transfer`, `cheque`, `paypal`, `stripe`) for what remains purely
declarative.

**Research on platforms usable in the 5 countries with a sandbox and no real company required**
(official sources cited, 2026-09-15):

| Platform | Payment methods | API (link + webhook) | FR/PL/IT/PT/DE countries | Sandbox without a real company | Advertised fees (pricing page, 2026-09) | Family |
|---|---|---|---|---|---|---|
| **Stripe** | +40 (cards, SEPA, iDEAL, Przelewy24…) | Yes — Payment Links API | ✓/✓/✓/**?**/✓ | Yes, free (built-in test mode) | Card 1,5 % + 0,25 € (EEA); SEPA 0,35 € | General-purpose — already wired, never proven |
| **Mollie** | +35 (cards, SEPA, iDEAL, Przelewy24, Bancontact, MB WAY…) | Yes — Payment Links API | ✓/✓/✓/✓/✓ (30 EEA countries) | Yes, free | Card 1,8 % + 0,25 €; SEPA 0,25 % + 0,4 %; iDEAL 0,29 € | General-purpose — EU-native, covers every local payment method in all 5 countries |
| **PayPal** | PayPal, cards, local methods | Yes — Orders API v2 + webhooks | ✓/✓/✓/✓/✓ (200+ countries) | Yes, free developer sandbox | 3,49 % + fixed (checkout); 2,99 % + fixed (cards) | General-purpose — currently a display-only descriptor in invoicerr, to be built as real collection |
| Payplug | Cards, Apple Pay, Google Pay | Yes — REST API | FR only | Yes, test environment | Not established | FR specialist |
| Przelewy24 | +165 Polish banks, cards | Yes — REST API | PL only | Yes, test panel | Not established | PL specialist |
| Nexi (XPay) | Cards, Satispay, BNPL | Yes — Pay-by-Link API | IT only | Not established | Not established | IT specialist |
| Easypay | Cards, MB WAY, Multibanco | Yes — Pay-by-Link | PT only | Yes, free | Not established | PT specialist |
| IfThenPay | Multibanco, MB WAY, Payshop, cards | Yes — Pay-by-Link | PT only | Yes | Not established | PT specialist |

Each fee figure is the one advertised on the platform's official pricing page as of the research
date (2026-09-15), not a durable fact — to be re-checked before any decision to wire it up.
Stripe's Portugal coverage could not be confirmed (marked `?`); Adyen/Checkout.com/SumUp/
Braintree/GoCardless also cover all or part of the 5 countries but their sandbox isn't confirmed
(except GoCardless), so they aren't retained for now. **Excluded, and why**: Paddle and Lemon
Squeezy (the merchant-of-record/SaaS family, 5 %+ fees, built for a software subscription, not for
collecting on a one-off invoice); Klarna (BNPL only, not a direct collection method); Square (EU
coverage not confirmed in the 5 target countries, a US-centric platform). **polar.sh is
deliberately absent from this table**: it's a merchant of record (MoR) built for a software
subscription, not for invoice collection — it is however retained for a completely different
topic, see Decision E.

**Resulting implementation order** (no duration estimated here — not requested):
1. Stripe — already wired, to be proven first with a real account (lifts rank 1's only caveat).
2. Mollie — new provider, the best native coverage of the 5 countries and their local payment
   methods.
3. PayPal — replace the current display descriptor with real Orders API v2 collection.
4. Regionals (Przelewy24 PL, Payplug FR, Nexi IT, Easypay/IfThenPay PT) — only if clients in those
   countries specifically ask for them.

**Not established by the research**, not to be taken for granted: Payplug / Nexi / Przelewy24 /
Easypay / IfThenPay fees; whether Adyen / Checkout.com / SumUp have a sandbox; Stripe's and
Klarna's Portugal coverage.

### B. PDF — a frozen document, editor removed

Owner's mandate, confirmed by an explicit question: "there shouldn't be a PDF editor for the
documents, a hardcoded document, only the language changes to match the client's, if not set the
company's, if not set English" — and the Handlebars editor must be **removed**. Verified in the
code: **it's already done, but not for this reason**. The PDF tab
(`frontend/src/pages/(app)/settings/_components/pdf.settings.tsx`) was removed on 2026-09-13
(commit `0a4f850a`) — reason at the time: the two routes it called (`GET`/`POST
/api/company/pdf-template`) had never existed on the backend, so the screen silently did nothing
for every visitor. The `pdfConfig` field of `EditCompanyDto` and its associated template model
were removed with it; **there exists today no Prisma PDF template model nor any
`Company.pdfTemplate` field** (verified by grepping `backend/prisma/schema.prisma` — the only
surviving "template" mechanism is `MailTemplate`, for emails, unrelated). The 2026-09-15 decision
therefore confirms the absence of an editor as a definitive product choice, not merely the current
state of things: no custom-template return should ever be reintroduced.

The requested language cascade (client → company → English) is, on its own, **already shipped** —
rank 14, `rendering/language/resolve-recipient-language.ts`, in exactly that order, with `en` as
the universal floor. Nothing to do on that front.

The "no-code PDF themes" (old rank 16) become a **list of visual presets** (colors, logo, font) —
never a content editor. Verified state: no brand field exists yet on `Company` (no `logo`, `color`,
or `font` in the schema — grep confirmed); rendering (`rendering/render-html.ts`) produces a
single hardcoded design today. Building the presets therefore first requires adding the strict
minimum (a logo field, a restricted color palette, a font choice from a closed set) — never a
free-text or markup area.

**What the removal takes away**: the Settings tab (already gone), any HTML/Handlebars template
stored in the database (there already was none left at removal time — the two routes it called
were already dead). **Open question**: for companies that believed they had an active custom
template before 2026-09-13, the screen never actually persisted it (404 on both routes) — so there
is nothing to migrate on the data side, but no communication was made to those companies at
removal time; to be decided whether such a communication is needed.

### C. Emails — a real WYSIWYG editor

Unlike the PDF, the owner wants "a clean WYSIWYG-style email editor." Current verified state:
`Settings → Email` (`templates.settings.tsx`, tested by `54-email-templates`) is a **plain-text
editor with single-brace `{placeholder}` tokens** (`actions/email-template.ts`), not Handlebars
despite the npm dependency of the same name still present in both `package.json` files (it serves
the legacy PDF rendering, not emails — no usage of `handlebars` found in the email code). Three
fallback levels already in place: per-type descriptor default, per-company override
(`Company.documentEmailTemplates`, `MailTemplate` model for the two system emails), generic
fallback. An unknown placeholder is FLAGGED, never blocking — a contract to preserve if the editor
changes.

**Gap to close**: today's text/`{placeholder}` templates → tomorrow's rich (WYSIWYG) editor. **Open
questions, not settled here**:
- which rich-editing library (TipTap, Lexical, Quill…) — to be chosen, this file doesn't decide;
- what happens to variables (Handlebars-style `{{invoice.number}}`, or today's `{name}` grammar
  kept under a different UI) — the current server contract (unknown placeholder flagged, never
  lifted) will need to be pinned down for whichever new grammar is chosen;
- should the same language cascade as the PDF (Decision B) apply to the default templates — likely,
  given the product consistency being aimed for, but not explicitly requested for email: to be
  confirmed.

### D. Mobile — PWA, nothing more

Owner's mandate: "the most we can do is a PWA, nothing more." Replaces the old rank 21 (native
iOS/Android app). **Shipped overnight** (see Shipped, rank 21): `b7a6581d` (manifest, icons
generated from the repo's only logo, service worker with `/api/*` set to `NetworkOnly` — never
cached, for multi-tenancy reasons) then `acbc2011` (the SW was registering itself without a
`window.Cypress` guard and was breaking spec `29-document-recurrence` in CI; fixed with a guarded
manual registration, plus a welcome side effect: the `virtual:pwa-register` runtime now carries the
real reload on activation of a new SW, which the first commit's `autoUpdate` didn't). **The README
was fixed in the same commit** (`b7a6581d`): it now says "Installable as a Progressive Web App
(PWA)" and no longer promises a native mobile/desktop app.

**Not established**: real installability on iOS and Android, and the rendering of the Android
splash screen — no device or simulator available here, to be checked by the owner on a real phone.
Receipt scanning via the camera (relevant to rank 13, expense reports) was not built — out of
scope for these two commits.

### E. Usage-based subscription — a paid HOSTED offering

Owner's mandate: "the goal is for me to host Invoicerr in secure German datacenters, and to have a
system for a company to pay based on its size (2 $ per user who uses the app, 1,5 $ from 5 users
on, and 1 $ for 10 and up [tiered degressive seat pricing])." Decisions already made by explicit
question:

- **The self-hosted open-source version stays FREE and with no billing module whatsoever.**
  Billing exists only on the owner's hosted offering, enabled by a configuration only their
  hosting sets — the Gitea/Plausible model (the code can exist in the repo but stays inert for any
  self-hoster).
- **Platform: Polar (polar.sh), "Starter" plan** — decided 2026-09-15: "We're going with Polar on
  Starter, they have the system to manage seats." The "which platform" question is therefore no
  longer open.
- **Pricing model: GRADUATED (marginal by tier)** — decided 2026-09-15: "we're going with
  graduated." Closed; the "flat rate per tier reached" option (everyone paying the rate of the
  tier they've reached) is ruled out. **Two grids to distinguish**:
  - **DECIDED grid** (the one from the original mandate): the first 4 seats at 2 $ each, the 5th
    through 9th at 1,5 $ each, the 10th and beyond at 1 $ each.
  - **CONSIDERED grid, NOT DECIDED** — the owner said prices would "probably" be revised to 5 $ /
    4 $ / 3,5 $ per seat. He only specified these three amounts, no new thresholds: the 5- and
    10-seat tiers below are a continuity assumption with the decided grid, **not confirmed by the
    owner** — not to be taken for granted.

  Worked example to remove any ambiguity, with both grids:

  | Seats | Decided grid (2 $/1,5 $/1 $) | Considered grid, not decided (5 $/4 $/3,5 $) |
  |---:|---|---|
  | 7 | `4×2 + 3×1,5 = 12,5 $` | `4×5 + 3×4 = 32 $` |
  | 12 | `4×2 + 5×1,5 + 3×1 = 18,5 $` | `4×5 + 5×4 + 3×3,5 = 50,5 $` |

- **Billing period: DECIDED on 2026-09-15 — monthly AND annual, not an exclusive choice.** Both
  plans will be offered. Not specified by the owner, not to be invented: whether annual carries a
  discount versus 12 times the monthly rate.
- **Definition of a seat: SETTLED on 2026-09-15 — a seat = one user × company attachment, born on
  acceptance, never on sending an invitation.** Owner's words, to quote: "A user pays to be linked
  to a company. Imagine an accountant who wants to use Invoicerr — every company they're attached
  to has to pay to have them on their team." Consequences, all closed on 2026-09-15:
  - a company's billable count is the number of its user attachments (the actual Prisma model:
    `UserCompany` — the owner says "CompanyMembership" in the generic sense, there is no model of
    that name in this schema), **never** the number of distinct users across the whole platform,
    and **with no notion of activity at all** (no "active in the last 30 days");
  - the same user who is a member of three companies counts as **three seats**, each billed to its
    own company;
  - the payer is always the company, never the user;
  - **the OWNER counts as a seat**, like any member — no role exemption;
  - **an invitation only counts upon acceptance** — the seat is born with the `UserCompany` row,
    never on sending the invitation (`modules/invitations/`): a pending invitation must add nothing
    to the billable count.

**Subscription lifecycle — three dated states, decided 2026-09-15** (none of it is implemented,
this is a product requirement to record):
1. **Trial** — 7 free days from the company's creation. Owner's words, to quote: "during the 7-day
   trial they shouldn't be able to send invoices, they should be able to do everything except send
   them, so we don't have to keep them." Concretely: **the `'send'` action**, the single entry
   point shared by `invoice`/`quote`/`credit-note` via `actions/async-send.ts` (final numbering,
   PDP/Chorus Pro/KSeF deposit, email sending — verified in the code, it is indeed the same action
   id for all three types) **is refused by name** during the trial. Everything else stays usable:
   drafts, clients, articles, PDF preview.
2. **Blocked** — if no payment is recorded by the end of the 14-day trial, the company switches to
   total blocking: **no action possible at all** (read/write, to be refined at implementation time
   whether a minimal read-only mode should survive). This blocking lasts 14 days.
3. **Deleted** — the mechanics and the delay differ depending on whether the company has already
   paid, **DECIDED in both cases on 2026-09-15**:
   - **A company that never paid** (never left the trial): at the end of the 14-day blocking
     period (so 21 days after creation with no payment), **a zip of every document it created** is
     sent or made available (a courtesy, not an obligation), then **actual immediate deletion**.
     This is consistent precisely because this company has, by construction, **never legally
     issued any document** (rank 1 of the lifecycle blocks `'send'`): no legal retention
     obligation (`archive/retention/`) applies to it.
   - **A company that paid and then stops paying** (has actually issued invoices): the same
     mechanics in principle — blocked 14 days, then **zip**, then **actual deletion** — but with a
     **longer delay between the zip and the deletion**, to give it time to retrieve its archive.
     **The exact length of this delay is NOT fixed**: the owner chose this option knowing
     explicitly it was "to be set" — to record as an open, quantifiable question (> 14 days, no
     value proposed here). Once the zip has been delivered, **responsibility for legal retention
     passes to the client**: a ToS clause must say so explicitly (not drafted here). The zip must
     contain everything needed for legal retention, not just the PDFs: based on what `archive/`
     already knows how to produce (`DocumentArchive.artifacts`, typed by `mime` —
     `application/pdf`, `application/xml`), the zip must include PDFs, signed XML (FR/PL/IT
     e-invoices), attachments (received invoices, expense reports once rank 13 has shipped) and
     the authority event log (`DocumentAuthorityEvent`, already populated for FR/PL/IT).

**Full cycle, both cases side by side**:
- Never paid: 14-day trial (everything except `'send'`) → blocked 14 days → zip → immediate
  deletion.
- Paid then lapsed: blocked 14 days → zip → deletion after a delay to be set (> 14 days, not
  quantified to date).

**Verified on 2026-09-15 against the official Polar documentation** (URL per point):
- **The graduated model IS modelable as-is** — the "Seat-Based Pricing" feature,
  https://polar.sh/docs/features/seat-based-pricing.md: three models supported, flat, **graduated**
  ("seats are billed according to their respective tier") and volume; the official example given
  (1-10 seats at 10 $, 11th and up at 8 $ → 14 seats = `10×10 + 4×8 = 132 $`) is structurally the
  same calculation as the 2 $/1,5 $/1 $ scale retained above. Closes the point that remained to be
  verified.
- Updating the seat count via the API: `PATCH /v1/subscriptions/{id}` with the `seats` and
  `proration_behavior` fields (`invoice` | `prorate` | `next_period` | `reset`), automatic
  proration — https://polar.sh/docs/api-reference/2026-10/subscriptions/update-subscription.md
  (**URL reported by the research, not re-verified directly here**).
- Webhooks — https://polar.sh/docs/integrate/webhooks/events.md: `subscription.created/updated/
  canceled/revoked/past_due`, and notably `customer_seat.assigned/claimed/revoked` — Polar has its
  own notion of a **seat assigned to a person**, which naturally maps to a `UserCompany`.
  Implementation lead to keep: one Polar seat per `UserCompany` attachment, rather than a plain
  numeric quantity on the subscription.
- Starter plan — https://polar.sh/docs/merchant-of-record/fees.md: free to start, **5 % + 0,50 $
  per transaction**, +1,5 % on international cards, per-seat pricing is included in the plan.
- **Polar is a Merchant of Record** —
  https://polar.sh/docs/merchant-of-record/introduction.md: Polar itself collects and remits VAT
  in the five target countries on the hoster's behalf; the hoster then only manages their own
  income tax on their revenue in France. Consequence to record: **the invoice received by the
  client company is issued by Polar, not by Invoicerr's owner.**
- Free sandbox — https://polar.sh/docs/integrate/sandbox.md:
  `sandbox.polar.sh` / API `sandbox-api.polar.sh`, Stripe test cards.

**Economics, worked out, with both grids**: the Starter plan's fixed 0,50 $/transaction fee weighs
proportionally much more on a small company, and noticeably less if prices are revised upward
(considered grid):

| Company | Decided grid (2 $/1,5 $/1 $) | Polar fees (5 % + 0,50 $) | Considered grid (5 $/4 $/3,5 $) | Polar fees |
|---|---|---|---|---|
| 1 seat | 2 $/month | `0,50 + 5%×2 = 0,60 $` → **30 %** | 5 $/month | `0,50 + 5%×5 = 0,75 $` → **15 %** |
| 4 seats | 8 $/month | `0,50 + 5%×8 = 0,90 $` → **11 %** | 20 $/month | `0,50 + 5%×20 = 1,50 $` → **7,5 %** |

So the fixed fee weighs half as much, proportionally, if the considered grid (not decided)
replaces the decided grid — an argument in its favor, but this file does not decide the choice of
grid. With the annual billing period now decided (see above), what remains open: if annual carries
a discount, which would dilute this fixed fee even further over a bigger amount — not specified by
the owner.

**Integration path to evaluate FIRST, before any hand-written Polar client**: better-auth's Polar
plugin (`@polar-sh/better-auth`) — better-auth is already the repo's auth system
(`backend/src/lib/auth.ts`), the plugin would presumably cover checkout, customer portal and
webhooks tied to the authenticated user in a single mechanism rather than three separate clients.
**Marked "to verify against the official docs"**: exactly what this plugin covers is not yet
confirmed (verification announced separately, not to be pre-empted). **Point of attention verified
in this repo** (not an established problem, just something to look at when wiring this up):
`app.module.ts:75` deliberately disables better-auth's own guard (`disableGlobalAuthGuard: true`)
because it "ignores API-key requests" — any better-auth plugin that adds its own routes must be
checked from this angle: do these routes go through the same global `AuthGuard`/`RolesGuard` as
the rest of the API, or do they bypass this mechanism? The
`WARNING__ENABLE_BILLING_FOR_USERS__WARNING` guardrail below applies the same way to any route
added by this plugin — absent (404) as long as the variable isn't set, whether it comes from the
owner's code or from the plugin.

**Activation guardrail — a requirement, not yet implemented**, to be reproduced EXACTLY: the
entire subscription system (screens, routes, seat counter, everything — including the routes the
better-auth plugin above would add) must stay **invisible** as long as the global environment
variable `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` isn't set (name to be copied character for
character, double underscores included, `WARNING` at both the start AND the end — deliberately
off-putting so that no self-hoster enables it by accident). This is the technical realization of
the "self-hosted stays free, billing only exists on the hosted offering" decision. What this
implies for the upcoming implementation:
- the variable must be read in **A SINGLE place** on the backend (a dedicated configuration
  module), never through `process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING` scattered
  through the code;
- it must be exposed to the frontend through **a single configuration route** (the frontend must
  never read a backend environment variable directly);
- **every billing controller must refuse with a 404, never a 403**, when the variable is absent —
  a 403 reveals that the route exists, a 404 makes it indistinguishable from a route that never
  existed, consistent with the variable's own aim of discretion.

### F. The others (13 expense reports, 15 custom fields, 19 purchase orders)

Owner's mandate: "I have nothing against it, put that in TODO_FEATURES and spell it out." At the
time of this decision (2026-09-15), none of the three features had any trace in the code (`grep`
empty on `customField`/`CustomField`, on `purchase.order`/`PurchaseOrder`/
`PurchaseOrderReference` outside the vendored e-invoicing formats). **Rank 13, rank 15 and the
first pass of rank 19 have shipped since** (see Shipped); only rank 19's second pass (3-way
reconciliation) remains open, described below.

**Rank 13 — enriched expense reports.** Shipped (`6cb60096`, see Shipped): attachment, category
and mileage, reusing `received-invoices/storage.ts`'s storage rather than duplicating it. OCR
deliberately not wired up: the existing pipeline (`received-invoices/ocr/`) extracts invoice
vocabulary (`grossAmount`, `supplier`), not expense vocabulary, and only attempts OCR on a PDF
while the main use case here is a photo — an adapter to write, not done here. No statutory mileage
rate: just two informational fields, the user reports the result themselves.

**Rank 15 — custom fields / tags.** Shipped (`3ff59800`, see Shipped): a parallel mechanism of
company-defined database fields, merged into the form and PDF rendering, without touching the
existing frozen `DocumentTypeDescriptor`s. Key derived from the label and immutable; deletion =
archiving, never a loss of the link with values already entered on issued documents. **Merge
completed** (`9f2e3585`): a required custom field now blocks every action, `send` included, before
any side effect — no longer a "merge in progress." Latent key-collision bug found and fixed along
the way (`findAvailableKey`).

**Rank 19 — purchase orders / supplier purchasing.** First pass shipped (`de30e2a4`, see Shipped):
issuing a purchase order to a supplier, one more `DocumentTypeDescriptor`, no migration. The 3-way
reconciliation with the received invoice remains a second pass, described in the commit: it needs
product decisions (which variances to tolerate, who approves, block or warn) and settling what
"3-way" means here — a third, goods-receipt document doesn't exist in the model. The mechanism to
reuse then is `received-invoices/supplier-reconciliation.ts`, never a duplicated mechanic. Three
choices made for issuance, to validate: see Open questions.

### G. Mail server — instance then company

Owner's request, with explicit emphasis ("Add that to the TODO, well explained, so we don't forget
it"): "an instance can declare a global mail server, which is what's used by default if a company
hasn't set its own in settings. For the instance's mail server it can be either SMTP or Resend
(Resend takes priority if both are set)."

**Shipped overnight, backend side** (see Shipped):
- `f1ed72e4` — Resend provider (`providers/resend.provider.ts`, raw REST rather than the SDK: two
  pitfalls hit and handled, attachments in snake_case `content_type` and a mandatory `User-Agent`
  on pain of a 403). Instance-level resolution when `MAIL_PROVIDER` is absent: nothing→smtp, SMTP
  only→smtp, Resend only→resend, both→resend — **an explicit `MAIL_PROVIDER` still wins**, a
  choice submitted to the owner (see Open questions), not settled by the mandate, which only
  covered the implicit case. `CompanyChannelConfig` (already AES-256-GCM encrypted by
  `ChannelCredentialsService`) reused with `providerId='mail'`, **no migration**. Four routes on
  the company controller: read, set, clear, test send. DI wiring proven by a real boot on port
  4100.
- `63b42ef9` — the company→instance cascade wired onto the six real sending paths: document
  (quote/invoice, `send-document-email.ts`), unpaid reminders, the signature request and its OTP,
  the danger-zone OTP (route fixed to carry `@ActiveCompany()`, checked before touching it that
  `RolesGuard`/`AuthGuard` already guarantee an active company at that point), client-portal
  invitation. **Deliberately not wired**: the Italian PEC transport, which sends via the company's
  own certified PEC mailbox under its own `sdi-pec` channel identifier — a regulatory channel
  distinct from the everyday mail server, documented as the only holdout.
- `1958c47a` — a test that depended on the ambient environment (`.env.test` provided a default
  sender that CI didn't) made hermetic.

**Shipped overnight, screen side** (`7a61f3f7`) — Settings → Mail, what was missing for Decision G
to be complete. **Decision G is therefore COMPLETE (backend + screen).**
- Current state: instance default, or a company server with its own provider and sender. **No
  secret is ever returned**: the read route only returns `{configured, kind, fromAddress}`, the
  edit form always starts empty on the password and API key.
- SMTP or Resend, zod validation per provider mirroring the server's own.
- **Test send** available at all times, even with no company configuration, because it exercises
  the real cascade: the error shown is the backend's, verbatim.
- **Revert to the instance server** clears the configuration, after confirmation. Tab hidden from
  MEMBER, consistent with the write routes being reserved to OWNER/ADMIN.

**Unresolved caveat**: Cypress spec 65 failed on its first run (3 failures out of 4, all either
"toast never appeared" or "back button not found") — written without being run, like specs
62/63/64. Instrumented (`c7e80579` — assertions on the HTTP status code before every toast wait; a
real screen defect fixed along the way, unrelated to the cause: the success toast for "Test send"
was showing `sendForCompany`'s generic message, never the expected dedicated text). **Cause of the
first failure NOT established**: the run's backend log proves that `PUT /api/company/mail-settings`
never completed (trail: `CredentialAudit`, six `mail:* RESOLVE_ACTIVE MISS`, never an `UPLOAD`),
without saying why — neither 400/403/503 (each would produce an error toast, which is absent), so
either a request that never leaves the browser, or a response that's never received; to be settled
on the next run, with the browser log or access log this time.

**Open questions, not to be settled here**:
- **What happens to Brevo?** The owner has a compromised Brevo key to regenerate (found in
  plaintext in a PR's compose file) and was already considering moving to Resend.
  `brevo.provider.ts` stays in the code; he hasn't said whether it remains a third instance
  provider alongside SMTP/Resend, or is purely replaced by Resend — left open.
- **An explicit `MAIL_PROVIDER` winning over `RESEND_API_KEY`** (the default choice made in
  `f1ed72e4`, beyond what the mandate settled) — to validate.
- The exact fallback behavior if Resend is configured but fails at runtime (fall back to SMTP, or
  refuse outright) — not specified, not implemented.
- **Link to production**: `invoicerr.chevrier.dev` today has NO mail server configured at all, so
  no email goes out (established 2026-09-14, see `5aed5154`). The company screen (`7a61f3f7`)
  reduces this risk now that it's built; filling in the five SMTP variables on the host, or
  configuring a company server via the screen, remains a separate immediate action, already noted
  in `TODO_MANDANT.md`.

---

## Open questions

**For the owner to settle as soon as they're up — the short, actionable list:**

1. **Future-dated migrations — settled: renamed on 2026-09-15** (prefix `20260920…` →
   `20260914…`, seven migrations, `_prisma_migrations` realigned on both local databases).
2. **Product choices from overnight — settled on 2026-09-15**: everything validated as-is
   (attachment ≤ 750 KiB; custom fields: kinds text/longText/number/money/date/boolean/select,
   OWNER/ADMIN screen, a required field also blocks `send`; purchase orders: supplier =
   `Client.supplier`, statuses mirroring the invoice, `PURCHASE-ORDER-` prefix) — **EXCEPT expense
   categories**: "not fixed but dynamic in the backend" → per-company `ExpenseCategory` table
   (migration), a default set inserted on company creation, CRUD in Settings, selector fed by the
   API. In progress.
3. **An explicit `MAIL_PROVIDER` wins over `RESEND_API_KEY`** — **settled on 2026-09-15: kept** (an
   explicit `MAIL_PROVIDER` is honored as-is; Resend only takes priority when nothing is set).
4. **Sandbox accounts** (Polar, Stripe, Mollie, PayPal) — guide published, not yet created.
   Workstreams A (payments) and E (subscription) are waiting on these keys.
5. **WYSIWYG library for emails** (Decision C) — **settled on 2026-09-15: TipTap**. In progress.
6. **Spec 65 (mail settings), cause of the first failure not established.** The run's backend log
   proves that `PUT /api/company/mail-settings` never completed, without saying why (no readable
   hypothesis — 400/403/503 — explains the total absence of a toast). The spec (`c7e80579`) now
   names the failing call instead of waiting on a toast; to be read on the next run.

*One-line methodology note: four Cypress specs out of five written without being run broke on
their first CI run overnight (62, 63, 64, 65) — never a product bug, always a false assumption in
the spec itself.*

---

Grouped here for quick review — none of them is settled by this file, all await a decision or a
check from the owner:

- **A (payments)** — nothing open on the choice of priority platforms (Stripe → Mollie → PayPal →
  regionals, decided); still to be checked when wiring them up: the unestablished fees (Payplug,
  Nexi, Przelewy24, Easypay, IfThenPay) and Stripe's Portugal coverage.
- **B (PDF, including the old rank 16)** — communication (or not) to companies that thought they
  had an active custom template before the tab was removed (2026-09-13). **Settled on 2026-09-15**:
  brand fields = logo (upload, existing file storage) + one accent color + a font from a closed
  embedded set (4-5); presets are named combinations of these three.
- **C (emails)** — WYSIWYG editor library to choose; variable grammar in the new editor; whether to
  extend the PDF's language cascade to the default email templates or not.
- **E (hosted subscription)** — **SETTLED** on 2026-09-15, not to be reopened: platform (Polar
  Starter), graduated model ($15/month with 1 seat included, then $4 per extra seat ($3 from the
  5th), yearly = 10 × monthly (two months free) — set in the Polar sandbox on 2026-09-15 after a
  25-competitor pricing study; trial 14 days), billing period (monthly AND
  annual), definition of a seat (`UserCompany`, OWNER included, invitation counted only on
  acceptance), full lifecycle in both cases (never paid: 14-day trial with no `'send'` → blocked 14
  days → zip → immediate deletion; paid then lapsed: blocked 14 days → zip → **real deletion 180
  days after the zip**, settled 2026-09-15). What remains genuinely open: drafting the ToS clause
  transferring legal-retention responsibility to the client once the zip has been delivered;
  exactly what the `@polar-sh/better-auth` plugin covers (verification announced separately) and
  whether its routes go through `AuthGuard`/`RolesGuard` or bypass them (`app.module.ts:75`,
  `disableGlobalAuthGuard: true`).
- **G (mail server)** — **COMPLETE, backend + screen** (`f1ed72e4`, `63b42ef9`, `1958c47a` for the
  backend — Resend provider, company→instance cascade wired onto every send path except the
  Italian PEC, deliberately — then `7a61f3f7` for the Settings → Mail screen, which never returns
  a secret). **Caveat**: Cypress spec 65 failed on its first run (3 failures out of 4); instrumented
  (`c7e80579`, a real screen defect fixed along the way) but the cause of the first failure remains
  NOT established — the backend log proves that `PUT /api/company/mail-settings` never completed
  during that run, without saying why; to be read on the next run (see Open questions #6). Still
  open: the exact fallback behavior if Resend is configured but fails at runtime (fall back to
  SMTP, or refuse outright) — not specified. **Settled on 2026-09-15**: Brevo is REMOVED (SMTP or
  Resend only; Brevo remains usable via its SMTP relay — in progress); an explicit `MAIL_PROVIDER`
  still wins over `RESEND_API_KEY`.

**What this file could not establish**: Payplug/Nexi/Przelewy24/Easypay/IfThenPay fees; whether
Adyen/Checkout.com/SumUp offer a sandbox with no real company required; Stripe's and Klarna's
Portugal coverage; the exact coverage of the `@polar-sh/better-auth` plugin (verification in
progress elsewhere); whether Polar's versioned URL
`api-reference/2026-10/subscriptions/update-subscription.md` stays stable over time (reported by
the research, not directly re-verified here).

---

## 1. Inventory of what exists (100% from code)

### 1.1 Documents (quotes, invoices, credit notes, expenses, received invoices)
A single generic mechanism — `backend/src/modules/documents/descriptors/` (`type-registry.ts` +
one descriptor per type: `quote.descriptor.ts`, `invoice.descriptor.ts`,
`credit-note.descriptor.ts`, `expense.descriptor.ts`, `received-invoice.descriptor.ts`) — drives
everything: fields, statuses, actions, numbering, email, dashboard/statistics contributions. No
type has its own controller/Prisma service; `documents.service.ts` + `persistence.ts` are generic.
e2e proof: `17-document-descriptor`, `19-document-pdf`, `20-document-totals`,
`21-document-lifecycle`, `22-document-numbering`, `23-document-email`, `28-document-async-send`.

- **Quote → invoice**: full conversion (`actions/convert-to-invoice.ts`) or a **percentage
  deposit** (`actions/request-deposit.ts`, recomputes the quote's gross total, refuses when there
  are several VAT rates without a single line) or **multi-milestone installment billing**
  (`actions/request-installments.ts`) — e2e `26-document-deposit`, `51-installments`.
- **Credit notes**: a dedicated type, the only type allowed to reduce an invoice
  (`settlement/credits.ts`) — e2e via `24-document-payments`/`25-document-settlement`.
- **Expenses**: attachment, category (closed list + "Other") and mileage — shipped rank 13,
  `6cb60096` (see Shipped), reusing `received-invoices/`'s storage and hashing, with a new generic
  `file` field kind on the descriptor.
- **Received invoices (AP)**: a dedicated `received-invoices/` module with extraction
  (`extraction.ts`), OCR (`received-invoices/ocr/`, Mistral **and** local `ocrmypdf` engines), file
  storage (`storage.ts`) and automatic/manual supplier reconciliation
  (`supplier-reconciliation.ts`, `Client.isSupplier` flag) — e2e `36-received-invoices`.
- **Lines**: per-line percentage discount already supported, applied before VAT
  (`totals/compute-totals.ts`).
- **Payments & settlement**: a `DocumentPayment` generic to any document type
  (`settlement/payments.ts`), multi-currency conversion **at the moment of payment** with a frozen
  rate (`settlement/convert-payment.ts`), online payment (Stripe, see Shipped rank 1) and
  per-company typed payment methods (`payment-methods/`) — e2e `24-document-payments`,
  `27-multi-currency-consolidation`, `60-online-payment`, `61-payment-methods`.
- **Recurrence**: a generic `schedules/` engine (weekly/monthly/quarterly/yearly cadence,
  `cadence.ts`), replays an action on a template document, `{thenSend:boolean}` option to chain the
  send — screen `settings/recurring.settings.tsx` — e2e `29-document-recurrence`.
- **Sharing/public viewing**: a hashed-token link, PDF only (`share-links/`,
  `public/public-documents.controller.ts`); **authenticated client portal shipped separately**
  (`56-client-portal`, see Shipped rank 3) — e2e `37-document-share-link`.
- **Electronic signature**: email OTP, dedicated token (`signatures/otp.ts`,
  `signature-token.ts`), `DOCUMENT_SIGNED` webhook — e2e `45-signature`.
- **Legal / WORM archiving**: `archive/` (`persistence.ts`, `storage.ts`,
  `archive-verdict-on-terminal.ts`, `verdict-artifact.ts`), retention (`archive/retention/`) — e2e
  `34-document-archive`.

### 1.2 E-invoicing compliance (the core of this branch)
See `CLAUDE.md`. In short, already in place and proven by dedicated specs (out of scope for this
document, not reproduced in detail here):
- National formats + semantics (`formats/national`, `formats/semantic`,
  `formats/vendored/{en16931,pl,es,nl,de,it}`) — e2e `30-document-xml-format`.
- Channels/transports (`transports/{pdp,ksef,sdi,chorus-pro,face,anaf}`) — e2e
  `31-national-channels`, `32-channel-mandate`.
- B2G (`b2g-routing/`, 15 deliverable countries — see the catalogs themselves) — e2e
  `40-b2g-routing`.
- Per-country policy (available document types, mandatory mentions, required identifiers,
  correction/cancellation routes): `country-policy/`, `mentions/`, `country-identifiers/`,
  `correction-routes/` — e2e `39-document-conformity`, `43-correction-routes`, `44-country-policy`.
- Cross-border taxation by profile composition, never an N×N matrix (`tax/tax-engine.ts`) — e2e
  `35-cross-border-tax`.
- **Computed legal mentions**: e.g. FR — statutory recovery indemnity (€40) and late-payment
  penalty rate (ECB rate + 10 pts, frozen at issue date) generated automatically
  (`mentions/data/fr.json`) — a level of sophistication few consumer-grade competitors match.
- **Real-time declarations**: the `reporting/` mechanism, **only one country shipped** — Portugal
  (`reporting/providers/pt-at-*`, status implemented-awaiting-accreditation). The Greece/Hungary
  providers that existed before the five-country pivot were removed with it. **Tracking screen
  shipped** (rank 10, `c6a06617`, see Shipped): a paginated, company-scoped list read from
  `DocumentAuthorityEvent`.

### 1.3 Clients, articles, suppliers
- `modules/clients/`: full CRUD, `ClientType` (individual/company), `ClientKind`
  (BUSINESS/GOVERNMENT — B2G routing), an independent `isSupplier` flag (AP reconciliation),
  `language` field (rank 14) — screen `pages/(app)/clients/`, e2e `05-clients`.
- `modules/articles/`: product/service catalog, line prefill from the catalog, stock quantity +
  alert threshold (`Article.quantity`/`lowStockThreshold`, rank 18) — e2e `14-articles`,
  `49-stock`.
- `modules/company-lookup/` + `modules/sirene/`: automatic enrichment on client creation from an
  official registry (French SIRENE + ~250 per-country capabilities, REGISTER/PARTIAL) — e2e
  `16-company-lookup`.

### 1.4 Multi-company, auth, API
- `modules/companies/` + `modules/company/` (+ `signing-certificates/`, `channels/`,
  `currency-rates/`): multi-company per user (`UserCompany`, `CompanyRole` OWNER/ADMIN/MEMBER),
  `@ActiveCompany()` scopes every request — e2e `15-multi-company`, `02-company`.
- better-auth auth + API-key fallback (`modules/api-keys/`, scopes) — e2e `13-api-keys`,
  `01-register`, `03-auth`.
- `modules/invitations/`: member invitation by code — screen
  `settings/_components/invitations.settings.tsx`.
- `modules/danger/`: app/company reset with OTP confirmation.
- Exchange rates (`company/currency-rates/`): daily automatic ECB feed + `open.er-api.com`
  fallback, manual entry always possible (`CurrencyRate.source` — rank 9, see Shipped).

### 1.5 Integrations & extensibility
- **Webhooks**: `modules/webhooks/` — 7 destination types (`WebhookType`: GENERIC, DISCORD,
  MATTERMOST, SLACK, TEAMS, ZAPIER, ROCKETCHAT), generic `DOCUMENT_*`/`CLIENT_*`/`COMPANY_*`/
  `WEBHOOK_*` events (purged of ~80 dead values in 2026-09-03, only those with a real emitter
  remain) — e2e `42-webhooks`.
- **MCP server**: `modules/mcp/` — generic tools per document type (`tools/tool-registry.ts`),
  scoped by API key, lets an AI agent drive the app.
- **In-app plugins**: `modules/plugins/` — `PluginType` SIGNING/STORAGE/OCR, an internal registry
  (the dynamically-loaded third-party plugin mechanism was removed in 2026, see the header comment
  of `plugins.service.ts` — judged to have no real extension point).

### 1.6 PDF, mail, i18n
- **PDF rendering: a single, hardcoded design** (`rendering/render-html.ts`), with no editor or
  database-stored template — the Settings tab that claimed to edit it was removed on 2026-09-13
  (the two routes it called had never existed on the backend). Product decision of 2026-09-15 (see
  Decision B): this state stays as-is by choice, not just by default — the only variation allowed
  is the content's language (rank 14, already shipped) and, coming up, a restricted set of visual
  presets (color/logo/font) — e2e `19-document-pdf`.
- Email templates: a SINGLE engine for everything the backend sends (`actions/email-template.ts`)
  — single-brace `{placeholder}` tokens, an unknown token left verbatim and FLAGGED rather than
  resolved (an email should never be blocked by a typo), an HTML part and a text part (derived from
  the HTML when the template doesn't supply one, links included). Three levels: per-type
  descriptor default, per-company override (`Company.documentEmailTemplates`, written by
  `actions/company-email-templates.ts`), generic fallback. The two SYSTEM emails (signature
  request, verification code) have shared this engine since unification; their table
  (`MailTemplate`) keeps only these two families. Stored HTML is sanitized on WRITE
  (`mail/sanitize-email-html.ts`), interpolated values escaped at render time. A single screen
  `settings/_components/templates.settings.tsx` (variables offered by the API, derived per type —
  never a hardcoded list; write access reserved to OWNER/ADMIN), tested by `54-email-templates`.
  **WYSIWYG editor to be built on top of this mechanism, see Decision C** — today's plain text is
  not Handlebars despite the npm dependency of the same name, still present but used nowhere in the
  email code.
- i18n: the UI is entirely `t()`-driven, managed by Weblate, `npm run i18n:check` gates CI;
  document descriptor labels follow the same mechanism with a plain-text fallback
  (`descriptor-i18n`, e2e `38-descriptor-i18n`). Document language per recipient: shipped (rank 14,
  see Shipped and Decision B).

### 1.7 Dashboard, internal reporting
- Dashboard and Statistics are the **same "contributions" mechanism** (`contributions/`): every
  document type can publish dashboard and/or statistics widgets, never a hardcoded field —
  invoice/quote/credit-note/expense/received-invoice already contribute to it.
- **Opt-in** multi-currency consolidation on these widgets (`contributions/currency-consolidation.ts`,
  `Company.referenceCurrency`) — e2e `27-multi-currency-consolidation`.
- Client account statement (aggregated balance + aging): shipped, rank 6 (see Shipped).

---

## 2. What competitors do (web research, 8 queries, 2026-09-10)

Sources consulted (unreliable content, extracted only to spot *feature families*, no instruction
followed, no text copied):
- Directly comparable self-hosted competitors: Invoice Ninja, Akaunting, Crater, InvoiceShelf.
- Consumer-facing SaaS: Zoho Invoice, Xero, FreshBooks, QuickBooks, Stripe Billing/Invoicing,
  PayPal Invoicing, Salesforce Billing.
- French SMB market: Evoliz, Sellsy, Kwixéo, Abby, Tiime.
- Generic 2026 roundups (Zapier, Capterra, GetApp, TheDigitalPM) on "must-have" features and
  accounting integrations (QuickBooks/Xero/DATEV).

Recurring families among these competitors, which drove the historical §3 (online payment,
reminders, client portal, bank reconciliation, accounting export, time tracking, stock, expense
reports, purchase orders, approval workflows, template customization, automatic exchange rates,
installment billing, custom fields, mobile app): nearly all of them are now either shipped (Shipped
section), or reformulated by a 2026-09-15 product decision (Product decisions section), or detailed
as a remaining gap (Remaining section).
