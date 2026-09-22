---
title: "IRP — India e-invoicing"
description: "India's GST e-invoice clearance through the IRP, and what adding India to Invoicerr would involve. Invoicerr does not support India today."
sidebar_label: "India"
keywords: [IRP, India e-invoicing, GST e-invoice, IRN, India invoice XML]
---

# IRP — India e-invoicing

:::warning[Invoicerr does not support India]
No India data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants India support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

India runs a strict clearance model: an invoice is not legal until the **Invoice Registration Portal
(IRP)** has registered it and returned a signed **IRN** and QR code. Businesses reach the IRP
through a licensed **GSP** (GST Suvidha Provider) rather than connecting to it directly.

## What supporting India would involve

| | |
|---|---|
| **System** | IRP — Invoice Registration Portal |
| **Authority** | GSTN — Goods and Services Tax Network, with NIC operating the IRP |
| **Format** | A national schema (GST INV-01, JSON). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the IRP through a licensed GSP intermediary. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: the signed IRN and QR code are the proof an invoice is valid.
- Mandatory today for larger businesses; the qualifying turnover threshold is expected to be
  lowered.
- A newer rule requires invoices to be reported to the IRP within a set number of days of issuance
  for large businesses.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for India.

- `country-policy/data/in.json` — which document actions India allows. Start here: without this file
  every action is refused with a 403, naming the country.
- `country-identifiers/data/in.json` — which national identifier a party must carry.
- `tax/tax-systems/data/in.json` and `vat-rates/data/in.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/in.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/in.json` — the channel and format an Indian public buyer requires.
- `transports/channel-policy/data/in.json` — whether a channel is legally required of a seller
  established in India, and from what date.
- `archive/retention/data/in.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the IRP is a transmission channel this repository does not
implement, and its JSON schema has no format provider. Both are code, not a JSON file — see [When a
country needs more than a file](../adding-a-country.md).

## Want India supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for India, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add India".
