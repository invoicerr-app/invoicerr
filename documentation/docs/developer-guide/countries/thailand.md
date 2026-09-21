---
title: "e-Tax Invoice — Thailand e-invoicing"
description: "Thailand's e-Tax Invoice and Receipt System, and what adding Thailand to Invoicerr would involve. Invoicerr does not support Thailand today."
sidebar_label: "Thailand"
keywords: [e-Tax Invoice, Thailand e-invoicing, Revenue Department Thailand, Thailand invoice XML]
---

# e-Tax Invoice — Thailand e-invoicing

:::warning[Invoicerr does not support Thailand]
No Thailand data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Thailand support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Thailand's e-invoicing runs through the Revenue Department's **e-Tax Invoice and Receipt System**,
covering VAT-registered businesses issuing tax invoices and receipts. Each document is digitally
signed and validated before it reaches the buyer.

## What supporting Thailand would involve

| | |
|---|---|
| **System** | e-Tax Invoice and Receipt System |
| **Authority** | RD — Revenue Department |
| **Format** | A national schema (RD e-Tax Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the Revenue Department's e-Tax platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout from 2018, covering all VAT taxpayers from 2023.
- Clearance model: the Revenue Department validates and authorises each document before delivery.
- Standard VAT rate is 7 percent.
- Archive retention is 7 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Thailand.

- `country-policy/data/th.json` — which document actions Thailand allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/th.json` — which national identifier a party must carry.
- `tax/tax-systems/data/th.json` and `vat-rates/data/th.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/th.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/th.json` — the channel and format a Thai public buyer requires.
- `transports/channel-policy/data/th.json` — whether a channel is legally required of a seller
  established in Thailand, and from what date.
- `archive/retention/data/th.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Revenue Department's e-Tax platform is a transmission
channel this repository does not implement, and its schema has no format provider. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Thailand supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Thailand, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Thailand".
