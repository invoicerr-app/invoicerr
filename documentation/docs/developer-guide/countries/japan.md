---
title: "QIS — Japan e-invoicing"
description: "Japan's Qualified Invoice System and JP PINT format, and what adding Japan to Invoicerr would involve. Invoicerr does not support Japan today."
sidebar_label: "Japan"
keywords: [QIS, JP PINT, Japan e-invoicing, Qualified Invoice System, Japan invoice XML]
---

# QIS — Japan e-invoicing

:::warning[Invoicerr does not support Japan]
No Japan data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Japan support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Japan's **Qualified Invoice System (QIS)** governs which invoices a buyer may use to deduct
consumption tax: only an invoice carrying the issuer's registered T-number qualifies. Invoices are
commonly exchanged as **JP PINT**, Japan's own Peppol-based specification, and a separate archiving
law requires issued invoices to stay searchable in digital form.

## What supporting Japan would involve

| | |
|---|---|
| **System** | Qualified Invoice System (QIS), commonly exchanged as JP PINT |
| **Authority** | NTA — National Tax Agency, with the Digital Agency promoting e-invoice adoption |
| **Format** | A national schema (JP PINT), Japan's own Peppol-based specification. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | The Peppol Network, over which JP PINT invoices are exchanged. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- QIS requires a registered T-number on the invoice for the buyer to deduct consumption tax;
  adoption of JP PINT itself is voluntary.
- A separate archiving law requires issued invoices to stay in searchable digital form, with no
  paper fallback.
- Consumption tax has a standard 10 percent rate and a reduced 8 percent rate.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Japan.

- `country-policy/data/jp.json` — which document actions Japan allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/jp.json` — which national identifier a party must carry.
- `tax/tax-systems/data/jp.json` and `vat-rates/data/jp.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/jp.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/jp.json` — the channel and format a Japanese public buyer requires.
- `transports/channel-policy/data/jp.json` — whether a channel is legally required of a seller
  established in Japan, and from what date.
- `archive/retention/data/jp.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Beyond those files, the work here is mostly research: this page names no national platform a
transport would have to be built for.

## Want Japan supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Japan, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Japan".
