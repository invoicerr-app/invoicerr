---
title: International Access Transparency
sidebar_position: 7
version: 2026-09-20
effectiveDate: 2026-09-20
---

:::warning Draft
Draft — not yet reviewed by counsel.
:::

This page is published in accordance with **Regulation (EU) 2023/2854 (the "EU Data Act"), Article
28**, which requires a provider of a data processing service to make publicly available (a) the
jurisdictions the ICT infrastructure used to process that service's data is subject to, and (b) a
general description of the technical, organizational, and contractual measures it takes to prevent
governmental access to, or transfer of, non-personal data held in the Union where that access or
transfer would conflict with Union or Member State law. It applies to the **hosted offering** of
Invoicerr only — the [Terms of Service](./terms-of-service.md), Section 14.4, incorporates this page
by reference. It does not apply to the self-hosted software, which never sends any data to us.

## 1. Jurisdictions

The infrastructure that processes the Service's own data — your Company's account data and Your Data
(the documents, business records, and configuration you create through the Service) — is located
exclusively in **France**, across two environments:

| Environment | Component | Host | Jurisdiction |
| --- | --- | --- | --- |
| Production | Application/Kubernetes infrastructure, managed PostgreSQL database, and document object storage | Scaleway SAS | France (Paris region) |
| Acceptance | Application infrastructure, database, and document storage — used to validate a release before it reaches production and, during the beta programme, used by that programme's participants | The Provider himself — no third-party host | France |

The production row sits with a single provider, in a single region, reached over Scaleway's own private
network rather than the public internet — the database is no longer a separate hop to a different
provider or country. The acceptance row has no provider at all in the ordinary sense: it runs on
infrastructure the Provider operates himself, in France, so there is no third party in that chain for a
foreign authority to serve a demand on — a stronger position under this Article than the production row
above, not a weaker one. The Provider himself, of course, remains subject to French and EU legal process
the same way any operator of the Service would be. Neither environment, nor Your Data on either one, is
hosted, mirrored, or backed up outside France/the EU. Where a sub-processor named in the
[Privacy Policy](./privacy-policy.md), Section 4,
and the [Data Processing Agreement](./data-processing-agreement.md), Section 7 (Polar for
subscription billing, Resend for transactional email, Cloudflare and Google LLC for inbound support
correspondence) is a non-EU entity or may process data outside the EEA, that processing is limited to
account/billing data or support correspondence — never Your Data or the documents you create through
the Service, on either environment — and relies on that provider's own GDPR Chapter V safeguards, as
described in the Privacy Policy, Section 5.

Two public, static websites — the marketing site (`invoicerr.app`) and this documentation site
(`docs.invoicerr.app`) — are hosted on **GitHub Pages**, operated by GitHub, Inc. (USA, a wholly-owned
subsidiary of Microsoft Corporation). Neither site is ICT infrastructure that processes the Service's
data: as the [Legal Notice](./legal-notice.md), Section 3, and the Privacy Policy, Section 10, both
state, GitHub never receives or stores the account, billing, or document data created through the
Service — only the visitor traffic ordinarily needed to serve a static page. They are listed here for
completeness, not because they fall within the scope Article 28 targets.

## 2. Measures Against Unlawful International Access

- **Data residency by design.** The Service's own database and document storage are hosted only in
  France, across the two environments described in Section 1 above — a choice, not a default, that by
  itself keeps the data outside the reach of any access request that does not go through an EU or
  French legal channel. The acceptance environment goes one step further: because the Provider hosts it
  himself, there is no third-party provider in that chain at all for a foreign authority to compel.
