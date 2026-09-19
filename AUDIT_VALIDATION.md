# Legal & Compliance Audit — Invoicerr hosted offering

**Audit date:** 2026-09-20 · **Branch:** `feat/compliance-engine-v2` · **Scope:** the hosted offering
only (the self-hosted software is out of scope, as every document already states).

**Why this file lives at the repository root.** It must not go in `documentation/docs/legal/`:
`backend/scripts/sync-legal-docs.ts` copies **every** `.md` in that directory into
`backend/src/legal/data/`, from where `legal-documents.ts` loads it as a served legal document, and
`backend/src/legal/docs-sync.spec.ts` asserts the two directories hold the *same set of files*. A
report dropped there would either break that test or be published at `/legal/audit-validation` as if
it were a legal document. `documentation/docs/` generally is also wrong: Docusaurus publishes it, and
an audit that names open gaps should not be a public page. The repository root is where the project's
other internal working documents already live (`TODO_MANDANT.md`, `TODO_FEATURES.md`), it is not
synced anywhere, and it is not published.

---

## 1. Summary

The legal corpus is **well above what a product at this stage usually has**. Six documents, five of
them translated, a real acceptance mechanism keyed on a content hash rather than a version string, a
sub-processor list that matches the code, and an EU Data Act chapter that most SaaS products of this
size do not have at all. The company identity is correct and consistent everywhere: **nowhere in this
repository is there a SAS, a share capital, or an RCS number attributed to the Provider** — the
corpus consistently names a sole trader (*entrepreneur individuel*), with the same SIREN/SIRET and
address in all six documents plus `LICENSE.COMMERCIAL.md`. That was the single biggest risk flagged
before the audit, and it is clean.

What is weaker is **the join between the documents and the product**. Three of the most serious
findings are not drafting errors but promises the product does not keep, or obligations that fall
outside the documents entirely.

| | Count |
| --- | --- |
| Blocking before launch | 7 |
| Important | 11 |
| Improvement | 6 |
| **Corrected in this pass** | **4** |

**Confidence level.** *Medium-high* on the internal quality of the documents — they are coherent,
cross-referenced, dated, and their factual claims about hosting, sub-processors and data lifecycle
survived verification against the code. *Medium* on the documents-versus-product alignment, because
this audit found four real mismatches in the places it looked, and it did not look everywhere.
*Low* on anything requiring a professional judgement about liability, jurisdiction or the merchant-
of-record structure — see Section 6.

**Launch-ready?** **No, not yet** — but the gap is small and mostly mechanical. None of the seven
blocking items requires a redesign; five are a document edit or a short internal procedure, one is a
one-line UI change, and one is a decision about whether to keep or drop a contractual promise. There
are **no customers today**, which makes this the cheapest possible moment to fix all of them: a
change to the Terms of Service or the Privacy Policy re-prompts every existing user for acceptance,
and right now that set is empty.

This is not legal advice and no document here is certified "compliant". Section 6 lists what a
lawyer should see.

---

## 2. Consolidated legal identity

Every value below was read from the repository, never inferred. "Consistent everywhere" means every
file listed agrees, character for character, on the value.

| Item | Value | Sources | Status |
| --- | --- | --- | --- |
| Legal form | Sole trader — *entrepreneur individuel* (micro-entreprise), French law | `legal-notice.md` §1, `terms-of-service.md` §1.1, `privacy-policy.md` §1, `LICENSE.COMMERCIAL.md` §2/§12 | Consistent everywhere |
| Trading/publisher name | Roméo Chevrier | same | Consistent everywhere |
| Share capital | — | — | **Correctly absent** — a sole trader has none |
| RCS / company registration | — | — | **Correctly absent** — the only RCS in the corpus is Scaleway's own |
| SIREN | 982 187 676 | `legal-notice.md` §1 (+ `.fr`), `terms-of-service.md` §1.1 (+ `.fr`), `privacy-policy.md` §1 (all 6 languages), `LICENSE.COMMERCIAL.md` | Consistent everywhere |
| SIRET | 982 187 676 00019 | same | Consistent everywhere |
| Registered address | 4 rue du Puits, 26120 Montélier, France | same | Consistent everywhere |
| VAT | Not applicable — *franchise en base*, CGI art. 293 B | `legal-notice.md` §1, `terms-of-service.md` §1.1, `LICENSE.COMMERCIAL.md` §4.5 | Consistent everywhere |
| VAT number | — | — | Correctly absent; `backend/src/modules/billing/checkout-tax-id.ts` also refuses to send one to Polar for a VAT-exempt company |
| Publication director | Roméo Chevrier (LCEN art. 6-III) | `legal-notice.md` §2 | Present |
| Contact | contact@invoicerr.app | all six documents | Consistent everywhere |
| Service address | my.invoicerr.app | `legal-notice.md` §3, `privacy-policy.md` §10 | Consistent everywhere |
| Marketing site | invoicerr.app (GitHub Pages, separate repo `invoicerr-app/landing`) | `privacy-policy.md` §10, `cookies-and-acceptable-use.md` Part C | Present — **not verifiable from this repository** (see A4) |
| Docs site | docs.invoicerr.app (GitHub Pages) | same | Present |
| Host (Service) | Scaleway SAS, SIREN 433 115 904, RCS Paris, 8 rue de la Ville-l'Évêque, 75008 Paris — Kubernetes + managed PostgreSQL + object storage, Paris region | `legal-notice.md` §3 | Present, LCEN art. 6-I-2 satisfied |
| Host (websites) | GitHub, Inc., 88 Colin P. Kelly Jr. Street, San Francisco CA 94107, USA | `legal-notice.md` §3 | Present |
| Payment | Polar Software Inc., **merchant of record** | `terms-of-service.md` §7.1, `privacy-policy.md` §4, `data-processing-agreement.md` §7 | Present and correctly characterised |
| Jurisdiction | French law; Tribunal de commerce de Romans-sur-Isère | `terms-of-service.md` §20.2, `legal-notice.md` §7, `LICENSE.COMMERCIAL.md` | Consistent everywhere |

