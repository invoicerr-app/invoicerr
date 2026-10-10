---
title: "SABIS — Lithuania e-invoicing"
description: "Lithuania's SABIS e-invoicing platform, and what adding Lithuania to Invoicerr would involve. Invoicerr does not support Lithuania today."
sidebar_label: "Lithuania"
keywords: [SABIS, Lithuania e-invoicing, eSąskaita, Lithuania invoice XML]
---

# SABIS — Lithuania e-invoicing

:::warning[Invoicerr does not support Lithuania]
No Lithuania data file exists anywhere in this repository — no country policy, no identifiers, no
tax system, no transmission channel. **Nothing on this page is implemented.** It is here so that
someone who wants Lithuania support knows what adding it would involve. The countries Invoicerr does
cover are listed in the [country directory](./index.md).
:::

Lithuania's e-invoicing runs through **SABIS**, the platform operated by the National Centre for
Common Functions (NBFC), which replaced the earlier eSąskaita system. The State Tax Inspectorate
(VMI) is the tax authority behind the mandate.

## What supporting Lithuania would involve

| | |
|---|---|
| **System** | SABIS, operated by the National Centre for Common Functions (NBFC) |
| **Authority** | State Tax Inspectorate (VMI) |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | SABIS. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing became mandatory in September 2024, migrating from the earlier eSąskaita platform.
- B2B e-invoicing remains voluntary.
- Archive retention cited at 10 years via SABIS.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each section has to satisfy; this is only the shopping list of sections Lithuania would need in
`countries/data/lt.json`.

- `policy` - which document actions Lithuania allows. Start here: without this
  section every action is refused with a 403, naming the country.
- `identifiers` - which national identifier a party must carry.
- `taxSystem` and `vatRates` - the tax kind, and the rate ladder
  offered on an invoice line.
- `correctionRoutes` - all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2gRouting` - the channel and format a Lithuanian public buyer requires.
- `channelPolicy` - whether a channel is legally required of a seller
  established in Lithuania, and from what date.
- `retention` - how long an archived document is kept, and what the duration is
  counted from.

Add `mentions`, `contentRequirements`, `countryFields`, `reporting` and
`domesticReverseCharge` sections only where the law actually gives them content.

Data alone will not finish the job here: SABIS is a transmission channel this repository does not
implement, which is code, not a JSON file — see [When a country needs more than a
file](../adding-a-country.md).

## Want Lithuania supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Lithuania, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Lithuania".
