---
title: "NEN — Czech Republic e-invoicing"
description: "The Czech Republic's NEN public-procurement e-invoicing platform. Invoicerr does not support the Czech Republic today."
sidebar_label: "Czech Republic"
keywords: [NEN, Czech Republic e-invoicing, ISDOC, Czech invoice XML, Národní Elektronický Nástroj]
---

# NEN — Czech Republic e-invoicing

:::warning[Invoicerr does not support the Czech Republic]
No Czech Republic data file exists anywhere in this repository — no country policy, no identifiers,
no tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Czech Republic support knows what adding it would involve. The countries Invoicerr
does cover are listed in the [country directory](./index.md).
:::

The Czech Republic runs mandatory B2G e-invoicing through **NEN** (Národní Elektronický Nástroj),
the national public-procurement platform operated by the **Financial Administration** (Finanční
správa). Invoices submitted through NEN typically use **ISDOC**, the Czech national XML format. B2B
e-invoicing is voluntary, with no domestic clearance requirement.

## What supporting the Czech Republic would involve

| | |
|---|---|
| **System** | NEN — Národní Elektronický Nástroj, the Czech public-procurement e-invoicing platform |
| **Authority** | Financial Administration (Finanční správa) |
| **Format** | A national XML schema (ISDOC). No provider in `backend/src/modules/documents/formats/` builds it today. |
| **Transmission** | NEN (Národní Elektronický Nástroj). No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory since October 2016 for central bodies, and for all public
  entities since April 2019.
- ERS, the former real-time sales-reporting requirement, was abolished in January 2023.
- B2B e-invoicing is voluntary and post-audit, with no domestic clearance step.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for the Czech Republic.

- `country-policy/data/cz.json` — which document actions the Czech Republic allows. Start here:
  without this file every action is refused with a 403, naming the country.
- `country-identifiers/data/cz.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cz.json` and `vat-rates/data/cz.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cz.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cz.json` — the channel and format a Czech public buyer requires.
- `transports/channel-policy/data/cz.json` — whether a channel is legally required of a seller
  established in the Czech Republic, and from what date.
- `archive/retention/data/cz.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: NEN is a transmission channel this repository does not
implement, and the ISDOC schema has no format provider. Both are code, not a JSON file — see [When a
country needs more than a file](../adding-a-country.md).

## Want the Czech Republic supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for the Czech Republic, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add the Czech
Republic".
