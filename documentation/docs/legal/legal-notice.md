---
title: Legal Notice
sidebar_position: 5
version: 2026-10-25
effectiveDate: 2026-10-25
---

:::warning[Draft]
Draft — not yet reviewed by counsel.
:::

Legal notice for the **hosted offering** of Invoicerr, published in accordance with **article 6 of
French law n° 2004-575 of 21 June 2004 for confidence in the digital economy (LCEN)**. This notice
does not apply to the self-hosted software, which anyone may run on their own infrastructure under the
license in the `LICENSE` file at the root of the
[repository](https://github.com/invoicerr-app/invoicerr).

## 1. Publisher

- **INVOICERR**, a société par actions simplifiée (**SAS**) under French law, with a
  share capital of **100 euros**.
- Registered office: **63 avenue Jules Guesde, 69200 Vénissieux, France**.
- Registered with the Lyon Trade and Companies Register (**RCS Lyon**) under number
  `[to be completed at registration]`.
- Represented by its president, **Roméo Chevrier**.
- Contact: **contact@invoicerr.app**. Telephone: `[to be completed]`.
- Intra-EU VAT number: `[to be completed]`. VAT: **VAT not applicable, Art. 293 B of the French
  General Tax Code (franchise en base)**; see Terms of Service, Section 7.2.

## 2. Publication Director

**Roméo Chevrier**, president of INVOICERR, is the publication director within the meaning of LCEN
art. 6-III.

## 3. Host

The Service (**my.invoicerr.app**), its database, the storage of its documents, and its backups are
hosted in France by **OVH SAS** (OVHcloud), a *société par actions simplifiée* registered with the
Lille Métropole Trade and Companies Register under number **424 761 419**, with registered office at
**2 rue Kellermann, 59100 Roubaix, France**. Telephone: `[to be completed]`. OVHcloud also hosts the
mailbox that receives correspondence sent to **contact@invoicerr.app**.

The domain names are served by **Cloudflare, Inc.**, 101 Townsend Street, San Francisco, CA 94107, USA,
which provides their DNS and, while its proxy is enabled in front of the Service, relays the traffic
between your browser and OVHcloud; see the
[International Access Transparency](./international-access-transparency.md) page.

The **public website** at **invoicerr.app**, the **documentation site** at **docs.invoicerr.app**,
where this notice is itself published, and the **source code repository** at
**github.com/invoicerr-app/invoicerr** (public issues, discussions where enabled, and the GitHub
Actions workflows that build and publish the Service's container images to the GitHub Container
Registry) are hosted by **GitHub, Inc.**, 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA, a
wholly-owned subsidiary of Microsoft Corporation, via its GitHub Pages, GitHub Actions, and GitHub
Container Registry services. GitHub, Inc. does not host the Service (**my.invoicerr.app**, OVHcloud,
above) and never receives or stores the account, billing, or document data created through it; see
the [Privacy Policy](./privacy-policy.md), Section 10.

## 4. Intellectual Property

The Invoicerr software is distributed under the license published in the `LICENSE` file at the root
of the repository (see Terms of Service, Section 11.1). The Invoicerr name and logo, as used on the
hosted Service and its documentation, belong to the Publisher.

## 5. Personal Data

See the [Privacy Policy](./privacy-policy.md) for how personal data is handled on the hosted Service.

## 6. Cookies

See the [Cookies & Acceptable Use Policy](./cookies-and-acceptable-use.md).

## 7. Governing Law and Consumer Mediation

This notice is governed by **French law**. Any dispute is submitted to the exclusive jurisdiction of
**the commercial court with jurisdiction over the Publisher's registered office in Lyon (currently the
Tribunal des activités économiques de Lyon)**, subject to any mandatory rule of law that provides
otherwise: the same clause as Terms of Service, Section 20.3.

The Service is offered strictly business-to-business (Terms of Service, Section 1.2). Accordingly, the
consumer mediation scheme of articles **L.616-1 et seq. of the French Consumer Code** does not apply to
this Agreement.

## 8. Governing Language

This document is drafted and executed in English. Where we provide a translation or a summary in
another language for your convenience and understanding, it is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated or summarized version, **the English version prevails** and is the version that governs the
rights and obligations of the parties. Translations and summaries are provided in good faith to help
each audience understand this document; they create no separate or additional rights.

Nothing in this Section sets aside a mandatory rule of law.

---

### Changelog

- **2026-09-16** — Initial draft.
- **2026-09-17** — Updated Terms of Service cross-references to match that document's 2026-09-17
  renumbering (8.1→12.1, 11.1→9.1, 12.2→18.2). Added a short statement in Section 7 that the French
  Consumer Code's consumer-mediation scheme (art. L.616-1 et seq.) does not apply, given the
  strictly B2B scope already stated in the Terms of Service — a fact worth stating expressly rather
  than leaving implicit, per the B2B-scope treatment the other four documents already give it.
