---
title: Privacy Policy
sidebar_position: 2
version: 2026-09-21
effectiveDate: 2026-09-21
---

:::warning Draft
Draft — not yet reviewed by counsel.
:::

This Privacy Policy explains how personal data is handled in connection with the **hosted offering**
of Invoicerr — the version of the Service operated at our own domain(s), as defined in the
[Terms of Service](./terms-of-service.md). **It does not apply to the self-hosted software.** When
you run Invoicerr on your own infrastructure, we never receive, see, or process any of your data —
there is nothing for us to be a controller or processor of, and this Policy describes nothing that
happens to you. Everything below concerns the hosted Service only.

## 1. Who We Are

The data controller for the account and billing data described in Section 3 is **Roméo Chevrier,
sole trader (entrepreneur individuel)**, registered under **SIREN 982 187 676 (SIRET 982 187 676
00019)**, with registered address at **4 rue du Puits, 26120 Montélier, France** ("**we**", "**us**",
"**the Provider**"). Contact: **contact@invoicerr.app**.

Given the nature and scale of our processing, we are not required by **GDPR Article 37** to appoint a
Data Protection Officer. Use the contact above for any question or request under this Policy.

## 2. Two Roles, Two Kinds of Data

Like the Terms of Service (Section 15.1), this Policy distinguishes two roles:

- **We are the data controller** for your own **account data** — the information about you and your
  Company needed to operate your subscription (Section 3 below).
- **We are only the data processor**, acting on your documented instructions, for the personal data
  **you** put into documents you create or receive through the Service — your customers' or contacts'
  names, addresses, and similar details on an invoice or quote. That processing is governed by the
  [Data Processing Agreement](./data-processing-agreement.md), not by this Policy: **you** remain the
  controller of that data, and you are responsible for your own privacy notice to your customers.

## 3. What We Collect, as Controller, and Why

We collect all of the data below **directly from you**, either when you provide it (registration,
configuration, support) or automatically as you use the Service (connection and security data).

| Data | Examples | Purpose | Legal basis (GDPR Art. 6) |
| --- | --- | --- | --- |
| Account data | name, email, hashed password, session tokens | let you sign in and use the Service | Performance of a contract (Art. 6(1)(b)) |
| Company data | company name, address, national identifiers you configure (e.g. SIREN/VAT) | operate your Company's workspace, populate the documents you issue | Performance of a contract (Art. 6(1)(b)) |
| Subscription data | plan, seat count, subscription status, trial dates | run your subscription; Polar processes and stores your payment method and billing address as merchant of record — see Section 5 | Performance of a contract (Art. 6(1)(b)) |
| Connection & security data | IP address, timestamps of authentication events, application logs | detect abuse, keep the Service secure, diagnose incidents | Legitimate interest (Art. 6(1)(f)) |
| Proof of acceptance | which legal document and version you accepted, when, and the IP address and browser user agent you accepted it from | show that you agreed to the text that was in force when you agreed to it | Performance of a contract (Art. 6(1)(b)), and our legitimate interest in being able to evidence that agreement (Art. 6(1)(f)) |
| Support communications | the content of emails you send to contact@invoicerr.app | answer your request | Legitimate interest (Art. 6(1)(f)), or performance of a contract where the request concerns your subscription |
| Invoicing records for our own accounting | your Company's identity and the Fees billed to it | our own statutory bookkeeping obligation | Legal obligation (Art. 6(1)(c)) |

We do not send marketing email beyond what is transactional to your account and subscription (e.g.
sign-in, billing, and service notices) — there is no separate marketing-consent flow to describe.

## 4. Sub-processors

We share the account and billing data above with the following sub-processors, each engaged under its
own data-processing terms:

- **Polar Software Inc.** — payment processing and billing; acts as **merchant of record** for your
  subscription (Terms of Service Section 7.1) and is itself a controller for the payment details it
  collects from you directly.
