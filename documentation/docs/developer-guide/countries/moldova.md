---
title: "e-Factura — Moldova e-invoicing"
description: "Moldova's e-Factura e-invoicing platform, and what adding Moldova to Invoicerr would involve. Invoicerr does not support Moldova today."
sidebar_label: "Moldova"
keywords: [e-Factura, Moldova e-invoicing, SFS, Moldova invoice XML]
---

# e-Factura — Moldova e-invoicing

:::warning[Invoicerr does not support Moldova]
No Moldova data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Moldova support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Moldova's e-invoicing runs through **e-Factura**, the national platform operated by the State Tax
Service (STS). A parallel **eBon** system handles electronic receipts for consumer transactions.

## What supporting Moldova would involve

| | |
|---|---|
| **System** | e-Factura, operated by the State Tax Service |
| **Authority** | State Tax Service (STS) |
| **Format** | A national XML schema (the e-Factura schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | e-Factura. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as fully mandatory since 2023.
- Full B2B e-invoicing cited as mandatory from October 2026, after a pilot from January 2026.
- Model described as clearance, with real-time validation through e-Factura.
- A qualified digital signature is cited as required for invoice authentication.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Moldova.

- `country-policy/data/md.json` — which document actions Moldova allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/md.json` — which national identifier a party must carry.
- `tax/tax-systems/data/md.json` and `vat-rates/data/md.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/md.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/md.json` — the channel and format a Moldovan public buyer requires.
- `transports/channel-policy/data/md.json` — whether a channel is legally required of a seller
  established in Moldova, and from what date.
- `archive/retention/data/md.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: e-Factura is a transmission channel this repository does
not implement, and its XML schema has no format provider. Both are code, not a JSON file — see [When
a country needs more than a file](../adding-a-country.md).

## Want Moldova supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Moldova, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Moldova".
