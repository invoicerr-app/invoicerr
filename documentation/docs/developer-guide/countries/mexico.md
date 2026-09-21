---
title: "CFDI — Mexico e-invoicing"
description: "Mexico's SAT CFDI e-invoicing system and what adding Mexico to Invoicerr would involve. Invoicerr does not support Mexico today."
sidebar_label: "Mexico"
keywords: [CFDI, SAT, Mexico e-invoicing, CFDI 4.0, e-invoicing Mexico]
---

# CFDI — Mexico e-invoicing

:::warning[Invoicerr does not support Mexico]
No Mexico data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Mexico support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Mexico's e-invoicing runs on CFDI, the Comprobante Fiscal Digital por Internet, under SAT, the
Servicio de Administración Tributaria. A CFDI is never sent straight to SAT: it first passes through
a PAC, a Proveedor Autorizado de Certificación, which validates, signs and timestamps it before
forwarding it to SAT for registration.

## What supporting Mexico would involve

| | |
|---|---|
| **System** | CFDI 4.0 — Comprobante Fiscal Digital por Internet |
| **Authority** | SAT — Servicio de Administración Tributaria |
| **Format** | A national XML schema (the CFDI 4.0 schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission through an authorized PAC (Proveedor Autorizado de Certificación) to SAT. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for all taxpayers since 2014; CFDI 4.0 became mandatory in 2023, replacing CFDI 3.3.
- Clearance runs through a certified PAC, not directly against SAT.
- Additional complement documents exist for payments (Pago) and payroll (Nómina).
- Digital seal certificate (CSD) required for signing.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Mexico.

- `country-policy/data/mx.json` — which document actions Mexico allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/mx.json` — which national identifier a party must carry.
- `tax/tax-systems/data/mx.json` and `vat-rates/data/mx.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/mx.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/mx.json` — the channel and format a Mexican public buyer requires.
- `transports/channel-policy/data/mx.json` — whether a channel is legally required of a seller
  established in Mexico, and from what date.
- `archive/retention/data/mx.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: PAC-mediated submission to SAT is a transmission channel
this repository does not implement, and the CFDI schema has no format provider. Both are code, not a
JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Mexico supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Mexico, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Mexico".
