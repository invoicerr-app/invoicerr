---
title: "VeriFactu — Spain e-invoicing"
description: "Spain's VeriFactu anti-fraud invoicing system and the Basque TicketBAI regime, and what adding Spain would involve. Invoicerr does not support Spain today."
sidebar_label: "Spain"
keywords: [VeriFactu, TicketBAI, Spain e-invoicing, AEAT, Spain invoice XML]
---

# VeriFactu — Spain e-invoicing

:::warning[Invoicerr does not support Spain]
No Spain data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Spain support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Spain's core reform is **VeriFactu**, an anti-fraud invoicing-software standard run by **AEAT**
(Agencia Tributaria) that chains each invoice's record to the one before it with a cryptographic
hash. Businesses in the **Basque Country** follow a separate, longer-standing regime instead,
**TicketBAI**, under the local Haciendas Forales. Neither system is the EU's EN 16931/Peppol format
— both define their own national XML record.

## What supporting Spain would involve

| | |
|---|---|
| **System** | VeriFactu — Spain's anti-fraud invoicing-software system, with TicketBAI as a separate mandatory regime in the Basque Country |
| **Authority** | AEAT (Agencia Tributaria), plus the Basque Haciendas Forales for TicketBAI |
| **Format** | A national XML record format (VeriFactu), and a separate TicketBAI format in the Basque Country. No provider in `backend/src/modules/documents/formats/` builds either today. |
| **Transmission** | Submission to AEAT's VeriFactu service, or the separate Basque TicketBAI provincial services. No transport in `backend/src/modules/documents/transports/` talks to either today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- VeriFactu becomes mandatory for companies from January 2027, having been moved back from an
  earlier 2026 date.
- TicketBAI has applied in the Basque Country since 2022-2024, under separate provincial rules,
  and requires signing every record.
- In VeriFactu mode the record is sent to AEAT as it is issued; in non-VeriFactu mode the record
  is kept and signed locally instead.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Spain.

- `country-policy/data/es.json` — which document actions Spain allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/es.json` — which national identifier a party must carry.
- `tax/tax-systems/data/es.json` and `vat-rates/data/es.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/es.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/es.json` — the channel and format a Spanish public buyer requires.
- `transports/channel-policy/data/es.json` — whether a channel is legally required of a seller
  established in Spain, and from what date.
- `archive/retention/data/es.json` — how long an archived document is kept, and what the duration
  is counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: AEAT's VeriFactu service and the separate Basque TicketBAI
services are transmission channels this repository does not implement, and neither XML format has a
format provider. Both are code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Spain supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Spain, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Spain".