### Documents in the corpus

| Document | Slug | Version | Languages | Acceptance required |
| --- | --- | --- | --- | --- |
| Terms of Service | `terms-of-service` | 2026-09-19 | en, fr | **Yes** |
| Privacy Policy | `privacy-policy` | **2026-09-20** (bumped by this audit) | en, fr, de, it, pl, pt | **Yes** |
| Data Processing Agreement | `data-processing-agreement` | 2026-09-19 | en, fr, de, it, pl, pt | No |
| Legal Notice | `legal-notice` | 2026-09-19 | en, fr | No |
| Cookies & Acceptable Use | `cookies-and-acceptable-use` | **2026-09-20** (bumped by this audit) | en, fr | No |
| International Access Transparency | `international-access-transparency` | 2026-09-19 | en, fr, de, it, pl, pt | No |

### Sub-processors declared vs. actually integrated

Verified against `backend/package.json`, the code in `backend/src/`, and `.env.example`.

| Third party | Declared | Actually integrated | Data | Location |
| --- | --- | --- | --- | --- |
| Scaleway SAS | Yes (PP §4, DPA §7, ToS §14.1) | Yes — S3 client (`backup/s3-client.ts`, `received-invoices/s3-storage.ts`), Postgres | Everything | France (Paris) |
| Polar Software Inc. | Yes, expressly **not** a DPA sub-processor | Yes — `@polar-sh/sdk`, `modules/billing/` | Subscription + payment | US / MoR |
| Resend | Yes | Yes — `mail/providers/` | Transactional email | US |
| Cloudflare, Inc. | Yes | Inbound email routing (infrastructure, not code) | Support mail | US |
| Google LLC (Gmail) | Yes | Support mailbox (infrastructure, not code) | Support mail | US |
| GitHub, Inc. | Yes, expressly **not** a DPA sub-processor | Yes — Pages/Actions/GHCR | None of the Service's | US |
| National platforms (PDP, KSeF, SdI, AT, Chorus Pro) | Yes | Yes — `modules/documents/transports/` | Documents, on customer instruction | Per country |
| Stripe / Mollie / PayPal | Yes, as the **customer's own** accounts | Yes — `documents/payments/providers/` | Customer's own | N/A |
| **PEC mailbox (Italian SdI)** | **No** | **Yes — `imapflow`, `transports/sdi-pec/`** | Documents | Customer's provider | → I9 |
| Mistral AI | Removed | **Confirmed gone** — only changelog entries and one historical code comment remain | — | — |
| Any analytics / tracking | Declared as none | **Confirmed none** — no Sentry, PostHog, Plausible, Matomo, GA, GTM, Segment, Mixpanel, Hotjar, Clarity anywhere; fonts are self-hosted npm packages, not a CDN | — | — |

---

## 3. Findings

### Blocking before launch

