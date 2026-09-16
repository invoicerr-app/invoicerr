---
title: Privacy Policy
sidebar_position: 2
version: 2026-09-17
effectiveDate: 2026-09-17
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

Like the Terms of Service (Section 13.1), this Policy distinguishes two roles:

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
- **[HOSTING PROVIDER, COUNTRY]** — infrastructure hosting for the Service. **The Service and Customer
  Data are hosted in the European Union**; the specific provider and country are still pending the
  final hosting decision — see Terms of Service Section 12.1.

**OCR (optical character recognition) runs on infrastructure we operate; no document is sent to a
third-party OCR provider.**

**Not sub-processors of ours:** payment providers you connect so **your own customers** can pay the
invoices **you** issue — Stripe, Mollie, PayPal — are **your own accounts**, contracted directly
between you and them (Terms of Service Section 12.3). The **national e-invoicing and government
platforms** you choose to connect (the French PDP, Poland's KSeF, Italy's SdI, Portugal's AT, France's
Chorus Pro) act on your own instruction and mandate to transmit the documents you send; their role
with respect to the personal data on those documents is addressed in the Data Processing Agreement,
not in this controller-facing Policy.

## 5. International Transfers

Some of the sub-processors above (Polar, Resend, Cloudflare, Google LLC) may process data outside the
European Economic Area, including in the United States. Where that is the case, the transfer relies on that
provider's own appropriate safeguards under GDPR Chapter V (such as the European Commission's Standard
Contractual Clauses). This section is a general statement, not a representation about any individual
provider's current certification — write to contact@invoicerr.app for the specific mechanism a given
provider relies on today.

## 6. Retention

- **Account and Company data** is kept for as long as your Company exists on the Service, then
  handled exactly as the Terms of Service, Section 11 describe: a Company that never converts from
  trial is deleted once its end-of-trial archive has been sent (Section 11.3, first bullet); a Company
  that had a paid subscription is deleted **no earlier than 180 days** after that archive is sent
  (Section 11.3, second bullet) — the exact grace period this Policy and `billing/lifecycle.ts`'s own
  `PAID_ZIP_GRACE_DAYS` constant agree on.
- **Application logs** and connection/security data are kept only as long as needed for the security
  and diagnostic purpose in Section 3, and are deleted or anonymized on a rolling basis.
- **Support communications** are kept for as long as needed to resolve your request and for a
  reasonable period afterward in case you follow up.

## 7. Security

Credentials and tokens used to connect your Company to third-party channels and platforms are
encrypted at rest (AES-256-GCM); all traffic to and from the Service is encrypted in transit (TLS) —
the same measures the Terms of Service describe in Section 13.3. Access to your data within our own
organization is restricted to what is needed to operate and support the Service.

## 8. Your Rights

Under the GDPR, you have the right to: access the personal data we hold about you (**Art. 15**);
have it corrected (**Art. 16**); have it erased (**Art. 17**); restrict its processing (**Art. 18**);
receive a portable copy of it (**Art. 20**); and object to processing based on our legitimate
interest (**Art. 21**). You can exercise any of these by writing to **contact@invoicerr.app**; we
will respond within the timeframe the GDPR sets for a controller. You also have the right to lodge a
complaint with the French data protection authority, the **CNIL** (www.cnil.fr), or with the
supervisory authority of your own EU member state.

We do not carry out any processing described in **GDPR Article 22** — there is no automated
decision-making, including profiling, that produces legal or similarly significant effects on you.

For the accounting ledger export and the automatic end-of-subscription data export, see Terms of
Service Sections 8.2 and 11.2 — both are also how you exercise portability in practice.

## 9. Cookies

The Service sets exactly one cookie, used only to keep you signed in. See the
[Cookies & Acceptable Use Policy](./cookies-and-acceptable-use.md) for what it is and why no consent
banner is shown for it.

## 10. Children

The Service is offered strictly business-to-business (Terms of Service Section 1.2) and is not
directed at, or knowingly used by, individuals acting outside a professional capacity.

## 11. Changes to This Policy

We may update this Policy from time to time; the version and effective date at the top of this page
identify the version in force. Where a change is material, we will tell you by email before it takes
effect, the same way the Terms of Service, Section 18.1 describes for that document.

## 12. Contact

Questions about this Policy, or a request under Section 8, can be sent to **contact@invoicerr.app**,
or by post to the address in Section 1.

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
  the European Union — the `[HOSTING PROVIDER, COUNTRY]` placeholder itself is unchanged, pending that
  decision. Section 5: the named US-based sub-processors list dropped Mistral AI and gained Cloudflare
  and Google LLC.
