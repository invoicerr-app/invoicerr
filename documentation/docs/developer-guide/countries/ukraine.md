---
title: "PROZORRO — Ukraine e-invoicing"
description: "Ukraine's PROZORRO public-procurement platform and its parallel tax-authority B2B system, and what adding Ukraine to Invoicerr would involve. Invoicerr does not support Ukraine today."
sidebar_label: "Ukraine"
keywords: [PROZORRO, Ukraine e-invoicing, DPS, Ukraine invoice XML]
---

# PROZORRO — Ukraine e-invoicing

:::warning[Invoicerr does not support Ukraine]
No Ukraine data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Ukraine support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Ukraine runs two parallel systems: **PROZORRO** for public procurement e-invoicing, and a separate
general Tax Authority system for B2B, both under the State Tax Service (DPS).

## What supporting Ukraine would involve

| | |
|---|---|
| **System** | PROZORRO (B2G) and a separate Tax Authority system (B2B) |
| **Authority** | State Tax Service (DPS) |
| **Format** | A national XML schema. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | PROZORRO / Tax Authority System. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- PROZORRO cited as mandatory for public procurement since 2016.
- B2B e-invoicing described as progressive, with requirements extended in 2023 and 2024.
- The two systems are described as running in parallel rather than as one unified platform.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Ukraine.

- `country-policy/data/ua.json` — which document actions Ukraine allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/ua.json` — which national identifier a party must carry.
- `tax/tax-systems/data/ua.json` and `vat-rates/data/ua.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/ua.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/ua.json` — the channel and format a Ukrainian public buyer requires.
- `transports/channel-policy/data/ua.json` — whether a channel is legally required of a seller
  established in Ukraine, and from what date.
- `archive/retention/data/ua.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: PROZORRO and the Tax Authority system are transmission
channels this repository does not implement, and neither's XML schema has a format provider. Both
are code, not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Ukraine supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Ukraine, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Ukraine".
