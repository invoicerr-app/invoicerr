---
title: "SIN — Bolivia e-invoicing"
description: "Bolivia's SIN e-invoicing system and what adding Bolivia to Invoicerr would involve. Invoicerr does not support Bolivia today."
sidebar_label: "Bolivia"
keywords: [SIN, Bolivia e-invoicing, CUFD, Bolivia invoice XML, e-invoicing Bolivia]
---

# SIN — Bolivia e-invoicing

:::warning[Invoicerr does not support Bolivia]
No Bolivia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Bolivia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Bolivia's e-invoicing runs through SIN, the Servicio de Impuestos Nacionales, on its own national
platform. Each invoice is authorized with a CUFD code obtained from SIN, and the platform is
designed offline-first so a seller can keep invoicing when connectivity drops and sync afterward.

## What supporting Bolivia would involve

| | |
|---|---|
| **System** | SIN Sistema de Factura Electrónica, authorized per invoice via a CUFD code |
| **Authority** | SIN — Servicio de Impuestos Nacionales |
| **Format** | A national XML schema (the SIN invoice schema). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the SIN platform, online or via offline sync. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Offline-first design: invoices can be issued locally and synced to SIN once connectivity is
  restored.
- Progressive rollout by sector, still expanding.
- Digital certificate required for every document.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Bolivia.

- `country-policy/data/bo.json` — which document actions Bolivia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/bo.json` — which national identifier a party must carry.
- `tax/tax-systems/data/bo.json` and `vat-rates/data/bo.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/bo.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/bo.json` — the channel and format a Bolivian public buyer requires.
- `transports/channel-policy/data/bo.json` — whether a channel is legally required of a seller
  established in Bolivia, and from what date.
- `archive/retention/data/bo.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SIN platform is a transmission channel this repository
does not implement, and its XML schema has no format provider. Both are code, not a JSON file — see
[When a country needs more than a file](../adding-a-country.md).

## Want Bolivia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Bolivia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Bolivia".
