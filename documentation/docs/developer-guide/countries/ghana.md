---
title: "GRA — Ghana e-invoicing"
description: "Ghana's GRA e-invoicing system, and what adding Ghana to Invoicerr would involve. Invoicerr does not support Ghana today."
sidebar_label: "Ghana"
keywords: [GRA, Ghana e-invoicing, e-VAT Ghana, Ghana invoice XML]
---

# GRA — Ghana e-invoicing

:::warning[Invoicerr does not support Ghana]
No Ghana data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Ghana support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Ghana's e-invoicing is administered by the **GRA**, the Ghana Revenue Authority, through its
e-Invoice System, referred to in places as e-VAT.

## What supporting Ghana would involve

| | |
|---|---|
| **System** | GRA e-Invoice System (e-VAT) |
| **Authority** | GRA — Ghana Revenue Authority |
| **Format** | A national format (e-VAT). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the GRA e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout described as starting from 2021.
- Described as a clearance model, with pre-clearance validation required before an invoice is valid.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ghana.

- `country-policy/data/gh.json` — which document actions Ghana allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/gh.json` — which national identifier a party must carry.
- `tax/tax-systems/data/gh.json` and `vat-rates/data/gh.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/gh.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/gh.json` — the channel and format a Ghanaian public buyer requires.
- `transports/channel-policy/data/gh.json` — whether a channel is legally required of a seller
  established in Ghana, and from what date.
- `archive/retention/data/gh.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the GRA e-Invoice System is a transmission channel this
repository does not implement, and the e-VAT format has no format provider. Both are code, not a
JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Ghana supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ghana, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ghana".
