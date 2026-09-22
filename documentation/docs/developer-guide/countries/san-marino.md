---
title: "San Marino e-invoicing"
description: "How San Marino exchanges e-invoices with Italy over SDI, and what adding San Marino to Invoicerr would involve. Invoicerr does not support San Marino today."
sidebar_label: "San Marino"
keywords: [San Marino e-invoicing, SDI, FatturaPA, San Marino invoice]
---

# San Marino e-invoicing

:::warning[Invoicerr does not support San Marino]
No San Marino data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants San Marino support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

San Marino's cross-border trade with Italy runs through Italy's own **SDI** (Sistema di
Interscambio), using the **FatturaPA** format. San Marino's own Finance Authority applies the
Italian rules for this exchange.

## What supporting San Marino would involve

| | |
|---|---|
| **System** | SDI (Sistema di Interscambio) — Italy's exchange platform |
| **Authority** | Finance Authority (San Marino), applying Italy's SDI rules |
| **Format** | FatturaPA — Italy's e-invoice format. This repository already ships it, built for Italy, so it would not have to be written from scratch. |
| **Transmission** | SDI. This repository's `sdi` and `sdi-pec` transports already speak to it, built for Italy; nothing in the country catalogs routes San Marino invoices there today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Cited as mandatory for all B2B/B2G transactions since 2019, extended to B2C in 2024.
- Model described as clearance, with real-time validation through SDI.
- Archive retention cited at 10 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for San Marino.

- `country-policy/data/sm.json` — which document actions San Marino allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/sm.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sm.json` and `vat-rates/data/sm.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sm.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sm.json` — the channel and format a public buyer in San Marino requires.
- `transports/channel-policy/data/sm.json` — whether a channel is legally required of a seller
  established in San Marino, and from what date.
- `archive/retention/data/sm.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Unlike most of the countries on this page, the format and the transport are not missing from this
repository — FatturaPA and the `sdi`/`sdi-pec` transports already ship, built for Italy. What is
missing is the data: every file in the list above, naming San Marino specifically.

## Want San Marino supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for San Marino, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add San Marino".
