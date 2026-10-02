---
region: Europe
status: mandatory
priority: medium
formats: []
scope:
  - B2B
  - B2C
progress: next
---
# 🇵🇹 Portugal

**Authority:** AT (Autoridade Tributária e Aduaneira).

Portugal has no dedicated e-invoicing channel or format in this app. Of the ATCUD regime's several
requirements, the **ATCUD code itself is now generated and declared**; the **fiscal QR code** is
still not implemented. Read this page before invoicing in Portugal.

## ATCUD is declared; the fiscal QR code is still missing

Since 2021, Portaria n.º 195/2020 requires every invoice to carry an **ATCUD** (a validation code
obtained by pre-registering a numbering series with the AT, concatenated with the document's
sequence number) and a **fiscal QR code** — art. 4.º n.º 1: *"O ATCUD, com o formato
«ATCUD:CodigodeValidação-NumeroSequencial», deve constar obrigatoriamente em todas as faturas e
outros documentos fiscalmente relevantes."*

A company registers its own validation code per numbering series in its settings (invoice and credit
note series are registered separately), and this app stamps the resulting ATCUD, with the `ATCUD:`
prefix stripped, onto the declaration it sends to the AT (`ptAtAtcudFor`,
`reporting/providers/pt-declaration-provider.ts`). A document with no
ATCUD registered for its series (null, blank, or the pre-regulation `"0"` placeholder the AT's own
manual still names for an unregistered sender) is refused before the declaration is even sent,
journaled as failed with the reason, rather than declared with a value that is not really its own.

**Still not implemented**: the **fiscal QR code** printed on the document itself (a separate
requirement from the ATCUD declaration above), the **certified-software** status required once
turnover exceeds €50,000 and organized accounting applies (Decreto-Lei n.º 28/2019 art. 4.º; this
app is not AT-certified), and the **chained RSA signature** every certified program must print as a
4-character hash on each document, each one cryptographically tied to the previous document in its
series (Portaria n.º 363/2010 art. 6.º).

## No transmission channel for a B2B seller

- `countries/data/pt.json` **exists and deliberately declares no fact** (2026-09-13).
  That is a sourced conclusion, not a gap: Decreto-Lei n.º 28/2019 art. 12.º n.º 1 makes electronic
  transmission itself optional and consent-based, *"As faturas e demais documentos fiscalmente
  relevantes podem, mediante aceitação pelo destinatário, ser emitidos por via eletrónica"*, the verb
  being *podem* (may), not *devem* (must). Portuguese law names no platform, unlike France's PDP or
  Italy's SdI, so nothing here constrains which channel a Portuguese seller uses for an ordinary B2B
  invoice. The file's own notes carry the retrieval and the quotations.
- What Portuguese law *does* impose at this level is a **certified invoicing software** obligation
  above a turnover threshold (same decree, art. 4.º), a fact about the software, not about the
  transport, and one this app does not satisfy today (it is not AT-certified). The two must not be
  conflated.

## Selling to a government client (B2G): a named, sourced, unwired channel

