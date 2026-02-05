# Architecture vs Implementation - Differences Analysis

This document compares what was planned in `ARCHITECTURE.md` with the current implementation status, and documents decisions for each difference.

---

## Summary

| Category | Planned | Implemented | Status |
|----------|---------|-------------|--------|
| Interfaces | 12 | 12 | ✅ Complete |
| Services | 8 | 9 | ✅ +1 (xades-signature) |
| Country Configs | 25 + generic | 6 + generic | ⏳ Partial |
| Transmission Strategies | 15 + base | 9 | ⏳ Partial (+2 new) |
| Format Generators | 12 | 0 | ❌ Not started |

---

## 1. Transmission Strategies

### Implemented (Planned)

| Strategy | Platform | Status |
|----------|----------|--------|
| `email.strategy.ts` | Fallback | ✅ Implemented |
| `chorus.strategy.ts` | France B2G | ✅ Implemented |
| `superpdp.strategy.ts` | France B2B | ✅ Implemented |
| `sdi.strategy.ts` | Italy (SdI) | ✅ Implemented |
| `peppol.strategy.ts` | Multi-country | ✅ Implemented |

### Implemented (Not in Original Plan)

| Strategy | Platform | Decision |
|----------|----------|----------|
| `saft.strategy.ts` | Portugal SAF-T | ✅ **CURRENT BETTER** - Required for PT hash chaining. Add to ARCHITECTURE.md |
| `verifactu.strategy.ts` | Spain Veri*Factu | ✅ **CURRENT BETTER** - Required for ES hash chaining. Add to ARCHITECTURE.md |

### Not Implemented (Planned)

| Strategy | Platform | Decision |
|----------|----------|----------|
| `base.strategy.ts` | Abstract base | 🔧 **ARCHITECTURE BETTER** - Should implement to reduce duplication |
| `ksef.strategy.ts` | Poland | ⏳ Roadmap - Tier 1 clearance country |
| `nav.strategy.ts` | Hungary | ⏳ Roadmap - Tier 3 RTTR country |
| `spv.strategy.ts` | Romania | ⏳ Roadmap - Tier 1 clearance country |
| `mydata.strategy.ts` | Greece | ⏳ Roadmap - Tier 3 RTTR country |
| `leqi.strategy.ts` | China | ⏳ Roadmap - Tier 1 clearance country (complex) |
| `gib.strategy.ts` | Turkey | ⏳ Roadmap - Tier 1 clearance country |
| `sef.strategy.ts` | Serbia | ⏳ Roadmap - Tier 1 clearance country |
| `irp.strategy.ts` | India | ⏳ Roadmap - Tier 1 clearance country |
| `myinvois.strategy.ts` | Malaysia | ⏳ Roadmap - Tier 1 clearance country |
| `tvan.strategy.ts` | Vietnam | ⏳ Roadmap - Tier 1 clearance country |

---

## 2. Services

### Implemented (Planned)

| Service | Purpose | Status |
|---------|---------|--------|
| `context-builder.service.ts` | Build TransactionContext | ✅ Implemented |
| `rule-resolver.service.ts` | Resolve rules from context | ✅ Implemented |
| `vat-engine.service.ts` | VAT calculation | ✅ Implemented |
| `correction.service.ts` | Credit note management | ✅ Implemented |
| `numbering.service.ts` | Invoice numbering | ✅ Implemented |
| `hash-chain.service.ts` | ES/PT hash chaining | ✅ Implemented |
| `qr-code.service.ts` | QR code generation | ✅ Implemented |
| `vies.service.ts` | EU VAT validation | ✅ Implemented |

### Implemented (Not in Original Plan)

| Service | Purpose | Decision |
|---------|---------|----------|
| `xades-signature.service.ts` | XAdES-BES signing | ✅ **CURRENT BETTER** - Required for FatturaPA (IT) and Verifactu (ES). Add to ARCHITECTURE.md |

---

## 3. Country Configurations

### Implemented

| Country | Status | Notes |
|---------|--------|-------|
| 🇫🇷 France (FR) | ✅ Implemented | PDP + Chorus Pro |
| 🇩🇪 Germany (DE) | ✅ Implemented | Peppol + XRechnung |
| 🇧🇪 Belgium (BE) | ✅ Implemented | Peppol |
| 🇮🇹 Italy (IT) | ✅ Implemented | SdI clearance |
| 🇪🇸 Spain (ES) | ✅ Implemented | Veri*Factu hash chain |
| 🇵🇹 Portugal (PT) | ✅ Implemented | ATCUD + SAF-T |
| 🌍 Generic | ✅ Implemented | Fallback for unlisted |

### Not Implemented (Planned)

**Tier 1 - Clearance Countries (Complex)**
| Country | Platform | Priority |
|---------|----------|----------|
| 🇵🇱 Poland (PL) | KSeF | ⏳ High - Mandatory 2026 |
| 🇨🇳 China (CN) | Leqi/Golden Tax | ⏳ Medium - Complex (SM2) |
| 🇹🇷 Turkey (TR) | GİB e-Fatura | ⏳ Medium |
| 🇮🇳 India (IN) | IRP | ⏳ Medium |
| 🇲🇾 Malaysia (MY) | MyInvois | ⏳ Medium |
| 🇷🇸 Serbia (RS) | SEF | ⏳ Low |
| 🇻🇳 Vietnam (VN) | T-VAN | ⏳ Low |

