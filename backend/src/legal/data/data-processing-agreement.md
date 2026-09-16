---
title: Data Processing Agreement
sidebar_position: 3
version: 2026-09-17
effectiveDate: 2026-09-17
---

:::warning Draft
Draft — not yet reviewed by counsel.
:::

This Data Processing Agreement ("**DPA**") supplements the [Terms of Service](./terms-of-service.md)
for the **hosted offering** of Invoicerr and implements **GDPR Article 28**. **It does not apply to
the self-hosted software** — see the Terms of Service's own scope clause and the
[Privacy Policy](./privacy-policy.md), Preamble: a self-hosted deployment never sends us any data, so
there is no processing for this DPA to govern.

## 1. Parties and Scope

**You** ("**the Customer**") are the **data controller** for the personal data contained in the
documents you create or receive through the Service — in particular your own customers' and
contacts' names, addresses, and other details on an invoice, quote, or related record ("**Customer
Personal Data**"). **We** ("**the Processor**", defined as in Terms of Service Section 1.1) process
Customer Personal Data **solely on your documented instructions**, as described in this DPA. This is
the exact duality the Terms of Service, Section 13.1 already states; this DPA is the detail Article
28(3) requires for it.

## 2. Definitions

"Personal Data", "Processing", "Data Subject", "Controller", "Processor", and "Personal Data Breach"
have the meanings given in **GDPR Article 4**.

## 3. Subject-Matter, Duration, Nature and Purpose

- **Subject-matter**: hosting, storing, rendering, and — where you choose to send a document through
  a transmission channel or government platform — transmitting the documents you create through the
  Service.
- **Duration**: for as long as your Company subscribes to the Service, plus the retention window
  described in Section 10 below.
- **Nature and purpose**: automated storage and processing needed to provide the Service's core
  function — creating, issuing, and archiving business documents — exactly as configured by you.
- **Categories of Data Subjects**: your own customers, suppliers, and contacts named on the documents
  you create.
- **Categories of Personal Data**: names, postal and email addresses, phone numbers, and any other
  personal data you choose to enter into a document's fields (e.g. a contact person's name on an
  invoice). We do not require or expect special categories of data (GDPR Art. 9) and you should not
  enter any into the Service.

## 4. Processor Obligations (GDPR Art. 28(3))

We:

1. process Customer Personal Data **only on your documented instructions** — this DPA, together with
   your own configuration of the Service (which company, which channels, which documents you send),
   constitutes those instructions, including with regard to transfers, unless required otherwise by
   EU or Member State law, in which case we will inform you before processing, unless that law
   prohibits it on important grounds of public interest;
2. ensure that persons authorized to process Customer Personal Data are bound by confidentiality,
   whether contractually or by statute;
3. implement the security measures described in Section 9;
4. respect the conditions for engaging a further sub-processor described in Section 7;
5. assist you, taking into account the nature of the processing, in responding to Data Subject
   requests (Section 8);
6. assist you in complying with your own obligations under GDPR Articles 32-36, taking into account
   the nature of processing and the information available to us;
7. delete or return Customer Personal Data at the end of the provision of Service, as described in
   Section 10;
8. make available to you the information reasonably necessary to demonstrate compliance with this
   Article and allow for, and contribute to, audits as described in Section 11.

## 5. Customer Obligations and Rights

As controller, **you have the right to**: issue us documented instructions regarding the processing of
Customer Personal Data, which we will follow (Section 1); object to a new sub-processor and, if
unresolved, end the subscription on that ground (Section 7); receive our assistance with Data Subject
requests (Section 8); and audit our compliance with this DPA (Section 11).

In turn, **you warrant** that you have a lawful basis for the Customer Personal Data you enter into
the Service, that the data is accurate, and that you enter no more of it than is needed for the
document you are creating. Your instructions to us are limited to what the Service's own features let
you configure — we have no independent means of processing Customer Personal Data outside of running
the Service as built.

## 6. Confidentiality

Our personnel authorized to access Customer Personal Data are bound by a confidentiality obligation,
whether contractual or statutory, that survives the end of their engagement with us.

## 7. Sub-processors

You give us a **general authorization** to engage the sub-processors relevant to processing documents
that carry Customer Personal Data:

- The **national e-invoicing and government platforms you choose to connect** — the French PDP,
  Poland's KSeF, Italy's SdI, Portugal's AT, France's Chorus Pro for B2G invoicing — acting on your
  explicit instruction, under the credentials and mandates you provide, to transmit the documents you
  send.
- **Resend** — delivery of transactional email that may carry a document, or a link to one, on your
  instruction.
- **Cloudflare, Inc.** — inbound email routing for correspondence sent to **contact@invoicerr.app**
  (support correspondence only; never the Customer Personal Data contained in the documents you create
  through the Service).
- **Google LLC (Gmail)** — the mailbox where support correspondence sent to **contact@invoicerr.app**
  is received (support correspondence only; never the Customer Personal Data contained in the documents
  you create through the Service).
- **Scaleway SAS** — infrastructure hosting for the Service: the Kubernetes cluster it runs on and the
  object storage that holds archived documents, including those carrying Customer Personal Data.
  **The Service and Customer Data are hosted in the European Union**, in Scaleway's Paris (France)
  region.
- **Neon, LLC** (a Databricks, Inc. affiliate) — the managed PostgreSQL database in which the documents
  you create, and the Customer Personal Data they contain, are stored. The Company's database runs in
  Neon's EU region (AWS Europe, Frankfurt).

**OCR (optical character recognition) runs on infrastructure we operate; no document is sent to a
third-party OCR provider.**

