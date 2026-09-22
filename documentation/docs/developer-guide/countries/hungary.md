---
title: "Online Számla (RTIR) — Hungary e-invoicing"
description: "Hungary's Online Számla real-time invoice reporting (RTIR), run by NAV, and what adding Hungary would involve. Invoicerr does not support Hungary today."
sidebar_label: "Hungary"
keywords: [RTIR, Online Számla, Hungary e-invoicing, NAV, Hungary invoice XML]
---

# Online Számla (RTIR) — Hungary e-invoicing

:::warning[Invoicerr does not support Hungary]
No Hungary data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Hungary support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Hungary requires real-time invoice data reporting for every invoice issued by a Hungarian taxpayer,
through **Online Számla**, the **RTIR** (Real-Time Invoice Reporting) system run by **NAV** (Nemzeti
Adó- és Vámhivatal). For most invoices, reporting to NAV runs alongside the invoice rather than
replacing it — the legal document is still the PDF or paper original. From 2026, water and energy
utility suppliers must switch to the reported XML being the invoice itself.

## What supporting Hungary would involve

| | |
|---|---|
| **System** | Online Számla — Hungary's Real-Time Invoice Reporting system (RTIR) |
| **Authority** | NAV (Nemzeti Adó- és Vámhivatal — National Tax and Customs Administration) |
| **Format** | A national XML schema (NAV XML v3.0). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | The NAV Online Számla API. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Real-time reporting to NAV is mandatory for all invoices issued by Hungarian taxpayers — B2B,
  B2C, and export alike.
- For most invoices this is reporting only; NAV's "completeness indicator" flags the rarer case
  where the reported XML is itself the legal invoice.
- Water and energy utility suppliers must move to that legal-invoice mode from January 2026.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Hungary.

- `country-policy/data/hu.json` — which document actions Hungary allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/hu.json` — which national identifier a party must carry.
- `tax/tax-systems/data/hu.json` and `vat-rates/data/hu.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/hu.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/hu.json` — the channel and format a Hungarian public buyer requires.
- `transports/channel-policy/data/hu.json` — whether a channel is legally required of a seller
  established in Hungary, and from what date.
- `archive/retention/data/hu.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the NAV Online Számla API is a transmission channel this
repository does not implement, and its NAV XML v3.0 schema has no format provider. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Hungary supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Hungary, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Hungary".
