---
title: "MH — El Salvador e-invoicing"
description: "El Salvador's Ministerio de Hacienda DTE e-invoicing system and what adding it to Invoicerr would involve. Invoicerr does not support El Salvador today."
sidebar_label: "El Salvador"
keywords: [MH, DTE, El Salvador e-invoicing, e-invoicing El Salvador]
---

# MH — El Salvador e-invoicing

:::warning[Invoicerr does not support El Salvador]
No El Salvador data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants El Salvador support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

El Salvador's e-invoicing (factura electrónica) runs through the Ministerio de Hacienda, which
pre-authorizes every DTE document before it can be delivered to the buyer.

## What supporting El Salvador would involve

| | |
|---|---|
| **System** | DTE — Documento Tributario Electrónico (Ministerio de Hacienda) |
| **Authority** | MH — Ministerio de Hacienda |
| **Format** | A national XML schema (the MH DTE schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the Ministerio de Hacienda platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout, mandatory for all businesses.
- Digital certificate and sequential numbering required.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for El Salvador.

- `country-policy/data/sv.json` — which document actions El Salvador allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/sv.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sv.json` and `vat-rates/data/sv.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sv.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sv.json` — the channel and format a Salvadoran public buyer requires.
- `transports/channel-policy/data/sv.json` — whether a channel is legally required of a seller
  established in El Salvador, and from what date.
- `archive/retention/data/sv.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Ministerio de Hacienda platform is a transmission
channel this repository does not implement, and its XML schema has no format provider. Both are
code, not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want El Salvador supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for El Salvador, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add El Salvador".
