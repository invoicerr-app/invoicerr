---
title: "e-Faktur — Indonesia e-invoicing"
description: "Indonesia's e-Faktur tax invoice system, and what adding Indonesia to Invoicerr would involve. Invoicerr does not support Indonesia today."
sidebar_label: "Indonesia"
keywords: [e-Faktur, Indonesia e-invoicing, DJP Online, NPWP, Indonesia invoice XML]
---

# e-Faktur — Indonesia e-invoicing

:::warning[Invoicerr does not support Indonesia]
No Indonesia data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Indonesia support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Indonesia's e-invoicing runs through **e-Faktur**, the Directorate General of Taxes' electronic tax
invoice system, submitted through the DJP Online platform. Every VAT-registered business issues its
tax invoices this way, each one validated and numbered by the DGT before it reaches the buyer.

## What supporting Indonesia would involve

| | |
|---|---|
| **System** | e-Faktur, submitted through DJP Online |
| **Authority** | DGT — Directorate General of Taxes |
| **Format** | A national XML schema (e-Faktur). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to DJP Online. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout from 2015, covering all VAT taxpayers from 2020.
- Clearance model: DJP Online validates and numbers each invoice before delivery.
- Standard VAT rate is 11 percent.
- Archive retention is 10 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Indonesia would need in
`countries/data/id.json`.

- `policy` - which document actions Indonesia allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format an Indonesian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Indonesia, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the DJP Online platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Indonesia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Indonesia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Indonesia".
