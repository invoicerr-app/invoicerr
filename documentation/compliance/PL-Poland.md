---
region: Europe
status: phased
priority: high
formats:
  - FA(3)
scope:
  - B2B
  - B2G
progress: in-progress
---
# 🇵🇱 Poland

**Authority:** Ministry of Finance (KAS) · **Channel:** KSeF (Krajowy System e-Faktur).

KSeF is Poland's national clearance system, and this app builds and validates the national **FA(3)**
XML format against the official schema and submits it through a dedicated KSeF client. What follows
is an honest account of how confident this app's own data is about the mandate, and how recently the
channel was actually watched clearing a real invoice.

## The channel mandate is not yet promoted in this app's own data

This app's `channel-policy` catalog records the `ksef` channel as `requirement: "suggested"`, with
provenance `unverified` — its own resolution note explains why: it has not yet been sourced to a
primary legal text read with its own verification date, the same discipline that let France's PDP
entry be promoted to `mandated`. That note also records, honestly, what a public European Commission
factsheet and Poland's own KSeF portal say about the real rollout: mandatory emission for large
enterprises from **2026-02-01**, for all VAT-registered businesses from **2026-04-01**, with a
transitional exemption ending **2026-12-31** and full compliance from **2027-01-01**. Those dates are
not asserted here as this app's own verified fact — they are what its data notes cite as the
open question a proper reading of the law would settle.

## Proven once, not re-verified since the engine refactor

- `transports/ksef/ksef.live.spec.ts` is a real round-trip against `ksef-test.mf.gov.pl` that, when
  it last ran, reached `CLEARED` with a genuine `ksefNumber` — the fullest live proof any channel in
  this app has produced (it polls all the way to clearance, not just an accepted upload).
- `KSEF_AUTH_TOKEN`/`KSEF_NIP` **do** exist as CI secrets today (confirmed by name, not value). The
  same secrets authenticated successfully against `ksef-test.mf.gov.pl` as recently as 2026-07-14 (a
  CI run of the pre-refactor spec: real submission, a semantic `REJECTED` — code 450 — not an auth
  failure). No live run has exercised the current, post-refactor spec, and no CI run of
  `compliance-live.yml` has happened since the 2026-08-29 engine refactor — so whether the same
  credentials are still valid today is unverified, not proven expired. Until the spec is re-run, this
  app cannot claim the KSeF channel is working today — only that it worked once, against a test
  environment, with credentials that have not been re-tried since.

## Selling to a government client (B2G)

The routing rule sends a Polish government client's invoice through **KSeF**, in FA(3), and requires
the client's **NIP** on file — sourced (`legal`) to the European Commission's eInvoicing country
factsheet for Poland and the KSeF portal's own page for local government units (both read
2026-09-02). This is the same KSeF channel and format as ordinary B2B, so it carries the same
credentials caveat above.

## Tax

VAT, standard rate **23%** — sourced to the EU's Taxes in Europe Database (TEDB), situation date
2026-07-01. This app has no fuller Polish rate catalog (`vat-rates/`) yet, so no reduced rates are
modeled — only this standard rate is available when composing cross-border tax.

## Identifiers

`country-identifiers/data/pl.json` declares one scheme: **LEGAL_ID** (the NIP), sourced `legal`, with
`required: false`.

As for Italy, the `required: false` is a limit of the catalog rather than of the law. This catalog's
only axis is the PARTY TYPE (company/individual), not the ROLE, and one declaration feeds both the
seller screens and the client screen; `required: true` is a hard save-block on all of them, so it
would also refuse a lawful Polish CLIENT record in the cases where the buyer's identifier is not
required. The fact's own `notes` carries the real position.

## Correcting or cancelling an invoice

Poland is the most restrictive of the five countries on how a mistake gets fixed: a **credit note**,
a **debit note** and an **internal credit note** are all legally **forbidden** as ways to fix an
issued invoice; a **corrective invoice** and **cancel-and-replace** are, by contrast, legally
**required** for the situations they cover; an authority-side annulment is forbidden; resubmitting
under the same identity is allowed. All of this is sourced (`legal`); the remaining four routes are
unverified.

Even though the law requires `CANCEL_AND_REPLACE`, cancelling an invoice **locally, in this app, is
not implementable for Poland today** — that legal route is realized in practice through a corrective
invoice, a different mechanism this app has not wired as a status flip on the original record. A
cancellation attempt is refused, by name, rather than silently allowed or silently downgraded.

## Sources

`backend/src/modules/documents/country-policy/data/pl.json`, `correction-routes/data/pl.json`,
`correction-routes/cancel-policy.ts`, `b2g-routing/data/pl.json`,
`transports/channel-policy/data/pl.json`, `tax/tax-systems/data/pl.json`,
`country-identifiers/data/pl.json`, `vat-rates/data/pl.json`, plus
`archive/retention/data/pl.json` — five years, counted not from the invoice date but from the end of
the calendar year the tax fell due in (ustawa o VAT art. 112 pointing at Ordynacja podatkowa art. 70
§ 1) — and `transports/ksef/ksef.live.spec.ts` for the live-proof claim above.
