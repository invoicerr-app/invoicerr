---
title: "CIS — Croatia e-invoicing"
description: "Croatia's CIS clearance platform under Fiscalization 2.0, and what adding Croatia would involve. Invoicerr does not support Croatia today."
sidebar_label: "Croatia"
keywords: [CIS, Croatia e-invoicing, e-Račun, Fiscalization 2.0, Croatia invoice XML]
---

# CIS — Croatia e-invoicing

:::warning[Invoicerr does not support Croatia]
No Croatia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Croatia support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Croatia introduced mandatory e-invoicing under the **Fiscalization 2.0** reform, passed in mid-2025
with one of the shortest rollout windows in Europe. Invoices are validated by the **CIS** (Central
Information System), Croatia's clearance platform, accessible through the **e-Račun** portal, under
the **Tax Administration** (Porezna uprava). The mandate covers B2B, B2C, and B2G transactions.

## What supporting Croatia would involve

| | |
|---|---|
| **System** | CIS (Central Information System) — Croatia's e-invoicing clearance platform, accessible through the e-Račun portal |
| **Authority** | Tax Administration (Porezna uprava) |
| **Format** | A national XML schema (e-Račun format). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | The CIS platform, reached through the e-Račun portal. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model — every invoice must be validated by CIS before it reaches the buyer.
- The mandate reached public bodies and large enterprises from January 2026, with all other
  businesses following in January 2027.
- Each invoice receives a QR code for validation.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Croatia.

- `country-policy/data/hr.json` — which document actions Croatia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/hr.json` — which national identifier a party must carry.
- `tax/tax-systems/data/hr.json` and `vat-rates/data/hr.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/hr.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/hr.json` — the channel and format a Croatian public buyer requires.
- `transports/channel-policy/data/hr.json` — whether a channel is legally required of a seller
  established in Croatia, and from what date.
- `archive/retention/data/hr.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the CIS platform is a transmission channel this repository
does not implement, and the e-Račun XML schema has no format provider. Both are code, not a JSON
file — see [When a country needs more than a file](../adding-a-country.md).

## Want Croatia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Croatia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Croatia".
