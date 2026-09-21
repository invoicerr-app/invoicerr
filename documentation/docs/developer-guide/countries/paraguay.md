---
title: "SIFEN — Paraguay e-invoicing"
description: "Paraguay's SIFEN e-invoicing system and what adding Paraguay to Invoicerr would involve. Invoicerr does not support Paraguay today."
sidebar_label: "Paraguay"
keywords: [SIFEN, SET, Paraguay e-invoicing, Paraguay invoice XML, e-invoicing Paraguay]
---

# SIFEN — Paraguay e-invoicing

:::warning[Invoicerr does not support Paraguay]
No Paraguay data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Paraguay support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Paraguay's e-invoicing runs on SIFEN, the national electronic invoicing platform operated by SET,
the Secretaría de Estado de Tributación, which pre-authorizes every invoice before it can be
delivered to the buyer.

## What supporting Paraguay would involve

| | |
|---|---|
| **System** | SIFEN — Paraguay's national electronic invoicing platform |
| **Authority** | SET — Secretaría de Estado de Tributación |
| **Format** | A national XML schema (the SET/SIFEN invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SET/SIFEN platform for authorization. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive rollout by sector since 2018, now covering all businesses.
- Digital certificate required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Paraguay.

- `country-policy/data/py.json` — which document actions Paraguay allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/py.json` — which national identifier a party must carry.
- `tax/tax-systems/data/py.json` and `vat-rates/data/py.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/py.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/py.json` — the channel and format a Paraguayan public buyer requires.
- `transports/channel-policy/data/py.json` — whether a channel is legally required of a seller
  established in Paraguay, and from what date.
- `archive/retention/data/py.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SET/SIFEN platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Paraguay supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Paraguay, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Paraguay".
