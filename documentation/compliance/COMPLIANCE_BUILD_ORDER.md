# Ordre d'implémentation des stubs — FORMATS d'abord, puis ENVOIS

> Liste **linéaire et complète**, dans l'ordre demandé : **(1) tous les FORMATS, puis (2) tous les
> ENVOIS** (email, PDP, plateformes…). **Les 106 juridictions câblées y figurent** (index de contrôle
> en fin). Stratégie/levier : `COMPLIANCE_STUBS_ROADMAP.md`.
> Type : `FONDATION` / `FORMAT` / `ENVOI` / `REPORTING` / `DATA`. `(#n)` = réutilise le provider de l'étape n.
>
> ⚠️ **Le couple (régime, format, canal) par rôle B2B/B2C/B2G est de la CONFIG par pays** (via `appliesTo`
> dans le profil, cf. `fr.ts`), **pas une règle universelle**. Ici on liste les *providers* à coder ;
> *quel* rôle utilise *quel* format/envoi se déclare dans chaque profil (axe DATA, §BLOC E).

> 🟢 **Déjà réel — NE PAS recoder.** Le chemin par défaut (PDF, EN 16931 / Factur-X, email) existe
> **déjà** dans `invoices.service.ts` (`getInvoicePdf` via Handlebars+`getPDF`; `getInvoiceXMLFormat`
> via `@fin.cx/einvoice` → EN16931/Factur-X/UBL ; `sendInvoiceByEmail` via `MailService`). Les stubs
> `plain-pdf` (#2), `EN 16931` (#3), `Factur-X` (#4) et `email` (#60) **dupliquaient** ce code → la
> **PHASE 0** ci-dessous les **branche sur l'existant** (déplacement de code, pas réécriture) au lieu
> de les réimplémenter.

> ⚖️ **Cycle de vie complet vs numérotation.** Aujourd'hui le pipeline va de bout en bout
> **uniquement pour les pays `GAPLESS_SELF`** (numéro auto-assigné par l'app — FR, DE, IT, ES, BE…).
> Les pays `AUTHORITY_RANGE` (numéro attribué par l'autorité — 🇲🇽 MX/CFDI et cie) sont
> **correctement bloqués** : l'app **throw** `"Numbering model is AUTHORITY_RANGE … self-assignment is
> not allowed. Use the compliance engine's FolioPool instead."` tant que les FolioPool (#124) et les
> stubs clearance (#65, BLOC C) ne sont pas réels. Ce n'est **pas un bug** — c'est la garde attendue.

---

## PHASE 0 — refactor `invoices.service` → délégation config-driven (déplacer, pas réécrire)
> But : faire que `invoices.service` **appelle la compliance** (résolue par la config du pays/rôle)
> au lieu de hardcoder PDF/format/email. Le code réel existant est **déplacé**, pas réécrit.

- [x] **0.1** Extraire `InvoiceRenderingService` (cycle-safe, sans import compliance) — `modules/invoice-rendering/` · ✅ `fca7e241`
- [x] **0.2** Format providers délèguent via `InvoiceArtifactPort` (`ctx.externalRef` → `renderPdf`/`renderPdfFormat`) — `providers/format/providers.ts` · ✅ `673635d6`
- [x] **0.3** Transmission **email réelle** : `EmailTransmissionProvider` → `InvoiceMailPort`/`InvoiceMailGateway` (cycle-safe), `transmit`/`transmitAll`/`execute` async — `providers/transmission/` · ✅
- [x] **0.4** `sendInvoiceByEmail` réduit à `complianceService.send()` **config-driven**, bloc PDF+email hardcodé retiré, `MailService` sorti de `invoices.service` — `modules/invoices/invoices.service.ts` · ✅
- [x] **1.** `[FONDATION]` **wiring Nest** : `FormatProviderRegistry({artifacts})` + `TransmissionProviderRegistry({mail})` → `ComplianceExecutor({formats, transmission})` → `ComplianceService` — `nest/compliance.module.ts` · ✅

---

# BLOC A — FORMATS (tout, dans l'ordre)

## A1 · Défaut + partagés (levier maximal)
> 🟢 #2/#3/#4 sont **déjà implémentés dans `invoices.service.ts`** et **réutilisés** via la PHASE 0
> (le provider délègue à `InvoiceRenderingService` par `ctx.externalRef`). **À NE PAS recoder** —
> reste seulement à finir 0.3/0.4 (envoi config-driven). Le Schematron de validation est l'unique
> ajout optionnel résiduel sur #3.
- [x] 2. `[FORMAT]` **plain-pdf** → délègue `getInvoicePdf()`/`getPDF()` (déjà réel) — `format/providers.ts` via port · *tous les pays défaut*
- [x] 3. `[FORMAT]` **EN 16931 UBL/CII** via `@fin.cx/einvoice` (déjà réel dans `getInvoiceXMLFormat`) — délègue via port · **XML pur ✅** (renderXmlFormat + exportXml), reste Schematron
      → FR(base Factur-X), CO, PE, MY, RO, RS, LV, SK, IE, SI, BE, AE, SG · *(reste : Schematron, optionnel)*
- [x] 4. `[FORMAT]` **Factur-X** (EN 16931 CII + PDF/A-3 hybride, déjà réel via `embedInPdf`) → 🇫🇷 FR — délègue via port · **casing fix ✅** (export formats now lowercase, matching @fin.cx/einvoice API)
      Validation : in-memory + structural bytes (guideline `urn:cen.eu:en16931:2017`), pas de round-trip CII via fromXml (bug lib). Byte-level autoritaire → L2 (Mustang) / L3 (EC ITB).
- [x] 5. `[FORMAT]` **XRechnung** (CIUS de #3) → 🇩🇪 DE — **rendu ✅** (exportXml('xrechnung') via renderXmlFormat)
      Validation round-trip UBL OK. **Gap data connu** : BR-DE-11 (tél vendeur), BR-DE-12 (email vendeur), BR-DE-13 (EndpointID acheteur Peppol), BR-DE-14 (code moyen paiement UNTDID 4461) — champs absents du modèle company/client/payment, à ajouter avant XRechnung B2G live.
- [ ] 6. `[FORMAT]` **Facturae** → 🇪🇸 ES — `national-formats.ts` (`es-facturae`)

## A2 · Grands formats nationaux (marchés majeurs)
- [ ] 7. `[FORMAT]` **FatturaPA** → 🇮🇹 IT, 🇸🇲 SM — `format/providers.ts:82`
- [ ] 8. `[FORMAT]` **CFDI 4.0** → 🇲🇽 MX — `format/providers.ts:67`
- [ ] 9. `[FORMAT]` **FA_VAT** → 🇵🇱 PL — `format/providers.ts:130`
- [ ] 10. `[FORMAT]` **KSA UBL 2.1 + QR** → 🇸🇦 SA — `format/providers.ts:97`
- [ ] 11. `[FORMAT]` `in-irp` (GST e-invoice) → 🇮🇳 IN
- [ ] 12. `[FORMAT]` `nfe` (NF-e/NFS-e/CT-e) → 🇧🇷 BR
- [ ] 13. `[FORMAT]` `tr-efatura` (UBL-TR) → 🇹🇷 TR
- [ ] 14. `[FORMAT]` `cn-efapiao` → 🇨🇳 CN
- [ ] 15. `[FORMAT]` `eg-eta` → 🇪🇬 EG

## A3 · LATAM (CO & PE réutilisent #3)
- [ ] 16. 🇨🇱 `cl-dte` · 17. 🇦🇷 `ar-fe` · 18. 🇪🇨 `ec-fe` · 19. 🇺🇾 `uy-cfe` · 20. 🇨🇷 `cr-fe` ·
  21. 🇩🇴 `do-ecf` · 22. 🇬🇹 `gt-fel` · 23. 🇵🇦 `pa-fe` · 24. 🇵🇾 `py-de` · 25. 🇸🇻 `sv-dte` ·
  26. 🇧🇴 `bo-fe` · 27. 🇻🇪 `ve-fe`

## A4 · Afrique
- [ ] 28. 🇳🇬 `ng-firs` · 29. 🇰🇪 `ke-etims` · 30. 🇬🇭 `gh-evat` · 31. 🇷🇼 `rw-ebm` · 32. 🇹🇿 `tz-vfd` ·
  33. 🇺🇬 `ug-efris` · 34. 🇿🇲 `zm-smartinvoice` · 35. 🇿🇼 `zw-fdms` · 36. 🇨🇮 `ci-fne` · 37. 🇧🇯 `bj-mecef`

## A5 · Asie (MY réutilise #3)
- [ ] 38. 🇮🇩 `id-efaktur` · 39. 🇻🇳 `vn-tt78` · 40. 🇹🇼 `tw-egui` · 41. 🇰🇿 `kz-esf` · 42. 🇵🇭 `ph-eis` ·
  43. 🇹🇭 `th-etax` · 44. 🇳🇵 `np-cbms` · 45. 🇧🇩 `bd-nbr` · 46. 🇵🇰 `pk-fbr`

## A6 · MENA + Europe (autres formats nationaux)
- [ ] 47. 🇯🇴 `jo-jofotara` · 48. 🇹🇳 `tn-teif` · 49. 🇭🇷 `hr-eracun` · 50. 🇦🇱 `al-fiscalization` ·
  51. 🇺🇦 `ua-taxinvoice` · 52. 🇲🇪 `me-fiscal`

## A7 · Formats absents du code — à CRÉER
- [ ] 53. 🇬🇷 GR — `[FORMAT]` **myDATA** XML (realTime) — absent
- [ ] 54. 🇭🇺 HU — `[FORMAT]` **Online Számla** (RTIR) — absent

> RO, RS, LV, SK, CO, PE, MY, IE, SI, BE, AE, SG : **aucun format à coder** (EN 16931 #3) → tout est en BLOC C/E.

---

# BLOC B — prérequis aux envois (fondations transverses)
- [ ] 55. `[FONDATION]` **async core** : Effects runtime ↔ stores Prisma + cron + `ApplySignalService` + webhook — `lifecycle/runtime.ts`, `nest/*`
- [ ] 56. `[FONDATION]` **inbound mapping** : statuts entrants → `applyResponse` — `runtime.ts:142`, `response.ts:33`
- [ ] 57. `[FONDATION]` **routage par rôle** : `appliesTo` sur `TransmissionRule` (`schema.ts:61`) + engine role-aware (`engine:113`) + B2G (`ClientType.GOVERNMENT` Prisma + ctx `invoices.service`)
- [ ] 58. `[FONDATION]` **signature** XAdES/PAdES/CAdES — `signing/providers.ts:8,16,24`
- [ ] 59. `[FONDATION]` **archive** WORM/S3 + résidence — `archive/providers.ts:18`

---

# BLOC C — ENVOIS / TRANSMISSIONS (tout, dans l'ordre)

## C1 · Défaut + France + partagés
> 🟢 #60 **email** : ✅ **fait** (PHASE 0.3/0.4). Déplacé dans `EmailTransmissionProvider` via
> `InvoiceMailPort`/`InvoiceMailGateway` ; `sendInvoiceByEmail` appelle désormais
> `complianceService.send()` config-driven. `MailService` retiré de `invoices.service`.
- [x] 60. `[ENVOI]` **email** → `InvoiceMailGateway` (`MailService.sendMail`, PDF en PJ) via provider transmission · *tous les pays défaut*
- [ ] 61. `[ENVOI]` **print** (reçus B2C/fiscalisation) — `transmission/providers.ts:133`
- [ ] 62. `[ENVOI]` **PDP** (annuaire + remise + `sendStatus` + poll/callback) → 🇫🇷 FR — `transmission/providers.ts:39,43,47`
- [ ] 63. `[ENVOI]` **Peppol** (SMP + AS4 + Invoice Response) → IE, SI, BE, AE, SG, NL, SE, NO, DE(B2G) — `transmission/providers.ts:24,28`

## C2 · Grandes plateformes clearance/RTR
- [ ] 64. **SdI** → 🇮🇹 IT, 🇸🇲 SM — `transmission/providers.ts:74,78,82`
- [ ] 65. **PAC → SAT** → 🇲🇽 MX — `transmission/providers.ts:59,63`
- [ ] 66. **KSeF** → 🇵🇱 PL — `transmission/providers.ts:106,110`
- [ ] 67. **ZATCA FATOORA** → 🇸🇦 SA · 68. **es-aeat** (SII/Verifactu) → 🇪🇸 ES
- [ ] 69. **IRP (GSTN/NIC)** → 🇮🇳 IN · 70. **SEFAZ** (par état) → 🇧🇷 BR · 71. **GİB** → 🇹🇷 TR ·
  72. **STA** (Golden Tax IV) → 🇨🇳 CN · 73. **ETA** → 🇪🇬 EG

## C3 · LATAM portals
- [ ] 74. 🇨🇱 **SII** · 75. 🇨🇴 **DIAN** · 76. 🇦🇷 **AFIP/ARCA** · 77. 🇵🇪 **SUNAT/SEE** *(à créer — `OSE` générique aujourd'hui)* ·
  78. 🇪🇨 **SRI** · 79. 🇺🇾 **DGI** · 80. 🇨🇷 **Hacienda** · 81. 🇩🇴 **DGII** · 82. 🇬🇹 **SAT** ·
  83. 🇵🇦 **DGI** · 84. 🇵🇾 **SIFEN** · 85. 🇸🇻 **MH** · 86. 🇧🇴 **SIN** · 87. 🇻🇪 **SENIAT**

## C4 · Afrique portals
- [ ] 88. 🇳🇬 FIRS · 89. 🇰🇪 KRA · 90. 🇬🇭 GRA · 91. 🇷🇼 RRA · 92. 🇹🇿 TRA · 93. 🇺🇬 URA · 94. 🇿🇲 ZRA ·
  95. 🇿🇼 ZIMRA · 96. 🇨🇮 DGI · 97. 🇧🇯 DGI · 98. 🇯🇴 JoFotara · 99. 🇹🇳 TTN

## C5 · Asie portals
- [ ] 100. 🇮🇩 Coretax · 101. 🇻🇳 GDT · 102. 🇲🇾 MyInvois · 103. 🇹🇼 MoF · 104. 🇰🇿 IS ESF ·
  105. 🇵🇭 BIR · 106. 🇹🇭 RD · 107. 🇳🇵 IRD · 108. 🇧🇩 NBR · 109. 🇵🇰 FBR

## C6 · Europe (autres portals) + manquants + B2G
- [ ] 110. 🇷🇴 **ANAF** · 111. 🇷🇸 **SEF** · 112. 🇭🇷 **Fiskalizacija** · 113. 🇱🇻 **VID** · 114. 🇸🇰 **Finančná správa** ·
  115. 🇺🇦 **DPS** · 116. 🇦🇱 **CIS** · 117. 🇲🇪 fiscal
- [ ] 118. **à CRÉER** : 🇬🇷 **AADE** (myDATA) · 119. 🇭🇺 **NAV** (Online Számla)
- [ ] 120. **Portails B2G** (config par profil, `appliesTo:{roles:['B2G']}`) : 🇫🇷 Chorus Pro/PPF · 🇪🇸 FACe · 🇩🇪 ZRE/OZG-RE · 🇮🇹 SdI-PA

---

# BLOC D — Reporting, fiscalité, intégrité
- [ ] 121. `[REPORTING]` **e-reporting FR** (transaction + paiement) → go-live 🇫🇷 FR — `reporting/handlers.ts:48`
- [ ] 122. `[REPORTING]` périodique : EC Sales List/DEB, OSS/IOSS, Intrastat, **SAF-T** (🇵🇹 PT, 🇦🇴 AO, 🇲🇿 MZ, NO) — `reporting/handlers.ts`
- [ ] 123. `[FISCAL]` sales-tax US comté/ville (`taxsystems/handlers.ts:29`) · arrondis consumption-tax (`:38`)
- [ ] 124. `[NUMÉROTATION]` hash-chain (`numbering.ts:29`) · folio-pools MX/CL (`:48`)
- [ ] 125. `[OPS]` `operations/validate` (`compliance-service.ts:461`) + contingency (`:291,296`)

# BLOC E — DATA (config par pays + par rôle ; parallèle, faible code)
- [ ] 126. `[DATA]` déclarer dans CHAQUE profil les règles **par rôle** (regime/format/canal/reporting via `appliesTo`), à la manière de `fr.ts`. Vérifier les 106 profils `BEST_EFFORT → OFFICIAL` puis étendre vers 196 — `profiles/data/*`

---

## Jalons
- 🟢 **Atteint** : #2-3-4 (PDF + EN 16931 + Factur-X) **déjà réels** et réutilisés (PHASE 0.1/0.2) →
  la majorité des pays `GAPLESS_SELF` ont déjà un format réel **et** un cycle de vie complet
  (issue→build→email→encaissée), validé par la suite de scénarios CI multi-pays (fr-be, de-fr, it-it, es-pt).
- 🟢 **Atteint (PHASE 0.3/0.4)** : email **config-driven** → `sendInvoiceByEmail` délègue à `complianceService.send()`,
  envoi réel via `EmailTransmissionProvider`/`InvoiceMailGateway`. Le chemin par défaut est désormais **entièrement** piloté par la config.
- 🟢 **Atteint (A1 XML pur)** : EN 16931 XML pur (#3 UBL/CII + #5 XRechnung + PEPPOL_BIS) via `renderXmlFormat`/`exportXml`
  + casing fix #4 (FACTURX/ZUGFERD/PDF_A3 lowercase → `embedInPdf`). Debloque BE, IE, SI, AE, SG, LV, SK, RO, RS + DE XRechnung.
  Validation L1 : in-memory + structural bytes pour CII/facturx/zugferd ; round-trip UBL pour ubl/xrechnung. Byte-level autoritaire → L2/L3.
  **Gap XRechnung** : rendu structurel OK mais données manquantes (tél/email vendeur, EndpointID acheteur, payment means code) — tracer avant B2G.
- **🇫🇷 France** complète = #4 (Factur-X ✅) + #62 (PDP) + #121 (e-reporting) — marché cible.
- Premier clearance/`AUTHORITY_RANGE` de bout en bout = **🇲🇽 MX** (#124 FolioPool + #65 PAC→SAT) :
  débloque les pays où le numéro vient de l'autorité (aujourd'hui **bloqués à dessein**, cf. encadré ⚖️ en tête).
- Premier clearance Peppol/SdI de bout en bout = **🇮🇹 IT** (#7 format + #64 SdI) : valide injection/idempotence/persistance/callback avant de paralléliser C3-C6.

## À AUDITER
- `lifecycle/corrections.ts` : redondant avec `correctInvoice`/`cancelInvoice` déjà dans `invoices.service.ts` → source unique ou retirer.

---

## INDEX DE CONTRÔLE — 106 juridictions
**Format national propre (à coder)** : AL AR BD BO BR CI BJ CL CN CR DO EC EG ES GH GR(à créer) GT HR HU(à
créer) ID IN IT JO KE KZ ME MX NG NP PA PY PH PK PL RW SA SM SV TH TN TR TW TZ UA UG UY VE VN ZM ZW.
**Format = EN 16931 (#3, pas de code)** : CO, PE, MY, RO, RS, LV, SK, IE, SI, BE, AE, SG, + base FR.
**Format partagé** : DE (XRechnung #5), ES (Facturae #6), FR (Factur-X #4).
**Envoi national/portail (à coder)** : tous les pays clearance/realTime ci-dessus + B2G (FR/ES/DE/IT).
**Défaut seul (PDF #2 + email #60)** — postAudit (19) : AT AU BG CY CZ DK EE FI JP LI LT LU MD MT NL NO NZ
SE US ; noMandate (6) : CA CH GB MC VA ZA.
**Périodique/SAF-T** : AO MZ PT. **Planned (défaut→futur)** : BA BH CM DZ ET HN KW LK MA MK NI OM QA SN.

*Total = 106 (vérifié). Les pays "défaut seul" et "planned" n'ont besoin que de #2 + #60 aujourd'hui ;
leur seul reste est l'axe DATA (#126).*

> ⚖️ **Rappel cycle de vie (cf. encadré en tête).** Tous les pays ci-dessus en `GAPLESS_SELF`
> (numéro auto-assigné : défaut seul, planned, FR/DE/IT/ES/BE… post-format) ont déjà un **cycle
> complet** une fois la PHASE 0 finie. Les pays `AUTHORITY_RANGE` (MX/CFDI et autres clearance où
> l'autorité attribue le numéro) restent **volontairement bloqués** jusqu'aux FolioPool (#124) +
> stubs clearance (BLOC C) — l'app throw au lieu d'auto-assigner. À ne pas confondre avec un défaut.
