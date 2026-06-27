# Roadmap — implémentation des stubs compliance

> La pipeline tourne déjà (engine → lifecycle → exécution → providers) ; chaque provider est un **stub**
> qui loggue `log.todo(scope, hint)`. **100 pays sont déjà câblés** (data BEST_EFFORT/OFFICIAL) via 7
> archétypes. Ce document liste ce qu'il reste à rendre réel, **du plus important au moins important**.
> État 2026-06-27, branche `feat/compliance-architecture`.

## Le travail n'est PAS « 196 intégrations »
« A country is data » : un pays = un **profil** (archétype + taux + dates + `providerId`). Le code réel
à écrire se compte en **providers partagés**, pas en pays. Trois axes :

- **Axe FONDATIONS (transversal)** — fait *une fois*, profite à *tous* les pays.
- **Axe PROVIDERS (code)** — un nombre fini de **formats** (~44 nationaux + ~6 partagés) et de
  **canaux/portails** (~50 portails + Peppol/SdI/PDP/PAC/KSeF/OSE). Beaucoup sont **mutualisés**
  (EN 16931 UBL couvre déjà 8 pays, etc.) → on priorise par **levier** (pays débloqués) × marché ×
  urgence de mandat.
- **Axe DATA (profils)** — vérifier taux/dates/identifiants des 100 profils (et étendre vers 196),
  faire passer `BEST_EFFORT → OFFICIAL`. Gros volume, **faible code**.

Répartition actuelle des archétypes : `clearance` 34 · `realTime` 20 · `postAudit` 19 · `planned` 14 ·
`peppolCtc` 5 · `noMandate` 5 · `periodic` 3.

---

# A. FONDATIONS (transversal — à faire en premier, débloque tout)

| # | Item | Fichiers | Débloque | Effort |
|---|------|----------|----------|--------|
| **A0 ⭐** | **Chemin par défaut réel** : `format/plain-pdf` → `getInvoicePdf()`/`getPDF()`; `transmission/email` → `MailService`; wiring Nest (registries réels dans `ComplianceService`) | `providers/format/providers.ts:53`, `providers/transmission/providers.ts:14`, `nest/compliance.module.ts:85` | **les 24 pays postAudit+noMandate** + le fallback de tous les autres | S |
| **A1** | **Socle async durable** : connecter les Effects du runtime (SCHEDULE_POLL/AWAIT_CALLBACK/ARM_TIMER) aux stores Prisma + cron + `ApplySignalService` + webhook **déjà présents** ; mapper statuts entrants → `applyResponse` | `lifecycle/runtime.ts:142`, `lifecycle/response.ts:33`, `nest/*` | **les 54 pays clearance+realTime** (tout régime async) | XL |
| **A2** | **Signature** XAdES/PAdES/CAdES | `providers/signing/providers.ts:8,16,24` | tous régimes clearance + archive signé | M |
| **A3** | **Archive** WORM/S3 + résidence | `providers/archive/providers.ts:18` | rétention légale partout | M |
| **A4** | **Routage par rôle B2B/B2C/B2G** : `appliesTo` sur `TransmissionRule` + engine role-aware (`engine:113`) + détecter B2G (`ClientType.GOVERNMENT` + ctx `invoices.service`) | `profiles/schema.ts:61`, `engine/compliance-engine.ts:113`, `prisma/schema.prisma:234` | **correction transverse** : format/portail diffèrent par rôle (FR/IT/ES/DE faux sans ça) | M |

---

# B. FORMATS & CANAUX PARTAGÉS (levier maximal — 1 impl = N pays)

