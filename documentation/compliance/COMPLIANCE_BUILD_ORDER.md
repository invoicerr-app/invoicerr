# Ordre d'implémentation des stubs — checklist séquentielle

> Liste **linéaire, dans l'ordre**, de ce qu'il faut coder. Chaque étape = une chose concrète
> (`FONDATION` / `FORMAT` / `PORTAIL` / `CANAL`) avec son fichier. Stratégie & levier : voir
> `COMPLIANCE_STUBS_ROADMAP.md`. Cocher au fur et à mesure. Type entre crochets.

## Légende
`FORMAT` = construire le document (XML/PDF national) · `PORTAIL`/`CANAL` = transmettre + recevoir les
statuts · `FONDATION` = brique transversale. ⭐ = jalon.

---

## PHASE 0 — Chemin par défaut réel ⭐ (après : les 24 pays post-audit/no-mandate marchent)
- [ ] 1. `[FORMAT]` **plain-pdf** → brancher sur `getInvoicePdf()`/`getPDF()` — `providers/format/providers.ts:53`
- [ ] 2. `[CANAL]` **email** → injecter `MailService.sendMail` (PDF en PJ) — `providers/transmission/providers.ts:14`
- [ ] 3. `[FONDATION]` **wiring Nest** : passer des registries réels à `ComplianceService` — `nest/compliance.module.ts:85`

