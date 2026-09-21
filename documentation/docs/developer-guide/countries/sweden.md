---
title: "Sweden e-invoicing"
description: "Sweden's Peppol-based e-invoicing under SFTI, and what adding Sweden to Invoicerr would involve. Invoicerr does not support Sweden today."
sidebar_label: "Sweden"
keywords: [Sweden e-invoicing, Peppol Sweden, SFTI, Digg, Sweden invoice XML]
---

# Sweden e-invoicing

:::warning[Invoicerr does not support Sweden]
No Sweden data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Sweden support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Sweden relies entirely on the **Peppol** network for e-invoicing, with no central clearance
platform. Digg (the Swedish Agency for Digital Government) certifies Access Points, and SFTI (Single
Face To Industry) sets the technical standards, now converged on Peppol BIS Billing 3.0.

## What supporting Sweden would involve

| | |
|---|---|
| **System** | Peppol Network, standardized through SFTI |
| **Authority** | Digg — Swedish Agency for Digital Government |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory since 2019.
- B2B e-invoicing remains voluntary but is described as a soft mandate from large buyers.
- The legacy Svefaktura format is cited as withdrawn by SFTI from mid-2025, leaving Peppol BIS 3.0
  as the sole recommended standard.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Sweden.

- `country-policy/data/se.json` — which document actions Sweden allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/se.json` — which national identifier a party must carry.
- `tax/tax-systems/data/se.json` and `vat-rates/data/se.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/se.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/se.json` — the channel and format a Swedish public buyer requires.
- `transports/channel-policy/data/se.json` — whether a channel is legally required of a seller
  established in Sweden, and from what date.
- `archive/retention/data/se.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Sweden supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Sweden, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Sweden".
