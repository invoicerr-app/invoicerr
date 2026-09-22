# Migration sources — what a new user can actually bring with them

**Read this first.** The instinct is to build one importer per competitor. That instinct is wrong for
four of the five countries this product serves. In **Italy** and **Poland** the tax authority itself
holds a complete, structured, machine-readable copy of the user's own invoices and hands it back on
request — no vendor involved, no plan to pay for, no CSV to reverse-engineer. In **Portugal** the law
goes one better: exporting SAF-T (PT) is a *cumulative precondition of software certification*, so
every program that can legally issue a Portuguese invoice can, by construction, emit one file
carrying clients, products, per-line VAT, numbering series and payment dates. Only **France** and
**Germany** have no such lever — and in both, the national accounting format everyone reaches for
first (FEC, DATEV) turns out to be general-ledger shaped and structurally incapable of carrying an
invoice line. So the work ranks: build a **structured e-invoice XML reader** first, a **SAF-T–family
reader** second, and only then a short, hand-picked set of **vendor APIs** for the users those two
cannot reach — chiefly French and German ones, and anybody invoicing through Stripe.

Scope confirmed from the catalogues under `backend/src/modules/documents/`: the per-country data
directories (`country-policy/data`, `tax/tax-systems/data`, `country-fields/data`,
`transports/channel-policy/data`, `b2g-routing/data`, `vat-rates/data`) each hold exactly five files
— `de`, `fr`, `it`, `pl`, `pt`. The code agrees with the five-country scope.

---

## The answer in one table

| Country | Best source | What it yields | Who can get it |
|---|---|---|---|
| **Poland** | **KSeF** national clearance archive, via its API | FA(2)/FA(3) XML, full line items, 10-year retention | Every taxpayer in scope — mandatory since 2026 |
| **Italy** | **Agenzia delle Entrate** "Fatture e Corrispettivi" bulk download | Original FatturaPA XML, ~2–3 years full file | Every VAT number, SPID/CIE/CNS login only |
| **Portugal** | **SAF-T (PT)** from the user's own software | Clients + products + invoices + per-line VAT + payments | Every AT-certified program, by law |
| **Germany** | Vendor API or export (lexoffice, sevdesk…) | Varies by vendor; structured XML growing since 2025 | Depends on vendor and tier |
| **France** | Vendor API or export (Pennylane, Qonto, Henrri…) | Varies by vendor; Factur-X where a platform emits it | Depends on vendor and tier |

The two countries at the bottom are the ones that need per-vendor work. The three at the top need
format work, done once.

---

## Part 1 — The importers to build, ranked

### 1. A structured e-invoice reader (EN 16931 family, plus FatturaPA and FA(3))

**Why first.** It is the only importer that pays off in four countries at once, and it is the one the
codebase is already half-way through.

| Country | Where the user's own XML comes from |
|---|---|
| Italy | AdE portal bulk download; or a platform's bulk ZIP (Fatture in Cloud, Fattura24) |
| Poland | KSeF export endpoint; or a platform's KSeF integration |
| Germany | Held directly, growing since the 1 Jan 2025 receiving mandate |
| France | Factur-X from platforms that emit it (Qonto, Abby, Henrri, Pennylane) |
| Portugal | UBL via the B2G/Peppol path — secondary, SAF-T is better here |

**What already exists in this repository.** `modules/documents/received-invoices/extraction.ts`
already parses **CII**, **UBL** and **Factur-X** (PDF/A-3 embedded CII) into a header-plus-lines
structure with a per-line VAT rate — written for inbound supplier invoices, but the parsing job is
identical. Its own header documents the discipline to keep: never `fromXml` (the round-trip bug),
DOM parsing rather than regex, a byte ceiling before the parser is touched, malformed input treated
as empty rather than partially read.

**What is missing.** There is no **FatturaPA** reader and no **FA(3)** reader. Both formats are
already *written* by this codebase — `formats/national/fatturapa-provider.ts` and
`formats/national/fa3-provider.ts` — so the field mapping is established in-tree; only the read
direction is absent. That is the single highest-leverage piece of work in this whole document,
because those two formats are exactly what Italy's and Poland's state archives hand back.

**What this importer can never recover.** Say it plainly in the UI rather than guessing:

- **Payment status and payment date.** A FatturaPA XML carries `DatiPagamento` — the *agreed* terms
  and due date — and never whether or when the invoice was actually paid. The same holds across the
  EN 16931 family. Payment status must come from a second source or be left unset.
