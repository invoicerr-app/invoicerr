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

Portugal has no dedicated e-invoicing channel or format in this app, and one specific legal
requirement — the ATCUD code and the fiscal QR code — is **mandatory on every Portuguese invoice and
is not implemented**. Read this page before invoicing in Portugal.

## ATCUD and the QR code are missing

Since 2021, Portaria n.º 195/2020 requires every invoice to carry an **ATCUD** (a validation code
obtained by pre-registering a numbering series with the AT, concatenated with the document's
sequence number) and a **fiscal QR code** — art. 4.º n.º 1: *"O ATCUD, com o formato
«ATCUD:CodigodeValidação-NumeroSequencial», deve constar obrigatoriamente em todas as faturas e
outros documentos fiscalmente relevantes."*

This app does not compute either. The only occurrence of ATCUD in the codebase is a hardcoded
placeholder in `reporting/providers/pt-declaration-provider.ts`:

```ts
// "deve ser preenchido com «0» (zero) até à sua regulamentação" (field 1.6.2) — quoted verbatim
// from the manual; this bridge does not compute a real ATCUD.
'doc:ATCUD': '0',
```

That placeholder is the AT's own documented value for "not yet regulated for this sender" — this app
uses it because it has no real series registration or ATCUD generator, not because Portuguese law
makes ATCUD optional. **An invoice issued today through this app for a Portuguese company is missing
a legally required element.**

Two further pieces of the same regime are also not implemented: the **certified-software** status
required once turnover exceeds €50,000 and organized accounting applies (Decreto-Lei n.º 28/2019
art. 4.º) — this app is not AT-certified — and the **chained RSA signature** every certified program
must print as a 4-character hash on each document, each one cryptographically tied to the previous
document in its series (Portaria n.º 363/2010 art. 6.º).

## No transmission channel, no B2G

- No `channel-policy` file exists for Portugal — this app records no transmission-channel mandate or
  suggestion for a Portuguese seller.
- No `b2g-routing` file exists either — selling to a Portuguese government client (which requires
  CIUS-PT) is not implemented. This app's own country-policy notes record why: CIUS-PT could not be
  vendored, the third-party portals that carry it vary, and no Peppol coverage was found for Portugal
  on the European Commission's own eInvoicing factsheet.
- No Portugal-specific invoice format exists in this app either — a Portuguese invoice is built with
  the same generic engine every unmodeled country uses, not a CIUS-PT profile.

## Monthly reporting is built but unproven

A provider (`reporting/providers/pt-declaration-provider.ts`) implements the AT's real-time
e-invoice-communication webservice contract — one of three ways Decreto-Lei n.º 198/2012 art. 3.º
lets a business meet its monthly reporting obligation (the other two, a SAF-T (PT) file or direct
portal entry, are not built here). It has **never been run against the real AT service**: this
checkout holds no AT "subutilizador" identifier or public key, and because it feeds the same
un-computed ATCUD placeholder described above, even a successful call would be reporting invoices
that are not themselves fully compliant.

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

Only 3 of the 11 correction routes are sourced to Portuguese law: a **credit note** and a
**corrective invoice** are allowed, a **debit note** is required for the cases it covers. A
ledger-only annotation is also allowed. The other seven routes, including cancel-and-replace, are
unverified — and because `CANCEL_AND_REPLACE` has no confirmed status, **cancelling an issued invoice
locally is not implementable in this app for Portugal today**; an attempt is refused by name.

## Sources

`backend/src/modules/documents/country-policy/data/pt.json`, `country-identifiers/data/pt.json`,
`correction-routes/data/pt.json`, `correction-routes/cancel-policy.ts`,
`tax/tax-systems/data/pt.json`, `vat-rates/data/pt.json`, `reporting/data/pt.json`, plus
`reporting/providers/pt-declaration-provider.ts` for the ATCUD placeholder quoted above. No
`transports/channel-policy/data/pt.json` or `b2g-routing/data/pt.json` file exists.
