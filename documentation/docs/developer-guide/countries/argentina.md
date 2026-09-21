---
title: "AFIP/ARCA — Argentina e-invoicing"
description: "Argentina's AFIP/ARCA e-invoicing system and what adding Argentina to Invoicerr would involve. Invoicerr does not support Argentina today."
sidebar_label: "Argentina"
keywords: [AFIP, ARCA, Argentina e-invoicing, CUIT invoice, e-invoicing Argentina]
---

# AFIP/ARCA — Argentina e-invoicing

:::warning[Invoicerr does not support Argentina]
No Argentina data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Argentina support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Argentina's e-invoicing runs through AFIP/ARCA, the country's federal tax authority, recently
reorganized from AFIP into ARCA. Invoices are cleared before they can be delivered: the seller
requests a CAF authorization range, signs the invoice, and submits it to the AFIP/ARCA platform for
a CAE code.

## What supporting Argentina would involve

| | |
|---|---|
| **System** | AFIP/ARCA Sistema de Factura Electrónica |
| **Authority** | ARCA — Administración Federal de Ingresos Públicos (formerly AFIP) |
| **Format** | A national XML schema (the AFIP/ARCA invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the AFIP/ARCA web services (WSFE/WSMTX) for CAE clearance. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: a CAF folio range and a CAE code are required before an invoice can reach the
  buyer.
- Mandatory for VAT-registered taxpayers since 2015, with the platform migrating from AFIP to ARCA
  through 2024-2025.
- Digital certificate and electronic signature required on every invoice.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Argentina.

- `country-policy/data/ar.json` — which document actions Argentina allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ar.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ar.json` and `vat-rates/data/ar.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ar.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ar.json` — the channel and format an Argentine public buyer requires.
- `transports/channel-policy/data/ar.json` — whether a channel is legally required of a seller
  established in Argentina, and from what date.
- `archive/retention/data/ar.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the AFIP/ARCA platform is a transmission channel this
repository does not implement, and its XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Argentina supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Argentina, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Argentina".
