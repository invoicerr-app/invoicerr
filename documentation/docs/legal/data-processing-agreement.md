---
title: Data Processing Agreement
sidebar_position: 3
version: 2026-09-21
effectiveDate: 2026-09-21
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
the exact duality the Terms of Service, Section 15.1 already states; this DPA is the detail Article
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
  Poland's KSeF, Italy's SdI (and, for its certified-email channel, the PEC mailbox provider you
  subscribe to), Portugal's AT, France's Chorus Pro for B2G invoicing — acting on your explicit
  instruction, under the credentials and mandates you provide, to transmit the documents you send.
- **Resend** — delivery of transactional email that may carry a document, or a link to one, on your
  instruction.
- **Cloudflare, Inc.** — inbound email routing for correspondence sent to **contact@invoicerr.app**
  (support correspondence only; never the Customer Personal Data contained in the documents you create
  through the Service).
- **Google LLC (Gmail)** — the mailbox where support correspondence sent to **contact@invoicerr.app**
  is received (support correspondence only; never the Customer Personal Data contained in the documents
  you create through the Service).
- **Scaleway SAS** — infrastructure hosting for the **production** environment of the Service: the
  Kubernetes cluster it runs on, the managed PostgreSQL database in which the documents you create — and
  the Customer Personal Data they contain — are stored, and the object storage that holds archived
  documents, including those carrying Customer Personal Data. **The Service and Customer Data, including
  the database, are hosted in the European Union**, in Scaleway's Paris (France) region, with the
  database reached over Scaleway's own private network rather than the public internet.

**OCR (optical character recognition) runs on infrastructure we operate; no document is sent to a
third-party OCR provider.**

**The acceptance environment used for the beta programme is not run by a sub-processor.** Before a
release reaches the production environment above, we validate it on a separate acceptance environment
that we operate ourselves, on our own infrastructure, in France. Because we host that environment
directly, rather than through a third party, there is no sub-processor to authorize for it, and none is
added to this Section for that reason — the Processor hosting on his own hardware is not his own
sub-processor. During the beta programme, the programme's participants use the Service on this
acceptance environment, and Customer Personal Data they enter — on real invoices and other real
documents — is processed and stored there, not on Scaleway's production infrastructure above, until
that environment is retired, at which point it moves to the production infrastructure.

**Polar Software Inc. is not a sub-processor under this DPA**: it processes your Company's own
subscription and payment data as an independent controller/merchant of record (Privacy Policy
Sections 3-4), not Customer Personal Data appearing on the documents you issue.

**GitHub, Inc. is not a sub-processor under this DPA either**: it hosts our public documentation
website (docs.invoicerr.app) and our source code repository via GitHub Pages, Actions, and Container
Registry — infrastructure that never receives, stores, or processes Customer Personal Data. See
Privacy Policy, Section 10.

**The AI assistant you connect through our Model Context Protocol endpoint is not a sub-processor
under this DPA**: the Service exposes an MCP endpoint (`POST /api/mcp`) so you can create an API key
and connect an AI assistant of your own choosing to it; within the scopes you grant that key, the
assistant can read and manage your clients and documents, and run document actions, on your behalf.
We neither call nor choose the AI model behind your assistant — its provider is selected by you, has
no contract with us, and is therefore not a sub-processor under this DPA, for the same reason Polar is
not one above. You are responsible for the lawfulness of any Customer Personal Data your assistant
sends to that provider, including any transfer outside the EEA, and for the instructions the assistant
acts on. One of the MCP tools, `get_document_pdf_link`, creates a public, unauthenticated link to a
document's PDF, valid for 30 days and revocable from the Service; once such a link is surfaced into a
conversation with your assistant, anyone who holds it can reach that document for as long as the link
remains valid.

Each sub-processor above is bound, by contract, to data-protection obligations materially equivalent
to those in this DPA — in particular the confidentiality duty of Section 6 and the security measures
of Section 9 (**GDPR Art. 28(4)**). We remain fully liable to you for that sub-processor's performance
of those obligations.

