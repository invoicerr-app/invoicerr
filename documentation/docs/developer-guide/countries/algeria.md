---
title: "Algeria e-invoicing in Invoicerr"
description: "Invoicerr ships Algeria country data: policy, identifiers, tax, corrections, retention and a domestic-currency rule. Which mechanisms are covered, read from the application's own files."
sidebar_label: "Algeria (supported)"
keywords: [Algeria e-invoicing, DZD, IFU, NIF, RC, NIS]
---

# Algeria e-invoicing in Invoicerr

:::tip[Invoicerr supports Algeria]
Algeria is one of the countries with data files in the per-country catalogues, so the application runs
for a company established there. Support is per mechanism, not a single yes or no: several mechanisms
below are honestly `unverified`, not sourced to a primary text.
:::

:::warning[A prior claim on this page was wrong]
This page used to describe a "DGI e-Invoice System": a clearance model with tax-authority
authorization and a mandatory digital signature: carried over from an earlier, never-checked research
pass. A dedicated research pass for issue #558 read seven finance laws (2022-2026), three consolidated
2026 tax codes (CPF, CIDTA, CTCA), the DGI's own official communique on the 2026 finance law, and the
DGI's own internal search engine, specifically for "facturation électronique" / "e-facture" /
"clearance" / "signature électronique" / "caisse enregistreuse": and found **no occurrence of any of
them tied to an obligation, in force or announced with a date.** That earlier claim is not confirmed by
any primary source this pass reached, and this page no longer repeats it. See
[`transports/channel-policy/data/dz.json`](https://github.com/invoicerr-app/invoicerr/blob/dev/backend/src/modules/documents/transports/channel-policy/data/dz.json)'s
own notes for the full method, and what would still be needed to call this a proof of absence rather
than a strong negative finding.
:::

## What is sourced ("legal" provenance)

- **VAT**: 19% standard rate and 9% reduced rate, both quoted verbatim from the Code des Taxes sur le
  Chiffre d'Affaires (CTCA) 2026, art. 21 and art. 23.
- **Numbering**: an invoice must belong to an uninterrupted, chronological series (a `facturier`, paper
  or dematerialized): a new booklet cannot be opened before the previous one is exhausted. Décret
  exécutif n° 05-468 du 10 décembre 2005, art. 10, read and quoted in full. This also settles that an
  issued invoice is never rewritten (only ever explicitly cancelled) and that a dematerialized invoice
  is legally regular.
- **Identifiers**: RC (Registre du Commerce) and NIS (Numéro d'Identification Statistique) are required
  for a business party (seller always, buyer when it is itself a business, never for a private, final
  consumer): decree 05-468, art. 3, read in full.
- **Retention**: 10 years from the document's own issue date. Code des Procédures Fiscales art. 64 and
  Code de commerce art. 12, both read directly.
- **Domestic currency**: a sale between an Algerian seller and an Algerian buyer must be invoiced in
  Algerian dinars (DZD): Banque d'Algérie règlement n° 07-01 du 3 février 2007, art. 5, quoted
  verbatim. Invoicerr preselects DZD when both parties are established in Algeria, and **blocks
  sending** such an invoice in any other currency, naming the rule. Export invoicing in a foreign
  currency stays allowed.

## What is `unverified` (contributor practice, not a legal text)

The issue's native contributor (GitHub user athmanemokraoui) answered six practice questions on
2026-09-30. Where decree 05-468 is silent and only the contributor's answer supports a fact, it is
marked `unverified` rather than `legal`, per this repository's own provenance discipline:

- **NIF (Numéro d'Identification Fiscale)** and **AI (Article d'Imposition)**: not named anywhere in
  decree 05-468's own list of mandatory invoice mentions (a full reading, not an oversight), but shown
  in practice per the contributor.
- **Correction routes**: decree 05-468 defines exactly one correction mechanism: an issuer-written
  "facture annulée" mention, diagonal, on the original document: and is otherwise silent. All eleven
  canonical correction routes this catalogue covers are honestly `unverified` for Algeria; the
  contributor was unsure whether a credit note exists in practice ("I'm not sure but in practice yes,
  there should be a credit note").
- **The IFU regime is common**: the contributor described Algeria's IFU (Impôt Forfaitaire Unique, a
  flat-tax regime) as "the most used for freelancers and small businesses": practice, not itself a
  legal citation, though the regime's own existence and its ban on invoicing VAT are sourced to CIDTA
  and CTCA (see below).

## A genuine schema gap: the IFU regime

Algeria's IFU replaces VAT, personal income tax (IRG) and a local tax (TLS) with one flat levy for a
qualifying small business (CIDTA art. 282bis/282ter, threshold 8,000,000 DA annual turnover), and
forbids stating VAT on an invoice at all (CTCA art. 64). This catalogue's `tax-systems` schema has a
closed `schemes` vocabulary (`STANDARD` / `FRANCHISE_BASE` / `EXEMPT`), none of which represents a
regime that **replaces** VAT with a different, combined tax rather than merely exempting or reducing
it. Algeria's own tax-systems file stays at `schemes: ["STANDARD"]`, the ordinary VAT regime; an IFU
seller can be represented today with this product's existing company-level "VAT exempt" toggle to get
the correct invoice OUTPUT (no VAT line), which is a practical approximation, not a claim that IFU
legally is a franchise-en-base. A faithful model of IFU (its own 5%/12%/0.5% rate, its minimum
forfaitaire, its replacement of two further taxes) has no slot in the current schema: a decision for
whoever owns the tax-systems format next, not something this data-only change invents a slot for.

## Known gaps, left out of this change on purpose

- **Invoice language**: no catalogue in this product encodes the language a law requires an invoice to
  be written in, for any country. Algeria's loi n° 91-05 (Arabic-language law) never names "facture",
  and the closest provision ("gestion financière" in Arabic, art. 4) is a broad reading, not a direct
  hit; the contributor noted French, Arabic, Kabyle and even English invoices are all issued in
  practice today, with no enforcement in either direction observed. Left out entirely: a genuine
  product gap, not an Algeria-specific one.
- **The "bon de transaction commerciale"** (décret 16-66, agriculture/fishing/crafts): the contributor
  said this can be left for a later pass. Not modeled.
- **Arabic / right-to-left layout**: tracked separately as issue #559, a frontend concern, not a
  compliance-data one.

## Where this lives

- [Algeria in the country compliance matrix](../country-support/dz.md): every mechanism, and the
  catalogue each answer comes from, regenerated from those files on every docs build.
- [Compliance - Algeria](/compliance/dz): the same coverage, written for someone deciding whether to
  use Invoicerr in Algeria.

To widen that coverage, or to add a country of your own, see [Adding a
country](../adding-a-country.md).
