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
the contract each section has to satisfy; this is only the shopping list of sections Taiwan would need in
`countries/data/tw.json`.

- `policy` - which document actions Taiwan allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Taiwanese public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Taiwan, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the eGUI e-Invoice System is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want Taiwan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Taiwan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Taiwan".
