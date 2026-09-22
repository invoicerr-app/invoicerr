---
title: "eGUI — Taiwan e-invoicing"
description: "Taiwan's electronic Government Uniform Invoice (eGUI) system, and what adding Taiwan to Invoicerr would involve. Invoicerr does not support Taiwan today."
sidebar_label: "Taiwan"
keywords: [eGUI, Taiwan e-invoicing, e-Invoice Taiwan, Uniform Invoice, Taiwan invoice XML]
---

# eGUI — Taiwan e-invoicing

:::warning[Invoicerr does not support Taiwan]
No Taiwan data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Taiwan support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Taiwan's e-invoicing, known as **eGUI**, is run by the tax authority and takes two shapes: a
structured document for business-to-business trade, and a QR code printed on the receipt for
consumer sales, periodically reported back to the authority.

## What supporting Taiwan would involve

| | |
|---|---|
| **System** | eGUI — electronic Government Uniform Invoice |
| **Authority** | NRA — National Taxation Bureau |
| **Format** | A national schema (eGUI): structured XML for business-to-business, a QR code for consumer sales. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the eGUI e-Invoice System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Progressive mandatory rollout: consumer-facing from 2015, business-to-business requirements
  extended from 2020.
- Standard VAT rate is 5 percent.
- Archive retention is 5 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Taiwan.

- `country-policy/data/tw.json` — which document actions Taiwan allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/tw.json` — which national identifier a party must carry.
- `tax/tax-systems/data/tw.json` and `vat-rates/data/tw.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/tw.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/tw.json` — the channel and format a Taiwanese public buyer requires.
- `transports/channel-policy/data/tw.json` — whether a channel is legally required of a seller
  established in Taiwan, and from what date.
- `archive/retention/data/tw.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the eGUI e-Invoice System is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Taiwan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Taiwan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Taiwan".
