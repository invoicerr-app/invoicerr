---
title: "EHF — Norway e-invoicing"
description: "Norway's EHF/Peppol e-invoicing standard, and what adding Norway to Invoicerr would involve. Invoicerr does not support Norway today."
sidebar_label: "Norway"
keywords: [EHF, Norway e-invoicing, ELMA, Peppol Norway, Norway invoice XML]
---

# EHF — Norway e-invoicing

:::warning[Invoicerr does not support Norway]
No Norway data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Norway support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Norway's e-invoicing standard, **EHF Billing 3.0**, is the local name for Peppol BIS Billing 3.0 —
technically identical to the EU standard. Suppliers look up a receiver's capability in **ELMA**, the
Norwegian Peppol directory, before sending over the Peppol network. DFØ (the Norwegian Agency for
Public and Financial Management) is the authority behind the public-sector mandate.

## What supporting Norway would involve

| | |
|---|---|
| **System** | EHF Billing 3.0 (Peppol BIS 3.0), looked up via the ELMA directory |
| **Authority** | DFØ — Norwegian Agency for Public and Financial Management |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory for all public-sector suppliers today.
- B2B e-invoicing remains voluntary but is described as the de facto standard.
- A legal mandate for all B2B transactions is cited as proposed for around 2028.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Norway.

- `country-policy/data/no.json` — which document actions Norway allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/no.json` — which national identifier a party must carry.
- `tax/tax-systems/data/no.json` and `vat-rates/data/no.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/no.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/no.json` — the channel and format a Norwegian public buyer requires.
- `transports/channel-policy/data/no.json` — whether a channel is legally required of a seller
  established in Norway, and from what date.
- `archive/retention/data/no.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Norway supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Norway, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Norway".