- **2026-09-17** — Owner decisions applied. Section 1's VAT mention restated as "VAT not applicable —
  Art. 293 B of the French General Tax Code (franchise en base)" (wording only, same regime — matches
  Terms of Service Section 1.1). Section 7's jurisdiction clause restated as the Commercial Court of
  Romans-sur-Isère (Tribunal de commerce de Romans-sur-Isère) — the court with jurisdiction over the
  Provider's registered office in Montélier, which itself has no commercial court of its own — subject
  to any mandatory rule of law that provides otherwise, matching Terms of Service Section 18.2.
- **2026-09-17** — Owner decision applied: hosting resolved to Scaleway (Kubernetes + object storage,
  Paris, France) and Neon (managed Postgres database, EU region) — see Terms of Service Section 12.1.
  Section 3 completed with Scaleway SAS's corporate name, SIREN/RCS, and registered office, discharging
  the LCEN art. 6-I-2 requirement this section previously left as a placeholder pending that decision.
- **2026-09-17** — GitHub added as hosting provider for the documentation website. Section 3 gained
  **GitHub, Inc.** (address, Microsoft parent) as host of **docs.invoicerr.app** — the site this very
  notice is published on — and of the public source repository, via GitHub Pages / Actions / Container
  Registry. At the time, `invoicerr.app` was believed to be the Ingress host for the Scaleway-hosted
  Service itself, with no distinct landing page — superseded by the entry below.
- **2026-09-19** — Owner decision: the public website moved to **GitHub Pages** at **invoicerr.app**;
  the Service now lives at **my.invoicerr.app**. Section 3 now names `invoicerr.app` as a second
  GitHub Pages-hosted site alongside `docs.invoicerr.app`, and states explicitly that the Scaleway-hosted
  Service runs at `my.invoicerr.app`.
- **2026-09-19** — Owner decision: the managed PostgreSQL database moves from Neon to **Scaleway SAS**,
  the same entity and Paris region already disclosed here as the Service's host. Section 3 now lists
  the managed PostgreSQL database alongside the Kubernetes cluster and object storage Scaleway operates
  for the Service — this section never named Neon (LCEN art. 6-I-2 only requires disclosing the host of
  the site/content itself), so this is a completeness addition, not a correction.
- **2026-09-19** — Owner decision, on counsel's advice: this document is now translated into French in
  full (loi Toubon art. 2). New Section 8 ("Governing Language") states that the English text is the
  one that governs whenever a translation reads differently — the same clause added to the other four
  documents, and consistent with Section 7's existing choice of French law and jurisdiction. No other
  fact changed.
- **2026-09-19** — Updated Terms of Service cross-references to match that document's 2026-09-19
  renumbering, done to make room for its new EU Data Act sections (9.1→11.1, 18.2→20.2). No fact in
  this notice itself changed.
- **2026-09-20** — Owner decision: introduced a separate acceptance environment, used to validate a
  release before it reaches production and, during the beta programme, used by that programme's
  participants, hosted by the Provider himself on infrastructure he operates in France — not by
  Scaleway. Section 3 (renamed "Hosts", plural) now identifies both hosts LCEN art. 6-I-2 requires:
  Scaleway SAS for the production Service (**my.invoicerr.app**), unchanged, and the Provider himself,
  using the identity already given in Section 1, for the acceptance environment. This is a new fact,
  not a restatement: during the beta programme, participants' Customer Data — real invoices and other
  real business records — resides on the acceptance environment, not on Scaleway's production
  infrastructure — see Privacy Policy, Section 4.
- **2026-10-25**: The Publisher is now **INVOICERR**, a SASU with a share capital of 100 euros, registered
  office in Vénissieux, represented by its president, Roméo Chevrier, who is also the publication
  director. Section 1 gives the RCS Lyon and intra-EU VAT numbers as placeholders until registration.
  Section 3 is renamed "Host": the Service, its database, its documents and its backups are hosted in
  France by OVH SAS (OVHcloud), which also hosts the support mailbox; Cloudflare is named for DNS and,
  while enabled, its proxy. The Scaleway production entry and the separate acceptance environment are
  removed. Section 7 now names the court of the registered office in Lyon.
- **2026-10-30**: English-only legal texts: the full French translation is replaced by a short French
  summary, and the German, Italian, Polish and Portuguese translations are withdrawn. Section 8 covers
  "a translation or a summary" wherever it covered a translation, and adds that it sets aside no
  mandatory rule of law. Section 1 now names the société par actions simplifiée (SAS) rather than a
  SASU (D-262).
