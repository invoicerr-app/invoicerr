---
title: "RO e-Factura — Romania e-invoicing"
description: "Romania's RO e-Factura clearance system, and what adding Romania to Invoicerr would involve. Invoicerr does not support Romania today."
sidebar_label: "Romania"
keywords: [RO e-Factura, Romania e-invoicing, SPV, ANAF, Romania invoice XML]
---

# RO e-Factura — Romania e-invoicing

:::warning[Invoicerr does not support Romania]
No Romania data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Romania support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Romania's e-invoicing runs through **RO e-Factura**, submitted via the **SPV** (Spațiul Privat
Virtual) portal and cleared by ANAF (Agenția Națională de Administrare Fiscală). An invoice is only
legally valid once ANAF returns its own signature over it.

## What supporting Romania would involve

| | |
|---|---|
| **System** | RO e-Factura, submitted through the SPV portal |
| **Authority** | ANAF — Agenția Națională de Administrare Fiscală |
| **Format** | A national XML schema (RO_CIUS, a UBL 2.1 customization with ANAF-specific validation). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | SPV. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for B2G, B2B and B2C reporting today.
- Model described as clearance: ANAF validates and signs the invoice before it is legally usable.
- Access to SPV is cited as requiring a qualified digital certificate.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Romania.

- `country-policy/data/ro.json` — which document actions Romania allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ro.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ro.json` and `vat-rates/data/ro.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ro.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ro.json` — the channel and format a Romanian public buyer requires.
- `transports/channel-policy/data/ro.json` — whether a channel is legally required of a seller
  established in Romania, and from what date.
- `archive/retention/data/ro.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: SPV is a transmission channel this repository does not
implement, and RO_CIUS has no format provider. Both are code, not a JSON file — see [When a country
needs more than a file](../adding-a-country.md).

## Want Romania supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Romania, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Romania".
