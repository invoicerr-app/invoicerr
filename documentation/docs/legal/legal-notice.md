---
title: Legal Notice
sidebar_position: 5
version: 2026-09-19
effectiveDate: 2026-09-19
---

:::warning Draft
Draft — not yet reviewed by counsel.
:::

Legal notice for the **hosted offering** of Invoicerr, published in accordance with **article 6 of
French law n° 2004-575 of 21 June 2004 for confidence in the digital economy (LCEN)**. This notice
does not apply to the self-hosted software, which anyone may run on their own infrastructure under the
license in the `LICENSE` file at the root of the
[repository](https://github.com/invoicerr-app/invoicerr).

## 1. Publisher

- **Roméo Chevrier**, sole trader (entrepreneur individuel / micro-entreprise) under French law.
- Registered under **SIREN 982 187 676 (SIRET 982 187 676 00019)**.
- Registered address: **4 rue du Puits, 26120 Montélier, France**.
- Contact: **contact@invoicerr.app**.
- VAT: **VAT not applicable — Art. 293 B of the French General Tax Code (franchise en base)**; see
  Terms of Service, Section 1.1 for the same representation.

## 2. Publication Director

**Roméo Chevrier**, in his capacity as the sole trader publishing and operating the Service, is the
publication director within the meaning of LCEN art. 6-III.

## 3. Host

**Scaleway SAS** — a *société par actions simplifiée* registered under SIREN **433 115 904** (RCS
Paris), with registered office at **8 rue de la Ville-l'Évêque, 75008 Paris, France**, as required by
LCEN art. 6-I-2. Scaleway operates the Kubernetes cluster, the managed PostgreSQL database, and the
object storage the Service (**my.invoicerr.app**) runs on, in its Paris region. Contact: same postal
address; see Scaleway's own published legal notice (scaleway.com) for their support channels.

The **public website** at **invoicerr.app**, the **documentation site** at **docs.invoicerr.app** —
where this notice is itself published — and the **source code repository** at
**github.com/invoicerr-app/invoicerr** (public issues, discussions where enabled, and the GitHub
Actions workflows that build and publish the Service's container images to the GitHub Container
Registry) are hosted by **GitHub, Inc.**, 88 Colin P. Kelly Jr. Street, San Francisco, CA 94107, USA, a
wholly-owned subsidiary of Microsoft Corporation, via its GitHub Pages, GitHub Actions, and GitHub
Container Registry services. GitHub, Inc. does not host the hosted Service itself
(**my.invoicerr.app**, Scaleway SAS, above) and never receives or stores the account, billing, or
document data created through it — see Privacy Policy, Section 10.

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
**the Commercial Court of Romans-sur-Isère (Tribunal de commerce de Romans-sur-Isère), the court of
the Provider's registered office**, subject to any mandatory rule of law that provides otherwise — the
same clause as Terms of Service, Section 20.2.

The Service is offered strictly business-to-business (Terms of Service, Section 1.2). Accordingly, the
consumer mediation scheme of articles **L.616-1 et seq. of the French Consumer Code** does not apply to
this Agreement.

## 8. Governing Language

This document is drafted and executed in English. Where we provide a translation into another
language for your convenience and understanding, that translation is not a substitute for the English
text: in the event of any inconsistency, ambiguity, or conflict between the English version and a
translated version, **the English version prevails** and is the version that governs the rights and
obligations of the parties. Translations are provided in good faith to help each audience understand
this document; they create no separate or additional rights.

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
