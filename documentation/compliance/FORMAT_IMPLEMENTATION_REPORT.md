# Format Implementation Report — Night Run 2026-06-27

## Summary

All 8 phases (A–H) completed. **22 national e-invoice format skeletons** implemented, **72 tests passing**, `nest build` clean. **Generators are now reachable in prod** via executor → provider → port delegation.

## What Changed in the Amorçage (2026-06-28)

The night run produced DB-free generators (`buildFatturaPa(data)`, `buildCfdi(data)`, …) but wired them through `ctx.invoiceData` — a field nobody populated, so in prod all national providers fell back to `log.todo` stubs. The harness was green because it called `service.buildX(data)` directly, bypassing the executor.

**Fix**: Align national render methods with the existing `renderPdf(invoiceId)` / `renderXmlFormat(invoiceId)` pattern — fetch from DB internally, expose `(invoiceId)` signature on the port.

### Changes
1. **`InvoiceArtifactPort`**: All national methods changed from `(data: InvoiceRenderData)` → `(invoiceId: string)`. Removed `InvoiceRenderData` import from port.
2. **`InvoiceRenderingService`**: Added `fetchRenderData(invoiceId)` — shared private method. Render wrappers (`renderFatturaPa`, `renderCfdi`, `renderFacturae`, `renderKsaUbl`, `renderFaVat`, `renderNationalXml`) now take `invoiceId`, fetch, then delegate to `buildX(data)`. Build methods remain DB-free for isolated testing.
3. **`TransactionContext`**: Removed `invoiceData?` field (no longer needed).
4. **All format providers** (Cfdi, FatturaPa, KsaUbl, FaVat, NationalXml): switched from `ctx.invoiceData` → `ctx.externalRef`.
5. **`FacturaeFormatProvider`** (new): supports `ES_FACTURAE`, delegates to `renderFacturae(ctx.externalRef)`. Replaces the empty `es-facturae` stub in `NATIONAL_FORMAT_PROVIDERS`.
6. **`FormatProviderRegistry`**: now passes `artifacts` to all providers including `CfdiFormatProvider`, `FatturaPaFormatProvider`, `KsaUblFormatProvider`, `FaVatFormatProvider`, `FacturaeFormatProvider`, `NationalXmlFormatProvider`.
7. **CN & EG fixtures**: added `CN_B2B`, `EG_B2B` with structural validation tests.
8. **Reachability tests**: 9 new tests prove executor→provider→port delegation (registry.buildAll with mock port emits marker XML bytes, not empty stubs).

## Phases Completed

### Phase A: Spike @e-invoice-eu/core
- **Decision: NO-GO** — API fundamentally different (raw JSON UBL tree vs `EInvoice` class)
- Requires complete `buildEInvoice()` rewrite; cost too high for unattended run
- Stay on `@fin.cx/einvoice` for EN 16931 family

### Phase B: FatturaPA 1.2 (IT/SM) ✅
- Library: `@digitalia/fatturapa` — `fpa2xml()` JSON→XML generation
- Structural validation: CedentePrestatore, CessionarioCommittente, DatiGenerali, DettaglioLinee, DatiRiepilogo, DatiPagamento
- Missing: XAdES-BES signature, SdI submission → BLOC C

### Phase C: CFDI 4.0 (MX) ✅
- Raw XML construction (xmlbuilder2 `@` attribute syntax broken; template literals)
- Pre-stamp skeleton: Comprobante, Emisor, Receptor, Conceptos, Impuestos
- Missing: Sello digital, UUID (timbrado), PAC submission

### Phase D: Facturae 3.2.1 (ES) ✅
- xmlbuilder2: Facturae, FileHeader, Parties, InvoiceHeader, InvoiceTotals, InvoiceItems
- **Wired to executor** via `FacturaeFormatProvider` (ES_FACTURAE syntax)
- Missing: XAdES-BES/EPES signature (xadesjs installed, TODO EPES signing)

### Phase E: KSA UBL 2.1 + QR (SA) ✅
- xmlbuilder2: UBL 2.1 with `cac:TaxSubtotal` array fix
- QR placeholder for ZATCA
- Missing: FATOORA submission, QR content encoding

### Phase F: FA_VAT FA(2) (PL/KSeF) ✅
- xmlbuilder2: Fa, FaWiersz, Podsumowanie, IdentyfikatorNIP
- Missing: KSeF API token, submission

