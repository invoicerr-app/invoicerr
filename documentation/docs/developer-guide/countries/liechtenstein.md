---
title: "Liechtenstein e-invoicing"
description: "Liechtenstein's e-invoicing landscape, tied to the Swiss framework, and what adding Liechtenstein to Invoicerr would involve. Invoicerr does not support Liechtenstein today."
sidebar_label: "Liechtenstein"
keywords: [Liechtenstein e-invoicing, eVAT portal, QR-bill, Liechtenstein invoice XML]
---

# Liechtenstein e-invoicing

:::warning[Invoicerr does not support Liechtenstein]
No Liechtenstein data file exists anywhere in this repository — no country policy, no identifiers,
no tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Liechtenstein support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Liechtenstein's e-invoicing follows the Swiss framework, a consequence of the customs and monetary
union between the two countries. The Tax Administration (Steuerverwaltung) runs an eVAT portal for
VAT transactions, alongside the Swiss QR-bill format used for payments.

## What supporting Liechtenstein would involve

| | |
|---|---|
| **System** | eVAT Portal, built on the Swiss e-invoicing framework |
| **Authority** | Steuerverwaltung — Tax Administration |
| **Format** | A national XML schema (Swiss QR-bill / Swiss XML standard). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the eVAT Portal. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- eVAT portal became mandatory for VAT transactions from January 2025.
- Model described as post-audit, aligned with the Swiss tax system.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Liechtenstein would need in
`countries/data/li.json`.

- `policy` - which document actions Liechtenstein allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a public buyer in Liechtenstein requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Liechtenstein, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: the eVAT Portal is a transmission channel this repository
does not implement, and its own QR-bill format has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Liechtenstein supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Liechtenstein, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add
Liechtenstein".