| # | Area | Problem | Legal basis | Status |
| --- | --- | --- | --- | --- |
| **B1** | `LICENSE.COMMERCIAL.md` §4.3 | The commercial licence is invoiced **directly by the Provider**, in his own name, payable within 30 days — this is the one revenue stream where the Provider is the creditor (Polar is not involved, as §4.3 itself says). It states **no late-payment penalty rate and no €40 fixed recovery indemnity**. Both are mandatory content of payment terms between professionals. This is the finding most likely to have been missed, because the natural place to look — the Terms of Service — legitimately has no such clause (Polar is merchant of record there). | C. com. **art. L441-10, I** (the payment terms *must* state the penalty rate and the fixed recovery indemnity) and **art. D441-5** (€40); omission sanctioned by **art. L441-16** | **To decide** (rate is a business choice) |
| **B2** | ToS §20.1 vs. the product | §20.1 promises "at least **thirty (30) days' notice by email** before a change takes effect". The product gives **zero**: `backend/src/legal/legal-release-boot.service.ts` notices the change *at boot*, i.e. once the new text is already live and already the current hash, and `backend/src/legal/legal-acceptance.guard.ts` then refuses every write (session **and** API key) until the user re-accepts. The notice email goes out at the same moment the new text starts binding. A commitment the product contradicts is worse than no commitment. | C. civ. art. 1103/1104 (binding force, good faith); the clause is the Provider's own undertaking | **To decide** |
| **B3** | Product UI | The legal documents are reachable **only from the sign-in and sign-up pages** (`frontend/src/components/legal-links.tsx`, rendered as a sibling of `<AuthShell>` in `sign-in.tsx` and `sign-up.tsx` only). `frontend/src/pages/(app)/_layout.tsx` has **no footer at all**: once signed in, a user has no route to the Terms, the Privacy Policy, the DPA, the Legal Notice or the cookie policy. | LCEN **art. 6-III** (legal notice must be accessible); GDPR **art. 12(1)** (information must be easily accessible) | **To decide** (UI placement, redesign in progress) |
| **B4** | Missing document | **No GDPR Article 30 record of processing activities.** Nothing in the repository, and no evidence of one outside it. The Art. 30(5) small-organisation derogation does **not** rescue this: it lifts only where processing is occasional and carries no risk — here it is continuous, it is the core of the product, and it includes processing on behalf of controllers (Art. 30(2) applies to the processor role separately). | GDPR **art. 30** | **To do** |
| **B5** | Missing procedure + page | **No documented breach-notification procedure** (who decides, on what clock, who is told, in what order), although DPA §12 promises notification "without undue delay" and undertakes to let the customer meet their own 72-hour deadline. Separately, **there is no `SECURITY.md` and no vulnerability-disclosure page** anywhere in the repository, while **GHSA-g76v-ff9h-j6r2** is open, affects the published line, and the decision is **not to patch that line**. Self-hosters running the published line currently have no channel telling them that. | GDPR **art. 33** (72 h to the CNIL) and **art. 34**; DPA §12's own undertaking | **To do** |
| **B6** | ToS §17.1 | The liability cap is "the Fees you actually paid **us** in the twelve (12) months preceding the event". But §7.1 makes **Polar the merchant of record** — the customer pays *Polar*, not the Provider. Read literally the cap is zero, which is a cap that empties the Provider's obligation of substance. | C. civ. **art. 1170** (a clause depriving an essential obligation of its substance is unwritten); C. com. **art. L442-1, I, 2°** (significant imbalance) | **To decide** |
| **B7** | All six documents | Every document still opens with `:::warning Draft — not yet reviewed by counsel.:::`. Shipping to a paying customer a document that announces itself as an unreviewed draft undermines its own enforceability and is a poor signal. | — (commercial and evidential, not statutory) | **To decide** |

### Important

