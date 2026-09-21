---
title: "ZRA — Zambia e-invoicing"
description: "Zambia's ZRA Smart Invoice e-invoicing system, and what adding Zambia to Invoicerr would involve. Invoicerr does not support Zambia today."
sidebar_label: "Zambia"
keywords: [ZRA, Smart Invoice, Zambia e-invoicing, Zambia invoice XML]
---

# ZRA — Zambia e-invoicing

:::warning[Invoicerr does not support Zambia]
No Zambia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Zambia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Zambia's e-invoicing is administered by the **ZRA**, the Zambia Revenue Authority, through its Smart
Invoice e-Invoice System.

## What supporting Zambia would involve

| | |
|---|---|
| **System** | ZRA e-Invoice System (Smart Invoice) |
| **Authority** | ZRA — Zambia Revenue Authority |
| **Format** | A national format (Smart Invoice). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the ZRA e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses from 2023, with continuous real-time reporting.
- Described as a clearance model requiring e-invoice authorization before an invoice is valid.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Zambia.

- `country-policy/data/zm.json` — which document actions Zambia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/zm.json` — which national identifier a party must carry.
- `tax/tax-systems/data/zm.json` and `vat-rates/data/zm.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/zm.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/zm.json` — the channel and format a Zambian public buyer requires.
- `transports/channel-policy/data/zm.json` — whether a channel is legally required of a seller
  established in Zambia, and from what date.
- `archive/retention/data/zm.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the ZRA e-Invoice System is a transmission channel this
repository does not implement, and the Smart Invoice format has no format provider. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Zambia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Zambia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Zambia".