`countries/data/pt.json` **does exist** and names a real channel: `transportId: "fe-ap"`,
`formatSyntax: "ubl"`, sourced to Portaria n.º 289/2019, de 5 de setembro (regulating CCP art.
299.º-B n.º 5's own delegation), read directly from its original Diário da República publication.
The portaria delegates the platform to ESPAP, I. P. (the state's own shared-services agency), whose
site names it **FE-AP** ("Portal da Fatura Eletrónica na Administração Pública", also branded
"B2AP"), and delegates the format to ESPAP's own technical instructions, which name **UBL 2.1** as
the only complete syntax representation of the Portuguese CIUS ("CIUS-PT") today, the UN/CEFACT
(CII) one being explicitly "em construção" (under construction) as read.

Two things keep this from being a working channel today:

- **`fe-ap` is not a transport this app talks to.** `transports/transport-registry.ts` has no `fe-ap`
  entry, deliberately, the same choice this catalog already makes for Germany's `zre-ozgre`: sending
  an invoice to a Portuguese government client is refused, naming the missing channel, rather than
  silently falling back to email or a different country's channel.
- **No CIUS-PT-specific Schematron is vendored.** The generic UBL provider this rule resolves to
  (`formats/ubl-provider.ts`) validates against the EN 16931 baseline only; ESPAP's own site
  publishes a CIUS-PT-specific Schematron this app does not carry under `formats/vendored/`, so a
  document built this way is EN 16931-valid but not independently checked against CIUS-PT's own
  extra business rules.

No required client identifier or invoice field is named in the portaria's own text (unlike France's
SIRET or Italy's Codice Univoco Ufficio), so none is declared here either.

## Monthly reporting: invoices and credit notes, built but unproven against the real AT

A provider (`reporting/providers/pt-declaration-provider.ts`) implements the AT's real-time
e-invoice-communication webservice contract — one of three ways Decreto-Lei n.º 198/2012 art. 3.º
lets a business meet its monthly reporting obligation (the other two, a SAF-T (PT) file or direct
portal entry, are not built here). A credit note is declared too, as `InvoiceType` `NC`, carrying
the corrected invoice's own number as `Reference` and `DebitCreditIndicator` `D`, sourced to the
e-Fatura webservice manual's "Aspetos Específicos" (fields 1.6.4, 1.6.14.3, 1.6.14.4) and to
Decreto-Lei n.º 198/2012 art. 1.º n.º 2 / art. 3.º n.º 4, which extend the same communication duty
to a corrective document. A credit note that corrects no invoice, or whose invoice has no number of
its own, is never declared: the app has no buyer or reference to invent for it.

This has **never been run against the real AT service**: this checkout holds no AT "subutilizador"
identifier or public key, so everything above is proven only against a local fake AT server built
for the app's own end-to-end tests. Two things are open, specifically because no real AT round trip
or worked example exists to settle them: whether a credit note's totals should be sent positive
(as this app does, relying on `DebitCreditIndicator` alone to carry the sign) or negative, and
what a real AT makes of a genuine ATCUD and an `NC` declaration once one is actually sent.

## Tax

VAT, three continental rates, all sourced to the Código do IVA (CIVA) as served by the AT, read
directly 2026-09-04:

| Rate | Category | Article |
| --- | --- | --- |
| 23% | Standard | art. 18.º n.º 1, c) |
| 13% | Reduced | art. 18.º n.º 1, b) |
| 6% | Super-reduced | art. 18.º n.º 1, a) |

These are the rates for mainland Portugal only. Madeira and the Azores set their own regional rates
under a delegation in CIVA art. 18.º n.º 3 (a 2026-09-04 check of the EU's TEDB found regional
standard rates of 22% for Madeira and 16% for the Azores) — neither region's own reduced rates are
modeled here.

## Identifiers

- **NIF / NIPC**, required on the seller unconditionally (CIVA art. 36.º n.º 5, a)) and required on
  the buyer only when the buyer is itself VAT-registered, or on request otherwise (n.º 16 of the same
  article). No digit-count pattern is declared — the founding decree for the NIF format
  (Decreto-Lei n.º 463/79) could not be reached in primary text.
- **VAT number**, not required below the €15,000/year exemption threshold (CIVA art. 53.º n.º 1). Its
  usual equivalence to the NIF/NIPC prefixed "PT" is a common convention, not one this catalog found
  stated in the law itself.

## Correcting or cancelling an invoice

Only 4 of the 11 correction routes are sourced to Portuguese law: a **credit note** and a
**corrective invoice** are allowed, a **debit note** is required for the cases it covers. A
ledger-only annotation is also allowed. The other seven routes, including cancel-and-replace, are
unverified — and because `CANCEL_AND_REPLACE` has no confirmed status, **cancelling an issued invoice
locally is not implementable in this app for Portugal today**; an attempt is refused by name.

## Sources

`backend/src/modules/documents/countries/data/pt.json` (one file, all of this country's own
sections: action policy; identifiers; correction routes; the tax system; the VAT rate ladder;
reporting, the credit-note communication duty, `appliesTo: "credit-note"`; archive retention, the
ten-year retention, CIVA art. 52.º n.º 1; channel policy, which exists but declares no fact, for
the sourced reason given above; and B2G routing, which exists and names `fe-ap`/UBL 2.1, for the
sourced reason given above, not backed by a transport in `transports/transport-registry.ts`
today), plus `correction-routes/cancel-policy.ts` and
`reporting/providers/pt-declaration-provider.ts` for the ATCUD and NC declaration mapping quoted
above.