| # | Area | Problem | Legal basis | Status |
| --- | --- | --- | --- | --- |
| **I1** | Cookies policy + PP §9 | Both stated the Service sets "**exactly one** cookie". False: `frontend/src/components/ui/sidebar.tsx:73` writes a second cookie, `sidebar_state`, `max-age` 7 days, on every signed-in page (`SidebarProvider` is mounted in `pages/(app)/_layout.tsx:86`). Neither document stated any duration, and neither mentioned the five browser-storage values the Service also writes. | **Art. 82, loi n° 78-17** of 6 Jan. 1978 (covers any writing to/reading from a terminal, not cookies alone); CNIL cookie guidelines | **Corrected** |
| **I2** | PP §6 | No retention duration for application logs — only "deleted or anonymized on a rolling basis". A concrete duration now exists in the code: `LOG_RETENTION_DAYS`, default **90** (`backend/src/logger/log-purge-sweep.ts`), enforced by an hourly sweep. | GDPR **art. 13(2)(a)** (state the period, or the criteria) | **Corrected** |
| **I3** | PP §3 | The acceptance record (`LegalAcceptance`: document, version, content hash, timestamp, **IP address**, **user agent**) was being collected and was described nowhere. | GDPR **art. 13(1)(c)** and **art. 5(1)(a)** | **Corrected** |
| **I4** | Product UI | `international-access-transparency` — published 2026-09-19 specifically because the EU Data Act requires it to be *publicly available* — was served by the API and reachable by URL, but **linked from nothing**. | Reg. (EU) **2023/2854, art. 28** | **Corrected** |
| **I5** | Missing document + checkout | There is **no refund/cancellation policy** as a standalone document; the entire rule is one sentence in ToS §12.2 ("no refund and no proration"). And nothing states it at the moment of subscribing: `frontend/src/pages/(app)/settings/_components/billing.settings.tsx` shows a USD notice and a VAT/merchant-of-record notice, but **no link to the Terms and no mention of the no-refund rule** before the Subscribe button. | C. com. **art. L441-1** (communication of terms to a professional buyer); general contract-formation transparency | **To decide** |
| **I6** | Session retention | **Expired sessions are never purged.** `better-auth` has no expired-session cleanup in this version and the application adds none — a `Session` row, carrying `ipAddress` and `userAgent`, survives its own `expiresAt` indefinitely, until sign-out or account deletion. The corrected PP §6 now describes this truthfully; the underlying behaviour is still a data-minimisation gap. | GDPR **art. 5(1)(e)** (storage limitation) | **To do** |
| **I7** | ToS §15.3, PP §7, DPA §9, IAT §2 | All four describe encryption at rest as covering **credentials and tokens only**. Since the recent backup work, `backend/src/modules/backup/backup-crypto.ts` encrypts **every backup artifact with AES-256-GCM before upload**, and `backup-runner.ts` fails the whole sweep if the key is missing rather than uploading plaintext. A real, verified security measure that the security sections understate. | GDPR **art. 32**; DPA §9 is the Art. 32 measures annex | **To do** (wording in §5) |
| **I8** | AI / MCP | The product ships an MCP server and an API-key model explicitly documented for connecting an AI assistant (`documentation/docs/user-guide/ai-agents.md`). A customer who does so sends Customer Personal Data to an LLM provider **of their own choosing**. No document addresses this, although the DPA already has exactly the right pattern for it (the "platforms you choose to connect" and "your own Stripe/Mollie/PayPal accounts" carve-outs). Note: the Provider itself calls **no** LLM — there is no AI Act provider/deployer obligation on him today. | GDPR **art. 28(3)(a)** (scope of instructions); AI Act — analysed, no obligation found | **To decide** (wording in §5) |
| **I9** | DPA §7 | The Italian SdI path polls a **PEC mailbox over IMAP** (`imapflow`, `backend/src/modules/documents/transports/sdi-pec/`). The customer's PEC provider therefore handles documents carrying Customer Personal Data. DPA §7's "national e-invoicing and government platforms you choose to connect" names SdI but not the PEC mailbox that fronts it. | GDPR **art. 28(2)/(4)** | **To do** (wording in §5) |
| **I10** | The Provider's own obligations | France's e-invoicing reform: the obligation to be able to **receive** electronic invoices applies to all taxable persons from **1 September 2026** — a date now past. The Provider is himself a French business and this is an obligation on him personally, independent of the product. Issuance for micro-enterprises follows later. | Ordonnance n° **2021-1190**, as amended (LF 2024, art. 91) — **calendar to be re-confirmed**, it has been amended more than once | **To do** (operational) |
| **I11** | ToS §1.2 | §1.2 denies any right of withdrawal flatly. **Analysis: that is correct as the product is sold today.** Art. L221-3 C. conso extends consumer protections to a professional with ≤5 employees contracting outside their main activity — but **only for contracts concluded *hors établissement*** (off-premises). A self-service online subscription is a *distance* contract, which that article does not cover. The flat denial therefore holds **for as long as no subscription is ever signed off-premises** — at a trade fair, at a prospect's office. There is no guardrail against that today. | C. conso **art. L221-3**; **art. L221-1, I, 2°** (definition of an off-premises contract) | **To decide** |

### Improvement

| # | Area | Problem | Status |
| --- | --- | --- | --- |
| **A1** | `.env.example` | Does not document `LOG_RETENTION_DAYS`, although the Privacy Policy now states 90 days as a commitment and a self-hosted operator has no way to discover the knob from that file. (`BACKUP_*` *is* well documented, in `documentation/docs/user-guide/backups.md`.) | To do |
| **A2** | `backend/package.json` | `@documenso/sdk-typescript` is a declared dependency with **zero references in `src/`**. Legally harmless — no data flows — but it makes any supply-chain or sub-processor review read wrong, and a future reviewer will flag it as an undeclared sub-processor. | To do |
| **A3** | ToS §1.1 | States the legal form twice in one sentence: "Roméo Chevrier, **sole trader (entrepreneur individuel)**, an **entrepreneur individuel (micro-entreprise)** under French law". Cosmetic; deliberately left alone because any edit to this file re-prompts every user for acceptance. | To decide |
| **A4** | Marketing site | `invoicerr.app` lives in a **separate repository** (`invoicerr-app/landing`). The Privacy Policy §10 and Cookies Part C make specific claims about it (no cookie, no analytics, theme in `localStorage`, one client-side call to `api.github.com`). Those claims **could not be verified from this repository** and should be re-checked in that one. | To do |
| **A5** | Missing page | No public **security page** describing the measures actually in place. The International Access Transparency page covers part of it (TLS, AES-256-GCM credentials, access control) but is framed as a Data Act disclosure, not as a security page. Would pair naturally with the `SECURITY.md` of B5. | To do |
| **A6** | Accessibility | **European Accessibility Act** (Directive (EU) 2019/882, transposed in France by ordonnance n° 2023-859): analysed, **no obligation found**. The Act targets services to consumers; Invoicerr is sold strictly B2B (ToS §1.2), and the Provider is in any case a microenterprise, which art. 4(5) exempts from the service obligations. Recorded so the reasoning exists rather than the question being left open. A consumer-facing pivot would reopen it. | No action |

### Confirmed correct (audited, no finding)

These were checked and are right — worth recording so they are not re-litigated.