- **Delivery/clearance status**, which lives in separate receipt files (`RicevutaConsegna`,
  `NotificaScarto`, KSeF's UPO), not in the invoice.
- **Quotes and estimates.** They are never transmitted, so they are structurally absent.

### 2. A SAF-T–family reader (SAF-T PT, then JPK_FA)

**Why second.** It is the only format in this study that reconstructs a **client book** and a
**payment history**, not just a pile of invoices — and in Portugal it is legally guaranteed to exist.

**SAF-T (PT)** — current version **1.04_01**, established by Portaria n.º 302/2016 (in force
2017-01-01, data-structure Annex from 2017-07-01), correcting the lineage from Portaria n.º
321-A/2007. One XSD serves both invoicing and accounting software; which tables are populated is
signalled by the Header's `TaxAccountingBasis` field (`F` = faturação, `C` = contabilidade, `I` =
integrated, and others). An invoicing tool produces the faturação set.

What a single SAF-T (PT) file yields:

| Block | Fields that matter to an importer |
|---|---|
| `Header` | NIF, company name, fiscal year, currency, `SoftwareCertificateNumber` |
| `MasterFiles/Customer` | Customer ID, name, billing and shipping address, country, tax ID |
| `MasterFiles/Product` | Product code, description, type, EAN |
| `MasterFiles/TaxTable` | Tax type (IVA/IS/NS), region (incl. PT-AC, PT-MA), code, **percentage** |
| `SourceDocuments/SalesInvoices` header | `InvoiceNo` (doc-type code + **series** + sequential number in one string), `ATCUD`, `Hash`, `InvoiceDate`, `InvoiceType` (`FT`/`FS`/`FR`/`ND`/**`NC`** = credit note), `DocumentStatus`, `CustomerID` |
| `…/Line` | Product code and description, quantity, unit of measure, unit price, `SettlementAmount` (per-line discount), and a Tax block with `TaxPercentage`, **`TaxExemptionCode`** (the M01–M99 exemption reason) and `TaxExemptionReason` |
| `…/DocumentTotals` | Net, tax payable, gross, currency, a **`Payment`** sub-block (mechanism, amount, **date**) and a `WithholdingTax` sub-block (retenção na fonte) |

So: clients, products, invoices with per-line VAT and exemption reasoning, numbering series, credit
notes and payment dates — all from one file. Nothing else in this study comes close.

**The legal guarantee.** Portaria n.º 363/2010, Artigo 3.º (*Requisitos*), read first-hand from the
AT's own consolidated text and quoted verbatim:

> A certificação dos programas de faturação depende da verificação cumulativa dos seguintes
> requisitos:
> a) Ter a possibilidade de exportar o ficheiro a que se refere a Portaria n.º 321-A/2007, de 26 de
> março;

That file is SAF-T (PT). The Portaria is `vigente`, amended by Portarias 22-A/2012, 160/2013 and
340/2013 and by Decreto-Lei n.º 28/2019 — the latter revoked Articles 1 and 2, but **Article 3
stands**. Certification therefore implies SAF-T export, with no vendor discretion. One reader covers
the entire legal Portuguese market.

**JPK_FA** — Poland's sibling, conceptually the same shape under a different XSD (current version
**(4)**, published with every other structure at `gov.pl/web/kas/struktury-jpk`). Confirmed against
the schema itself:

- Header (`Faktura`): `P_1` issue date, `P_2A` number, buyer and seller name/address (`P_3A`–`P_3D`),
  VAT-UE codes, `P_6` sale date, per-rate net/tax totals, `P_15` total due, and `RodzajFaktury`
  (`VAT` / **`KOREKTA`** / `ZAL`) with `PrzyczynaKorekty` and `NrFaKorygowanej` for corrections.
- Lines (`FakturaWiersz`, repeatable): `P_7` description, `P_8A` unit, `P_8B` quantity, `P_9A`/`P_9B`
  unit price, `P_10` discount, `P_11`/`P_11A` line value, and **`P_12`** — the VAT rate, enumerated
  as `23, 22, 8, 7, 5, 4, 3, 0, zw, oo, np`, i.e. including the exempt, reverse-charge and
  out-of-scope codes.
- Absent, and it matters: **no due date, no payment status, no payment date**, no client email.

Build SAF-T (PT) first and JPK_FA second; they are separate schemas, not one parser with a flag, but
the target mapping is shared.

### 3. A small, hand-picked set of vendor APIs — plus a mapped-CSV fallback

Only after the two above, and only where they cannot reach. Ranked by users-reached per unit of work:

| # | Platform | Country reach | Why it earns a bespoke importer |
|---|---|---|---|
| 1 | **Stripe** | All five | Users invoicing through Stripe have **no structured e-invoice at all** — Stripe's own docs state it "does not itself generate or transmit legally compliant e-invoice files". The XML importer can never help them. Meanwhile the API is the most open found: self-serve secret key, no approval, no paid tier for read access, cursor pagination over full history, 100 req/s. |
| 2 | **lexoffice / Lexware Office** | Germany | The German mass-market leader, and Germany has no national fallback. API included on **all four** paid tiers, GET over historical invoices with line items, 2 req/s. |
| 3 | **Fatture in Cloud** | Italy | Market leader; API on **every** tier including the €4 Forfettari plan, and `GET /issued_documents/{id}/e_invoice/xml` returns the actual FatturaPA file — so it feeds importer #1 rather than duplicating it. |
| 4 | **Fakturownia** | Poland | Free tier keeps API **and** JPK **and** KSeF — a churned free user can still leave with their data. |
| 5 | **Qonto** | France (+DE/IT/PT/…) | Self-serve API key, per-line `vat_rate`, buyer `vat_number`, `paid_at`, native Factur-X generation, published rate limits. |

**The long tail gets a mapped CSV importer, not a bespoke one.** No convergent CSV shape exists —
compare Stripe's `total_taxes`, Xero's `TotalTax`, Zoho's `tax_percentage`, Invoice Ninja's
`tax_rate1/2/3`. Worse, **no vendor in this entire study publishes its CSV column list**, in any of
the five countries. Guessing a header row is therefore not an option; ask the user to map columns.
That pattern already exists in this repository: `modules/documents/bank-reconciliation/csv-mapping.ts`
and its `parse-csv.ts` sibling take a user-supplied `CsvColumnMapping` against the file's own header
row, with date-format and decimal-separator choices, shape ceilings checked before per-row work, and
formula-injection guarded through `utils/csv.ts`. Reuse it; do not invent a second mechanism.

### Rejected as a first importer — and why

| Candidate | Why not |
|---|---|
| **FEC** (France) | Two independent defects. It is a **general-ledger journal**, not invoices: its 18 fields (`JournalCode … Idevise`) carry account numbers, debit/credit, and a piece reference — no line items, no per-line VAT rate (VAT is its own aggregate G/L line), no structured client record beyond an auxiliary account label, no PDFs. And it **does not reach the segment this product sells to**: the micro-entrepreneur's statutory bookkeeping is a `livre des recettes`, not double-entry accounts, and the obligation is triggered on audit for businesses on the régime réel. Of the French platforms surveyed, three ship FEC (Pennylane, Indy, EBP) and one has it on the roadmap only (Abby). |
| **DATEV Buchungsstapel** (Germany) | The same shape for the same reason. The format *is* publicly specified (`developer.datev.de`, 125 columns in v13) — but a row is one aggregate posting: `Umsatz`, `Soll/Haben`, `Konto`, `Gegenkonto`, `Belegdatum`, `BU-Schlüssel`. No line items, VAT only as a code on the aggregate, client identity only as an account number (names and USt-IdNr live in a separate Stammdaten file), and never a document attachment. |
| **GoBD / GDPdU** (Germany) | Not a schema. GoBD mandates machine-readable *access* in one of three modes (Z1 direct, Z2 indirect, Z3 data-carrier), and the `index.xml`/DTD pair is a **descriptor** that tells audit software what arbitrary vendor columns mean. It buys no cross-vendor stability, so it is no cheaper to parse than the vendor's raw CSV. |
| **GDPR article 20** | See Part 5. Almost everywhere it is a support ticket or an account dump. |

---

## Part 2 — The target: what an importer must fill

Established from `backend/prisma/schema.prisma` and
`modules/documents/descriptors/invoice.descriptor.ts`.

**`Client`** — `name`, `contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone`,
`address`, `addressLine2`, `postalCode`, `city`, `state`, `country`, `countryCode`, `language`,
`currency`, `type` (`COMPANY`/`INDIVIDUAL`), `kind` (`BUSINESS`/`GOVERNMENT`), `isActive`.

**`PartyIdentifier`** — one row per `(clientId, scheme)`. The schemes each country's catalogue
declares, from `country-identifiers/data/`:

| Country | Schemes |
|---|---|
| FR | `LEGAL_ID` (SIREN/SIRET), `VAT` |
| DE | `VAT` (USt-IdNr.), `LEGAL_ID` (Handelsregisternummer) |
| IT | `VAT` (Partita IVA), `LEGAL_ID` (Codice Fiscale), `IT_SDI` (Codice Destinatario), `PEC`, `IT_PA_CODE` |
| PL | `LEGAL_ID` (NIP) |
| PT | `LEGAL_ID` (NIF/NIPC), `VAT` |

Each source format supplies these directly: SAF-T's `CustomerTaxID`, JPK_FA's buyer NIP, FatturaPA's
`IdFiscaleIVA` + `CodiceFiscale` + `CodiceDestinatario`/PEC, EN 16931's BT-48.

**`DocumentInstance`** — `typeId: 'invoice'`, `status`, `number` (Int), `displayNumber`, `atcud`,
and `data` (Json). The `data` payload, per the invoice descriptor: `client`, `origin`,
`correctsInvoiceId`, `issueDate`, `dueDate`, `currency`, `notes`, `clientReference`, and `lines[]`
of `{ description, articleId, quantity, unit, unitPrice, vatRate, discountPercent }`.

**`DocumentPayment`** — `amountMinor`, `currency`, `paidAt`, `method`, `note`. This is where SAF-T's
`DocumentTotals/Payment` lands, and what the XML route leaves empty.

**Two wrinkles worth designing for up front:**

- **Numbering.** `DocumentNumberSequence` is one `nextNumber` per `(companyId, typeId)`. Importing
  history means writing `number`/`displayNumber` from the source *and* advancing the sequence past
  the highest imported value, or the first invoice the user issues after migrating collides with an
  imported one. Sources differ in how the number is shaped: SAF-T packs doc-type, series and
  sequential number into one `InvoiceNo` string and must be split; JPK_FA gives `P_2A` whole.
- **Correction links.** `correctsInvoiceId` and Portugal's `ATCUD` are both first-class columns.
  FatturaPA (`DatiFattureCollegate`), JPK_FA (`NrFaKorygowanej`) and SAF-T (`References` on the line,
  `InvoiceType = NC`) each carry the link in their own way; a French FEC carries it nowhere, and
  Pennylane's own export is documented to drop the avoir-to-invoice link entirely.

---

## Part 3 — National standards, country by country

### France — FEC

Article A47 A-1 du Livre des procédures fiscales. 18 fields in fixed order: `JournalCode`,
`JournalLib`, `EcritureNum`, `EcritureDate`, `CompteNum`, `CompteLib`, `CompAuxNum`, `CompAuxLib`,
`PieceRef`, `PieceDate`, `EcritureLib`, `Debit`, `Credit`, `EcritureLet`, `DateLet`, `ValidDate`,
`Montantdevise`, `Idevise`. Tab or pipe delimited, ASCII/ISO-8859-15/UTF-8, dates as `AAAAMMJJ`,
comma decimal separator, filename `SirenFECAAAAMMJJ`. Produced on demand during an audit, not filed
periodically. See the rejection table above for why it is not the French answer.

### Poland — JPK

Only **JPK_V7M/V7K** is a periodic filing (monthly or quarterly, phased in by business size from
2016 to 2018). Every other structure — **JPK_FA** included — is *na żądanie*, produced on demand
during an audit. So JPK_FA is a *capability* every compliant business has, not a file sitting in an
inbox. Its content is detailed in Part 1.

### Italy — FatturaPA

Current technical specification **1.9** (valid from 1 April 2025), superseded by **1.9.1** from 15
May 2026. Mandatory via SdI for domestic B2B/B2C since 1 January 2019, extended to the regime
forfettario in two steps (a turnover-threshold phase in 2022, then universally from 2024 — dates
flagged unverified below). A folder of FatturaPA XML yields: header (`TipoDocumento`, `Numero`,
`Data`, `Divisa`), `DettaglioLinee` (description, quantity, unit of measure, unit price,
`ScontoMaggiorazione`, `AliquotaIVA`, **`Natura`** N1–N7 for non-taxable lines), `DatiRiepilogo` per
rate, `DatiBollo`, `DatiRitenuta`, `DatiCassaPrevidenziale`, both parties' identifiers, and
`DatiPagamento`. Note that `CodiceDestinatario` and PEC sit in the transport header
(`DatiTrasmissione`), not the fiscal body.

*Version-numbering caveat:* `fatturapa.gov.it` labels the same 1 April 2025 document "versione 1.4"
while `agenziaentrate.gov.it` calls it 1.9 — two official domains, same date, same underlying XSD
files (`Schema_VFPR12_v1.2.3.xsd`). Treat the AdE sequence as canonical; confirm against a real
invoice's schema declaration before hard-coding either.

### Portugal — SAF-T (PT)

Covered in Part 1, including the certification guarantee. The one thing SAF-T does not hold is the
rendered QR-code payload — only its ingredients (ATCUD, Hash, totals).

### Germany — nothing equivalent, and that is the finding

Germany has no mandated invoice-level export format. What it has instead:

- **GoBD** (BMF-Schreiben of 28 November 2019, updating the 2014 original), which mandates access
  modes, not a schema.
- **DATEV**, a private cooperative's de facto standard that is ledger-shaped.
- **The e-invoicing mandate** under §14 UStG as amended by the Wachstumschancengesetz. Timetable, per
  the BMF's own FAQ and §27(38) UStG: **receiving** capability mandatory for all domestic B2B since
  **1 January 2025**; paper and unstructured PDF still permitted with recipient consent until **31
  December 2026**, extended to **31 December 2027** for suppliers with prior-year turnover ≤ €800,000;
  issuance fully mandatory from **1 January 2028**. Compliant formats, quoted from the BMF:
  > Insbesondere die in Deutschland üblichen Formate XRechnung und ZUGFeRD ab Version 2.0.1 (mit
  > Ausnahme der Profile MINIMUM und BASIC-WL) erfüllen die umsatzsteuerlichen Voraussetzungen für
  > eine E-Rechnung.

  So XRechnung qualifies, and ZUGFeRD from 2.0.1 **except** the MINIMUM and BASIC-WL profiles — an
  importer must check the profile before trusting a ZUGFeRD file to be complete.

  Consequence for migration: a German user's *incoming* archive is increasingly structured today,
  but their own *outgoing* history is not, because they may still legally have issued PDFs
  throughout the transition. Partial source, improving each year.

---

## Part 4 — The state as a migration source

| Country | Retrievable? | Mechanism | Auth | Retention |
|---|---|---|---|---|
| **Poland** | **Yes, by API** | KSeF 2.0: `POST /invoices/query/metadata`, `POST /invoices/exports` (async bulk), `GET /invoices/ksef/{ksefNumber}` | XAdES qualified signature, Trusted Profile (ePUAP), KSeF certificate, or a KSeF token | **10 years** |
| **Italy** | **Yes, by portal** | "Fatture e Corrispettivi" → Consultazione → **"Consultazioni e download massivi"**, by date range | SPID, CIE, CNS, or Entratel/Fisconline | **Full XML ~2–3 years**, then metadata only for ~8–9 |
| **Portugal** | Partly | e-Fatura "Consultar" → **"Exportar tabela"** — a summary spreadsheet (reference, status, date, total), plus per-document PDF. The AT webservice is write-only | NIF+password, Chave Móvel Digital, Cartão de Cidadão | — |
| **France** | **No** | The reform's *annuaire* is a routing registry (SIREN → receiving address), not an archive; invoices live with the private accredited platform. Chorus Pro (B2G) offers status tracking and a PISTE-gated API | — | — |
| **Germany** | **No** | No B2B clearance platform by design. B2G (ZRE/OZG-RE) lets a supplier download their own submissions as XML — but **deletes them 28 days** after provision or last status change | — | 28 days |

**Poland's published rate limits** (from the official CIRFMF documentation): metadata query and
invoice export 8 req/s, 16/min, **20/hour**; export-status polling 10 req/s, 60/min, 600/h;
single-invoice fetch 8 req/s, 16/min, 64/h. The 20-per-hour ceiling on export jobs is the binding
constraint — design the importer as a queued, resumable job from the start, not a request-scoped
loop. The repository already has the right home for that: `modules/documents/queue/`.

**Italy's consent precondition — resolved, but flag it.** Historically the AdE retained only
fiscally-relevant metadata unless the taxpayer opted into the *servizio di consultazione*. The
authority's own December 2025 guide now describes availability as automatic:

> Tutte le fatture elettroniche (nonché le note di variazione) emesse e ricevute correttamente
> attraverso il Sistema di Interscambio sono messe a disposizione del soggetto Iva

No adesione language appears near the feature in the current text. A *separate* opt-in still governs
the free **conservazione** service. The exact instrument that removed the consultation opt-in was not
pinned down — see Part 7.

**Delegation.** Italy allows a taxpayer to delegate e-invoicing and conservation services
specifically to parties beyond the usual intermediaries listed at art. 3 comma 3 DPR 322/1998 — which
is the legal hook a third-party importer would need. Portugal has an equivalent *Contabilista
Certificado* nomination flow, though whether it extends to arbitrary software rather than an
accountant is unresolved.

---

## Part 5 — GDPR article 20: where it is a lever

Rarely. Across every platform surveyed in all five countries, article 20 produced a genuine,
self-serve, structured *business*-data export in only two cases.

**Real:**

- **Invoice Ninja** — self-serve CSV/XLS/JSON across seven business categories (clients, invoices,
  quotes, payments, products, expenses, vendors). The strongest portability story found anywhere.
- **Odoo Online** — a full database backup ZIP; not framed as portability but functionally complete.
  Self-hosted Community sidesteps the question entirely.
- **Pennylane** (partial, and only on one path) — deleting an accountant-managed dossier
  auto-triggers an emailed export bundling FEC, balance, grand livre, all invoices and a spreadsheet
  linking invoices to FEC entries, with links valid 30 days.

**A support ticket, not a button:** Indy, Tiime, Henrri, EBP, Shine, iFirma, sevdesk, Xero (whose
policy explicitly routes the request through "How to contact us").

**Unverified or plausibly an account dump:** Stripe, QuickBooks (an Intuit *account*-level portal
exists; whether it contains QBO invoice data or only profile and marketing data is unconfirmed —
exactly the failure mode to expect), Zoho, FreshBooks, Wave, Sage, PayPal, and most of the Italian
and Portuguese vendors.

**Practical conclusion.** Do not design a migration flow whose happy path is "ask your old provider
for your GDPR export". Design for the file formats and APIs above, and treat article 20 as the
last-resort path for a user whose vendor has no export at all.

---

## Part 6 — The platforms

59 platforms surveyed. Full per-platform notes are condensed here to what an importer needs: the
export, the gate, and the surprise.

### France (10)

| Platform | Export | API | Gate |
|---|---|---|---|
| **Pennylane** | XLSX list + ZIP of PDFs (**400/batch cap**, ZIP is a paid add-on); **FEC**; invoices natively Factur-X | REST, Company/Firm/FirmGroup; 5 req/s | **API needs Essentiel €24/mo**. Free tier exists (1,200 invoices/yr) but no API. Avoir→invoice link dropped from export |
| **Indy** | FEC, livre-journal CSV; documents **one at a time, no bulk ZIP**; client list is import-only | **None** | Portability by email to a DPO address |
| **Tiime** | Factures/devis/clients export, format not stated | **Partner-only** — "exclusivement disponible sur demande pour les éditeurs de logiciels" | Free tier generous (multi-rate VAT, avoirs); account deletion is a manual ID-checked process |
| **Henrri** (Cegid) | "Export comptable", format unstated | **Public, credit-metered** — free pack 200 credits/mo, 60 req/min; reads are free | Free tier real; paid tiers add a parameterisable export. Confirms Factur-X/UBL/CII |
| **EBP** | FEC confirmed | **ELITE tier only** | **No public pricing at all** |
| **Cegid Comptabilité** | Unverified | Unverified | Entirely sales-gated |
| **Shine** | CSV/OFX/QIF — but a **bank-transaction** export, not invoice lines | None found | Exports unlimited on every tier incl. free; post-closure export via support |
| **Facture.net** | **CSV, Excel, PDF and JSON** — the broadest format list in France | None public | **Entirely free**, nothing gated |
| **Abby** | CSV/Excel/PDF; **FEC marked "Bientôt" — not shipped** | Bearer-token API at `docs.abby.fr` | Export not on the free Basique tier |
| **Axonaut** | Named exports for SAGE 1000, Ibiza, Cegid | Claimed, no public reference found | **No free tier**, €97/mo single plan |

*Note:* **QuickBooks France is gone** — new subscriptions ended January 2023, access removed 31
December 2023, read-only ended 31 March 2024. **Sage's French legacy Compta & Facturation** also shut
down (updates stopped 31 December 2024, access cut 31 March 2025). A French user may be migrating
because their tool died, holding only whatever they exported at the time.

### Poland (11)

| Platform | Export | API | Gate |
|---|---|---|---|
| **Fakturownia** | CSV; bulk PDF/ZIP; **JPK_V7, JPK_FA, JPK_MAG** | Public REST, self-service `api_token`, JSON or XML | **Free Micro tier (0 zł) keeps API + JPK + KSeF.** The most migration-friendly free tier found in any country |
| **wFirma** | JPK_FA/V7/MAG/ST/KR_PD | REST at `api2.wfirma.pl`; confirmed `invoicecontent` line items and `contractor` records with NIP | **`appKey` issued individually per application**; OAuth2 apps need a verified company and manual review |
| **iFirma** | Unverified | JSON API; **published limits: 15,000/day, 100/min**; KSeF integrated | Requires an "Aktywacja API" step; no self-serve GDPR export (DPO email) |
| **inFakt** | Unverified | REST + webhooks + sandbox at `docs.infakt.pl` | Pricing page unreadable |
| **Taxxo** | Unverified | Claimed | No published pricing |
| **Comarch Betterfly** | — | — | Free entry tier from 0 zł, KSeF integrated |
| **Comarch ERP Optima** | — | — | Quote-based |
| **enova365** | JPK within the licence | — | Quote-based; vendor claims 22,000 companies |
| **InsERT Subiekt** | — | — | **1045 PLN perpetual desktop licence** — local DB, not a cloud API |
| **Symfonia** | — | — | KSeF Plus is a dedicated app |
| **Fakturomania** | JPK_CIT/V7/KR/FA, "export in various formats" | Not mentioned | Targets **sp. z o.o., not JDG** |

*Note:* **Fakturuj.pl now redirects to a different vendor** — treat as discontinued.

### Italy (8)

| Platform | Export | API | Gate |
|---|---|---|---|
| **Fatture in Cloud** (TeamSystem) | Bulk **ZIP of documents on every tier**; per-invoice FatturaPA XML via API | OAuth2, scoped, OpenAPI + 8 SDKs; `GET /issued_documents` with `items_list`; `GET .../e_invoice/xml` | **API checked on all five tiers, including the €4 Forfettari plan.** Only the ZIP turnaround SLA differs by tier |
| **Fattura24** | **Excel, XML, CSV, P7M and bulk ZIP on every paid tier** including €4 Professional | API key; **30/min, 200/h, 500/day** — but **create-only**, no documented read of existing invoices | Bulk file export is the real path here, not the API |
| **Aruba** | Not itemised | "Web services" — **Premium tier only** | **No public pricing on any tier.** Claims 800,000+ partite IVA |
| **Danea EasyFatt** | Excel/XML import-export from the Professional tier up | None | **Desktop-first** — the XML files are already on the user's disk regardless of the feature flag |
| **InfoCert LegalInvoice** | Not documented publicly | Not found | START verified at €50+IVA/year. InfoCert is itself an accredited *conservatore* — whether that 10-year archive is extractable is the open question |
| **Register.it** | Unverified | Unverified | — |
| **AdE's own free tools** | Portal, desktop compiler, and the **FatturAE** mobile app | — | Free; see Part 4 |
| Bank-distributed tools | Unconfirmed | — | Could not be verified |

### Portugal (8)

Every certified platform can emit SAF-T (PT) — that is the law, not a feature. What differs is the
API.

| Platform | API | Gate |
|---|---|---|
| **Moloni** | OAuth, `moloni.pt/dev/` | **Not on mOn €3.50 or Base €6.49**; API from Flex €10.90 up |
| **Cegid Vendus** | Exists at `vendus.pt/ws/` | **Not on Base €6.25**; API from Flex €10.83 up |
| **Cegid Jasmin** (PRIMAVERA) | Developer portal unreachable | Free entry point exists |
| **InvoiceXpress** | v2, **API key**, documented **780 req/min**; SAF-T, invoices, credit notes, estimates, clients, sequences | **API + SAF-T on every tier (€3–€40/mo) and in the trial.** AT cert #192 |
| **Facturalusa** | REST v2, CRUD on invoices/articles/clients, test + live environments | **Free tier (€0 for the first year to €50k turnover) already includes API and all modules.** AT cert #2652 |
| **TOConline** | 290+ endpoints | **Access routed through your accountant** — cannot self-serve a key |
| **Bill.pt** | Page 404s | €50.41–€146.34/year. AT cert #2578 |
| **AT's free "Faturação"** | — | Summary spreadsheet export only, no line items |

*Structural finding:* searching the AT certified-software register for **Odoo, Zoho, QuickBooks,
Xero, Wave, FreshBooks, Invoice Ninja and Stripe** returned **no matches**. Taken at face value, none
of them can legally serve as the invoicing system of record in Portugal above the certification
threshold. The Portuguese market is effectively local-only, which is precisely why the single SAF-T
reader covers it so completely.

### Germany (8)

| Platform | Export | API | Gate |
|---|---|---|---|
| **lexoffice / Lexware Office** | DATEV via Pendelakte, XRechnung, GoBD archiving | `api.lexware.io`, API-key bearer, GET over historical invoices with line items, 2 req/s | **API and DATEV on all four tiers** (€7.90–€32.90). No free tier |
| **sevdesk** | ZUGFeRD + XRechnung **even on the free tier**; DATEV/ADDISON on paid | Exists | **API only on the top "Buchhaltung Pro" tier** (€30.90+). The starkest gate in Germany |
| **Papierkram** | **GoBD certification, DATEV export and XRechnung/ZUGFeRD on every tier including Free** | Credit-metered, **BETA** | API absent on Free and S |
| **FastBill** | PDF, ZIP, XLS, CSV; DATEV XML all tiers | **API on every tier**, 50–1,000 calls/h by tier | DATEV Rechnungsdatenservice 1.0 is Pro+ |
| **Billomat** | XRechnung, ZUGFeRD all tiers | **Absent on the cheapest "Professional" tier** — the one sold to solo freelancers | That tier also has no DATEV |
| **WISO MeinBüro** | XRechnung/ZUGFeRD all tiers | Higher tiers, exact cut unclear | **Revenue-capped tiers** (€25k, €120k) |
| **DATEV Unternehmen online** | Beleg exchange with the accountant | — | Provisioned by the Steuerberater, no public price |
| **SumUp Rechnungen** | — | — | **Debitoor is shut down**, absorbed here |

### Pan-European and global (14)

| Platform | Serves FR/PL/IT/PT/DE? | The one thing to know |
|---|---|---|
| **Stripe** | All five, but **emits no compliant e-invoice anywhere** | Best API in the study: self-serve key, no approval, no tier gate, 100 req/s, `customer_tax_ids` with `pl_nip`/`de_stn`, full historical listing |
| **PayPal** | Present, no compliance anywhere | **Production access needs a 24–72h manual review**, and `billing_info` has **no buyer VAT field** at all |
| **Odoo** | All five, depth varies sharply | Emits FEC, FA(3)+KSeF, FatturaPA+SdI, DATEV, and is a Peppol Access Point. **But `l10n_pt` is chart-of-accounts only — no SAF-T, no certification**, and Italy lacks Conservazione. **API paywalled to Odoo Online Custom (€29.90/user/mo); free and unlimited self-hosted** |
| **Zoho Books / Invoice** | FR and DE editions only; **IT, PL, PT absent** | **Zoho Invoice's API is on the free plan**; Zoho Books' is Standard+ |
| **QuickBooks Online** | DE/IT/PT live, **France exited**, Poland never | OAuth app + consent only, no bare key |
| **Xero** | **No localised presence in any of the five** | 60 calls/min/tenant; uncertified apps capped at 25 tenants; GDPR export is a support ticket |
| **Sage** | DE/PT yes, **FR legacy shut down**, IT absent from its own region list, PL under the Symfonia brand | Developer docs unreachable throughout — the worst-documented API surveyed |
| **FreshBooks** | No localised presence | Self-serve OAuth2, no approval for own-data use; per-line tax present |
| **Wave** | **Not available in any of the five** — US/Canada only | Developer docs return 403 |
| **Invoice Ninja** | Self-hostable | **Best GDPR answer in the study**; dedicated `POST /api/v1/export`; hosted Free has no API, self-hosted has everything |
| **SumUp Invoices** | All five | Self-serve export across 8 categories, free tier included — but **no invoicing API at all** |
| **Revolut Business** | Present | **PDF only**, and no credit notes, recurring invoices or quotes — not a system of record |
| **Qonto** | FR + DE/IT/PT and others | Self-serve key, per-line `vat_rate`, buyer `vat_number`, `paid_at`, native Factur-X, 1,000 req/10s |
| **Dynamics 365 BC** | All five | Priced per user from $80/mo — not this product's segment |

---

## Part 7 — What is not verified

Each line names what would settle it.

**Legal and format**

- Italy's regime forfettario phase-in dates (the 2022 turnover threshold, the 2024 universal
  obligation) and the current status of the Sistema Tessera Sanitaria carve-out — read the Normattiva
  text of DL 36/2022 art. 18, L. 213/2023, and the current Milleproroghe.
- The instrument that removed Italy's consultation opt-in — the December 2025 AdE guide describes
  availability as automatic, contradicting the 2018 Garante-driven provvedimento. DL 34/2019 art. 14
  is the likely candidate; read it.
- Italy's FatturaPA version-numbering discrepancy (1.9/1.9.1 versus 1.4) — inspect a real invoice's
  schema declaration.
- Whether a VAT-exempt Polish business owes JPK_V7 at all — ustawa o VAT art. 99 ust. 11c.
- The statutory basis for Poland's ≤10,000 PLN monthly exemption running to 1 January 2027 — the
  KSeF amending Act text.
- Whether pre-2.0 voluntary-era KSeF invoices remain queryable through the 2.0 API — a KAS continuity
  note, or a direct question to the authority.
- Portugal's exact certified-software turnover threshold — Decreto-Lei n.º 28/2019, which was
  unreachable from here.
- The Geschäftszeichen of the 15 October 2024 and 15 October 2025 German BMF letters — the BMF site
  blocks automated requests; BStBl I 2024 S. 1320 is the citation to chase.
- Whether Italy's and Portugal's delegation mechanisms extend to arbitrary third-party software
  rather than only accredited accountants — the decisive question for a hands-off importer.
- Whether the AdE's free conservazione service lets a user download their whole 10-year archive, and
  in what package format.

**Platform**

- **No vendor in any of the five countries publishes its CSV or XLSX column list.** This is the
  single most consistent finding in the study and the reason the CSV fallback must be
  mapping-driven. Only a real export from a real account settles any of them.
- Post-cancellation export windows — essentially undocumented everywhere. Germany's retention law
  makes a read-only window plausible there; nobody states one. Read each vendor's terms, or ask.
- sevdesk's, Sage's, Wave's, Revolut's and Jasmin's API surfaces — all behind JS shells, cookie walls
  or outright 403s. A real browser session would settle each.
- Whether Qonto's **free** invoicing tier (no bank account) gets an API key — decides whether a
  non-paying French user has any programmatic exit at all.
- Whether QuickBooks' Intuit-account data download includes QBO invoice data or only profile data.
- Whether QuickBooks' DE/IT/PT editions are genuinely locally compliant or only localised sign-up
  pages.
- Whether Chorus Pro exposes bulk download of a supplier's own past submissions, beyond status
  tracking — the full PISTE Swagger would settle it.
- Whether Italian banks distribute free invoicing tools — the premise could not be confirmed.
- KeyInvoice (Portugal) — bot-protected on every attempt.
- Streamsoft, Easybill, Buchhaltungsbutler, orgaMAX, Collmex, Accountable and sorted were not
  investigated in depth; their absence here is a budget decision, not a judgement.
