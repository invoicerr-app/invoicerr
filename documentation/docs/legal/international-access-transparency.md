---
title: International Access Transparency
sidebar_position: 6
version: 2026-09-19
effectiveDate: 2026-09-19
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
exclusively in **France** and, more broadly, the **European Union**:

| Component | Provider | Jurisdiction |
| --- | --- | --- |
| Application/Kubernetes infrastructure and document object storage | Scaleway SAS | France (Paris region) |
| Managed PostgreSQL database | Neon, LLC (a Databricks, Inc. affiliate) | European Union (AWS Europe, Frankfurt) |

Neither the Service's own infrastructure nor Your Data is hosted, mirrored, or backed up outside
France/the EU. Where a sub-processor named in the [Privacy Policy](./privacy-policy.md), Section 4,
and the [Data Processing Agreement](./data-processing-agreement.md), Section 7 (Polar for
subscription billing, Resend for transactional email, Cloudflare and Google LLC for inbound support
correspondence) is a non-EU entity or may process data outside the EEA, that processing is limited to
account/billing data or support correspondence — never Your Data or the documents you create through
the Service — and relies on that provider's own GDPR Chapter V safeguards, as described in the
Privacy Policy, Section 5.

Two public, static websites — the marketing site (`invoicerr.app`) and this documentation site
(`docs.invoicerr.app`) — are hosted on **GitHub Pages**, operated by GitHub, Inc. (USA, a wholly-owned
subsidiary of Microsoft Corporation). Neither site is ICT infrastructure that processes the Service's
data: as the [Legal Notice](./legal-notice.md), Section 3, and the Privacy Policy, Section 10, both
state, GitHub never receives or stores the account, billing, or document data created through the
Service — only the visitor traffic ordinarily needed to serve a static page. They are listed here for
completeness, not because they fall within the scope Article 28 targets.

## 2. Measures Against Unlawful International Access

- **Data residency by design.** The Service's own database and document storage are hosted only in
  France and the EU (Section 1 above) — a choice, not a default, that by itself keeps the data
  outside the reach of any access request that does not go through an EU or French legal channel.
- **Encryption in transit.** All traffic to and from the Service is encrypted end-to-end over TLS,
  terminated at the ingress with a certificate issued and renewed automatically (cert-manager /
  Let's Encrypt) — see `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Encryption at rest for connection credentials.** The credentials and tokens the Service stores to
  connect your Company to a third-party channel or platform (an e-invoicing transport, an OIDC
  provider, a signing certificate, a webhook secret) are encrypted at rest with AES-256-GCM before
  being written to the database — see `backend/src/utils/secret-crypto.ts` — so a copy of the database
  alone does not expose them.
- **Access control.** Access to a Company's data within the Service is scoped by that Company's own
  roles (owner/admin/member); access to production infrastructure and data within our own organization
  is restricted to what is needed to operate and support the Service, as described in the Privacy
  Policy, Section 7, and the Data Processing Agreement, Section 9.
- **Contractual safeguards with sub-processors.** Every sub-processor is bound, by contract, to
  data-protection obligations materially equivalent to this DPA (GDPR Art. 28(4)) — see the Data
  Processing Agreement, Section 7 — and, where a sub-processor may process data outside the EEA, to
  the European Commission's Standard Contractual Clauses or another GDPR Chapter V safeguard.
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