### Phase G: LATAM + TR + IN + CN + EG (10 countries) ✅
- Generic `buildNationalXml(data, countryCode)` router
- Country-specific skeleton builders:
  - **CL** (Chile DTE/SII): ClaveDTE, Encabezado, Emisor, Receptor
  - **AR** (Argentina FE/AFIP): Factura, Cabecera, CUIT
  - **EC** (Ecuador FE/SRI): Factura, InfoTributaria, InfoFactura
  - **BR** (Brazil NF-e/SEFAZ): nfeProc, NFe, infNFe, emit, det
  - **TR** (Turkey e-Fatura/GİB): Invoice, Header, Sender, Receiver
  - **CN** (China e-Fapiao/Golden Tax IV): Fapiao, Header, Seller, Buyer, Items
  - **EG** (Egypt ETA): Invoice, Header, Seller, Buyer, Lines
  - **IN** (India IRP/GST e-Invoice): Invoice, TradeParty, GSTIN

### Phase H: GR myDATA + HU Online Számla ✅
- **GR** (Greece myDATA/AADE): UBL-like InvoiceHeader/Issuer/Counterpart/Details/Summary
- **HU** (Hungary Online Számla/NAV): UBL 2.1 with NAV extension elements, tax category AAA/AAM

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| format-validation.spec.ts (EN16931) | 48 | ✅ PASS |
| format-registry.spec.ts (resolution + reachability) | 17 | ✅ PASS |
| national-format-validation.spec.ts | 15 | ✅ PASS |
| **Total** | **72** | **✅ PASS** |

## Architecture

```
InvoiceArtifactPort (interface) — all methods take (invoiceId: string)
├── renderPdf(invoiceId) → PDF bytes
├── renderPdfFormat(invoiceId, format) → PDF/A-3 bytes
├── renderXmlFormat(invoiceId, format) → UBL/CII/XRechnung XML
├── renderFatturaPa(invoiceId) → FatturaPA 1.2 XML  [fetches via fetchRenderData]
├── renderCfdi(invoiceId) → CFDI 4.0 XML            [fetches via fetchRenderData]
├── renderFacturae(invoiceId) → Facturae 3.2.1 XML   [fetches via fetchRenderData]
├── renderKsaUbl(invoiceId) → KSA UBL 2.1 XML       [fetches via fetchRenderData]
├── renderFaVat(invoiceId) → FA_VAT FA(2) XML       [fetches via fetchRenderData]
└── renderNationalXml(invoiceId, countryCode) → Generic router [fetches via fetchRenderData]
    ├── CL → DTE/SII
    ├── AR → FE/AFIP
    ├── EC → FE/SRI
    ├── BR → NF-e/SEFAZ
    ├── TR → e-Fatura/GİB
    ├── CN → e-Fapiao/Golden Tax IV
    ├── EG → ETA
    ├── IN → IRP/GST
    ├── GR → myDATA/AADE
    └── HU → Online Számla/NAV

FormatProvider implementations (providers.ts):
├── En16931FormatProvider (EN 16931 family)
├── PlainPdfFormatProvider (plain PDF)
├── FatturaPaFormatProvider (IT)    → port.renderFatturaPa(externalRef)
├── CfdiFormatProvider (MX)         → port.renderCfdi(externalRef)
├── FacturaeFormatProvider (ES)     → port.renderFacturae(externalRef)
├── KsaUblFormatProvider (SA)       → port.renderKsaUbl(externalRef)
├── FaVatFormatProvider (PL)        → port.renderFaVat(externalRef)
├── NationalXmlFormatProvider (GEN) → port.renderNationalXml(externalRef, cc)
└── NATIONAL_FORMAT_PROVIDERS (stub providers for remaining countries)
```

## Commits

1. `6b3d476` — feat(compliance): implement FatturaPA, CFDI, Facturae, KSA UBL, FA_VAT format providers
2. `5e1435d` — feat(compliance): implement LATAM + TR + IN national XML skeletons (Phase G)
3. `f0f990e` — feat(compliance): add GR myDATA and HU Online Számla XML skeletons (Phase H)

## What's Missing (Next Steps)

### Format validation (authoritative)
- All national formats are structural-gate only. Authoritative validation requires:
  - XSD schemas (L2)
  - Schematron rules (L2/L3)
  - External services (PAC, KSeF, ZATCA, etc.)

### BLOC C — Transmission/Channel
- FatturaPA → SdI submission
- CFDI → PAC → SAT timbrado
- FA_VAT → KSeF API
- KSA UBL → ZATCA FATOORA
- All LATAM TR/IN/EG → government portal APIs

### BLOC A remaining
- A3 LATAM: UY, CR, DO, GT, PA, PY, SV, BO, VE (9 countries)
- A4 Africa: NG, KE, GH, RW, TZ, UG, ZM, ZW, CI, BJ (10 countries)
- A5 Asia: ID, VN, TW, KZ, PH, TH, NP, BD, PK (9 countries)
- A6 MENA/Europe: JO, TN, HR, AL, UA, ME (6 countries)
