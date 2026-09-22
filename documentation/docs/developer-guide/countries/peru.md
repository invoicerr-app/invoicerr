---
title: "SUNAT — Peru e-invoicing"
description: "Peru's SUNAT e-invoicing system and what adding Peru to Invoicerr would involve. Invoicerr does not support Peru today."
sidebar_label: "Peru"
keywords: [SUNAT, Peru e-invoicing, CPE, Peru invoice XML, e-invoicing Peru]
---

# SUNAT — Peru e-invoicing

:::warning[Invoicerr does not support Peru]
No Peru data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Peru support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Peru's e-invoicing runs through SUNAT, the Superintendencia Nacional de Aduanas y de Administración
Tributaria. Every document is a CPE, a Comprobante de Pago Electrónico, typically routed through an
OSE, an Operador de Servicios Electrónicos, which validates it and forwards it to SUNAT for
clearance.

## What supporting Peru would involve

| | |
|---|---|
| **System** | CPE — Comprobante de Pago Electrónico |
| **Authority** | SUNAT — Superintendencia Nacional de Aduanas y de Administración Tributaria |
| **Format** | A national XML schema: UBL 2.1 with SUNAT's own Peruvian extensions. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission through an authorized OSE (Operador de Servicios Electrónicos) to SUNAT. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: an OSE validates and forwards the CPE to SUNAT, which returns a CDR receipt.
- Mandatory for nearly all registered taxpayers since June 2022.
- A separate SIRE integrated-records system layers sales/purchase reporting on top of the CPE.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Peru.

- `country-policy/data/pe.json` — which document actions Peru allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/pe.json` — which national identifier a party must carry.
- `tax/tax-systems/data/pe.json` and `vat-rates/data/pe.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/pe.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/pe.json` — the channel and format a Peruvian public buyer requires.
- `transports/channel-policy/data/pe.json` — whether a channel is legally required of a seller
  established in Peru, and from what date.
- `archive/retention/data/pe.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: OSE-mediated submission to SUNAT is a transmission channel
this repository does not implement, and the CPE schema has no format provider. Both are code, not a
JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Peru supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Peru, [open one](https://github.com/invoicerr-app/invoicerr/issues/new/choose)
and name which of the files above you need — a request that names one mechanism is far more
actionable than "please add Peru".
