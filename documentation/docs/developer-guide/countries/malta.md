---
title: "Malta e-invoicing"
description: "Malta's Peppol-based e-invoicing and its planned Digital Real-Time Reporting platform, and what adding Malta to Invoicerr would involve. Invoicerr does not support Malta today."
sidebar_label: "Malta"
keywords: [Malta e-invoicing, Peppol Malta, CFR, Malta invoice XML]
---

# Malta e-invoicing

:::warning[Invoicerr does not support Malta]
No Malta data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Malta support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Malta's public authorities receive e-invoices over the **Peppol** network, under the Commissioner
for Revenue (CFR). The country is also preparing a future Digital Real-Time Reporting (DRR) platform
for broader B2B use.

## What supporting Malta would involve

| | |
|---|---|
| **System** | Peppol Network, with a future Digital Real-Time Reporting (DRR) platform |
| **Authority** | Commissioner for Revenue (CFR) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Public authorities are cited as required to receive EN 16931 e-invoices today.
- A Digital Real-Time Reporting framework is described as in development from 2025.
- A phased ViDA-aligned rollout is cited: large corporates from 2028, cross-border B2B from 2030,
  full domestic B2B from 2035.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Malta.

- `country-policy/data/mt.json` — which document actions Malta allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/mt.json` — which national identifier a party must carry.
- `tax/tax-systems/data/mt.json` and `vat-rates/data/mt.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/mt.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/mt.json` — the channel and format a Maltese public buyer requires.
- `transports/channel-policy/data/mt.json` — whether a channel is legally required of a seller
  established in Malta, and from what date.
- `archive/retention/data/mt.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Malta supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Malta, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Malta".
