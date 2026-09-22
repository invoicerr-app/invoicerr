---
title: "SENIAT — Venezuela e-invoicing"
description: "Venezuela's SENIAT e-invoicing system and what adding Venezuela to Invoicerr would involve. Invoicerr does not support Venezuela today."
sidebar_label: "Venezuela"
keywords: [SENIAT, Venezuela e-invoicing, RIF invoice, Venezuela invoice XML, e-invoicing Venezuela]
---

# SENIAT — Venezuela e-invoicing

:::warning[Invoicerr does not support Venezuela]
No Venezuela data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Venezuela support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Venezuela's e-invoicing runs through SENIAT, the Servicio Nacional Integrado de Administración
Aduanera y Tributaria, which pre-authorizes every invoice before it can be delivered to the buyer.

## What supporting Venezuela would involve

| | |
|---|---|
| **System** | Factura Electrónica (SENIAT) |
| **Authority** | SENIAT — Servicio Nacional Integrado de Administración Aduanera y Tributaria |
| **Format** | A national XML schema (the SENIAT invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SENIAT platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2015, now covering all businesses.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Venezuela.

- `country-policy/data/ve.json` — which document actions Venezuela allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ve.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ve.json` and `vat-rates/data/ve.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ve.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ve.json` — the channel and format a Venezuelan public buyer requires.
- `transports/channel-policy/data/ve.json` — whether a channel is legally required of a seller
  established in Venezuela, and from what date.
- `archive/retention/data/ve.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SENIAT platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Venezuela supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Venezuela, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Venezuela".