| # | Provider | Fichiers | Pays débloqués | Effort |
|---|----------|----------|----------------|--------|
| **B1 ⭐** | **EN 16931 UBL/CII** (via `@fin.cx/einvoice`) | `format/providers.ts:38` | LV, SK, RO, RS + base EU + tout le set Peppol (≥8 aujourd'hui) | L |
| **B2** | **Peppol** (SMP + AS4 + Invoice Response) | `transmission/providers.ts:24,28` | BE, IE, SI, NL, SE, NO… (peppolCtc + postAudit Peppol) | L |
| **B3** | **XRechnung** (CIUS de B1) | `format/providers.ts` + national | DE (B2G live, B2B en phase) | S (réutilise B1) |
| **B4** | **Facturae** + SII/Verifactu | `format/national`, portail `es-aeat` | ES (live) | M |

---

# C. INTÉGRATIONS PAYS — clearance + realTime (le gros : 54 pays)
*Chaque ligne = un format national + un portail national, déjà nommés dans
`national-formats.ts` / `national-portals.ts` avec le hint exact. Priorisé par PIB/volume × mandat live.*

### Vague C1 — grandes économies, mandats live (à faire d'abord)
| Pays | Format | Portail |
|------|--------|---------|
| 🇮🇹 Italie | FatturaPA | SdI |
| 🇮🇳 Inde | `in-irp` GST e-invoice | IRP (GSTN/NIC) |
| 🇧🇷 Brésil | `nfe` (NF-e/NFS-e/CT-e) | SEFAZ (état par état) |
| 🇲🇽 Mexique | CFDI 4.0 | PAC → SAT |
| 🇸🇦 Arabie S. | ZATCA UBL 2.1 + QR | FATOORA |
| 🇹🇷 Turquie | UBL-TR | GİB |
| 🇪🇸 Espagne | Facturae | AEAT (→ B4) |
| 🇵🇱 Pologne | FA_VAT | KSeF |
| 🇩🇪 Allemagne | XRechnung (→ B3) | Peppol/B2G |
| 🇨🇳 Chine | e-Fapiao | STA (Golden Tax IV) |
| 🇪🇬 Égypte | `eg-eta` | ETA |

### Vague C2 — LATAM CTC (live, schémas proches entre eux)
CL (DTE/SII) · CO (DIAN) · AR (FE/AFIP) · PE (OSE/SUNAT) · EC (SRI) · UY (CFE/DGI) · CR (Hacienda) ·
DO (e-CF/DGII) · GT (FEL/SAT) · PA (DGI) · PY (e-Kuatia/SIFEN) · SV (DTE/MH) · BO (SIN) · VE (SENIAT)

### Vague C3 — Afrique + Asie, mandats émergents live
Afrique : KE (eTIMS) · NG (FIRS) · GH (E-VAT) · RW (EBM) · TZ (VFD) · UG (EFRIS) · ZM (Smart Invoice) ·
ZW (FDMS) · CI (FNE) · BJ (e-MECeF) · TN (TEIF/TTN) · JO (JoFotara).
Asie : ID (e-Faktur/Coretax) · VN (TT78/GDT) · MY (MyInvois) · PH (EIS/BIR) · TW (eGUI) · KZ (ESF) ·
TH (e-Tax) · NP (CBMS) · BD (NBR) · PK (FBR).

### Vague C4 — UE planifiée 2026-2028 (réutilise B1/B2 + portail + data)
BE (2026, Peppol) · RO (e-Factura/ANAF, live 2024) · RS (SEF) · HR (e-Račun, 2026) · LV (2026) ·
SK (2027) · SI (2027) · IE (2028) · + fiscalisation live : UA (DPS), AL (CIS), ME.

---

# D. POST-AUDIT / NO-MANDATE (24 pays — quasi rien à coder)
postAudit (19) + noMandate (5) : GB, CH, NL, SE, NO, AT, DK, FI, CZ, LU, … → **A0 suffit** (PDF+email).
Ajout optionnel : reporting périodique (SAF-T) pour PT/NO/quelques-uns (voir E).

---

# E. REPORTING & FISCALITÉ (selon besoins)
- Reporting agrégé/périodique : EC Sales List/DEB, OSS/IOSS, Intrastat, SAF-T (PT/NO/AO…), e-reporting FR
  (`reporting/handlers.ts`, `regimes/handlers.ts`). Fréquence faible, souvent côté comptable.
- Affinages fiscaux : empilement sales-tax US comté/ville (`taxsystems/handlers.ts:29`), arrondis
  consumption-tax (`:38`). Niche (US/JP).
- Numérotation : hash-chain tamper-evidence (`numbering.ts:29`), folio-pools MX/CL (`:48`).

---

# F. AXE DATA — vérification des profils (volume, faible code)
Faire passer les profils `BEST_EFFORT → OFFICIAL` : taux TVA, dates d'entrée en vigueur, identifiants
requis, `providerId`. 100 profils câblés aujourd'hui → cible 196. Source : `documentation/compliance`.
Indépendant du code providers ; parallélisable.

---

# À CLARIFIER (audit avant d'implémenter)
- **`lifecycle/corrections.ts`** (credit-note/corrective/cancel-replace) : redondant avec le
  `correctInvoice`/`cancelInvoice` **déjà implémenté** dans `invoices.service.ts`. À câbler comme source
  unique ou retirer — ne pas remplir aveuglément.
- **`operations/validate`** (`compliance-service.ts:461`), **contingency** (`:291,296`) : utilitaires
  transverses, à traiter avec A1.

---

# Séquençage recommandé
**A0** (rapide, couvre 24 pays + fallback) → **B1+B2** (socle EU structuré, fort levier) → **A1**
(socle async, prérequis clearance) → **A2/A3** → puis **C1** un pays **de bout en bout** (probablement
🇮🇹 SdI ou 🇲🇽 CFDI) pour figer le pattern d'intégration (injection service, idempotence, persistance,
gestion d'erreur, callback) **avant** de dérouler C2/C3/C4 en parallèle. L'axe **F (data)** avance
indépendamment.