- **Company identity** — sole trader everywhere, no SAS/capital/RCS anywhere, all identifiers consistent across 7 files and 6 languages.
- **Polar as merchant of record** — correctly described in all three places it appears, including the non-obvious consequence that Polar is *not* a DPA sub-processor and that it, not the Provider, issues the subscription invoice and handles VAT.
- **Pricing statements** — USD-denominated (ToS §7.2) and VAT-exclusive (ToS §7.1) are both stated in the documents *and* shown on the subscribe screen (`billing.settings.tsx`, `billing-currency-notice` / `billing-vat-notice`).
- **Data lifecycle** — the ToS §13 / PP §6 / DPA §10 figures (14-day trial, 14-day read-only block, 30-day minimum retrieval, 180-day paid grace) match `backend/src/modules/billing/lifecycle.ts` **exactly** (`TRIAL_DAYS`, `BLOCKED_DAYS`, `MIN_RETRIEVAL_DAYS`, `PAID_ZIP_GRACE_DAYS`).
- **Acceptance mechanism** — checkbox is **not** pre-checked (`useState(false)`, `sign-up.tsx:54`); enforced server-side, not only in the UI; the stored row carries user, slug, version, content hash, timestamp, IP and user agent; the guard covers API-key requests as well as sessions; and the hash is computed from the **English text only**, so shipping a translation never re-prompts anyone. This is better than most products this size.
- **No consent banner** — the conclusion is right. After correction, the inventory is two cookies and five browser-storage values, all either strictly necessary or a preference the user set themselves. Both grounds are exempt under art. 82 of loi n° 78-17. There is no audience measurement, advertising or profiling anywhere in the product to consent to.
- **No marketing email** — every template in `backend/src/mail/system-email-templates.ts` is transactional. The Privacy Policy's statement to that effect holds; there is no B2B prospection question to answer.
- **Mistral AI fully removed** — the only surviving references are changelog entries (correct: they are history) and one code comment explaining why a file exists. No live reference, no key, no call.
- **Portability and switching** — ToS §8.2/§9/§10 describe a self-service export, an API, and per-document PDF/EN 16931 XML. `POST /api/companies/export` exists (`companies.controller.ts:91`) and is wired to a UI (`data-export.settings.tsx`). The Data Act claims are backed by real features.
- **Hosting** — Scaleway-only, Paris, matches `.env.example`'s `ARCHIVE_S3_*` guidance and the S3 client. The Neon→Scaleway move is reflected in all six documents *and* their translations.
- **SLA** — deliberately absent, and consistently so: ToS §16.1 ("best-effort", no numeric uptime) and Cookies/AUP §7 (published figures are indicative only) agree. Not a gap.
- **Translation integrity** — heading counts match the English original in all 16 translated files; the Governing Language clause is present in all six documents.

---

## 4. Corrections applied

Four findings were corrected. All are factual alignments between a document and what the code
actually does — no clause was removed, no substantive term changed, no business choice made.

### C1 — Cookie and browser-storage inventory (I1)

**Files:** `documentation/docs/legal/cookies-and-acceptable-use.md`, `.fr.md`

Part A rewritten. "Exactly **one** cookie" replaced by a table of the **two** cookies actually set,
with purpose and duration, plus a second table of the five browser-storage values and a note on the
PWA offline cache:

| | Name | Duration | Verified in |
| --- | --- | --- | --- |
| Cookie | `better-auth.session_token` | 7 days, extended on use | `better-auth` 1.7.4 default `expiresIn: 3600*24*7`, `updateAge: 1440*60`; no override in `backend/src/lib/auth.ts` |
| Cookie | `sidebar_state` | 7 days | `frontend/src/components/ui/sidebar.tsx:15-16,73` |
| localStorage | `i18nextLng` | — | `frontend/src/lib/i18n.ts:148` |
| localStorage | `vite-ui-theme` | — | `frontend/src/components/theme-provider.tsx:26` |
| localStorage | `pwa-install-dismissed-at` | — | `frontend/src/components/pwa-install-prompt.tsx:8` |
| localStorage | `invoicerr_portal_token` | — | `frontend/src/hooks/use-portal-fetch.ts:17` |
| sessionStorage | `invoicerr-sw-reloaded` | tab lifetime | `frontend/src/main.tsx:37-51` |

Section 2's **conclusion is unchanged** — no consent banner is required — but it now rests on the two
exemption grounds that actually carry it (strictly necessary; a preference set by the user
themselves) instead of on a single-cookie fact that was untrue, and it cites art. 82 of loi n° 78-17
explicitly. Section 3's trigger widened to match.

### C2 — Log retention, session records, acceptance proof (I2, I3)

**Files:** `privacy-policy.md` and its `fr`, `de`, `it`, `pl`, `pt` translations

- §3 gains a **"Proof of acceptance"** row (document, version, date, IP, user agent) with its legal
  basis — Art. 6(1)(b) plus legitimate interest in evidencing the agreement.
- §6's single vague bullet split into three accurate ones: application logs **90 days** with an
  automatic purge; session records until sign-out or account deletion; acceptance record for the life
  of the account. The 90 figure is `LOG_RETENTION_DAYS`'s documented default in
  `backend/src/logger/log-purge-sweep.ts`.
