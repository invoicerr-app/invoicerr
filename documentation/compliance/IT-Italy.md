---
region: Europe
status: mandatory
priority: high
formats:
  - FatturaPA
scope:
  - B2B
  - B2C
  - B2G
progress: in-progress
---
# 🇮🇹 Italy

**Authority:** Agenzia delle Entrate (AdE) · **Channel:** SdI (Sistema di Interscambio).

Italy's clearance system has required domestic e-invoicing since 2019. This app builds the national
**FatturaPA** XML and has a client built directly from SdI's published WSDL/XSD — but that client has
never exchanged a byte with the real service.

## The channel mandate is not yet promoted in this app's own data

This app's `channel-policy` catalog records the `sdi` channel as `requirement: "suggested"`, with
provenance `unverified`. Its own resolution note is explicit about why, given how well known the real
mandate is: the file has not yet been re-read against a primary legal text (D.Lgs. 127/2015 art. 1,
Provvedimento AdE prot. 433608/2022) with its own verification date recorded in this file — an
internal audit elsewhere in this repository already cites that article, but this catalog only
promotes a fact once a primary source has been read directly for the file itself, not borrowed from
an adjacent document. So: SdI is Italy's real, long-standing mandatory channel, but this app's own
record for it is still marked unverified, by design, until that direct reading happens.

## Never run against the real service

`transports/sdi/sdicoop.live.spec.ts` targets SdI's real `SdIRiceviFile.RiceviFile` endpoint but its
own header states plainly: **implemented-awaiting-accreditation** — no environment available to this
app holds a real Agenzia delle Entrate intermediary accreditation, so this spec has never been
executed against the true endpoint. The `SdiCoopClient` was built by reading the published
WSDL/XSD/instructions, not proven against them.

## Selling to a government, or any, client

The routing rule sends an Italian government client's invoice through **SdI**, in FatturaPA, and
requires the client's 6-character **Codice Univoco Ufficio** (from IndicePA) — sourced (`legal`) to
the Specifiche tecniche del formato FatturaPA v1.3.2, read directly 2026-09-01. The format builder
correctly emits `FormatoTrasmissione: FPA12` for a government recipient and `FPR12` for a private one
(the vendored XSD accepts both), and it validates against the official FatturaPA XSD rather than the
generic EN 16931 Schematron — a national schema, judged by its own rules.

## Tax

VAT, standard rate **22%** — sourced to the EU's Taxes in Europe Database (TEDB), situation date
2026-07-01. This app has no fuller Italian rate catalog (`vat-rates/`) yet, so reduced rates are not
modeled; an earlier, unsourced set of reduced rates was deliberately dropped rather than carried
forward under a provenance that never covered them.

## Identifiers

No `country-identifiers` file exists for Italy in this app today — no Italian-specific identifier
requirement (codice fiscale, partita IVA format, required/optional) is declared in this catalog.

## Correcting or cancelling an invoice

8 of the 11 correction routes are sourced to Italian law. A **credit note** is legally allowed, a
**debit note** and an **internal credit note** are legally **required** for the cases they cover, a
plain **corrective invoice is forbidden** (Italy fixes a mistake through a credit note or a new
document, never by editing/reissuing the original under the same act), and a ledger-only annotation
is allowed.

Cancelling an already-sent invoice and reissuing it is implementable in this app for Italy, but only
**after SdI has rejected it (scarto)** — once an invoice has actually reached the recipient, this app
will not cancel it. This matches the descriptor's own `send_failed` status: SdI's own rejection is
what that status represents here, and cancellation stays available only from it.

## Sources

`backend/src/modules/documents/country-policy/data/it.json`, `correction-routes/data/it.json`,
`correction-routes/cancel-policy.ts`, `b2g-routing/data/it.json`,
`transports/channel-policy/data/it.json`, `tax/tax-systems/data/it.json`, plus
`transports/sdi/sdicoop.live.spec.ts` and `formats/national/fatturapa-provider.ts` for the
accreditation and FPA12/FPR12 claims above.
