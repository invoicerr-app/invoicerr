---
region: Europe
status: mandatory
priority: high
formats:
  - EN 16931
  - Factur-X
scope:
  - B2B
  - B2C
  - B2G
progress: in-progress
---
# 🇫🇷 France

**Authority:** DGFiP (Direction Générale des Finances Publiques) · **Channel:** PDP (Plateforme de
Dématérialisation Partenaire) for B2B, Chorus Pro for B2G.

France is the only one of the five countries where this app's own data records the transmission
channel as **legally mandated**, and the only country where BOTH its channels — PDP (B2B) and Chorus
Pro (B2G) — have been proven against a real platform (see below for what "proven" covers for each).

## Sending an invoice

- From **2026-09-01**, a domestic B2B invoice must go through an accredited PDP — this app's
  `channel-policy` catalog marks the `pdp` channel `requirement: "mandated"`, sourced to
  *"Seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues"*
  (impots.gouv.fr, checked 2026-08-27). Sending such an invoice by e-mail instead is not a lesser
  channel, it is a sanctioned one under CGI art. 1737 III/IV bis. That date has already passed as of
  this page's writing, so the mandate is in force.
- **Proven live**: a real deposit against the superpdp sandbox reached the platform's own
  conformity states in sequence — `fr:200` (déposée, validated) → `fr:201` (émise) → `fr:202` (reçue
  par la plateforme) — deposit 375037, 2026-08-29, reproduced across two independent runs. Along with
  Chorus Pro below (B2G, 2026-09-14), this makes France the one country among the five whose channels
  this app has actually watched clear against a real service, not just a mock — both still in
  sandbox/qualification, neither in production.
- The artifact sent is **Factur-X** — a PDF/A-3 file with an embedded EN 16931 CII XML — gated by the
  vendored EN 16931 Schematron before anything is deposited.

## Selling to a government client (B2G)

The routing rule (`b2g-routing`) sends a French government client's invoice through **Chorus Pro**,
in Factur-X, and requires the client's **SIRET** on file — sourced to Code de la commande publique
art. L. 2192-1/L. 2192-2/L. 2192-5. The transport itself is built and registered in this app
(`transports/chorus-pro-transport.ts`).
- **Proven live in qualification, 2026-09-14**: a real Factur-X deposit, built the same way a live
  send builds one, reached the terminal authority state `IN_INTEGRE` (`CPP0011117000000000425903`,
  `listeErreurDP: []`) after two earlier deposits were rejected and their causes fixed — a wrong
  BT-23 "cadre de facturation" value, a recipient SIRET wrongly truncated to its SIREN, and a
  hardcoded payment-means code (commits `67a94d58`, `7de5a90c`, `ecce4d35`). Both credential layers
  (a PISTE OAuth application and a Chorus Pro "compte technique") were obtained with **no real
  company** — Chorus Pro's own qualification space issues a fictitious structure and SIRET.
- **Not proven**: production — no production PISTE application or Chorus Pro production raccordement
  exists, so nothing above ran outside `CHORUSPRO_ENVIRONMENT=SANDBOX`. Also not proven: anything in
  an invoice's life AFTER `IN_INTEGRE` — a real public buyer's own downstream handling
  (`MISE_A_DISPOSITION`, `MANDATEE`, `MISE_EN_PAIEMENT`…) has never been exercised, since
  qualification has no real public buyer to do it with.

An optional `buyerReference` ("code service") is also read from the invoice if the client's own
Chorus Pro account requires one.

## Tax

VAT, with a franchise-based small-business exemption. Every rate below is sourced to the Code
général des impôts (CGI), read directly, 2026-09-01:

| Rate | Category | Article |
| --- | --- | --- |
| 20% | Standard | art. 278 |
| 10% | Reduced | art. 278 bis / art. 279 |
| 5.5% | Super-reduced | art. 278-0 bis |
| 2.1% | Super-reduced | art. 281 quater / 281 octies / 298 septies |
| 0% | Exempt — franchise en base | art. 293 B, I |

A business under the franchise threshold charges no VAT at all (art. 293 B, I) and its VAT number is
correspondingly not required on its invoices (CGI ann. II art. 242 nonies A, I, 2° and II — the same
dispensation also applies to any invoice ≤ 150 € excl. tax).

## Identifiers

- **SIREN or SIRET**, required on both parties — Code de commerce art. R.123-237 legally requires the
  9-digit SIREN; this app also accepts the 14-digit SIRET (which contains the SIREN in its first 9
  digits) and derives the SIREN from it automatically before building an invoice's XML.
- **French VAT number**, not required at country level — whether it must appear depends on the
  issuing company's own VAT regime (see Tax above), which this catalog does not track per company.

## Correcting or cancelling an invoice

10 of the 11 correction routes this app tracks are sourced to French law (only
`COUNTERPARTY_OBJECTION` is unverified). In practice: credit notes, debit notes, corrective invoices
and cancel-and-replace are all legally **allowed**; an internal credit note and an annotated
duplicate are **required** in the situations French law reserves them for; an authority-side
annulment, a ledger-only annotation, and skipping the document entirely are all **forbidden**.

Cancelling an already-sent invoice and reissuing it is implementable in this app for France, with
**no restriction** — the correction-routes data for `CANCEL_AND_REPLACE` names no authority step or
transmission precondition.

## Sources

`backend/src/modules/documents/country-policy/data/fr.json`,
`country-identifiers/data/fr.json`, `correction-routes/data/fr.json`, `b2g-routing/data/fr.json`,
`transports/channel-policy/data/fr.json`, `tax/tax-systems/data/fr.json`, `vat-rates/data/fr.json`,
`mentions/data/fr.json` (the three C. com. art. L441-9 mentions carried on every invoice),
`content-requirements/data/fr.json` (BT-23), and `archive/retention/data/fr.json` — **two
simultaneous obligations**, six years fiscal from the document's own date (LPF art. L102 B) and ten
years commercial from the close of the financial year (C. com. art. L123-22), the binding date being
the later of the two — plus `transports/pdp/pdp.live.spec.ts`,
`transports/chorus-pro/choruspro.live.spec.ts` and `transports/chorus-pro-transport.ts` for the
live-proof and implementation claims above.
