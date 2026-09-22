---
title: "Belgium e-invoicing"
description: "Belgium's B2B and B2G e-invoicing mandate runs entirely over Peppol, and what adding Belgium would involve. Invoicerr does not support Belgium today."
sidebar_label: "Belgium"
keywords: [Belgium e-invoicing, Peppol Belgium, Belgium invoice XML, BOSA, SPF Finances]
---

# Belgium e-invoicing

:::warning[Invoicerr does not support Belgium]
No Belgium data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Belgium support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Belgium requires e-invoicing for all VAT-registered B2B trade from January 2026, extending its
existing B2G mandate. Unlike some of its neighbours, Belgium runs no central government platform for
B2B — invoices move directly over the **Peppol** network, under **SPF Finances** (the federal tax
administration) and **BOSA**, the digital-transformation agency that acts as Belgium's Peppol
authority.

## What supporting Belgium would involve

| | |
|---|---|
| **System** | Belgium's B2B and B2G e-invoicing mandate, running entirely over the Peppol network |
| **Authority** | SPF Finances (federal tax administration), with BOSA as Belgium's Peppol authority |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory for public procurement since March 2024.
- The domestic B2B mandate takes effect January 1, 2026, covering all VAT-registered companies at
  once rather than phasing in by company size.
- A temporary email-based bridge platform ("Hermes") is due to shut down at the end of 2025.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Belgium.

- `country-policy/data/be.json` — which document actions Belgium allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/be.json` — which national identifier a party must carry.
- `tax/tax-systems/data/be.json` and `vat-rates/data/be.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/be.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/be.json` — the channel and format a Belgian public buyer requires.
- `transports/channel-policy/data/be.json` — whether a channel is legally required of a seller
  established in Belgium, and from what date.
- `archive/retention/data/be.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Belgium supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Belgium, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Belgium".
