---
title: "NF-e — Brazil e-invoicing"
description: "Brazil's NF-e/SEFAZ e-invoicing system and what adding Brazil to Invoicerr would involve. Invoicerr does not support Brazil today."
sidebar_label: "Brazil"
keywords: [NF-e, SEFAZ, NFS-e, Brazil e-invoicing, e-invoicing Brazil]
---

# NF-e — Brazil e-invoicing

:::warning[Invoicerr does not support Brazil]
No Brazil data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Brazil support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Brazil's e-invoicing runs through several parallel documents rather than one: NF-e (Nota Fiscal
Eletrônica) for goods, NFS-e for services, NFC-e for retail, NFCom for telecoms, and CT-e for
freight, each cleared by SEFAZ before delivery. SEFAZ is run at state level and coordinated
nationally through CONFAZ, and NFS-e is layered on top of thousands of municipal authorities.

## What supporting Brazil would involve

| | |
|---|---|
| **System** | NF-e / NFS-e / NFC-e / NFCom / CT-e — Brazil's family of electronic tax documents |
| **Authority** | SEFAZ (Secretaria da Fazenda), coordinated nationally by CONFAZ; NFS-e also involves municipal authorities |
| **Format** | A national XML schema — separate NF-e, NFS-e, NFC-e, NFCom and CT-e schemas. No provider in `backend/src/modules/documents/formats/` builds any of them today. |
| **Transmission** | Submission to state SEFAZ web services (plus municipal endpoints for NFS-e). No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- Clearance model: each document type is validated and authorized by SEFAZ before it can be
  delivered.
- NFS-e is being unified into a single national system, alongside NFCom for telecoms.
- Digital certificate (ICP-Brasil A1 or A3) required for signing.
- Archive retention noted at 11 years.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Brazil.

- `country-policy/data/br.json` — which document actions Brazil allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/br.json` — which national identifier a party must carry.
- `tax/tax-systems/data/br.json` and `vat-rates/data/br.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/br.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/br.json` — the channel and format a Brazilian public buyer requires.
- `transports/channel-policy/data/br.json` — whether a channel is legally required of a seller
  established in Brazil, and from what date.
- `archive/retention/data/br.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the SEFAZ web services are a transmission channel this
repository does not implement, and Brazil's XML schemas have no format provider. Both are code, not
a JSON file — see [When a country needs more than a file](../adding-a-country.md).

## Want Brazil supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Brazil, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Brazil".
