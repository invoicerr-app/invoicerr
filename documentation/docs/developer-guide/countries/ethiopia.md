---
title: "ETA — Ethiopia e-invoicing"
description: "Ethiopia's ETA e-invoicing system, and what adding Ethiopia to Invoicerr would involve. Invoicerr does not support Ethiopia today."
sidebar_label: "Ethiopia"
keywords: [ETA, Ethiopia e-invoicing, Ethiopia invoice XML]
---

# ETA — Ethiopia e-invoicing

:::warning[Invoicerr does not support Ethiopia]
No Ethiopia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Ethiopia support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Ethiopia's e-invoicing is administered by the **ETA**, the Ethiopian Tax Authority, through its
e-Invoice System.

## What supporting Ethiopia would involve

| | |
|---|---|
| **System** | ETA e-Invoice System |
| **Authority** | ETA — Ethiopian Tax Authority |
| **Format** | A national XML schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the ETA e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ethiopia.

- `country-policy/data/et.json` — which document actions Ethiopia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/et.json` — which national identifier a party must carry.
- `tax/tax-systems/data/et.json` and `vat-rates/data/et.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/et.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/et.json` — the channel and format an Ethiopian public buyer requires.
- `transports/channel-policy/data/et.json` — whether a channel is legally required of a seller
  established in Ethiopia, and from what date.
- `archive/retention/data/et.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the ETA e-Invoice System is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Ethiopia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ethiopia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ethiopia".