- **Resend** — delivery of transactional email sent by the Service (sign-in links, notifications).
- **Cloudflare, Inc.** — inbound email routing for correspondence sent to **contact@invoicerr.app**
  (support correspondence only; Cloudflare never sees the data contained in the documents you create
  through the Service).
- **Google LLC (Gmail)** — the mailbox where support correspondence sent to **contact@invoicerr.app**
  is received (support correspondence only; Google never sees the data contained in the documents you
  create through the Service).
- **Scaleway SAS** — infrastructure hosting for the **production** environment of the Service: the
  Kubernetes cluster it runs on, the managed PostgreSQL database that stores the Company and account
  data described in Section 3 and the documents you create through the Service, and the object storage
  that holds archived documents. **The Service and Customer Data, including the database, are hosted in
  the European Union**, in Scaleway's Paris (France) region, with the database reached over Scaleway's
  own private network rather than the public internet.

**The acceptance environment used for the beta programme.** Before a release reaches the production
infrastructure described above, we validate it on a separate acceptance environment that the Provider
operates himself, on his own infrastructure, in France — no third party hosts it, so it is not listed
above as a sub-processor. During the beta programme, the programme's participants use the Service on
this acceptance environment rather than on Scaleway's production infrastructure, and their Customer
Data — including real invoices, real clients, and other real business records — is stored there. When
the acceptance environment used for the beta programme is retired, that data moves to the production
infrastructure described above.

**OCR (optical character recognition) runs on infrastructure we operate; no document is sent to a
third-party OCR provider.**

**Not sub-processors of ours:** payment providers you connect so **your own customers** can pay the
invoices **you** issue — Stripe, Mollie, PayPal — are **your own accounts**, contracted directly
between you and them (Terms of Service Section 14.3). The **national e-invoicing and government
platforms** you choose to connect (the French PDP, Poland's KSeF, Italy's SdI, Portugal's AT, France's
Chorus Pro) act on your own instruction and mandate to transmit the documents you send; their role
with respect to the personal data on those documents is addressed in the Data Processing Agreement,
not in this controller-facing Policy.

## 5. International Transfers

Some of the sub-processors above (Polar, Resend, Cloudflare, Google LLC) may process data outside the
European Economic Area, including in the United States. Where that is the case, the transfer relies on
that provider's own appropriate safeguards under GDPR Chapter V (such as the European Commission's
Standard Contractual Clauses). This section is a general statement, not a representation about any
individual provider's current certification — write to contact@invoicerr.app for the specific mechanism
a given provider relies on today. **Scaleway SAS is not in this list**: it is a French company that
hosts the Company's managed PostgreSQL database, in addition to the Kubernetes infrastructure and
object storage already described in Section 4, entirely within its Paris (France) region — no part of
the chain that stores the documents you create, or your Company's account and database records,
involves a non-EU entity.

## 6. Retention

