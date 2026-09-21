---
title: "DGID — Senegal e-invoicing"
description: "Senegal's planned DGID e-invoicing system, and what adding Senegal to Invoicerr would involve. Invoicerr does not support Senegal today."
sidebar_label: "Senegal"
keywords: [DGID, Senegal e-invoicing, Senegal invoice XML]
---

# DGID — Senegal e-invoicing

:::warning[Invoicerr does not support Senegal]
No Senegal data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Senegal support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Senegal's e-invoicing is administered by the **DGID**, the Direction Générale des Impôts et des
Domaines. Electronic invoicing is currently permitted on a voluntary basis, and the DGID is
preparing a centralized platform to make it mandatory for all commercial transactions.

## What supporting Senegal would involve

| | |
|---|---|
| **System** | Centralized e-invoicing platform (under development) |
| **Authority** | DGID — Direction Générale des Impôts et des Domaines |
| **Format** | A national format, not yet fixed in draft legislation. No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | Submission to DGID's planned centralized platform. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Electronic invoicing has been permitted on a voluntary basis since 2008.
- Mandatory e-invoicing for all businesses is expected from 2025, under a Finance Bill reform.
- No specific format is fixed in draft legislation; the regional trend points toward EN 16931 or a
  national standard.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Senegal.

- `country-policy/data/sn.json` — which document actions Senegal allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/sn.json` — which national identifier a party must carry.
- `tax/tax-systems/data/sn.json` and `vat-rates/data/sn.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/sn.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/sn.json` — the channel and format a Senegalese public buyer requires.
- `transports/channel-policy/data/sn.json` — whether a channel is legally required of a seller
  established in Senegal, and from what date.
- `archive/retention/data/sn.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: DGID's planned centralized platform is a transmission
channel this repository does not implement, and its format has not been fixed either. Both are code,
not a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Senegal supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Senegal, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Senegal".