**Polar Software Inc. is not a sub-processor under this DPA**: it processes your Company's own
subscription and payment data as an independent controller/merchant of record (Privacy Policy
Sections 3-4), not Customer Personal Data appearing on the documents you issue.

Each sub-processor above is bound, by contract, to data-protection obligations materially equivalent
to those in this DPA — in particular the confidentiality duty of Section 6 and the security measures
of Section 9 (**GDPR Art. 28(4)**). We remain fully liable to you for that sub-processor's performance
of those obligations.

We will give you at least **thirty (30) days' notice by email** before adding a new sub-processor to
the list above, mirroring the notice period the Terms of Service, Section 18.1 already uses for
changes to that Agreement. You may object on reasonable data-protection grounds by writing to
**contact@invoicerr.app** within that window; if we cannot address your objection, either party may
treat that as grounds to end the subscription under the Terms of Service, Section 10.

## 8. Assistance with Data Subject Requests

If a Data Subject contacts us directly about Customer Personal Data, we will inform you without undue
delay and will not respond to the Data Subject ourselves, unless you instruct us to. Where a feature
of the Service lets you fulfil a request yourself (for example, editing or deleting a client's record),
you should use it directly; we will otherwise provide reasonable assistance.

## 9. Security Measures (GDPR Art. 32)

- Encryption at rest (AES-256-GCM) for credentials and tokens used to connect to third-party channels
  and platforms.
- Encryption in transit (TLS) for all traffic to and from the Service.
- Role-based access control within your Company (owner/admin/member roles) and, within our own
  organization, access limited to what is needed to operate and support the Service.

## 10. Deletion or Return of Data at the End of the Provision of Services

At the end of your Company's subscription, the Terms of Service, Section 11 govern what happens to
your data, and this DPA adopts the same mechanism as the "return" half of Article 28(3)(g):

- **Return**: the zip archive described in Terms of Service Section 11.2 — containing, for every
  document your Company holds, its stored data and, where renderable, a copy of it — is generated
  automatically and emailed to your Company's Owner. This is the return of Customer Personal Data
  Article 28(3)(g) requires; you may also request a full export at any time before that point (Terms
  of Service Section 8.2).
- **Deletion**: follows the same schedule as the Privacy Policy, Section 6 — immediate after the
  archive for a Company that never had a paid subscription, no earlier than **180 days** after the
  archive for one that did.

## 11. Audits

We will make available to you the information reasonably necessary to demonstrate compliance with
this DPA, and will allow for, and contribute to, audits — including inspections — conducted by you or
an auditor you mandate, on reasonable prior written notice, subject to confidentiality and to a
frequency of no more than once per twelve-month period absent a specific, documented cause (such as an
actual or suspected Personal Data Breach concerning Customer Personal Data).

## 12. Personal Data Breach Notification

We will notify you **without undue delay** after becoming aware of a Personal Data Breach affecting
Customer Personal Data, with the information reasonably available to us at the time, sufficient to let
you meet your own 72-hour notification obligation to your supervisory authority under **GDPR Art.
33**, and your obligation to inform affected Data Subjects under **Art. 34** where it applies.

## 13. International Transfers

Same statement as the Privacy Policy, Section 5: where a sub-processor listed in Section 7 processes
Customer Personal Data outside the EEA, the transfer relies on that provider's own appropriate
safeguards under GDPR Chapter V.

## 14. Term, Liability, and Governing Law

This DPA runs for as long as the Terms of Service do, and terminates automatically with them. The
liability cap and governing law/jurisdiction of the Terms of Service, Sections 15 and 18.2, apply to
this DPA as well.

---

### Changelog

- **2026-09-16** — Initial draft.
- **2026-09-17** — Restructured against the `dpa-drafting` skill's Article 28(3) checklist; no fact
  changed. Updated every Terms of Service cross-reference to match that document's 2026-09-17
  renumbering (9.1→13.1, 8.1→12.1, 12.1→18.1, Section 6→10, 7.2→11.2, 9.4→8.2, 10.3/12.2→15/18.2).
  Section 5 renamed "Customer Obligations and Rights" and now states the controller's own Article
  28(3) rights explicitly (instruct, object to a sub-processor, request assistance, audit) rather than
  leaving them only implicit in Sections 1/7/8/11. Section 7 now states the Article 28(4) flow-down
  explicitly: each sub-processor is bound to materially equivalent obligations, and we remain fully
  liable for their performance — the checklist's provision 7, previously only implied by the 30-day
  notice/objection mechanism.
- **2026-09-17** — Owner decisions applied. Section 7: added **Cloudflare, Inc.** (inbound routing for
  **contact@invoicerr.app**) and **Google LLC (Gmail)** (the mailbox that receives it), both scoped to
  support correspondence only — neither ever processes the Customer Personal Data contained in the
  documents you create through the Service. Removed **Mistral AI**: OCR no longer calls any
  third-party API — it now runs entirely on infrastructure we operate (matching the Privacy Policy's
  own Section 4 change), so there is no third-party OCR sub-processor left to authorize here. Section
  7's hosting bullet now states explicitly that the Service and Customer Data are hosted in the
  European Union.
- **2026-09-17** — Owner decision applied: hosting provider resolved. Section 7's hosting bullet now
  names **Scaleway SAS** (Kubernetes infrastructure and object storage for archived documents,
  Paris/France region) and **Neon, LLC** (a Databricks, Inc. affiliate; the managed PostgreSQL database
  in which Customer Personal Data is stored, EU region — AWS Europe, Frankfurt) in place of the
  `[HOSTING PROVIDER, COUNTRY]` placeholder.