- §6's session bullet is deliberately worded to describe what actually happens, **not** an automatic
  expiry that does not exist — see I6, which remains open.
- §9 corrected in line with C1.

### C3 — Data Act transparency page now reachable (I4)

**Files:** `frontend/src/components/legal-links.tsx`, `frontend/src/locales/en/translation.json`

Added `international-access-transparency` to the legal links row with a new
`legal.links.internationalAccess` key. The comment on the entry records *why* it is there (Art. 28
requires public availability, not mere URL reachability). The existing e2e spec
(`e2e/cypress/e2e/75-legal-acceptance.cy.ts`) asserts individual links, not a count, so it is
unaffected.

### C4 — Stale "five documents" comments

**Files:** `backend/src/legal/legal-documents.ts`, `frontend/src/pages/legal/[slug].tsx`

Three comments said "five documents" / "the other three"; there have been six since 2026-09-19.

### Verification

| Check | Result |
| --- | --- |
| `npm run legal:sync` | 24 files copied |
| `npx vitest run src/legal/` | **139 passed**, 2 skipped, 14 files — same as baseline |
| `cd backend && npm run build` | green |
| `cd frontend && npm run build` | green |
| `cd frontend && npm run i18n:check` | **passed** — every statically used key defined in EN |
| `cd documentation && npm run build` | green (also run before the changes, as a baseline) |
| `backend/dist/src/legal/data/` vs source | 24 files each, identical sets |

### Content hashes — what re-prompts a user

The hash is computed from the **English** body only, so the sixteen translated files never move it.

| Document | Before | After | Effect |
| --- | --- | --- | --- |
| **`terms-of-service.md`** | `10c3a42cd80855da` | **unchanged** | **None.** Deliberately left untouched — every finding against it is a decision for you, not a correction for me |
| **`privacy-policy.md`** | `14ed2f5f5bda280f` | **`91671d1e50d631cb`** | **Re-acceptance required.** Acceptance-gated, so every existing user would be blocked at the next write until they re-accept. **There are no users today, so this costs nothing — and this is precisely why it should be done now** |
| `cookies-and-acceptable-use.md` | `6e649edec8d03a4c` | `67399359288c36ad` | None — not acceptance-gated |
| Other 3 canonical documents | — | unchanged | None |

`version` and `effectiveDate` were bumped to **2026-09-20** on the two documents whose text changed,
so the displayed version stops describing text that no longer exists. Both carry a changelog entry
stating what changed and why.

### Suggested commit grouping

Four commits, each independently reviewable and revertible:

1. `fix(legal): l'inventaire des cookies dit vrai — deux cookies, pas un, et le stockage local avec`
   — `cookies-and-acceptable-use.md` + `.fr.md`. The false statement and its French translation.
2. `fix(legal): la politique de confidentialité annonce 90 jours de journaux et la preuve d'acceptation`
   — `privacy-policy.md` + 5 translations. **The commit that moves the acceptance hash** — worth
   isolating so that fact is visible in the history.
3. `fix(legal): la page de transparence Data Act devient atteignable depuis le produit`
   — `legal-links.tsx` + `translation.json`.
4. `docs(legal): six documents, plus cinq — commentaires remis à jour`
   — the two stale comments. Pure housekeeping.

`AUDIT_VALIDATION.md` itself goes with commit 1, or on its own — your call.

---

## 5. Decisions needed from you

Ten. Each carries a recommendation.

### D1 — Late-payment penalties and the €40 indemnity in the commercial licence (B1)

The commercial licence is invoiced by you, in your own name, payable in 30 days. Art. L441-10, I
C. com. requires the payment terms to state the penalty rate and the fixed €40 recovery indemnity;
omission is sanctioned by art. L441-16. The rate is yours to choose within a floor, which is why I did
not write it myself.

**Recommendation: add the legal default.** It is the safest, requires no judgement, and is what
applies anyway if you say nothing. Proposed insertion as `LICENSE.COMMERCIAL.md` §4.3, after the
30-day sentence:

> Any sum unpaid at its due date bears, automatically and without prior notice, late-payment
> penalties at a rate equal to **the European Central Bank's refinancing rate in force on 1 January
> or 1 July of the current half-year, increased by ten (10) percentage points**, applied to the
> amount including tax, from the day following the due date until full payment. The Licensee is also
> liable, automatically, for a **fixed recovery indemnity of forty euros (€40)** per unpaid invoice,
> under articles L.441-10 and D.441-5 of the French Commercial Code; where recovery costs actually
> incurred exceed that amount, the Provider may claim additional compensation on justification.

The alternative — a contractual rate of three times the legal interest rate — is the statutory floor
and is also valid; it is simply a negotiation position rather than a default.

### D2 — The 30-day notice promise (B2)

ToS §20.1 promises 30 days' notice before a change takes effect. The product enforces the new text
immediately. Three ways out:

- **(a) Make the product keep the promise.** Add an `effectiveDate` gate: a newly released document
  binds and blocks only once its `effectiveDate` is reached, with the notification email going out at
  release. The front matter field already exists and is already parsed. Most work, best outcome, and
  the only option that keeps the clause as written.
