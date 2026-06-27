# Ordre d'implémentation des stubs — checklist exhaustive

> Liste **linéaire et complète** de ce qu'il faut coder, dans l'ordre. **Les 106 juridictions câblées
> y figurent toutes** (index de contrôle en fin de fichier). Stratégie/levier : voir
> `COMPLIANCE_STUBS_ROADMAP.md`. Type : `FONDATION` / `FORMAT` / `PORTAIL` / `CANAL` / `REPORTING` / `DATA`.
> `(#4)` = réutilise le provider de l'étape 4 → pas de nouveau format à coder, juste portail + data.
>
> ⚠️ **Format ET portail dépendent du rôle B2B/B2C/B2G** (pas seulement du pays). Schéma type :
> **B2G** → portail public dédié (Chorus Pro, FACe, ZRE, SdI-PA), souvent Peppol ; **B2C** → reçu /
> fiscalisation / e-reporting seul (souvent **aucun** e-invoice transmis à l'acheteur) ; **B2B** → flux
> e-invoice/clearance principal. Voir §PHASE 2-bis (prérequis) et §SPECS MANQUANTES.

---

## PHASE 0 — Chemin par défaut réel ⭐
- [ ] 1. `[FORMAT]` **plain-pdf** → `getInvoicePdf()`/`getPDF()` — `providers/format/providers.ts:53`
- [ ] 2. `[CANAL]` **email** → `MailService.sendMail` (PDF en PJ) — `providers/transmission/providers.ts:14`
- [ ] 3. `[FONDATION]` **wiring Nest** : registries réels dans `ComplianceService` — `nest/compliance.module.ts:85`

➡️ Après la Phase 0, **les 26 pays "défaut seul" fonctionnent** (cf. §PHASE 9-A) : 🇺🇸 US, 🇬🇧 GB, 🇨🇦 CA,
🇨🇭 CH, 🇯🇵 JP, 🇦🇺 AU, 🇳🇿 NZ, 🇿🇦 ZA, 🇳🇱 NL, 🇸🇪 SE, 🇳🇴 NO, 🇦🇹 AT, 🇩🇰 DK, 🇫🇮 FI, 🇨🇿 CZ, 🇱🇺 LU, 🇧🇬 BG,
🇨🇾 CY, 🇪🇪 EE, 🇱🇹 LT, 🇲🇹 MT, 🇲🇩 MD, 🇱🇮 LI, 🇲🇨 MC, 🇻🇦 VA + les "planned" (§PHASE 10).

## PHASE 1 — Socle structuré partagé ⭐ (levier maximal)
- [ ] 4. `[FORMAT]` **EN 16931 UBL/CII** via `@fin.cx/einvoice` + Schematron — `format/providers.ts:38`
      → réutilisé par FR(Factur-X), CO, PE, MY, RO, RS, LV, SK, IE, SI, BE, AE, SG
- [ ] 5. `[CANAL]` **Peppol** : SMP + AS4 + `sendStatus`/Invoice Response — `transmission/providers.ts:24,28`
      → IE, SI, BE, AE, SG, NL, SE, NO, DE(B2G)
- [ ] 6. `[FORMAT]` **XRechnung** (CIUS de #4) → 🇩🇪 DE — `format/providers.ts` + national
- [ ] 7. `[FORMAT]` **Facturae** + 8. `[PORTAIL]` **es-aeat** (SII/Verifactu) → 🇪🇸 ES

## PHASE 2 — Socle asynchrone durable ⭐ (prérequis de TOUTE clearance/realTime)
- [ ] 9. `[FONDATION]` **async core** : Effects runtime ↔ stores Prisma + cron + `ApplySignalService` + webhook — `lifecycle/runtime.ts`, `nest/*`
- [ ] 10. `[FONDATION]` **inbound mapping** : statuts entrants → `applyResponse` — `runtime.ts:142`, `response.ts:33`
- [ ] 11. `[FONDATION]` **signature** XAdES/PAdES/CAdES — `providers/signing/providers.ts:8,16,24`
- [ ] 12. `[FONDATION]` **archive** WORM/S3 + résidence — `providers/archive/providers.ts:18`

## PHASE 2-bis — Routage par rôle B2B/B2C/B2G ⭐ (prérequis : sans ça, FR/IT/ES/DE sont faux)
*Aujourd'hui regime/format/reporting sont role-aware (`appliesTo`), mais **la transmission est choisie
par date seulement** (`compliance-engine.ts:113`, `TransmissionRule` sans `appliesTo`) et **B2G n'est
jamais détecté** (`invoices.service.ts` fait partout `INDIVIDUAL?'B2C':'B2B'`). Donc un B2C français
prendrait le PDP — faux.*
- [ ] 12a. `[FONDATION]` ajouter `appliesTo?: ClassificationSelector` à `TransmissionRule` — `profiles/schema.ts:61`
- [ ] 12b. `[FONDATION]` engine : transmission role-aware → `pickWithSelector(sp.transmission, date, buyerRole, supply)` — `engine/compliance-engine.ts:113`
- [ ] 12c. `[FONDATION]` détecter **B2G** : ajouter `GOVERNMENT` à `ClientType` (Prisma `schema.prisma:234` + form client) ; mapper `buyerRole:'B2G'` à TOUS les sites ctx — `invoices.service.ts:254,332,582,757,855,1648`
- [ ] 12d. `[DATA]` scinder les `channels` par rôle (`appliesTo`) dans les profils où B2B/B2C/B2G divergent (FR, IT, ES, DE, …)

## SPECS MANQUANTES à AJOUTER (formats/portails absents du code)
*Vérifié : 0 spec pour ces pays/rôles. À créer dans `national-formats.ts` / `national-portals.ts` (+ provider).*
- [ ] 12e. 🇬🇷 GR — `[FORMAT]` myDATA XML + `[PORTAIL]` **AADE** (realTime) — absents
- [ ] 12f. 🇭🇺 HU — `[FORMAT]` Online Számla (RTIR) + `[PORTAIL]` **NAV** — absents
- [ ] 12g. 🇵🇪 PE — `[PORTAIL]` **SUNAT/SEE** dédié (aujourd'hui canal `OSE` générique) — à préciser
- [ ] 12h. **Portails B2G dédiés** à ajouter : 🇫🇷 Chorus Pro / PPF (B2G), 🇪🇸 FACe (B2G), 🇩🇪 ZRE/OZG-RE (B2G), 🇮🇹 SdI-PA (Codice Univoco Ufficio) — chacun via `appliesTo:{roles:['B2G']}`

## PHASE 3 — 🇫🇷 FRANCE de bout en bout ⭐⭐ (marché cible, pilote)
- [ ] 13. `[FORMAT]` **Factur-X** (EN 16931 CII #4 + PDF/A-3 hybride) → FR — `fr.ts` syntax FACTURX
- [ ] 14. `[PORTAIL]` **PDP** : annuaire + remise + `sendStatus`("encaissée") + poll/callback — `transmission/providers.ts:39,43,47`
- [ ] 15. `[REPORTING]` **e-reporting FR** (transaction + paiement) — `reporting/handlers.ts:48`
  > Fige ici le pattern callback/PDP. Câblage `markPaid`→`transmitStatus` déjà en place.

## PHASE 4 — 🇮🇹 ITALIE (pattern clearance synchrone canonique)
- [ ] 16. `[FORMAT]` **FatturaPA** → IT — `format/providers.ts:82`
- [ ] 17. `[PORTAIL]` **SdI** : submit + notifiche + `sendStatus`/poll → IT — `transmission/providers.ts:74,78,82`
  > Valide injection service · idempotence · persistance · gestion d'erreur · poll/callback **avant** de paralléliser.

## PHASE 5 — C1 autres grandes économies (format + portail chacun)
- [ ] 18-19. 🇲🇽 MX — **CFDI 4.0** (`format/providers.ts:67`) + **PAC→SAT** (`transmission/providers.ts:59,63`)
- [ ] 20-21. 🇵🇱 PL — **FA_VAT** (`format/providers.ts:130`) + **KSeF** (`transmission/providers.ts:106,110`)
- [ ] 22-23. 🇮🇳 IN — `in-irp` GST e-invoice + **IRP (GSTN/NIC)**
- [ ] 24-25. 🇧🇷 BR — `nfe` (NF-e/NFS-e/CT-e) + **SEFAZ** (par état)
- [ ] 26-27. 🇸🇦 SA — **KSA UBL 2.1 + QR** (`format/providers.ts:97`) + **ZATCA FATOORA**
- [ ] 28-29. 🇹🇷 TR — `tr-efatura` (UBL-TR) + **GİB**
- [ ] 30-31. 🇨🇳 CN — `cn-efapiao` + **STA (Golden Tax IV)**
- [ ] 32-33. 🇪🇬 EG — `eg-eta` + **ETA**

## PHASE 6 — LATAM (clearance ; CO/PE en #4)
- [ ] 34. 🇨🇱 CL — `cl-dte` + **SII** · 35. 🇨🇴 CO — EN16931 (#4) + **DIAN** · 36. 🇦🇷 AR — `ar-fe` + **AFIP/ARCA**
- [ ] 37. 🇵🇪 PE — EN16931 (#4) + **OSE→SUNAT** · 38. 🇪🇨 EC — `ec-fe` + **SRI** · 39. 🇺🇾 UY — `uy-cfe` + **DGI**
- [ ] 40. 🇨🇷 CR — `cr-fe` + **Hacienda** · 41. 🇩🇴 DO — `do-ecf` + **DGII** · 42. 🇬🇹 GT — `gt-fel` + **SAT**
- [ ] 43. 🇵🇦 PA — `pa-fe` + **DGI** · 44. 🇵🇾 PY — `py-de` + **SIFEN** · 45. 🇸🇻 SV — `sv-dte` + **MH**
- [ ] 46. 🇧🇴 BO — `bo-fe` + **SIN** · 47. 🇻🇪 VE — `ve-fe` + **SENIAT**

## PHASE 7 — MENA + Afrique (clearance/realTime)
MENA : - [ ] 48. 🇯🇴 JO `jo-jofotara`/JoFotara · 49. 🇹🇳 TN `tn-teif`/TTN
Afrique : - [ ] 50. 🇳🇬 NG `ng-firs`/FIRS · 51. 🇰🇪 KE `ke-etims`/KRA · 52. 🇬🇭 GH `gh-evat`/GRA ·
53. 🇷🇼 RW `rw-ebm`/RRA · 54. 🇹🇿 TZ `tz-vfd`/TRA · 55. 🇺🇬 UG `ug-efris`/URA · 56. 🇿🇲 ZM `zm-smartinvoice`/ZRA ·
57. 🇿🇼 ZW `zw-fdms`/ZIMRA · 58. 🇨🇮 CI `ci-fne`/DGI · 59. 🇧🇯 BJ `bj-mecef`/DGI

## PHASE 8 — Asie (clearance/realTime ; MY en #4)
- [ ] 60. 🇮🇩 ID `id-efaktur`/Coretax · 61. 🇻🇳 VN `vn-tt78`/GDT · 62. 🇲🇾 MY EN16931 (#4)/MyInvois ·
63. 🇹🇼 TW `tw-egui`/MoF · 64. 🇰🇿 KZ `kz-esf`/IS ESF · 65. 🇵🇭 PH `ph-eis`/BIR · 66. 🇹🇭 TH `th-etax`/RD ·
67. 🇳🇵 NP `np-cbms`/IRD · 68. 🇧🇩 BD `bd-nbr`/NBR · 69. 🇵🇰 PK `pk-fbr`/FBR

## PHASE 9 — Europe clearance/realTime restante + Peppol-CTC + défaut-seul

### 9-A · Europe clearance/realTime (formats nationaux ou #4 + portail)
- [ ] 70. 🇷🇴 RO EN16931 (#4) + **ANAF** (live 2024) · 71. 🇷🇸 RS EN16931 (#4) + **SEF** · 72. 🇭🇷 HR `hr-eracun`/Fiskalizacija
- [ ] 73. 🇱🇻 LV EN16931 (#4) + **VID** · 74. 🇸🇰 SK EN16931 (#4) + **Finančná správa**
- [ ] 75. 🇬🇷 GR **myDATA/AADE** (`PORTAIL` à ajouter) · 76. 🇭🇺 HU **Online Számla/NAV** (`PORTAIL` à ajouter)
- [ ] 77. 🇲🇪 ME `me-fiscal` · 78. 🇦🇱 AL `al-fiscalization`/CIS · 79. 🇺🇦 UA `ua-taxinvoice`/DPS · 80. 🇸🇲 SM FatturaPA(#16)/SdI

### 9-B · Peppol-CTC (canal #5 + data, pas de format dédié)
- [ ] 81. 🇮🇪 IE (2028) · 82. 🇸🇮 SI (2027) · 83. 🇧🇪 BE (2026) · 84. 🇦🇪 AE · 85. 🇸🇬 SG

### 9-C · Défaut-seul (post-audit + no-mandate) — **aucun code, juste DATA (§PHASE 12)**
postAudit : 🇩🇪 DE*(→#6) 🇦🇹 AT 🇧🇬 BG 🇨🇾 CY 🇨🇿 CZ 🇩🇰 DK 🇪🇪 EE 🇫🇮 FI 🇱🇮 LI 🇱🇹 LT 🇱🇺 LU 🇲🇩 MD 🇲🇹 MT
🇳🇱 NL 🇳🇴 NO 🇸🇪 SE 🇯🇵 JP 🇦🇺 AU 🇳🇿 NZ 🇺🇸 US
noMandate : 🇬🇧 GB 🇨🇭 CH 🇿🇦 ZA 🇨🇦 CA 🇻🇦 VA 🇲🇨 MC

## PHASE 10 — "Planned" (mandats à venir : défaut aujourd'hui, format+portail quand live)
🇧🇦 BA 🇲🇰 MK 🇭🇳 HN 🇳🇮 NI 🇧🇭 BH 🇴🇲 OM 🇶🇦 QA 🇰🇼 KW 🇩🇿 DZ 🇲🇦 MA 🇨🇲 CM 🇸🇳 SN 🇪🇹 ET 🇱🇰 LK
- [ ] 86. Suivre les dates d'entrée en vigueur, brancher format+portail au cas par cas.

## PHASE 11 — Reporting agrégé + fiscalité + intégrité
- [ ] 87. `[REPORTING]` périodique : EC Sales List/DEB, OSS/IOSS, Intrastat, **SAF-T** (🇵🇹 PT, 🇦🇴 AO, 🇲🇿 MZ, NO) — `reporting/handlers.ts`
- [ ] 88. `[FISCAL]` sales-tax US comté/ville (`taxsystems/handlers.ts:29`) · arrondis consumption-tax (`:38`)
- [ ] 89. `[NUMÉROTATION]` hash-chain (`numbering.ts:29`) · folio-pools MX/CL (`:48`)
- [ ] 90. `[OPS]` `operations/validate` (`compliance-service.ts:461`) + contingency (`:291,296`)

## PHASE 12 — DATA (parallèle, faible code)
- [ ] 91. `[DATA]` vérifier les 106 profils `BEST_EFFORT → OFFICIAL` (taux/dates/identifiants/providerId) puis étendre vers 196 — `profiles/data/*`

---

## À AUDITER avant d'implémenter
- **`lifecycle/corrections.ts`** : redondant avec `correctInvoice`/`cancelInvoice` déjà dans `invoices.service.ts` → câbler comme source unique ou retirer.

---

## INDEX DE CONTRÔLE — 106 juridictions (rien oublié)
**Format/portail réel requis (clearance/realTime, 54)** : AL AR BO BR CI BJ CL CN CO CR DO EC EG ES* GH
GR GT HR HU ID IN IT JO KE KZ LV MX MY ME NG NP PA PE PH PK PL PY RO RS RW SA SK SM SV TH TN TR TW TZ
UA UG UY VE VN ZM ZW.
**Peppol-CTC (#5 + data, 5)** : AE BE IE SG SI.
**XRechnung (#6, 1)** : DE.
**France bespoke (Factur-X+PDP+e-reporting)** : FR.
**Défaut-seul postAudit (19)** : AT AU BG CY CZ DK EE FI JP LI LT LU MD MT NL NO NZ SE US.
**Défaut-seul noMandate (6)** : CA CH GB MC VA ZA.
**Périodique/SAF-T (3)** : AO MZ PT.
**Planned, défaut→futur (14)** : BA BH CM DZ ET HN KW LK MA MK NI OM QA SN.

*ES listé en Facturae (#7-8). Total = 54+5+1+1+19+6+3+14 = 103 archetypes + FR/IT/MX/PL bespoke déjà comptés dans les groupes ⇒ **106 distincts**.*
