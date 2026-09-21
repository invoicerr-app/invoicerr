---
title: "BIR — Philippines e-invoicing"
description: "The Philippines' BIR e-Invoice system, and what adding the Philippines to Invoicerr would involve. Invoicerr does not support the Philippines today."
sidebar_label: "Philippines"
keywords: [BIR, EIS, Philippines e-invoicing, e-Invoice Philippines, Philippines invoice XML]
---

# BIR — Philippines e-invoicing

:::warning[Invoicerr does not support the Philippines]
No Philippines data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Philippines support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

The Philippines requires mandatory e-invoicing through the Bureau of Internal Revenue's own
e-Invoice System, authorised before an invoice reaches the buyer. Software used to issue invoices
must itself be accredited by the BIR.

## What supporting the Philippines would involve

| | |
|---|---|
| **System** | EIS — the BIR's e-Invoice System |
| **Authority** | BIR — Bureau of Internal Revenue |
| **Format** | A national schema (EIS). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to the BIR's EIS platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: the BIR validates and authorises each invoice before delivery.
- Software used to issue invoices must hold BIR accreditation.
- Standard VAT rate is 12 percent.
- Archive retention is 5 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for the Philippines.

- `country-policy/data/ph.json` — which document actions the Philippines allows. Start here: without
  this file every action is refused with a 403, naming the country.
- `country-identifiers/data/ph.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ph.json` and `vat-rates/data/ph.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ph.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ph.json` — the channel and format a Philippine public buyer requires.
- `transports/channel-policy/data/ph.json` — whether a channel is legally required of a seller
  established in the Philippines, and from what date.
- `archive/retention/data/ph.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the BIR's EIS platform is a transmission channel this
repository does not implement, and its schema has no format provider. Both are code, not a JSON file
— see [When a country needs more than a file](../adding-a-country.md).

## Want the Philippines supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for the Philippines, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add the
Philippines".
