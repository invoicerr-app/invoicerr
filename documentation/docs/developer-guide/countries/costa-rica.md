---
title: "MH — Costa Rica e-invoicing"
description: "Costa Rica's Ministerio de Hacienda e-invoicing system and what adding Costa Rica to Invoicerr would involve. Invoicerr does not support Costa Rica today."
sidebar_label: "Costa Rica"
keywords: [MH, Costa Rica e-invoicing, Hacienda invoice, Costa Rica invoice XML, e-invoicing Costa Rica]
---

# MH — Costa Rica e-invoicing

:::warning[Invoicerr does not support Costa Rica]
No Costa Rica data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Costa Rica support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Costa Rica's e-invoicing (factura electrónica) runs through the Ministerio de Hacienda, which
pre-authorizes every invoice before it can be delivered to the buyer.

## What supporting Costa Rica would involve

| | |
|---|---|
| **System** | Factura Electrónica (Ministerio de Hacienda) |
| **Authority** | MH — Ministerio de Hacienda |
| **Format** | A national XML schema (the Hacienda invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the Ministerio de Hacienda platform for pre-authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2018, now covering all businesses.
- Digital certificate required for signing.
- Sequential, consecutive document numbering is required.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Costa Rica.

- `country-policy/data/cr.json` — which document actions Costa Rica allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/cr.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cr.json` and `vat-rates/data/cr.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cr.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cr.json` — the channel and format a Costa Rican public buyer requires.
- `transports/channel-policy/data/cr.json` — whether a channel is legally required of a seller
  established in Costa Rica, and from what date.
- `archive/retention/data/cr.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Ministerio de Hacienda platform is a transmission
channel this repository does not implement, and its XML schema has no format provider. Both are
code, not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Costa Rica supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Costa Rica, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Costa Rica".