We will give you at least **thirty (30) days' notice by email** before adding a new sub-processor to
the list above. You may object on reasonable data-protection grounds by writing to
**contact@invoicerr.app** within that window; if we cannot address your objection, either party may
treat that as grounds to end the subscription under the Terms of Service, Section 12.

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
- **Backup encryption.** Backups of the documents and files the Service stores are encrypted
  (AES-256-GCM) inside our own infrastructure before they are written to backup storage, under a key
  that only we hold and that the storage provider never receives — a missing key fails the backup run
  rather than writing anything unencrypted, and a leaked storage access key on its own yields
  ciphertext, not documents. This does not, by itself, establish the notification exemption **GDPR
  Article 34(3)(a)** allows for personal data rendered unintelligible by such measures; whether that
  exemption applies is a case-by-case assessment, not a claim made here.

## 10. Deletion or Return of Data at the End of the Provision of Services

At the end of your Company's subscription, the Terms of Service, Section 13 govern what happens to
your data, and this DPA adopts the same mechanism as the "return" half of Article 28(3)(g):

- **Return**: the zip archive described in Terms of Service Section 13.2 — containing, for every
  document your Company holds, its stored data and, where renderable, a copy of it — is generated
  automatically and emailed to your Company's Owner. This is the return of Customer Personal Data
  Article 28(3)(g) requires; you may also generate a full export yourself, self-service, at any time
  before that point (Terms of Service Section 8.2).
- **Deletion**: follows the same schedule as the Privacy Policy, Section 6 — no earlier than
  **thirty (30) days** after the archive for a Company that never had a paid subscription (Regulation
  (EU) 2023/2854, Article 25(2)(g)'s minimum retrieval window), no earlier than **180 days** after the
  archive for one that did.
- **Statutory retention**: one category of Customer Personal Data outlives that deletion. Every
  document you send through the Service is archived, and each archive records how long the law of your
  Company's own country requires that document to be kept and which text imposes the period. We do not
  erase an archived document while its period is still running — not on your instruction, and not when
  your Company is deleted, which you may do at any time and which we never block. Article 28(3)(g)
  itself preserves this case: a processor deletes existing copies "unless Union or Member State law
  requires storage of the personal data", and **GDPR Article 17(3)(b)** disapplies the erasure right to
  the same extent, for processing "necessary … for compliance with a legal obligation which requires
  processing by Union or Member State law to which the controller is subject". The file stays on our
  storage, with the expiry date and the citation recorded against it, and is erased once that date has
  passed. The Privacy Policy, Section 6 lists the four countries concerned today — Germany, France,
  Poland and Portugal — with the period and the statute for each, and states that a Company established
  anywhere else has nothing held back.

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
liability cap and governing law/jurisdiction of the Terms of Service, Sections 17 and 20.2, apply to
this DPA as well.

## 15. Governing Language

This document is drafted and executed in English. Where we provide a translation into another
language for your convenience and understanding, that translation is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated version, **the English version prevails** and is the version that governs the rights and
obligations of the parties. Translations are provided in good faith to help each audience understand
this document; they create no separate or additional rights.

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
- **2026-09-17** — GitHub added as hosting provider for the documentation website. Section 7 gained an
  explicit note that **GitHub, Inc.** is not a sub-processor under this DPA: it hosts only our public
  documentation site and source repository (GitHub Pages/Actions/Container Registry), never Customer
  Personal Data — the same treatment already given to Polar in this section, for the same reason (no
  Customer Personal Data flows to it).
- **2026-09-19** — Owner decision, on counsel's advice: this document is now translated into French,
  German, Italian, Polish, and Portuguese in full, alongside the Privacy Policy — GDPR Article 12 and
  WP260 require that information about personal data be understandable by the audience it targets. New
  Section 15 ("Governing Language") states that the English text is the one that governs whenever a
  translation reads differently. No fact changed by the translation itself.
- **2026-09-19** — Owner decision: implemented Regulation (EU) 2023/2854 (the EU Data Act), Chapter VI,
  alongside the matching Terms of Service and Privacy Policy updates. **Changed**: Section 10's
  Deletion bullet now gives a Company that never had a paid subscription a **minimum thirty (30)-day**
  window after the archive is sent, instead of immediate deletion (`billing/lifecycle.ts`'s new
  `MIN_RETRIEVAL_DAYS` constant, shipped alongside this update) — Article 25(2)(g)'s own minimum.
  Section 10's Return bullet now also points to the self-service full-data export
  (`POST /api/companies/export`) rather than an email request. Updated every Terms of Service
  cross-reference to match that document's 2026-09-19 renumbering (Section 13.1→15.1, 18.1→20.1,
  Section 10→12, Section 11→13, 11.2→13.2, Sections 15/18.2→17/20.2).
