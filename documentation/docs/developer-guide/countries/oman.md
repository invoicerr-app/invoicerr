---
title: "Oman e-invoicing"
description: "Oman's e-invoicing system, run by the Tax Authority, and what adding Oman to Invoicerr would involve. Invoicerr does not support Oman today."
sidebar_label: "Oman"
keywords: [Oman e-invoicing, Oman Tax Authority, Oman invoice XML, GCC VAT invoicing]
---

# Oman e-invoicing

:::warning[Invoicerr does not support Oman]
No Oman data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Oman support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Oman's e-invoicing mandate runs through its Tax Authority, on an e-Invoice System built for VAT
reporting. The system aligns with the wider GCC VAT framework and centers on real-time invoice
reporting.

## What supporting Oman would involve

| | |
|---|---|
| **System** | e-Invoice System (VAT) |
| **Authority** | Oman Tax Authority |
| **Format** | A national XML/JSON schema (GCC standard). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the Tax Authority's e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all businesses since 2021, with continuous real-time reporting.
- Standard VAT rate 5%.
- Digital signature required at submission.
- Archive retention 6 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Oman.

- `country-policy/data/om.json` — which document actions Oman allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/om.json` — which national identifier a party must carry.
- `tax/tax-systems/data/om.json` and `vat-rates/data/om.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/om.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/om.json` — the channel and format an Oman public buyer requires.
- `transports/channel-policy/data/om.json` — whether a channel is legally required of a seller
  established in Oman, and from what date.
- `archive/retention/data/om.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Tax Authority's e-Invoice System is a transmission
channel this repository does not implement, and its schema has no format provider. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Oman supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Oman, [open one](https://github.com/invoicerr-app/invoicerr/issues/new/choose)
and name which of the files above you need — a request that names one mechanism is far more
actionable than "please add Oman".
