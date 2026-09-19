---
region: Europe
status: phased
priority: medium
formats:
  - EN 16931
  - XRechnung
scope:
  - B2B
  - B2G
progress: in-progress
---
# 🇩🇪 Germany

**Authority:** BMF / KoSIT (standards) · **Channel (B2G):** none implemented in this app — see below.

Germany has no general transmission-channel data in this app — no `channel-policy` file exists for a
German seller at all. Selling to a German government client is a real, established obligation, but
this app has no transport that satisfies it — see the next section for the honest, named refusal that
results, and what changed on 2026-09-15.

## No channel mandate — because German law imposes a FORMAT, never a channel

`transports/channel-policy/data/de.json` **exists and deliberately declares no fact** (2026-09-13).
That is a sourced conclusion, not a gap.

UStG § 14 Abs. 1 defines an *elektronische Rechnung* by its **format** — one issued, transmitted and
received in a structured electronic format allowing electronic processing — as against a *sonstige
Rechnung*. § 14 Abs. 2 Satz 2 Nr. 1 carries the domestic B2B obligation, again in terms of format
alone, and § 27 Abs. 38 phases it in: every business free until 2026-12-31, those with turnover at or
below 800 000 € (and EDI users) until 2027-12-31, full effect 2028-01-01. **No provision names a
platform**, at any stage. So there is no channel to mandate, and none was invented to look symmetrical
with France or Italy.

This is precisely why Germany's obligation is real and yet absent from this catalog: the catalog
answers "which delivery channel does the law force", and German law answers "none — but the document
must be structured". The format side is handled where it belongs, in the B2G routing rule below and
in the format providers.

## Selling to a government client (B2G) — a named refusal, not a working channel

- The routing rule requires **XRechnung** content, sourced (`legal`) to § 4 Abs. 1 and § 5 ERechV
  (the federal e-invoicing ordinance), and a **Leitweg-ID** (`buyerReference`) as a mandatory document
  field — § 5 ERechV: *"Die elektronische Rechnung hat neben den umsatzsteuerrechtlichen
  Rechnungsbestandteilen mindestens folgende Angaben zu enthalten: 1. eine
  Leitweg-Identifikationsnummer, [...]"*. That requirement is real and unchanged by anything below.
- The ordinance itself requires submission through a federal administrative portal (the merged
  ZRE/OZG-RE) with prior account registration — not a channel this app implements. Between
  2026-09-02 and 2026-09-15 this app briefly routed through its own **Peppol** transport (the merged
  portal accepts Peppol as one of its official submission channels since September 2025, per its own
  FAQ, e-rechnung-bund.de), configured to build and send real XRechnung content, and proved that
  round-trip live once against the peppol.sh sandbox.
- **That Peppol transport was removed from the product on 2026-09-15**: the generic Access Point
  client it relied on only ever spoke to `POST /api/v1/send`, a shape matching none of the real AP
  vendors this project had researched, and the sandbox proof never exercised a real commercial AP
  account. Rather than keep a channel that would fail the first real customer, the transport was
  deleted outright — see git history around that date for the removed implementation.
- **Current behavior**: the routing rule's `transportId` now names a channel this app does not
  implement (`zre-ozgre`, the pre-Peppol value). Attempting to send an invoice to a German government
  client is refused, by name, citing that channel and the ERechV requirement above — never a silent
  fallback to email or any other channel. Re-enabling this route needs either a real Peppol Access
  Point account with a working `send()`, or a dedicated ZRE/OZG-RE client.
- **Scope limit, stated by the rule's own data, unaffected by the above**: only the *federal* (Bund)
  ordinance was read. Each of Germany's 16 Länder has its own e-invoicing ordinance, potentially
  different, which this app has not verified.

## Tax

VAT, standard rate **19%** — sourced to the EU's Taxes in Europe Database (TEDB), situation date
2026-07-01. No fuller German rate catalog (`vat-rates/`) exists yet, so reduced rates are not
modeled.

## Identifiers

Both German identifier facts in this catalog are marked `unverified`, for two different reasons:

- **USt-IdNr.** (VAT number, `DE` + 9 digits) — §14/§14a UStG were read and confirm a business must
  give a Steuernummer *or* a USt-IdNr on an invoice (never a flat USt-IdNr requirement on its own),
  but the 9-digit pattern itself is not stated in either provision, and the issuing authority's own
  page returned HTTP 404 when checked. The whole fact stays unverified rather than being split.
- **Handelsregisternummer** (commercial register number) — § 37a HGB requires it on "Geschäftsbriefe"
  (business letters) addressed to a recipient, but never mentions "Rechnung" (invoice) by name, and
  only binds a registered merchant (Kaufmann), not every company. Whether an invoice counts as a
  Geschäftsbrief for this purpose was not settled by this app's own research.

## Correcting or cancelling an invoice

8 of the 11 correction routes are sourced to German law. A **credit note** and **cancel-and-replace**
are allowed; a **corrective invoice** and an **authority-side annulment** are required for the cases
they cover; an internal credit note is forbidden; skipping the document by law, and a counterparty
objection, are both allowed.

Cancelling an already-sent invoice and reissuing it is implementable in this app for Germany, with
**no restriction** — grounded two independent ways in the data (the cancel-and-replace text itself,
and Germany's own default correction route, which states no correction is required by law at all).

## Sources

`backend/src/modules/documents/country-policy/data/de.json`, `country-identifiers/data/de.json`,
`correction-routes/data/de.json`, `correction-routes/cancel-policy.ts`, `b2g-routing/data/de.json`
(whose own `notes` field carries the full, dated history of the Peppol wiring and removal above),
`tax/tax-systems/data/de.json`, `country-fields/data/de.json`, `vat-rates/data/de.json` for the rate
ladder, and
`archive/retention/data/de.json` for the two simultaneous eight-year retention obligations (UStG
§ 14b and AO § 147). `transports/channel-policy/data/de.json` exists but declares no fact, for the
sourced reason given above.
