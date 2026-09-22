---
title: "SII — Chile e-invoicing"
description: "Chile's SII DTE e-invoicing system and what adding Chile to Invoicerr would involve. Invoicerr does not support Chile today."
sidebar_label: "Chile"
keywords: [SII, DTE, Chile e-invoicing, Chile invoice XML, e-invoicing Chile]
---

# SII — Chile e-invoicing

:::warning[Invoicerr does not support Chile]
No Chile data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Chile support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Chile's e-invoicing runs through the SII, the Servicio de Impuestos Internos, one of Latin America's
oldest e-invoicing regimes. Every document is a DTE, a Documento Tributario Electrónico, issued
against a pre-authorized folio range (CAF) and cleared by the SII before it reaches the buyer.

## What supporting Chile would involve

| | |
|---|---|
| **System** | DTE — Documento Tributario Electrónico |
| **Authority** | SII — Servicio de Impuestos Internos |
| **Format** | A national XML schema (the SII DTE schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SII platform for DTE clearance. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: a CAF folio range must be requested from the SII before a DTE can be issued.
- Mandatory for all businesses since 2018, following a voluntary program that began in 2001.
- Digital certificate required for signing every DTE.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Chile.

- `country-policy/data/cl.json` — which document actions Chile allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/cl.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cl.json` and `vat-rates/data/cl.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cl.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cl.json` — the channel and format a Chilean public buyer requires.
- `transports/channel-policy/data/cl.json` — whether a channel is legally required of a seller
  established in Chile, and from what date.
- `archive/retention/data/cl.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SII platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Chile supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Chile, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Chile".
