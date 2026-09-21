---
title: "ZIMRA — Zimbabwe e-invoicing"
description: "Zimbabwe's ZIMRA FDMS fiscalisation system, and what adding Zimbabwe to Invoicerr would involve. Invoicerr does not support Zimbabwe today."
sidebar_label: "Zimbabwe"
keywords: [ZIMRA, FDMS, Zimbabwe e-invoicing, Zimbabwe invoice XML]
---

# ZIMRA — Zimbabwe e-invoicing

:::warning[Invoicerr does not support Zimbabwe]
No Zimbabwe data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Zimbabwe support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Zimbabwe's fiscalisation regime is administered by **ZIMRA**, the Zimbabwe Revenue Authority,
through **FDMS**, the Fiscalisation Data Management System. It works through certified fiscal
devices — Electronic Tax Registers, fiscal printers, or Virtual Fiscalisation — rather than a pure
B2B e-invoicing flow.

## What supporting Zimbabwe would involve

| | |
|---|---|
| **System** | FDMS — Fiscalisation Data Management System |
| **Authority** | ZIMRA — Zimbabwe Revenue Authority |
| **Format** | A ZIMRA-specified fiscal format, validated by an on-invoice QR code. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Real-time transmission to FDMS, via a certified fiscal device or Virtual Fiscalisation (VFD) API. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Fiscal devices (Electronic Tax Registers) made mandatory for VAT-registered operators from January
  2022.
- Full FDMS/TaRMS integration for all businesses required from mid-2025.
- Each invoice must display a QR code for validation; buyer details are required for B2B
  transactions.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Zimbabwe.

- `country-policy/data/zw.json` — which document actions Zimbabwe allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/zw.json` — which national identifier a party must carry.
- `tax/tax-systems/data/zw.json` and `vat-rates/data/zw.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/zw.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/zw.json` — the channel and format a Zimbabwean public buyer requires.
- `transports/channel-policy/data/zw.json` — whether a channel is legally required of a seller
  established in Zimbabwe, and from what date.
- `archive/retention/data/zw.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: FDMS is a transmission channel this repository does not
implement, and its fiscal format has no format provider. Both are code, not a JSON file — see [When
a country needs more than a file](../adding-a-country.md).

## Want Zimbabwe supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Zimbabwe, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Zimbabwe".
