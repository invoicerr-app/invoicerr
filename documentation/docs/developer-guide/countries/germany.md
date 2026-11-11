---
title: "Germany e-invoicing in Invoicerr"
description: "Invoicerr ships Germany country data — policy, identifiers, tax, corrections, B2G routing and channel policy. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Germany (supported)"
keywords: [Germany e-invoicing, XRechnung, ZRE, OZG-RE]
---

# Germany e-invoicing in Invoicerr

:::tip[Invoicerr supports Germany]
Germany is one of five countries with data files in the per-country catalogues, so the application
runs for a company established there. Support is per mechanism, not a single yes or no.
:::

Germany's entries name ZRE and OZG-RE as the public-sector invoice receipt platforms, and XRechnung
as the format they carry.

This page is a pointer by design. Everything Invoicerr knows about Germany lives in its own data
files, and two pages already say it without anyone retyping it:

- [Germany in the country compliance matrix](../country-support/de.md) — every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance — Germany](/compliance/de) — the same coverage, written for someone deciding whether
  to use Invoicerr in Germany.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md): the catalogue files listed on every other page in this directory
are the ones Germany already has.

## Fallback payment term

The `paymentTerms.fallbackTerm` entry of `countries/data/de.json` is the 30 days an invoice's due
date falls back to when the company has no default term of its own (see [Payment
terms](../../user-guide/settings/payment-terms.md)). BGB § 286 Abs. 3 puts a debtor in default at
the latest 30 days after the due date and receipt of the invoice (`basis: "latePaymentThreshold"`).
It sets no payment term: without an agreed date a claim is due at once (BGB § 271 Abs. 1). The
application counts the 30 days from the invoice date, not from receipt of the invoice.

## Company-law mentions

The `companyLaw` section of `countries/data/de.json` prints, under the seller's name on invoices,
quotes, credit notes and purchase orders (Geschäftsbriefe and Bestellscheine):

| Legal forms | Printed | Source |
| --- | --- | --- |
| GmbH, UG (haftungsbeschränkt) | "GmbH, Registergericht: Amtsgericht München, HRB 12345", "Geschäftsführer: …" | § 35a Abs. 1 GmbHG, § 5a Abs. 1 GmbHG |
| GmbH, UG (haftungsbeschränkt) | "Vorsitzender des Aufsichtsrats: …", only when filled in | § 35a Abs. 1 GmbHG ("sofern die Gesellschaft einen Aufsichtsrat gebildet …") |
| AG | register line, "Vorstand: …", "Vorsitzender des Aufsichtsrats: …" | § 80 Abs. 1 AktG |
| e.K. | register line | § 37a Abs. 1 HGB, § 19 Abs. 1 Nr. 1 HGB |
| OHG, KG | register line | § 125 Abs. 1 HGB, § 177a HGB |
| Einzelunternehmen (not registered), other forms | nothing | § 37a HGB binds a registered Kaufmann |

The register number is the `LEGAL_ID` identifier (Handelsregisternummer), quoted by the template; the
Sitz is the company address. Capital is printed by no mention: § 35a and § 80 only ask for it when the
company states it. The texts speak of Geschäftsbriefe, not invoices; an invoice addressed to a client
is read as one, which this research did not settle against case law. Not modelled: the partners'
details of a KG with no natural person as partner (GmbH & Co. KG, § 125 Abs. 1 Satz 2 HGB),
liquidation, branches of foreign companies. All texts were read at gesetze-im-internet.de on
2026-10-25.

## Recapitulative statement codes

The `codeLists` section of `countries/data/de.json` carries `zmUmsatzart`, the three letters a
Zusammenfassende Meldung line puts in its `umsatzart` element: `D` (Dreiecksgeschäft, triangular
trade), `L` (innergemeinschaftliche Lieferung, intra-Community supply of goods) and `S` (sonstige
Leistung, intra-Community service). The list is read only through `code-lists/lookup.ts`; no
declaration builds a ZM line yet. Source: BZSt, Massendatenschnittstelle ELMA,
Fachverfahrensspezifische Schnittstellenbeschreibung (SSB) 1.0.2, 11.12.2025, section 2.7 Tabelle 7,
read on 2026-11-11.