- **Account and Company data** is kept for as long as your Company exists on the Service, then
  handled exactly as the Terms of Service, Section 13 describe: a Company that never converts from
  trial is deleted **no earlier than 30 days** after its end-of-trial archive has been sent
  (Section 13.3, first bullet — `billing/lifecycle.ts`'s own `MIN_RETRIEVAL_DAYS` constant); a Company
  that had a paid subscription is deleted **no earlier than 180 days** after that archive is sent
  (Section 13.3, second bullet — that same file's `PAID_ZIP_GRACE_DAYS` constant). Both figures are the
  minimum data-retrieval window Regulation (EU) 2023/2854 (the EU Data Act), Article 25(2)(g) requires
  before we may erase Your Data once you stop using the Service.
- **Archived documents still inside a statutory retention period outlive that deletion.** When you send
  a document through the Service we archive a copy of it and record, at that moment, how long the law
  of your Company's own country requires it to be kept and which text imposes that period. When your
  Company is deleted — by you, from your Company's settings, at any time and without us blocking your
  exit, or at the end of the schedule above — every record scoped to it and every stored file goes,
  **except** those archived documents whose recorded period has not yet run out. Those files stay on our
  storage, alongside a record naming the expiry date and the citation for each of them, and we erase
  them once that date has passed. The ground is **GDPR Article 17(3)(b)**: the right to erasure "shall
  not apply to the extent that processing is necessary … for compliance with a legal obligation which
  requires processing by Union or Member State law to which the controller is subject" — and a national
  invoice-retention obligation does not lapse because an account was closed. The periods we apply, each
  taken from the text that imposes it: **Germany**, 8 years from the end of the calendar year the
  document was issued in (UStG § 14b Abs. 1; AO § 147 Abs. 3); **France**, the longer of 6 years (LPF
  art. L102 B) and 10 years (C. com. art. L123-22), which bind a French company at the same time;
  **Poland**, 5 years (ustawa o VAT art. 112, which refers to the limitation period of Ordynacja
  podatkowa art. 70 § 1); **Portugal**, 10 years from the end of the calendar year of issue (CIVA art.
  52.º n.º 1). Those four countries are the only ones for which the Service carries a sourced retention
  rule: for a Company established anywhere else, nothing is held back and its archived documents are
  erased with everything else. Stated plainly: **if your Company is established in one of those four
  countries, the documents you sent through the Service stay on our storage for years after you have
  left**, and we will not erase them earlier at your request.
- **Application logs** are kept for **90 days**, then deleted automatically by a recurring purge —
  long enough to investigate a security incident or a support question that surfaces weeks later, and
  no longer.
- **Session records** — one row per sign-in, carrying the IP address and browser user agent it was
  created from — are deleted when you sign out, and otherwise kept for as long as your account
  exists. Deleting your account deletes them with it.
- **Your acceptance of these documents** — the date, the document and version accepted, and the IP
  address and user agent it was accepted from — is kept for as long as your account exists. We keep it
  because it is the proof that you agreed to the version you agreed to; it is deleted with your
  account.
- **Support communications** are kept for as long as needed to resolve your request and for a
  reasonable period afterward in case you follow up.

## 7. Security

Credentials and tokens used to connect your Company to third-party channels and platforms are
encrypted at rest (AES-256-GCM); all traffic to and from the Service is encrypted in transit (TLS) —
the same measures the Terms of Service describe in Section 15.3. Access to your data within our own
organization is restricted to what is needed to operate and support the Service.

## 8. Your Rights

Under the GDPR, you have the right to: access the personal data we hold about you (**Art. 15**);
have it corrected (**Art. 16**); have it erased (**Art. 17**); restrict its processing (**Art. 18**);
receive a portable copy of it (**Art. 20**); and object to processing based on our legitimate
interest (**Art. 21**). You can exercise any of these by writing to **contact@invoicerr.app**; we
will respond within the timeframe the GDPR sets for a controller. You also have the right to lodge a
complaint with the French data protection authority, the **CNIL** (www.cnil.fr), or with the
supervisory authority of your own EU member state.

The right to erasure (**Art. 17**) has a limit we apply, and you should know it before you ask: where a
statute still requires an archived document to be kept, **Art. 17(3)(b)** disapplies that right for as
long as the retention period runs, and we keep the document. Section 6 sets out which countries, which
periods, and which texts, and what is erased anyway.

We do not carry out any processing described in **GDPR Article 22** — there is no automated
decision-making, including profiling, that produces legal or similarly significant effects on you.

For the self-service full-data export, the accounting ledger export, and the automatic
end-of-subscription data export, see Terms of Service Sections 8.2 and 13.2 — all three are also how
you exercise portability in practice.

## 9. Cookies and Other Browser Storage

The Service sets two cookies — one to keep you signed in, one to remember whether you left the
navigation sidebar open — and keeps a handful of interface preferences in your browser's own local
storage. None of it is used for audience measurement, advertising, or profiling, and no third party
sets anything through the Service. See the
[Cookies & Acceptable Use Policy](./cookies-and-acceptable-use.md) for the full list, each item's
purpose and duration, and why no consent banner is shown.

## 10. Websites We Operate

The Service itself runs at **my.invoicerr.app**, hosted by Scaleway as described in Section 4.
Separately from the Service, we publish two public, static websites, both served by **GitHub
Pages** — a hosting service operated by **GitHub, Inc.**, 88 Colin P. Kelly Jr. Street, San
Francisco, CA 94107, USA, a wholly-owned subsidiary of Microsoft Corporation:

- **invoicerr.app** — our public marketing website. It sets no cookie and loads no analytics,
  advertising, or tracking script of any kind. The dark/light theme you pick is remembered only in
  your browser's `localStorage`, a purely local preference that never reaches us and carries no
  personal data. The page does make one call from **your own browser** to `api.github.com` (GitHub's
  public API) to display our current GitHub star count; that request is made directly by your
  browser, not routed through us, so GitHub sees the visitor's IP address the same way it would for
  any direct visit to github.com — see
  [GitHub's Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **docs.invoicerr.app** — our documentation website, built with Docusaurus. It sets no cookie and
  loads no analytics, advertising, or tracking script — its on-page search runs entirely in your
  browser (see the [Cookies & Acceptable Use Policy](./cookies-and-acceptable-use.md)).

Visiting either site sends your IP address and standard HTTP request headers to GitHub so it can
serve the page; that is GitHub's own technical access log, which we do not receive and do not
control. **No account, billing, or other Service data described in Section 3 ever transits through,
or is stored on, either site.**

Our source code is also published on GitHub, at
[github.com/invoicerr-app/invoicerr](https://github.com/invoicerr-app/invoicerr). Issues and
discussions posted there are public and are governed by GitHub's own privacy statement and terms, not
by this Policy.

GitHub, Inc. has self-certified to the U.S. Department of Commerce that it adheres to the EU-U.S. Data
Privacy Framework (DPF), including the UK Extension to the EU-U.S. DPF, for personal data it receives
from the EU/UK in this capacity — the same Chapter V safeguard referenced in Section 5 for our other
US-based providers.

## 11. Children

The Service is offered strictly business-to-business (Terms of Service Section 1.2) and is not
directed at, or knowingly used by, individuals acting outside a professional capacity.

## 12. Changes to This Policy

We may update this Policy from time to time; the version and effective date at the top of this page
identify the version in force. Where a change is material, we will tell you by email before it takes
effect, the same way the Terms of Service, Section 20.1 describes for that document.

## 13. Contact

Questions about this Policy, or a request under Section 8, can be sent to **contact@invoicerr.app**,
or by post to the address in Section 1.

## 14. Governing Language

This document is drafted and executed in English. Where we provide a translation into another
language for your convenience and understanding, that translation is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated version, **the English version prevails** and is the version that governs the rights and
obligations of the parties. Translations are provided in good faith to help each audience understand
this document; they create no separate or additional rights.

---

### Changelog

- **2026-09-16** — Initial draft.
- **2026-09-17** — Restructured against the `legal-tos-privacy`/`gdpr-compliance` skill checklists; no
  fact changed. Updated every Terms of Service cross-reference to match that document's 2026-09-17
  renumbering (Sections 5→7, 8.1→12.1, 8.3→12.3, 7→11, 7.3→11.3, 9.1→13.1, 9.3→13.3, 9.4→8.2/11.2,
  12.1→18.1). Added: a Data Protection Officer statement in Section 1 (none required, GDPR Art. 37,
  given our size); a "collected directly from you" statement opening Section 3 (GDPR Art. 14 does not
  apply — nothing here is sourced from a third party); an explicit GDPR Art. 22 statement in Section 8
  that no automated decision-making or profiling with legal or similarly significant effect takes
  place. Deliberately did **not** add CCPA/LGPD-specific sections: the Service is marketed strictly
  B2B out of France/the EU, and no representation targeting California or Brazilian customers exists
  today to ground one — add them if that changes.
- **2026-09-17** — Owner decisions applied. Section 4: added **Cloudflare, Inc.** (inbound routing for
  **contact@invoicerr.app**) and **Google LLC (Gmail)** (the mailbox that receives it) as
  sub-processors, both scoped to support correspondence only — neither ever sees the data contained in
  the documents you create through the Service. Removed **Mistral AI**: OCR no longer calls any
  third-party API — it now runs entirely on infrastructure we operate, so there is nothing left to
  disclose as a sub-processor for that feature (the `OCR_ENGINE=mistral` option this used to describe
  is gone from the product, not just from this Policy). Section 4's hosting bullet and Section 5 updated
  to match. Section 4: added an explicit commitment that the Service and Customer Data are hosted in
  the European Union. Section 5: the named US-based sub-processors list dropped Mistral AI and gained
  Cloudflare and Google LLC.
- **2026-09-17** — Owner decision applied: hosting provider resolved. Section 4's hosting bullet now
  names **Scaleway SAS** (Kubernetes infrastructure and document object storage, Paris/France region)
  and **Neon, LLC** (a Databricks, Inc. affiliate; managed PostgreSQL database, EU region — AWS Europe,
  Frankfurt) in place of the `[HOSTING PROVIDER, COUNTRY]` placeholder. Section 5's US-based-provider
  list gained **Neon/Databricks**: Neon, LLC's parent, Databricks, Inc., is a US company, even though
  the Company's own database runs in Neon's EU region — the same distinction already drawn for the
  other named US-based sub-processors.
- **2026-09-17** — GitHub added as hosting provider for the documentation website. New Section 10
  ("Websites We Operate") discloses **GitHub, Inc.** (address, Microsoft parent, self-certified EU-U.S.
  DPF membership including the UK Extension) as the GitHub Pages host of **docs.invoicerr.app** and of
  our public source repository, with the same "receives only visitor IP/request headers, no Service
  data, no cookie, no analytics" scoping already given to Cloudflare/Google for support email in
  Section 4. At the time, `invoicerr.app` itself was believed to be the Ingress host for the
  Scaleway-hosted Service (same domain as the app, not a second site) — superseded by the entry below.
- **2026-09-19** — Owner decision: the public website moved to **GitHub Pages** at **invoicerr.app**;
  the Service now lives at **my.invoicerr.app**. The 2026-09-17 entry above assumed `invoicerr.app` was
  the app's own Ingress host — that was correct at the time but is no longer the current setup.
  Section 10 rewritten to describe **invoicerr.app** as a second static, GitHub Pages-hosted site
  (public repository `invoicerr-app/landing`): no cookie, no analytics or tracking script, a
  theme preference kept only in `localStorage` (no personal data), and one client-side call to
  `api.github.com` for the GitHub star count — made by the visitor's own browser, so GitHub, not us,
  sees that visitor's IP address for that call, per GitHub's own Privacy Statement (now linked). The
  Service's own address is stated explicitly as **my.invoicerr.app** at the top of Section 10.
- **2026-09-19** — Owner decision, on counsel's advice: this document is now translated into French,
  German, Italian, Polish, and Portuguese in full — GDPR Article 12 and WP260 require that information
  about personal data be understandable by the audience it targets, and the product's own interface
  already ships in those five languages. New Section 14 ("Governing Language") states that the English
  text is the one that governs whenever a translation reads differently, so accepting this Policy in
  any language is accepting the same, single English wording — no fact changed by the translation
  itself.
- **2026-09-19** — Owner decision: implemented Regulation (EU) 2023/2854 (the EU Data Act), Chapter VI,
  alongside the matching Terms of Service update. **Changed**: Section 6's first bullet now gives a
  Company that never converts from trial a **minimum thirty (30)-day retention window** after its
  end-of-trial archive is sent, instead of immediate deletion — the one concrete Data Act gap the audit
  found (`billing/lifecycle.ts`'s new `MIN_RETRIEVAL_DAYS` constant, shipped alongside this update).
  Section 8 now also points to the new self-service full-data export
  (`POST /api/companies/export`) as a portability route, not only the accounting-ledger and
  end-of-subscription exports. Updated every Terms of Service cross-reference to match that document's
  2026-09-19 renumbering (Sections 13.1→15.1, 12.3→14.3, 11→13, 11.3→13.3, 13.3→15.3, 11.2→13.2,
  18.1→20.1).
- **2026-09-19** — Owner decision: the managed PostgreSQL database moves from Neon (AWS Europe,
  Frankfurt) to **Scaleway SAS**'s own managed database offering, in the same Paris (France) region
  already used for the Kubernetes infrastructure and object storage, reached over Scaleway's private
  network rather than the public internet. Section 4's separate Scaleway and Neon bullets are merged
  into one: **Neon, LLC** (a Databricks, Inc. affiliate) is no longer a sub-processor. Section 5's
  US-based-provider list drops Neon/Databricks accordingly and now states explicitly that no part of
  the chain storing your documents or your Company's account and database records involves a non-EU
  entity — the one non-EU exposure that list previously carried for that data.
- **2026-09-20** — Corrections, following an audit that compared this Policy against what the
  application actually stores. **Section 3** gains a "Proof of acceptance" row: the record of which
  legal document and version you accepted, when, and from which IP address and user agent, was being
  collected without being described here. **Section 6** now states a concrete retention duration for
  application logs — **90 days**, enforced by a recurring automatic purge — where it previously said
  only "deleted or anonymized on a rolling basis"; GDPR Article 13(2)(a) asks for the period, or the
  criteria to determine it, and a real figure now exists to give. The same section separates out
  session records (kept until sign-out or account deletion) and the acceptance record (kept while the
  account exists) rather than folding all three into one sentence. **Section 9** previously stated
  that the Service "sets exactly one cookie" — that was wrong; the navigation sidebar sets a second
  one. It now summarizes both cookies and the browser-local preferences, and defers to the
  [Cookies & Acceptable Use Policy](./cookies-and-acceptable-use.md), corrected the same day, for the
  itemized list. No new processing was introduced by any of this: every change describes something
  the Service was already doing.
- **2026-09-20** — Owner decision: introduced a separate acceptance environment, used to validate a
  release before it reaches the production infrastructure and, during the beta programme, used by the
  programme's participants. **Section 4**'s Scaleway bullet is now scoped explicitly to the production
  environment, and gains a new paragraph stating that the acceptance environment is hosted by the
  Provider himself, on his own infrastructure, in France — not by Scaleway, and not by any third-party
  sub-processor — and that during the beta programme, participants' Customer Data (including real
  invoices and other real business records) resides there, moving to the production infrastructure only
  once that environment is retired. This is a new fact, not a restatement: it is the first place this
  Policy discloses that a beta participant's Customer Data is stored somewhere other than Scaleway's
  production infrastructure.
- **2026-09-21** — Owner decision: how deleting a Company and statutory retention interact. **Section
  6** gains a bullet stating that a Company can be deleted at any time and that nothing blocks that
  exit, that every record scoped to it and every stored file is then erased **except** archived
  documents whose statutory retention period has not yet run out, and that those files stay on our
  storage — with the expiry date and the citation recorded against each — until that date passes. The
  ground is **GDPR Article 17(3)(b)**, and the bullet lists the four countries for which the Service
  carries a sourced retention rule (Germany, UStG § 14b Abs. 1 and AO § 147 Abs. 3; France, LPF art.
  L102 B and C. com. art. L123-22; Poland, ustawa o VAT art. 112 with Ordynacja podatkowa art. 70 § 1;
  Portugal, CIVA art. 52.º n.º 1), stating that a Company established anywhere else has nothing held
  back. **Section 8** now names that limit on the erasure right where the right itself is described,
  instead of leaving it only in Section 6. This is a new fact, not a restatement: it is the first place
  this Policy discloses that documents you sent through the Service can remain on our storage for years
  after your Company is deleted.
