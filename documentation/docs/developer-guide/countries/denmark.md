---
title: "Denmark e-invoicing"
description: "Denmark's NemHandel e-invoicing infrastructure for B2G and B2B, and what adding Denmark would involve. Invoicerr does not support Denmark today."
sidebar_label: "Denmark"
keywords: [Denmark e-invoicing, NemHandel, OIOUBL, Peppol Denmark, Denmark invoice XML]
---

# Denmark e-invoicing

:::warning[Invoicerr does not support Denmark]
No Denmark data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Denmark support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Denmark has required B2G e-invoicing since 2005, among the earliest mandates in Europe, delivered
through **NemHandel**, the national e-invoicing infrastructure run by the **Danish Business
Authority** (Erhvervsstyrelsen). NemHandel is built on **Peppol** and carries **OIOUBL**, Denmark's
own UBL profile, alongside plain Peppol BIS. The 2022 Bookkeeping Act is extending digital
record-keeping and e-invoice acceptance into the B2B space.

## What supporting Denmark would involve

| | |
|---|---|
| **System** | NemHandel — Denmark's national e-invoicing infrastructure, built on Peppol |
| **Authority** | Danish Business Authority (Erhvervsstyrelsen) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | NemHandel, Denmark's national e-invoicing infrastructure. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has been mandatory since 2005, extended to all public entities by 2019.
- The Bookkeeping Act 2022 is phasing in mandatory digital bookkeeping and e-invoice-receiving
  capability for businesses of every size.
- A full domestic B2B e-invoicing mandate is expected by 2027-2028, not yet in force.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Denmark.

- `country-policy/data/dk.json` — which document actions Denmark allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/dk.json` — which national identifier a party must carry.
- `tax/tax-systems/data/dk.json` and `vat-rates/data/dk.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/dk.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/dk.json` — the channel and format a Danish public buyer requires.
- `transports/channel-policy/data/dk.json` — whether a channel is legally required of a seller
  established in Denmark, and from what date.
- `archive/retention/data/dk.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: NemHandel is a transmission channel this repository does
not implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Denmark supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Denmark, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Denmark".
