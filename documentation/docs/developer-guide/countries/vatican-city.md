---
title: "Vatican City e-invoicing"
description: "How Vatican City exchanges e-invoices with Italy over SDI, and what adding Vatican City to Invoicerr would involve. Invoicerr does not support Vatican City today."
sidebar_label: "Vatican City"
keywords: [Vatican City e-invoicing, SDI, FatturaPA, Vatican invoice]
---

# Vatican City e-invoicing

:::warning[Invoicerr does not support Vatican City]
No Vatican City data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Vatican City support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Vatican City's trade with Italy runs through Italy's own **SDI** (Sistema di Interscambio), using
the **FatturaPA** format. The Prefecture for Economic Affairs is the Vatican's own authority; the
rules themselves are Italy's.

## What supporting Vatican City would involve

| | |
|---|---|
| **System** | SDI (Sistema di Interscambio) — Italy's exchange platform |
| **Authority** | Prefecture for Economic Affairs (Vatican City), applying Italy's SDI rules |
| **Format** | FatturaPA — Italy's e-invoice format. This repository already ships it, built for Italy, so it would not have to be written from scratch. |
| **Transmission** | SDI. This repository's `sdi` and `sdi-pec` transports already speak to it, built for Italy; nothing in the country catalogs routes Vatican City invoices there today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Cited as mandatory for all B2B/B2G transactions since 2019.
- Model described as clearance, with real-time validation through SDI.
- Archive retention cited at 10 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Vatican City.

- `country-policy/data/va.json` — which document actions Vatican City allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/va.json` — which national identifier a party must carry.
- `tax/tax-systems/data/va.json` and `vat-rates/data/va.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/va.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/va.json` — the channel and format a public buyer in Vatican City requires.
- `transports/channel-policy/data/va.json` — whether a channel is legally required of a seller
  established in Vatican City, and from what date.
- `archive/retention/data/va.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Unlike most of the countries on this page, the format and the transport are not missing from this
repository — FatturaPA and the `sdi`/`sdi-pec` transports already ship, built for Italy. What is
missing is the data: every file in the list above, naming Vatican City specifically.

## Want Vatican City supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Vatican City, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Vatican City".
