---
title: "Cyprus e-invoicing"
description: "Cyprus's B2G e-invoicing runs through the Government Gateway and Peppol, and what adding Cyprus would involve. Invoicerr does not support Cyprus today."
sidebar_label: "Cyprus"
keywords: [Cyprus e-invoicing, Peppol Cyprus, Cyprus Government Gateway, Cyprus invoice XML]
---

# Cyprus e-invoicing

:::warning[Invoicerr does not support Cyprus]
No Cyprus data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Cyprus support knows what adding it would involve. The countries Invoicerr does cover are
listed in the [country directory](./index.md).
:::

Cyprus has required public bodies to receive e-invoices since 2019, under EU Directive 2014/55/EU.
Invoices reach the public sector through the **Cyprus Government Gateway**, run by the **Tax
Department**, using the **Peppol** network for delivery. B2B e-invoicing remains voluntary today.

## What supporting Cyprus would involve

| | |
|---|---|
| **System** | Cyprus Government Gateway — the central B2G e-invoicing platform, delivered via Peppol |
| **Authority** | Tax Department |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | The Cyprus Government Gateway, the central platform for B2G e-invoicing, reached over the Peppol network. No transport in `backend/src/modules/documents/transports/` talks to it today. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing has applied to central public bodies since April 2019, and to all public entities
  since April 2020.
- B2B e-invoicing is voluntary, expected to become mandatory under the EU ViDA proposal.
- No clearance step today — invoices are delivered directly, not pre-validated by the Tax
  Department.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Cyprus.

- `country-policy/data/cy.json` — which document actions Cyprus allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/cy.json` — which national identifier a party must carry.
- `tax/tax-systems/data/cy.json` and `vat-rates/data/cy.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/cy.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/cy.json` — the channel and format a Cypriot public buyer requires.
- `transports/channel-policy/data/cy.json` — whether a channel is legally required of a seller
  established in Cyprus, and from what date.
- `archive/retention/data/cy.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Cyprus Government Gateway is a transmission channel
this repository does not implement, which is code, not a JSON file — see [When a country needs more
than a file](../adding-a-country.md).

## Want Cyprus supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Cyprus, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Cyprus".