**Tier 2 - RTTR Countries**
| Country | Platform | Priority |
|---------|----------|----------|
| 🇭🇺 Hungary (HU) | NAV | ⏳ Medium |
| 🇷🇴 Romania (RO) | SPV | ⏳ Medium |
| 🇬🇷 Greece (GR) | myDATA | ⏳ Medium |

**Tier 3 - Peppol Countries**
| Country | Priority |
|---------|----------|
| 🇬🇧 UK (GB) | ⏳ Low - NHS specific |
| 🇳🇱 Netherlands (NL) | ⏳ Low |
| 🇳🇴 Norway (NO) | ⏳ Low |
| 🇸🇪 Sweden (SE) | ⏳ Low |
| 🇦🇹 Austria (AT) | ⏳ Low |
| 🇦🇺 Australia (AU) | ⏳ Low |
| 🇳🇿 New Zealand (NZ) | ⏳ Low |
| 🇯🇵 Japan (JP) | ⏳ Low |
| 🇸🇬 Singapore (SG) | ⏳ Low |

**Tier 4 - Simple/Payment**
| Country | Priority |
|---------|----------|
| 🇨🇭 Switzerland (CH) | ⏳ Low - QR-Bill only |

**Decision**: Country configs can be added incrementally as needed. The generic fallback handles unlisted countries.

---

## 4. Format Generators

### Not Implemented (Entire folder missing)

The `formats/` folder was planned but not implemented:

| Generator | Format | Decision |
|-----------|--------|----------|
| `format.service.ts` | Orchestrator | ⏳ **ARCHITECTURE BETTER** - Needed for e-invoicing |
| `base.generator.ts` | Abstract base | ⏳ **ARCHITECTURE BETTER** - Reduce duplication |
| `facturx.generator.ts` | FR, DE | ⏳ Roadmap |
| `xrechnung.generator.ts` | DE B2G | ⏳ Roadmap |
| `fatturaPA.generator.ts` | IT | ⏳ Roadmap |
| `facturae.generator.ts` | ES | ⏳ Roadmap |
| `fa3.generator.ts` | PL KSeF | ⏳ Roadmap |
| `ubl.generator.ts` | Generic UBL 2.1 | ⏳ Roadmap |
| `pint.generator.ts` | AU, NZ, JP, SG | ⏳ Roadmap |
| `cii.generator.ts` | Generic CII | ⏳ Roadmap |
| `mydata.generator.ts` | GR | ⏳ Roadmap |
| `nav.generator.ts` | HU | ⏳ Roadmap |
| `gst-json.generator.ts` | IN | ⏳ Roadmap |

**Decision**: Format generators are essential for proper e-invoicing. Should be implemented based on country priority.

---

## 5. Interfaces

All 12 interfaces from ARCHITECTURE.md are implemented:

| Interface | Status |
|-----------|--------|
| `vat.interface.ts` | ✅ |
| `identifier.interface.ts` | ✅ |
| `transmission.interface.ts` | ✅ |
| `numbering.interface.ts` | ✅ |
| `format.interface.ts` | ✅ |
| `signature.interface.ts` | ✅ |
| `correction.interface.ts` | ✅ |
| `archiving.interface.ts` | ✅ |
| `clearance.interface.ts` | ✅ |
| `peppol.interface.ts` | ✅ |
| `country-config.interface.ts` | ✅ |
| `transaction-context.interface.ts` | ✅ |
| `applicable-rules.interface.ts` | ✅ |

---

## 6. DTOs

### Planned vs Implemented

| DTO | Planned | Current | Decision |
|-----|---------|---------|----------|
| `compliance-config.dto.ts` | ✅ | ✅ Implemented | ✅ Match |
| `transmission-result.dto.ts` | ✅ | Merged into transmission.interface.ts | ✅ **CURRENT BETTER** - Less file proliferation |
| `vat-calculation.dto.ts` | ✅ | Merged into vat-engine.service.ts | ✅ **CURRENT BETTER** - Co-located with logic |

---

## 7. Additional Improvements Made

These improvements were made during implementation that weren't in the original plan:

1. **Database persistence for numbering** - `NumberingSequence` Prisma model added for atomic counter increments
2. **XAdES-BES signature service** - Full implementation for FatturaPA and Verifactu
3. **SAF-T transmission** - Portugal-specific transmission strategy
4. **Verifactu transmission** - Spain-specific with hash chain integration
5. **SMP lookup for Peppol** - Actual Service Metadata Publisher resolution
6. **mTLS support for SdI** - Client certificate authentication for Italy

---

## 8. Action Items

### Immediate (To Implement Now)

1. ~~**`base.strategy.ts`** - Create abstract base class to reduce code duplication~~ Deferred - Current strategies work well independently

### Short-term (Next Phase)

2. **Format generators** - Start with `ubl.generator.ts` and `facturx.generator.ts`
3. **Poland config + KSeF** - Mandatory deadline approaching (2026)

### Medium-term (Future Phases)

4. Additional country configs based on user demand
5. Remaining transmission strategies

---

## 9. Architecture Deviations - Justification

| Deviation | Reason |
|-----------|--------|
| No `base.strategy.ts` | Strategies are simple enough that inheritance adds complexity without benefit. Each strategy has unique auth/payload requirements. |
| DTOs merged into interfaces | Reduces file count, keeps types co-located with usage |
| Extra strategies (saft, verifactu) | Required for ES/PT hash chaining - oversight in original plan |
| Extra service (xades-signature) | Required for IT/ES digital signatures - oversight in original plan |

---

*Last updated: January 23, 2026*
