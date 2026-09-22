---
title: "DIAN — Colombia e-invoicing"
description: "Colombia's DIAN e-invoicing system and what adding Colombia to Invoicerr would involve. Invoicerr does not support Colombia today."
sidebar_label: "Colombia"
keywords: [DIAN, Colombia e-invoicing, CUFE, Colombia invoice XML, e-invoicing Colombia]
---

# DIAN — Colombia e-invoicing

:::warning[Invoicerr does not support Colombia]
No Colombia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Colombia support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Colombia's e-invoicing runs through DIAN, the Dirección de Impuestos y Aduanas Nacionales, on its
own national platform (the SFE). Every invoice is cleared before delivery and carries a CUFE, a
unique code DIAN generates on validation, plus a QR code the buyer can use to verify it.

## What supporting Colombia would involve

| | |
|---|---|
| **System** | DIAN Sistema de Factura Electrónica (SFE) |
| **Authority** | DIAN — Dirección de Impuestos y Aduanas Nacionales |
| **Format** | A national XML schema: UBL 2.1 with DIAN's own Colombian extensions (CUFE, digital signature). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DIAN platform for CUFE clearance. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: DIAN validates and returns a CUFE before an invoice can be delivered.
- Progressive mandatory rollout from 2019, extended to all VAT-registered businesses.
- Also covers "equivalent documents" for transactions that fall outside the standard invoice.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Colombia.

- `country-policy/data/co.json` — which document actions Colombia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/co.json` — which national identifier a party must carry.
- `tax/tax-systems/data/co.json` and `vat-rates/data/co.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/co.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/co.json` — the channel and format a Colombian public buyer requires.
- `transports/channel-policy/data/co.json` — whether a channel is legally required of a seller
  established in Colombia, and from what date.
- `archive/retention/data/co.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DIAN platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Colombia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Colombia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Colombia".
