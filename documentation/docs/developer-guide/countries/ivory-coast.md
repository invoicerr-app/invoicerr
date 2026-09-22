---
title: "DGI — Ivory Coast e-invoicing"
description: "Ivory Coast's SIGF e-invoicing system, run by the DGI, and what adding Ivory Coast to Invoicerr would involve. Invoicerr does not support Ivory Coast today."
sidebar_label: "Ivory Coast"
keywords: [SIGF, DGI, Ivory Coast e-invoicing, FNE, Ivory Coast invoice XML]
---

# DGI — Ivory Coast e-invoicing

:::warning[Invoicerr does not support Ivory Coast]
No Ivory Coast data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Ivory Coast support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

Ivory Coast's e-invoicing is administered by the **DGI**, the Direction Générale des Impôts, through
its **SIGF** platform, the Système Intégré de Gestion de la Fiscalité. Today the mandate applies
mainly to digital service providers.

## What supporting Ivory Coast would involve

| | |
|---|---|
| **System** | SIGF — Système Intégré de Gestion de la Fiscalité |
| **Authority** | DGI — Direction Générale des Impôts |
| **Format** | A national format (FNE). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Real-time submission to the SIGF platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Mandatory for digital service providers from 2019; extension to all businesses is described as
  planned, with no fixed timeline.
- Described as a clearance model: invoices are sent to the DGI in real time.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ivory Coast.

- `country-policy/data/ci.json` — which document actions Ivory Coast allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/ci.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ci.json` and `vat-rates/data/ci.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ci.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ci.json` — the channel and format an Ivorian public buyer requires.
- `transports/channel-policy/data/ci.json` — whether a channel is legally required of a seller
  established in Ivory Coast, and from what date.
- `archive/retention/data/ci.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SIGF platform is a transmission channel this repository
does not implement, and the FNE format has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Ivory Coast supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ivory Coast, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ivory Coast".
