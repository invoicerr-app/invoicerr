---
title: "PDP/PPF — Monaco e-invoicing"
description: "How Monaco businesses follow France's PDP/PPF e-invoicing framework, and what adding Monaco to Invoicerr would involve. Invoicerr does not support Monaco today."
sidebar_label: "Monaco"
keywords: [Monaco e-invoicing, Chorus Pro, PDP, PPF, Monaco invoice]
---

# PDP/PPF — Monaco e-invoicing

:::warning[Invoicerr does not support Monaco]
No Monaco data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Monaco support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Monaco businesses registered with a French SIREN number follow France's own e-invoicing framework:
Partner Dematerialization Platforms (PDP) and the Portail Public de Facturation (PPF), with Chorus
Pro handling the B2G side. The Department of Finance is Monaco's own authority; the rules themselves
are France's.

## What supporting Monaco would involve

| | |
|---|---|
| **System** | The PDP/PPF framework, with Chorus Pro for B2G |
| **Authority** | Department of Finance (Monaco), applying the French DGFiP framework |
| **Format** | Factur-X and the wider UBL/CII family. This repository already ships these formats, built for France, so the format itself would not have to be written from scratch. |
| **Transmission** | Chorus Pro and the wider PDP/PPF framework — the same channels France's own mandate uses. This repository's `pdp` and `chorus-pro` transports already speak to them, built for France; nothing in the country catalogs routes Monaco invoices there today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Large enterprises cited as required to issue e-invoices from September 2026, SMEs from September
  2027.
- All companies cited as required to receive e-invoices from September 2026.
- Model described as clearance, following the French CTC approach.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Monaco.

- `country-policy/data/mc.json` — which document actions Monaco allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/mc.json` — which national identifier a party must carry.
- `tax/tax-systems/data/mc.json` and `vat-rates/data/mc.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/mc.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/mc.json` — the channel and format a public buyer in Monaco requires.
- `transports/channel-policy/data/mc.json` — whether a channel is legally required of a seller
  established in Monaco, and from what date.
- `archive/retention/data/mc.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Unlike most of the countries on this page, the format and the transport are not missing from this
repository — Factur-X/UBL and the `pdp`/`chorus-pro` transports already ship, built for France. What
is missing is the data: every file in the list above, naming Monaco specifically.

## Want Monaco supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Monaco, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Monaco".
