---
title: International Access Transparency
sidebar_position: 7
version: 2026-10-25
effectiveDate: 2026-10-25
---

:::warning[Draft]
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

The infrastructure that hosts the Service's own data, your Company's account data and Your Data (the
documents, business records, and configuration you create through the Service), is located
exclusively in **France**. One provider sits in front of it, for transit only, while its proxy is
enabled:

| Role | Component | Provider | Jurisdiction |
| --- | --- | --- | --- |
| Hosting | Managed Kubernetes infrastructure, managed PostgreSQL database (two nodes), document object storage, and backups (OVHcloud Object Storage, kept 35 days) | OVH SAS (OVHcloud) | France |
| Transit, while the proxy is enabled | DNS and reverse proxy: all traffic between your browser and the Service passes through Cloudflare's network, where TLS is terminated | Cloudflare, Inc. | United States (Cloudflare's network may handle the traffic outside France) |

**Hosting.** Your Data and the Service's database are stored, processed, and backed up only in France,
by a single French provider. Neither is hosted, mirrored, or backed up outside France.

**Transit.** While Cloudflare's proxy is enabled in front of the Service, every request and response
between your browser and the Service, including the documents you create and the personal data they
contain, passes through Cloudflare's network in clear before being re-encrypted towards the Service.
Cloudflare, Inc. is a company established in the United States and subject to its law. The Service
will move Cloudflare to DNS only, with no proxy, once production is validated, and this page will be
updated when it does.

Where another sub-processor named in the [Privacy Policy](./privacy-policy.md), Section 4, and the
[Data Processing Agreement](./data-processing-agreement.md), Annex IV, is a non-EU entity or may process
data outside the EEA (Stripe for the payment of the subscription, Resend for the text of transactional
email), that processing is limited to account and billing data or to the text of an email, never the
documents you create, which are reached through a download link served from France; it relies on that
provider's own GDPR Chapter V safeguards, as described in the Privacy Policy, Section 5.

Two public, static websites, the marketing site (`invoicerr.app`) and this documentation site
(`docs.invoicerr.app`), and the source code repository are hosted by **GitHub**, operated by GitHub,
Inc. (USA, a wholly-owned subsidiary of Microsoft Corporation). None of them is ICT infrastructure that
processes the Service's data: as the [Legal Notice](./legal-notice.md), Section 3, and the Privacy
Policy, Section 10, both state, GitHub never receives or stores the account, billing, or document data
created through the Service, only the visitor traffic ordinarily needed to serve a static page. They are
listed here for completeness, not because they fall within the scope Article 28 targets.

## 2. Measures Against Unlawful International Access

- **Data residency by design.** The Service's database, document storage, and backups are hosted only
  in France, by a French provider: a choice, not a default, that keeps the stored data outside the
  reach of any access request that does not go through an EU or French legal channel.
- **Transit through Cloudflare, stated plainly.** While Cloudflare's proxy is enabled, a US company
  sees the traffic in clear on its way to the Service (Section 1). We do not claim otherwise, and we
  remove the proxy once production is validated.
- **Encryption in transit.** All traffic to and from the Service is encrypted over TLS, terminated at
  the ingress with a certificate issued and renewed automatically (cert-manager / Let's Encrypt), see
  `deploy/helm/invoicerr/templates/ingress.yaml`, and, while the proxy is enabled, also at Cloudflare.
- **Encryption at rest for connection credentials.** The credentials and tokens the Service stores to
  connect your Company to a third-party channel or platform (an e-invoicing transport, an OIDC
  provider, a signing certificate, a webhook secret) are encrypted at rest with AES-256-GCM before
  being written to the database, see `backend/src/utils/secret-crypto.ts`, so a copy of the database
  alone does not expose them.
- **Backup encryption.** Backup copies of the documents and files the Service stores are encrypted
  (AES-256-GCM) before they are written to backup storage, under a key that is never written to that
  storage (see the Data Processing Agreement, Annex III), so a copy of the backup bucket alone reaches
  ciphertext, not documents. Backups expire after thirty-five (35) days.
- **No document in email.** Email sent through the Service carries only its text: a document is never
  attached and is reached through a download link served by the Service, so Resend, a US provider,
  never receives the documents you create.
- **Access control.** Access to a Company's data within the Service is scoped by that Company's own
  roles (owner/admin/member); access to production infrastructure and data within our own organization
  is restricted to what is needed to operate and support the Service, as described in the Privacy
  Policy, Section 7, and the Data Processing Agreement, Annex III.
- **Contractual safeguards with sub-processors.** Every sub-processor is bound, by contract, to
  data-protection obligations materially equivalent to the Data Processing Agreement (GDPR Art.
  28(4)), see the Data Processing Agreement, Clause 7.7 and Annex IV, and, where a sub-processor may
  process data outside the EEA, to the European Commission's Standard Contractual Clauses or another
  GDPR Chapter V safeguard.
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
- **2026-10-13**: Cross-references updated after the Data Processing Agreement became the European
  Commission's standard contractual clauses: its former Section 7 (sub-processors) is now Clause 7.7
  and Annex IV, its former Section 9 (security measures) is now Annex III. No measure changed.
- **2026-10-25**: Section 1 rewritten for the move to OVHcloud: the Service, its database (managed
  PostgreSQL with two nodes), its documents, and its backups (OVHcloud Object Storage, kept 35 days)
  are hosted in France by OVH SAS. Scaleway and the separate acceptance environment are removed. The
  table now shows Cloudflare as a second row, for transit only: while its proxy is enabled, all traffic
  passes through Cloudflare's network in clear, Cloudflare being a US company; the promise that the
  Service and Your Data are hosted exclusively in France concerns hosting, and this page now says what
  transit adds to it. Section 2: new "Transit through Cloudflare" and "No document in email" measures;
  the backup measure no longer says the storage provider never holds the key, since the same provider
  now hosts both the Service and its backups, and states only that the key is never written to the
  backup storage. Polar and Google are removed from the list of non-EU sub-processors, Stripe is added.
