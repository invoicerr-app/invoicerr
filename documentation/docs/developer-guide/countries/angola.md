---
title: "AGT — Angola e-invoicing"
description: "Angola's AGT-run SAF-T / e-Fatura e-invoicing system, and what adding Angola to Invoicerr would involve. Invoicerr does not support Angola today."
sidebar_label: "Angola"
keywords: [AGT, Angola e-invoicing, SAF-T Angola, e-Fatura Angola]
---

# AGT — Angola e-invoicing

:::warning[Invoicerr does not support Angola]
No Angola data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Angola support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Angola's e-invoicing is run by **AGT**, the Administração Geral Tributária, using the OECD SAF-T
(Standard Audit File for Tax) standard rather than the clearance-style platforms common elsewhere on
the continent. Businesses report through AGT's e-Fatura system.

## What supporting Angola would involve

| | |
|---|---|
| **System** | SAF-T / e-Fatura System |
| **Authority** | AGT — Administração Geral Tributária |
| **Format** | A national format (SAF-T / e-Fatura). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the AGT SAF-T / e-Fatura platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- SAF-T reporting made mandatory for selected taxpayers from 2019, with ongoing rollout to more
  businesses.
- Model is structured SAF-T data transmission alongside e-Fatura invoice generation, not a real-time
  clearance model.
- Digital signature referenced as part of the e-Fatura requirements.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Angola.

- `country-policy/data/ao.json` — which document actions Angola allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ao.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ao.json` and `vat-rates/data/ao.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ao.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ao.json` — the channel and format an Angolan public buyer requires.
- `transports/channel-policy/data/ao.json` — whether a channel is legally required of a seller
  established in Angola, and from what date.
- `archive/retention/data/ao.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the AGT SAF-T / e-Fatura platform is a transmission channel
this repository does not implement, and its SAF-T/e-Fatura schemas have no format provider. Both are
code, not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Angola supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Angola, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Angola".
