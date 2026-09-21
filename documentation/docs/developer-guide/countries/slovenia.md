---
title: "e-Slog — Slovenia e-invoicing"
description: "Slovenia's e-Slog standard over the Peppol network, and what adding Slovenia to Invoicerr would involve. Invoicerr does not support Slovenia today."
sidebar_label: "Slovenia"
keywords: [e-Slog, Slovenia e-invoicing, Peppol Slovenia, GZS, Slovenia invoice XML]
---

# e-Slog — Slovenia e-invoicing

:::warning[Invoicerr does not support Slovenia]
No Slovenia data file exists anywhere in this repository — no country policy, no identifiers, no tax
system, no transmission channel. **Nothing on this page is implemented.** It is here so that someone
who wants Slovenia support knows what adding it would involve. The countries Invoicerr does cover
are listed in the [country directory](./index.md).
:::

Slovenia's national e-invoicing standard is **e-Slog**, certified by the GZS (Chamber of Commerce)
and accepted alongside Peppol BIS Billing 3.0. The Financial Administration (Finančna uprava) is the
tax authority behind the B2G mandate.

## What supporting Slovenia would involve

| | |
|---|---|
| **System** | e-Slog, delivered over the Peppol network |
| **Authority** | Finančna uprava — Financial Administration |
| **Format** | EN 16931 (Peppol BIS). This repository already builds and validates it (`formats/peppol-bis-provider.ts`, `formats/ubl-provider.ts`), so the format would not have to be written from scratch. |
| **Transmission** | Peppol Access Point. The Peppol transport was removed from this repository on 2026-09-15 for want of a real Access Point account, so one would have to be built. |

:::note[Inherited, unverified]
Carried over from an earlier research pass in this repository's own history, and never checked
against a primary source. Leads, not facts — confirm every line before writing it into a data file.

- B2G e-invoicing cited as mandatory since 2015.
- B2B e-invoicing remains voluntary.
- Software used to produce e-Slog invoices is cited as requiring GZS certification.
:::

## Which catalogues a contributor would add

Adding a country is data, not code. [Adding a country](../adding-a-country.md) is the procedure and
the contract each file has to satisfy; this is only the shopping list for Slovenia.

- `country-policy/data/si.json` — which document actions Slovenia allows. Start here: without this
  file every action is refused with a 403, naming the country.
- `country-identifiers/data/si.json` — which national identifier a party must carry.
- `tax/tax-systems/data/si.json` and `vat-rates/data/si.json` — the tax kind, and the rate ladder
  offered on an invoice line.
- `correction-routes/data/si.json` — all eleven canonical correction routes, `unverified` where
  unresearched, never omitted.
- `b2g-routing/data/si.json` — the channel and format a Slovenian public buyer requires.
- `transports/channel-policy/data/si.json` — whether a channel is legally required of a seller
  established in Slovenia, and from what date.
- `archive/retention/data/si.json` — how long an archived document is kept, and what the duration is
  counted from.

Add `mentions/`, `content-requirements/`, `country-fields/`, `reporting/` and
`domestic-reverse-charge/` only where the law actually gives them content.

Data alone will not finish the job here: the Peppol network is a transmission channel this
repository does not implement, which is code, not a JSON file — see [When a country needs more than
a file](../adding-a-country.md).

## Want Slovenia supported?

Check the [open compliance
issues](https://github.com/invoicerr-app/invoicerr/issues?q=is%3Aissue+label%3Acompliance) first. If
there is no issue for Slovenia, [open
one](https://github.com/invoicerr-app/invoicerr/issues/new/choose) and name which of the files above
you need — a request that names one mechanism is far more actionable than "please add Slovenia".