## PHASE 1 — Socle EU structuré partagé ⭐ (levier max)
- [ ] 4. `[FORMAT]` **EN 16931 UBL/CII** via `@fin.cx/einvoice` + Schematron — `format/providers.ts:38`
- [ ] 5. `[CANAL]` **Peppol** : SMP lookup + AS4 + `sendStatus` (Invoice Response) — `transmission/providers.ts:24,28`
- [ ] 6. `[FORMAT]` **XRechnung** (CIUS de l'étape 4) → DE — `format/providers.ts` + national
- [ ] 7. `[FORMAT]` **Facturae** → ES — `format/national-formats.ts` (`es-facturae`)
- [ ] 8. `[PORTAIL]` **es-aeat** (SII/Verifactu) → ES — `transmission/national-portals.ts` (`es-aeat`)

## PHASE 2 — Socle asynchrone durable ⭐ (prérequis de TOUTE clearance)
- [ ] 9. `[FONDATION]` **async core** : Effects runtime (SCHEDULE_POLL/ARM_TIMER/AWAIT_CALLBACK) ↔ stores Prisma + cron + `ApplySignalService` + webhook — `lifecycle/runtime.ts`, `nest/*`
- [ ] 10. `[FONDATION]` **inbound mapping** : statuts entrants → `applyResponse` — `lifecycle/runtime.ts:142`, `lifecycle/response.ts:33`
- [ ] 11. `[FONDATION]` **signature** XAdES/PAdES/CAdES — `providers/signing/providers.ts:8,16,24`
- [ ] 12. `[FONDATION]` **archive** WORM/S3 + résidence — `providers/archive/providers.ts:18`

## PHASE 3 — Premier pays clearance de bout en bout ⭐ (fige le pattern)
- [ ] 13. `[FORMAT]` **FatturaPA** → IT — `format/providers.ts:82`
- [ ] 14. `[PORTAIL]` **SdI** : submit + notifiche + `sendStatus`/poll → IT — `transmission/providers.ts:74,78,82`
  > Valider ici : injection service, idempotence, persistance, gestion d'erreur, callback. **Avant** de paralléliser les suivants.

## PHASE 4 — C1 grandes économies, mandats live (format + portail chacun)
- [ ] 15. `[FORMAT]` **CFDI 4.0** → MX — `format/providers.ts:67`
- [ ] 16. `[PORTAIL]` **PAC → SAT** (timbre/UUID/folio + poll) → MX — `transmission/providers.ts:59,63`
- [ ] 17. `[FORMAT]` **in-irp** (GST e-invoice) → IN — `format/national-formats.ts`
- [ ] 18. `[PORTAIL]` **IRP (GSTN/NIC)** → IN — `national-portals.ts`
- [ ] 19. `[FORMAT]` **nfe** (NF-e/NFS-e/CT-e) → BR — `national-formats.ts`
- [ ] 20. `[PORTAIL]` **SEFAZ** (par état) → BR — `national-portals.ts`
- [ ] 21. `[FORMAT]` **KSA UBL 2.1 + QR** → SA — `format/providers.ts:97`
- [ ] 22. `[PORTAIL]` **ZATCA FATOORA** → SA — `national-portals.ts` (`zatca`)
- [ ] 23. `[FORMAT]` **FA_VAT** → PL — `format/providers.ts:130`
- [ ] 24. `[PORTAIL]` **KSeF** (auth + UPO + poll) → PL — `transmission/providers.ts:106,110`
- [ ] 25. `[FORMAT]` **tr-efatura** (UBL-TR) → TR — `national-formats.ts`
- [ ] 26. `[PORTAIL]` **GİB** → TR — `national-portals.ts` (`gib`)
- [ ] 27. `[FORMAT]` **eg-eta** → EG — `national-formats.ts` · 28. `[PORTAIL]` **ETA** → EG
- [ ] 29. `[FORMAT]` **cn-efapiao** → CN — `national-formats.ts` · 30. `[PORTAIL]` **STA (Golden Tax IV)** → CN
  > DE/ES déjà couverts par les étapes 6/7/8.

## PHASE 5 — C2 LATAM CTC (format + portail chacun ; schémas proches)
- [ ] 31. CL — `cl-dte` + **SII**
- [ ] 32. CO — DIAN (format + `dian`)
- [ ] 33. AR — `ar-fe` + **AFIP/ARCA**
- [ ] 34. PE — OSE + **SUNAT**
- [ ] 35. EC — `ec-fe` + **SRI**
- [ ] 36. UY — `uy-cfe` + **DGI**
- [ ] 37. CR — `cr-fe` + **Hacienda**
- [ ] 38. DO — `do-ecf` + **DGII**
- [ ] 39. GT — `gt-fel` + **SAT**
- [ ] 40. PA — `pa-fe` + **DGI**
- [ ] 41. PY — `py-de` + **SIFEN**
- [ ] 42. SV — `sv-dte` + **MH**
- [ ] 43. BO — `bo-fe` + **SIN**
- [ ] 44. VE — `ve-fe` + **SENIAT**

## PHASE 6 — C3 Afrique + Asie (mandats émergents)
Afrique :
- [ ] 45. KE `ke-etims`/KRA · 46. NG `ng-firs`/FIRS · 47. GH `gh-evat`/GRA · 48. RW `rw-ebm`/RRA ·
  49. TZ `tz-vfd`/TRA · 50. UG `ug-efris`/URA · 51. ZM `zm-smartinvoice`/ZRA · 52. ZW `zw-fdms`/ZIMRA ·
  53. CI `ci-fne`/DGI · 54. BJ `bj-mecef`/DGI · 55. TN `tn-teif`/TTN · 56. JO `jo-jofotara`/JoFotara

Asie :
- [ ] 57. ID `id-efaktur`/Coretax · 58. VN `vn-tt78`/GDT · 59. MY MyInvois · 60. PH `ph-eis`/BIR ·
  61. TW `tw-egui`/MoF · 62. KZ `kz-esf`/IS ESF · 63. TH `th-etax`/RD · 64. NP `np-cbms`/IRD ·
  65. BD `bd-nbr`/NBR · 66. PK `pk-fbr`/FBR

## PHASE 7 — C4 UE planifiée 2026-28 (réutilise EN 16931 + Peppol → surtout portail + data)
- [ ] 67. RO **ANAF** (e-Factura, live 2024 ; format = EN16931 UBL déjà fait)
- [ ] 68. RS **SEF** (`rs-sef`) · 69. BE Peppol (2026, canal déjà fait → data) · 70. HR `hr-eracun`/Fiskalizacija ·
  71. LV **VID** · 72. SK **Finančná správa** · 73. SI Peppol (2027) · 74. IE Peppol (2028) ·
  75. UA `ua-taxinvoice`/DPS · 76. AL `al-fiscalization`/CIS · 77. ME `me-fiscal`

## PHASE 8 — Reporting, fiscalité, data (en parallèle, faible blocage)
- [ ] 78. `[REPORTING]` e-reporting FR — `reporting/handlers.ts:48`
- [ ] 79. `[REPORTING]` EC Sales List / OSS / IOSS / Intrastat / SAF-T — `reporting/handlers.ts`
- [ ] 80. `[FISCAL]` sales-tax US comté/ville — `taxsystems/handlers.ts:29` · arrondis consumption-tax `:38`
- [ ] 81. `[NUMÉROTATION]` hash-chain — `numbering.ts:29` · folio-pools MX/CL — `:48`
- [ ] 82. `[DATA]` vérifier les 100 profils `BEST_EFFORT → OFFICIAL` (taux/dates/identifiants) puis étendre vers 196 — `profiles/data/*`

---

## À auditer avant d'y toucher
- **`lifecycle/corrections.ts`** : redondant avec `correctInvoice`/`cancelInvoice` déjà dans
  `invoices.service.ts` → câbler comme source unique **ou** retirer.
- **`operations/validate`** (`compliance-service.ts:461`) + **contingency** (`:291,296`) : à traiter avec la PHASE 2.
