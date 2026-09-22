---
title: "SRI — Ecuador e-invoicing"
description: "Ecuador's SRI e-invoicing system and what adding Ecuador to Invoicerr would involve. Invoicerr does not support Ecuador today."
sidebar_label: "Ecuador"
keywords: [SRI, Ecuador e-invoicing, clave de acceso, Ecuador invoice XML, e-invoicing Ecuador]
---

# SRI — Ecuador e-invoicing

:::warning[Invoicerr does not support Ecuador]
No Ecuador data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Ecuador support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Ecuador's e-invoicing (factura electrónica) runs through the SRI, the Servicio de Rentas Internas.
Every invoice carries a clave de acceso, a numeric authorization key the seller calculates and the
SRI validates before the document can be delivered.

## What supporting Ecuador would involve

| | |
|---|---|
| **System** | Factura Electrónica (SRI), authorized via a clave de acceso |
| **Authority** | SRI — Servicio de Rentas Internas |
| **Format** | A national XML schema (the SRI invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SRI web services for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2014, now covering all businesses.
- Offline mode exists as a contingency when connectivity is unavailable, with later sync to the SRI.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ecuador.

- `country-policy/data/ec.json` — which document actions Ecuador allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ec.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ec.json` and `vat-rates/data/ec.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ec.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ec.json` — the channel and format an Ecuadorian public buyer requires.
- `transports/channel-policy/data/ec.json` — whether a channel is legally required of a seller
  established in Ecuador, and from what date.
- `archive/retention/data/ec.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SRI platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Ecuador supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ecuador, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ecuador".
