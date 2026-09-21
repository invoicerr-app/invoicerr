---
title: "Slovakia e-invoicing"
description: "Slovakia's POS/e Faktúra e-invoicing system, and what adding Slovakia to Invoicerr would involve. Invoicerr does not support Slovakia today."
sidebar_label: "Slovakia"
keywords: [Slovakia e-invoicing, e Faktúra, POS, Slovakia invoice XML]
---

# Slovakia e-invoicing

:::warning[Invoicerr does not support Slovakia]
No Slovakia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Slovakia support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Slovakia's B2G e-invoicing runs through the **POS** (Pokladničný operačný systém) e-invoice system,
submitted via the **e Faktúra** web portal, under the Finančná správa (Financial Administration).

## What supporting Slovakia would involve

| | |
|---|---|
| **System** | POS e-invoice system, submitted through the e Faktúra portal |
| **Authority** | Finančná správa — Financial Administration |
| **Format** | A national XML schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | POS / e Faktúra. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory since 2018, with extended requirements from January 2024.
- B2B e-invoicing remains voluntary, with no clearance model in place.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Slovakia.

- `country-policy/data/sk.json` — which document actions Slovakia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/sk.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sk.json` and `vat-rates/data/sk.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sk.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sk.json` — the channel and format a Slovak public buyer requires.
- `transports/channel-policy/data/sk.json` — whether a channel is legally required of a seller
  established in Slovakia, and from what date.
- `archive/retention/data/sk.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: POS / e Faktúra is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Slovakia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Slovakia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Slovakia".
