# ToFix 1 - Compliance Module Issues

## BLOCKERS FOR PRODUCTION

- [x] **SdI XAdES signature not implemented** - `sdi.strategy.ts:162-168` - FatturaPA signing returns unsigned XML, critical for Italy
- [x] **Numbering service uses in-memory state** - `numbering.service.ts:30-31` - Sequence lost on server restart, needs database persistence
- [x] **Peppol SMP lookup not implemented** - `peppol.strategy.ts:166-176` - Returns mock/hardcoded data instead of actual lookup
- [ ] **SAF-T transmission strategy missing** - `pt.config.ts` references "saft" platform but no `SaftTransmissionStrategy` exists
- [ ] **Veri*Factu transmission strategy missing** - `es.config.ts` references "verifactu" platform but no strategy class exists

## HIGH PRIORITY

- [ ] **Optional ConfigRegistry without error handling** - `context-builder.service.ts:34-35` and `rule-resolver.service.ts:15,33-37` - Could fail silently or throw undefined errors
- [ ] **Peppol AS4 envelope signing not implemented** - `peppol.strategy.ts:186-201` - Only comments, no actual signing/encryption
- [ ] **SdI response parsing uses regex instead of XML parser** - `sdi.strategy.ts:229-243` - Fragile parsing that could fail
- [ ] **SuperPDP missing `status` field in error responses** - `superpdp.strategy.ts:52,104,130` - Inconsistent response structure
- [ ] **RuleResolver condition evaluation incomplete** - `rule-resolver.service.ts:213-236` - Many conditions return false without proper evaluation

## MEDIUM PRIORITY

- [ ] **VIESService not exported from module** - `compliance.module.ts:32` - Cannot be injected into other modules
- [ ] **QR code service only generates content strings** - `qr-code.service.ts:36-73` - `imageData` field never populated
- [ ] **Hash chain validation doesn't verify actual hashes** - `hash-chain.service.ts:142-166` - Only validates sequence linkage
- [ ] **Correction service uses undefined `requiresPreApproval`** - `correction.service.ts:92,117` - Property may not exist on CorrectionConfig
- [ ] **Email strategy checkStatus returns hardcoded value** - `email.strategy.ts:71-73` - Doesn't properly implement async pattern

## LOW PRIORITY / INCONSISTENCIES

- [ ] **SuperPDP import path inconsistent** - `superpdp.strategy.ts:7` - Uses `'../../interfaces'` instead of `'../transmission.interface'`
- [ ] **Belgium config missing customFields** - `be.config.ts:163-169` - Inconsistent with other configs
- [ ] **Germany config missing platform field in B2B** - `de.config.ts:71-77` - TransmissionRules will have null platform
- [ ] **SdI local interfaces not exported** - `sdi.strategy.ts` - SdIConfig, SdISubmitResponse, SdIStatusResponse not accessible for testing
- [ ] **TransmissionPayload platform fields not validated** - `transmission.interface.ts:60-72` - No validation that required fields are present for specific platforms
- [ ] **VATBreakdownItem category used without null check** - `vat-engine.service.ts:52` - Category is optional but assigned directly

## MISSING STRATEGIES TO IMPLEMENT

- [ ] `SaftTransmissionStrategy` for Portugal
- [ ] `VerifactuTransmissionStrategy` for Spain
- [x] XAdES signing service (shared for Italy and others)

## DOCUMENTATION TODOS FOUND IN CODE

- [ ] SdI: Production implementation incomplete (`sdi.strategy.ts:137,165,202`)
- [x] Peppol: Stub/mock implementations (`peppol.strategy.ts:197-200,222-223`)
- [x] Numbering: In-memory state needs DB (`numbering.service.ts:30-31`)
