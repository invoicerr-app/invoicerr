---
title: "DGII — Dominican Republic e-invoicing"
description: "The Dominican Republic's DGII e-CF e-invoicing system and what adding it to Invoicerr would involve. Invoicerr does not support the Dominican Republic today."
sidebar_label: "Dominican Republic"
keywords: [DGII, e-CF, NCF, Dominican Republic e-invoicing, e-invoicing Dominican Republic]
---

# DGII — Dominican Republic e-invoicing

:::warning[Invoicerr does not support the Dominican Republic]
No Dominican Republic data file exists anywhere in this repository — no country policy, no
identifiers, no tax system, no transmission channel. **Nothing on this page is implemented.** It is
here so that someone who wants Dominican Republic support knows what adding it would involve. The
countries Invoicerr does cover are listed in the [country directory](./index.md).
:::

The Dominican Republic's e-invoicing runs through DGII, the Dirección General de Impuestos Internos.
Every invoice is an e-CF, a comprobante fiscal electrónico, authorized against an NCF (Número de
Comprobante Fiscal) before it can reach the buyer.

## What supporting Dominican Republic would involve

| | |
|---|---|
| **System** | e-CF — Comprobante Fiscal Electrónico, authorized via an NCF |
| **Authority** | DGII — Dirección General de Impuestos Internos |
| **Format** | A national XML schema (the DGII e-CF schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the DGII platform for NCF authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: an NCF authorization number is required before an e-CF can be issued.
- Progressive rollout by sector since 2018, now covering all businesses.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Dominican Republic.

- `country-policy/data/do.json` — which document actions Dominican Republic allows. Start here:
  without this file every action is refused with a 403, naming the country.
- `country-identifiers/data/do.json` — which national identifier a party must carry.
- `tax/tax-systems/data/do.json` and `vat-rates/data/do.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/do.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/do.json` — the channel and format a Dominican public buyer requires.
- `transports/channel-policy/data/do.json` — whether a channel is legally required of a seller
  established in Dominican Republic, and from what date.
- `archive/retention/data/do.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the DGII platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Dominican Republic supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Dominican Republic, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Dominican
Republic".
