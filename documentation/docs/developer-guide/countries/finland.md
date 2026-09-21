---
title: "Finland e-invoicing"
description: "Finland's Finvoice standard and near-universal e-invoicing adoption, and what adding Finland would involve. Invoicerr does not support Finland today."
sidebar_label: "Finland"
keywords: [Finland e-invoicing, Finvoice, Peppol Finland, Finland invoice XML]
---

# Finland e-invoicing

:::warning[Invoicerr does not support Finland]
No Finland data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Finland support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Finland has required B2G e-invoicing since 2010, run by the **Tax Administration** (Verohallinto),
and B2B adoption is already very high even though it remains voluntary. Domestic invoices typically
travel as **Finvoice**, Finland's own national e-invoice standard, exchanged through a network of
banks and e-invoice operators; **Peppol** is used for cross-border and government delivery.

## What supporting Finland would involve

| | |
|---|---|
| **System** | Finvoice — Finland's national e-invoice standard, exchanged over a network of banks and e-invoice operators |
| **Authority** | Tax Administration (Verohallinto) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | The Finvoice network of banks and e-invoice operators, alongside Peppol for cross-border delivery. No transport in `backend/src/modules/documents/transports/` talks to either today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory for central government since 2010, and for the whole public
  sector since 2020.
- B2B e-invoicing is voluntary but has very high real-world adoption.
- Central government has used Peppol Advanced Ordering since 2021.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Finland.

- `country-policy/data/fi.json` — which document actions Finland allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/fi.json` — which national identifier a party must carry.
- `tax/tax-systems/data/fi.json` and `vat-rates/data/fi.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/fi.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/fi.json` — the channel and format a Finnish public buyer requires.
- `transports/channel-policy/data/fi.json` — whether a channel is legally required of a seller
  established in Finland, and from what date.
- `archive/retention/data/fi.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Finvoice network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Finland supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Finland, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Finland".
