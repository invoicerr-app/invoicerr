---
title: "MES — North Macedonia e-invoicing"
description: "North Macedonia's MES e-invoicing platform, and what adding North Macedonia to Invoicerr would involve. Invoicerr does not support North Macedonia today."
sidebar_label: "North Macedonia"
keywords: [MES, North Macedonia e-invoicing, e-faktura, Macedonia invoice XML]
---

# MES — North Macedonia e-invoicing

:::warning[Invoicerr does not support North Macedonia]
No North Macedonia data file exists anywhere in this repository — no country policy, no identifiers,
no tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants North Macedonia support knows what adding it would involve. The countries
Invoicerr does cover are listed in the [country directory](./index.md).
:::

North Macedonia's e-invoicing runs through **MES** (the Macedonian Electronic Invoice System),
regulated by the Public Revenue Office (PRO). The mandate covers both B2G and B2B transactions.

## What supporting North Macedonia would involve

| | |
|---|---|
| **System** | MES (Macedonian Electronic Invoice System) |
| **Authority** | Public Revenue Office (PRO) |
| **Format** | A national XML schema (the MES schema, UN/CEFACT-based). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | MES. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory since 2015, with progressive extension to B2B from the same
  year.
- Model described as clearance, with invoice validation through MES.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for North Macedonia.

- `country-policy/data/mk.json` — which document actions North Macedonia allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/mk.json` — which national identifier a party must carry.
- `tax/tax-systems/data/mk.json` and `vat-rates/data/mk.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/mk.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/mk.json` — the channel and format a North Macedonian public buyer requires.
- `transports/channel-policy/data/mk.json` — whether a channel is legally required of a seller
  established in North Macedonia, and from what date.
- `archive/retention/data/mk.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: MES is a transmission channel this repository does not
implement, and its XML schema has no format provider. Both are code, not a JSON file — see [When a
country needs more than a file](../adding-a-country.md).

## Want North Macedonia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for North Macedonia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add North
Macedonia".