- **Encryption in transit.** All traffic to and from the Service is encrypted end-to-end over TLS,
  terminated at the ingress with a certificate issued and renewed automatically (cert-manager /
  Let's Encrypt) — see `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Encryption at rest for connection credentials.** The credentials and tokens the Service stores to
  connect your Company to a third-party channel or platform (an e-invoicing transport, an OIDC
  provider, a signing certificate, a webhook secret) are encrypted at rest with AES-256-GCM before
  being written to the database — see `backend/src/utils/secret-crypto.ts` — so a copy of the database
  alone does not expose them.
- **Backup encryption.** Backup copies of the documents and files the Service stores are encrypted
  (AES-256-GCM) before they ever leave our infrastructure, under a key the storage provider never
  holds — see the Data Processing Agreement, Section 9 — so a demand served directly on that provider,
  or a copy of the backup bucket itself, reaches ciphertext, not documents.
- **Access control.** Access to a Company's data within the Service is scoped by that Company's own
  roles (owner/admin/member); access to production infrastructure and data within our own organization
  is restricted to what is needed to operate and support the Service, as described in the Privacy
  Policy, Section 7, and the Data Processing Agreement, Section 9.
- **Contractual safeguards with sub-processors.** Every sub-processor is bound, by contract, to
  data-protection obligations materially equivalent to the Data Processing Agreement (GDPR Art.
  28(4)) — see the Data Processing Agreement, Section 7 — and, where a sub-processor may process data
  outside the EEA, to the European Commission's Standard Contractual Clauses or another GDPR Chapter V
  safeguard.
- **No standing or automated access for a foreign authority.** We do not grant any government,
  authority, or third party standing, automated, or backdoor access to the infrastructure or database
  described in Section 1. Any request for Your Data from a public authority would need to be made
  through a legally binding instrument recognized under EU or French law; absent that, it is refused.
  Where we are legally permitted to do so, we will notify the Company concerned before disclosing any
  data in response to such a request.

## 3. Keeping This Page Current

This page is updated whenever the jurisdiction of the Service's own infrastructure, or the measures
described above, materially changes — the same commitment the [Terms of Service](./terms-of-service.md),
Section 20.1, makes for that document. It is reference material: reachable at
`GET /api/legal/documents` like every document listed there, but — like the Legal Notice, the Data
Processing Agreement, and the Cookies & Acceptable Use Policy — accepting it is never required to use
the Service.

## 4. Contact

Questions about this page can be sent to **contact@invoicerr.app**.

---

### Changelog

- **2026-09-19** — Initial publication, implementing Regulation (EU) 2023/2854 (the EU Data Act),
  Article 28, alongside the matching Terms of Service update (new Section 14.4, "International access
  transparency"). Content is drawn entirely from facts already stated elsewhere (Privacy Policy,
  Data Processing Agreement, Legal Notice) plus two claims verified directly against the code and
  infrastructure config for this page rather than merely repeated: TLS termination via cert-manager
  (`deploy/helm/invoicerr/templates/ingress.yaml`) and AES-256-GCM encryption at rest scoped to
  connection credentials only (`backend/src/utils/secret-crypto.ts`) — the archived documents
  themselves (`backend/src/modules/documents/archive/`) are not independently encrypted at the
  application level beyond the storage provider's own infrastructure, so this page does not claim
  that they are.
- **2026-09-19** — Editorial fix: Section 2's sub-processor bullet read "equivalent to this DPA" — a
  copy-paste artifact from the Data Processing Agreement's own Section 7 wording, where "this"
  correctly refers to itself. On this page the referent was wrong; reworded to name the Data
  Processing Agreement explicitly. No legal meaning changed.
- **2026-09-19** — Owner decision: the managed PostgreSQL database moves from Neon (a Databricks, Inc.
  affiliate; AWS Europe, Frankfurt) to **Scaleway SAS**'s own managed database offering, in the same
  Paris (France) region already used for the Kubernetes infrastructure and object storage, reached over
  Scaleway's private network rather than the public internet. Section 1's table collapses to a single
  row and a single provider: the jurisdictions sentence and Section 2's "Data residency by design"
  bullet now state **France** alone rather than "France and, more broadly, the EU" — a hedge this page
  needed only because the database used to sit in a different EU country under a different provider.
  This removes the one non-French, non-Scaleway hop the Service's own infrastructure had.
- **2026-09-20** — Legal audit finding: Section 2 gained a **Backup encryption** measure — backup
  copies of the documents and files the Service stores are encrypted (AES-256-GCM) before they leave
  our infrastructure, under a key the storage provider never holds, so a demand served on that
  provider alone reaches ciphertext, not documents (see the Data Processing Agreement, Section 9, and
  `backend/src/modules/backup/backup-crypto.ts`).
- **2026-09-20** — Owner decision: disclosed a separate acceptance environment, used to validate a
  release before it reaches production and, during the beta programme, used by that programme's
  participants, hosted by the Provider himself, on infrastructure he operates, in France — not by
  Scaleway, and not by any third party. **Section 1**'s table now has two rows instead of one: the
  production environment (Scaleway SAS, unchanged) and the acceptance environment, whose host column
  names no third party at all. This page's own concern — what a foreign authority could actually
  reach — is served, not undermined, by that: an environment with no third-party provider in the chain
  has no third party for a foreign authority to serve a demand on, though the Provider himself remains
  subject to French and EU legal process like any operator of the Service. **Section 2**'s "Data
  residency by design" bullet no longer claims a single provider, now that Section 1 correctly
  describes two environments.
