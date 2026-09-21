---
title: "GTA — Qatar e-invoicing"
description: "Qatar's GTA e-invoicing system and what adding Qatar to Invoicerr would involve. Invoicerr does not support Qatar today."
sidebar_label: "Qatar"
keywords: [GTA, Qatar e-invoicing, Qatar invoice XML, e-invoicing Qatar]
---

# GTA — Qatar e-invoicing

:::warning[Invoicerr does not support Qatar]
No Qatar data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Qatar support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Qatar's e-invoicing mandate runs through the GTA, the General Tax Authority, on its own e-Invoice
System. The authority requires real-time invoice reporting for VAT purposes.

## What supporting Qatar would involve

| | |
|---|---|
| **System** | e-Invoice System (GTA) |
| **Authority** | GTA — General Tax Authority |
| **Format** | A national XML/JSON schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the GTA platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses since 2021, with continuous real-time reporting.
- VAT rate cited as 0% / 15%.
- Digital signature required at submission.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Qatar.

- `country-policy/data/qa.json` — which document actions Qatar allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/qa.json` — which national identifier a party must carry.
- `tax/tax-systems/data/qa.json` and `vat-rates/data/qa.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/qa.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/qa.json` — the channel and format a public buyer in Qatar requires.
- `transports/channel-policy/data/qa.json` — whether a channel is legally required of a seller
  established in Qatar, and from what date.
- `archive/retention/data/qa.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the GTA platform is a transmission channel this repository
does not implement, and its schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Qatar supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Qatar, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Qatar".
