---
title: "FEL — Guatemala e-invoicing"
description: "Guatemala's SAT FEL e-invoicing system and what adding Guatemala to Invoicerr would involve. Invoicerr does not support Guatemala today."
sidebar_label: "Guatemala"
keywords: [FEL, DTE, SAT, Guatemala e-invoicing, e-invoicing Guatemala]
---

# FEL — Guatemala e-invoicing

:::warning[Invoicerr does not support Guatemala]
No Guatemala data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Guatemala support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Guatemala's e-invoicing runs through SAT, the Superintendencia de Administración Tributaria, under
the FEL scheme (Factura Electrónica en Línea). Every document is a DTE, a documento tributario
electrónico, pre-authorized by SAT before it can be delivered to the buyer.

## What supporting Guatemala would involve

| | |
|---|---|
| **System** | DTE — Documento Tributario Electrónico, issued under the FEL scheme |
| **Authority** | SAT — Superintendencia de Administración Tributaria |
| **Format** | A national XML schema (the SAT DTE/FEL schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SAT platform for DTE authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2017, now covering all businesses.
- Digital electronic signature required (Firma Electrónica).
- Several document subtypes exist: invoice, debit note, credit note, credit memo, receipt.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Guatemala would need in
`countries/data/gt.json`.

- `policy` - which document actions Guatemala allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Guatemalan public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Guatemala, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the SAT platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Guatemala supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Guatemala, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Guatemala".