- **(b) Narrow the clause** to what the product does — e.g. 30 days' notice for a change that
  *reduces your rights or increases your obligations*, immediate effect for a correction,
  clarification or a change required by law. This is a common and defensible formulation.
- **(c) Drop the 30 days** and promise notice "before or at the time the change takes effect". Least
  work, weakest commitment, and a visible downgrade.

**Recommendation: (b) now, (a) later.** (b) removes the contradiction today for the cost of one
paragraph; (a) is the honest long-term answer and is cheap to build once there is a reason to. Note
that **(b) and (c) both edit the Terms of Service and therefore re-prompt every user** — free today,
not free later.

### D3 — Legal links inside the application (B3)

Signed-in users cannot reach any legal document from the product. The component already exists
(`LegalLinks`); it simply is not mounted in `pages/(app)/_layout.tsx`. I did not mount it myself
because the UI is being redesigned screen by screen under your validation and a footer is a visual
decision.

**Recommendation: mount `<LegalLinks />` at the bottom of the authenticated layout now**, plainly,
and let the redesign restyle it later. An unstyled but reachable footer beats a beautiful
unreachable one. A settings-page-only link would be second best; leaving it as is, is not an option.

### D4 — Liability cap and the merchant of record (B6)

ToS §17.1 caps liability at fees "paid **us**", while Polar is the merchant of record. Literally, the
cap may be zero.

**Recommendation: key the cap on the amounts the customer paid *for the subscription*, whoever
collected them.** Proposed replacement for the tail of §17.1(b):

> …is capped at the **total amounts you paid for your subscription to the Service in the twelve (12)
> months preceding the event giving rise to the claim, whether those amounts were paid to us or, as
> merchant of record, to Polar on our behalf**.

This preserves the commercial intent, removes the zero-cap reading, and is consistent with §7.1. It
is a limitation-of-liability change, so it is yours, not mine — and it edits the Terms of Service
(re-prompt, free today).

### D5 — The "Draft — not reviewed by counsel" banner (B7)

Three options: have counsel review and remove it; remove it on your own judgement; or launch with it.

**Recommendation: a single scoped review by a lawyer covering the points in Section 6, then remove
it everywhere.** This corpus is well beyond the quality where a draft warning helps you; it now only
invites a counterparty to argue the documents were never meant to bind. Launching with the banner is
the worst of the three.

### D6 — Refund statement at the point of subscribing (I5)

Nothing links to the Terms, or states the no-refund rule, before the Subscribe button.

**Recommendation: one line under the Subscribe buttons in `billing.settings.tsx`**, next to the two
notices already there — "By subscribing you accept the [Terms of Service]; subscriptions renew
automatically and are not refunded or prorated for the unused part of a cancelled period" — rather
than a separate refund-policy document. A standalone policy for a two-sentence rule adds a seventh
document to keep in sync for no benefit. If you would rather have the document, say so and I will
write it; it then needs a slug, a sidebar position, and translations.

### D7 — Off-premises sales guardrail (I11)

ToS §1.2's flat denial of the withdrawal right is **correct for online self-service sales** — art.
L221-3 C. conso reaches only off-premises contracts, and a distance contract is not one. The risk is
purely operational: sign someone up at a trade fair or in their office, and if they have ≤5 employees
and the purchase sits outside their main activity, they get 14 days to withdraw.

**Recommendation: no document change, one operational rule** — never conclude a subscription in
person; always have the customer subscribe themselves, online. If you ever want to sell in person,
that decision needs its own clause and a withdrawal form, and it should be revisited then rather than
pre-emptively drafted now.

### D8 — Backup encryption in the security sections (I7)

Verified fact, currently understated in four places. Adding it means editing the DPA (6 languages) and
the transparency page (6 languages); adding it to ToS §15.3 as well would re-prompt every user.

**Recommendation: add it to the DPA §9 and the transparency page §2 only**, leaving ToS §15.3 alone
so the Terms' hash stays put. Proposed DPA §9 bullet:

> Backup artifacts are encrypted with AES-256-GCM **before** leaving our infrastructure, under a key
> held separately from the storage provider; a backup run fails rather than uploading anything
> unencrypted.

Say the word and I will apply it in all six languages of both documents.

### D9 — AI assistants connected by the customer (I8)

A customer can point their own LLM at the MCP server, which sends Customer Personal Data to a provider
you neither choose nor contract with. You call no LLM yourself — there is no AI Act obligation on you
today.

**Recommendation: one paragraph in DPA §7**, mirroring the carve-out already there for the customer's
own Stripe/Mollie/PayPal accounts:

> Where you connect an AI assistant or other external tool to the Service through the API or the MCP
> server, that tool acts on your own instruction, under an API key you issue and scope. Your data
> then reaches a provider you have chosen and contracted with directly; that provider is not our
> sub-processor, and the lawfulness of that transfer is yours to establish.

### D10 — PEC mailbox among the connected third parties (I9)

DPA §7 names SdI but not the PEC mailbox the Italian path actually polls.

