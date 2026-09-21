---
title: "SAR — Honduras e-invoicing"
description: "Honduras's SAR e-invoicing system and what adding Honduras to Invoicerr would involve. Invoicerr does not support Honduras today."
sidebar_label: "Honduras"
keywords: [SAR, Honduras e-invoicing, RTN invoice, Honduras invoice XML, e-invoicing Honduras]
---

# SAR — Honduras e-invoicing

:::warning[Invoicerr does not support Honduras]
No Honduras data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Honduras support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Honduras's e-invoicing (factura electrónica) runs through SAR, the Servicio de Administración de
Rentas, which pre-authorizes every invoice before it can be delivered to the buyer.

## What supporting Honduras would involve

| | |
|---|---|
| **System** | Factura Electrónica (SAR) |
| **Authority** | SAR — Servicio de Administración de Rentas |
| **Format** | A national XML schema (the SAR invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SAR platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2018, now covering all businesses.
- Digital certificate required for signing.
- Sequential document numbering is required.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Honduras.

- `country-policy/data/hn.json` — which document actions Honduras allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/hn.json` — which national identifier a party must carry.
- `tax/tax-systems/data/hn.json` and `vat-rates/data/hn.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/hn.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/hn.json` — the channel and format a Honduran public buyer requires.
- `transports/channel-policy/data/hn.json` — whether a channel is legally required of a seller
  established in Honduras, and from what date.
- `archive/retention/data/hn.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SAR platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Honduras supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Honduras, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Honduras".