- **2026-09-19** — Owner decision: the managed PostgreSQL database moves from Neon (AWS Europe,
  Frankfurt) to **Scaleway SAS**'s own managed database offering, in the same Paris (France) region
  already used for the Kubernetes infrastructure and object storage, reached over Scaleway's private
  network rather than the public internet. Section 7's separate Scaleway and Neon bullets are merged
  into one: **Neon, LLC** (a Databricks, Inc. affiliate) is no longer a sub-processor, which also
  removes that affiliate's US parent from the processing chain for Customer Personal Data. No other
  section changed: Section 13 (International Transfers) already only cross-refers to the Privacy
  Policy, Section 5, where the corresponding statement is updated.
- **2026-09-20** — Legal audit finding. Section 9 gained a fourth security measure: backups of the
  documents and files the Service stores are encrypted (AES-256-GCM) inside our own infrastructure
  before they reach backup storage, under a key the storage provider never receives, without claiming
  the **GDPR Article 34(3)(a)** notification exemption applies — that remains a case-by-case
  assessment. Section 7's e-invoicing
  platforms bullet now names the certified-email (PEC) mailbox provider behind Italy's SdI channel for
  companies using it. Section 7 gained a third non-sub-processor carve-out, for the AI assistant a
  Customer connects through the Service's Model Context Protocol endpoint: the provider behind it is
  chosen by the Customer, not by us, so it is not a sub-processor under this DPA, and the Customer is
  responsible for what it sends that provider — including any transfer outside the EEA — and for the
  instructions its assistant acts on; the paragraph also discloses that one of its tools mints a
  public, unauthenticated PDF link, valid 30 days and revocable. Section 7's closing paragraph no
  longer claims the thirty-day sub-processor notice mirrors the Terms of Service, Section 20.1 — that
  section's own 2026-09-20 rewrite gives changes immediate effect instead, so the cross-reference had
  become false; the thirty-day notice itself is unchanged and stands on its own.
- **2026-09-20** — Owner decision: introduced a separate acceptance environment, used to validate a
  release before it reaches the production environment and, during the beta programme, used by that
  programme's participants. Section 7's Scaleway bullet is now scoped explicitly to the production
  environment. Section 7 gained a new paragraph, alongside the existing Polar/GitHub/AI-assistant
  carve-outs, stating that the acceptance environment is **not** run by a sub-processor: we host it
  ourselves, on our own infrastructure, in France, so there is no third party to authorize for it. The
  same paragraph discloses that, during the beta programme, participants' Customer Personal Data —
  including on real invoices and other real documents — is processed and stored on that environment,
  not on Scaleway's production infrastructure, until the environment is retired, at which point the
  data moves to the production infrastructure.
- **2026-09-21** — Owner decision: how deleting a Company and statutory retention interact. **Section
  10** gains a third bullet, "Statutory retention": an archived document whose retention period is
  still running is not erased — neither on your instruction nor when your Company is deleted, which you
  may do at any time and which we never block — and the file stays on our storage with its expiry date
  and its citation recorded against it. The ground is the carve-out Article 28(3)(g) already contains
  ("unless Union or Member State law requires storage of the personal data") together with **GDPR
  Article 17(3)(b)**. Section 3's "Duration" was already expressed as the subscription plus the
  retention window described in Section 10, and now correctly covers this window too. This is a new
  fact, not a restatement: it is the first place this DPA discloses that Customer Personal Data can
  remain on our storage for years after the end of the provision of services.