**Recommendation: add "and the certified email (PEC) mailbox you configure for the Italian SdI
channel" to the existing "national e-invoicing and government platforms you choose to connect"
bullet.** It is a four-word addition to a bullet that already has the right legal shape. Six
languages.

---

## 6. For a lawyer

Ordered by how much a professional opinion actually changes the outcome.

1. **The merchant-of-record structure as a whole.** Polar sells to the customer and remits the VAT;
   you are a *franchise en base* sole trader receiving a payout. Who is the customer's counterparty
   for the subscription — you, or Polar? The Terms say you; the invoice says Polar. This one question
   governs the liability cap (D4), whether art. L441-10 touches the subscription at all, what your own
   VAT position is on Polar's payouts, and what you can be sued for. **Ask this first.** Everything
   else in this list is smaller.
2. **The liability cap** (D4) against art. 1170 C. civ. and art. L442-1, I, 2° C. com., once the
   answer to (1) is known.
3. **The exclusion of all warranties** (ToS §16.3, "as is"/"as available") in a B2B contract under
   French law — the *garantie des vices cachés* is not freely excludable between professionals of
   different specialities, which a micro-enterprise customer plausibly is.
4. **The indemnification clause** (ToS §18). Broad customer-side indemnities are an Anglo-American
   import and sit awkwardly in a French-law contract; enforceability against a very small business
   counterparty is worth a view.
5. **Section 13.4's transfer of statutory retention responsibility** — you email an archive and
   declare that the ten-year invoice-retention obligation becomes the customer's. Whether a
   contractual clause can effect that transfer, and whether emailing a zip discharges you, deserves
   confirmation. This is the clause most likely to be tested, because it is tested exactly when
   something has gone wrong.
6. **The withdrawal-right denial** (I11 / D7) — confirmation that art. L221-3 C. conso is confined to
   off-premises contracts and does not reach an online subscription.
7. **The French e-invoicing calendar** (I10) as it applies to you personally as a micro-entreprise —
   both the reception obligation now in force and the issuance date that follows.
8. **The Art. 28(3) checklist** on the DPA. My reading is that all eight required provisions are
   present and adequately drafted, but "adequately" is the word that needs a professional behind it.

---

## 7. Pre-production checklist

Work through it top to bottom; the order is deliberate.

**Documents**

- [ ] Add late-payment penalties + €40 indemnity to `LICENSE.COMMERCIAL.md` §4.3 (D1)
- [ ] Resolve the 30-day notice contradiction — clause or code (D2)
- [ ] Fix the liability cap for the merchant-of-record structure (D4)
- [ ] Remove the "Draft — not reviewed by counsel" banner from all six documents, **after** the review (D5)
- [ ] Add backup encryption to DPA §9 and the transparency page §2 (D8)
- [ ] Add the AI-assistant carve-out to DPA §7 (D9)
- [ ] Add the PEC mailbox to DPA §7 (D10)
- [ ] Re-run `npm run legal:sync` and `npx vitest run src/legal/` after **every** document edit
- [ ] For each edit, note whether the Terms or Privacy Policy hash moved — if so, every user is re-prompted

**Internal documents you do not have**

- [ ] Write the **Article 30 record of processing activities** — both roles, controller and processor (B4)
- [ ] Write the **personal-data-breach procedure**: detection, 72-hour clock, who notifies the CNIL, how customers are told, where it is logged (B5)
- [ ] Write the **data-subject-request procedure**: who answers contact@invoicerr.app, within what deadline, with what evidence of identity
- [ ] Add **`SECURITY.md`**: supported versions, how to report, expected response time — and state plainly that the published line is **not** patched for GHSA-g76v-ff9h-j6r2 (B5)

**Product**

- [ ] Mount `<LegalLinks />` in the authenticated layout (D3)
- [ ] Add the Terms link + no-refund line to the subscribe screen (D6)
- [ ] Add a purge for expired session rows, or state the retention truthfully (I6 — the Privacy Policy is already truthful; the behaviour is not yet minimal)
- [ ] Document `LOG_RETENTION_DAYS` in `.env.example` (A1)
- [ ] Remove `@documenso/sdk-typescript` if it is genuinely unused (A2)

**Verify outside this repository**

- [ ] Re-check the `invoicerr-app/landing` repo against the claims in Privacy Policy §10 and Cookies Part C: no cookie, no analytics, theme in `localStorage`, one call to `api.github.com` (A4)
- [ ] Confirm the **production** Polar organisation is configured like the sandbox: prices in USD, VAT handled by Polar as MoR, tax-ID collection on, and the per-seat tiers matching what the pricing page says
- [ ] Confirm you can **receive** electronic invoices as required in France, and re-confirm the current reform calendar (I10)
- [ ] Confirm the Scaleway DPA and the Resend DPA are actually signed — DPA §7 asserts that every sub-processor is contractually bound to equivalent obligations

**Last**

- [ ] Take a fresh backup and prove a restore — the corpus now states encryption at rest as a commitment
- [ ] Re-read this checklist after the lawyer's review; some items may change shape
