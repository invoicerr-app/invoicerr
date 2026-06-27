# Roadmap — implémentation des stubs compliance

> Toute la pipeline compliance tourne déjà (engine → lifecycle → exécution → providers), mais chaque
> provider/intégration est un **stub** qui loggue `log.todo(scope, hint)` au bon endroit. Ce document
> liste ce qu'il reste à rendre réel, **du plus important au moins important**, avec dépendances et
> effort. État au 2026-06-27, branche `feat/compliance-architecture`.

## Principe de priorisation
`importance = couverture (combien de factures/pays concernés) × déblocage (combien d'autres choses en
dépendent) ÷ effort`. On rend d'abord réel le **chemin par défaut** (PDF + email, code déjà existant),
puis le **socle EU structuré** (EN 16931 + Peppol), puis la **France** (marché cible : profil FR,
SIRET, encaissée), le tout reposant sur un **socle async durable**. Les intégrations clearance
pays-par-pays et le long-tail viennent ensuite.

---

## Tier 0 — Rendre le chemin par défaut réel (PDF + email) ⭐ priorité maximale
*Pourquoi en premier : la majorité des factures partent en PDF par email. Le code existe déjà
(`mail/mail.service.ts` SMTP+Brevo, `invoices.service.getInvoicePdf()` / `@/utils/pdf`). Aujourd'hui
la `ComplianceService` Nest est construite avec `{ store }` seul → registries par défaut = stubs, donc
le "send" compliance ne fait rien de réel pour une facture non-clearance. Faible effort, couverture
maximale.*

1. **format/plain-pdf** (`providers/format/providers.ts:53`) → brancher sur `getInvoicePdf()` /
   `getPDF()` existants. Produire le vrai PDF comme artefact `HUMAN`.
2. **transmission/email** (`providers/transmission/providers.ts:14`) → injecter `MailService` dans
   `EmailTransmissionProvider` et appeler `sendMail` avec le PDF en pièce jointe.
3. **Wiring Nest** (`compliance/nest/compliance.module.ts:85`) : passer des registries avec les vrais
   providers (PDF/mail) à `ComplianceService` au lieu des défauts. Garder le reste en stub.

**Dépend de** : rien. **Effort** : S. **Débloque** : un cycle émission→PDF→email réellement
fonctionnel de bout en bout.

---

## Tier 1 — Socle EU structuré : EN 16931 + Peppol
*Pourquoi : un seul format (Factur-X/UBL EN 16931) couvre la facturation électronique structurée de
quasi toute l'UE (FR 2026+, DE, BE, etc.), et Peppol est le transport pan-européen. Plus gros retour
sur investissement après le défaut.*

4. **format/en16931** (`providers/format/providers.ts:38`) → construire Factur-X/UBL via
   `@fin.cx/einvoice` (hint déjà en place : `EInvoice.embedInPdf/exportXml`) + validation Schematron.
5. **transmission/peppol** (`providers/transmission/providers.ts:24,28`) → SMP lookup + envoi AS4 via
   un Access Point ; implémenter aussi `sendStatus` (Invoice Response/MLR).

**Dépend de** : Tier 0 (artefact pipeline). **Effort** : L (intégration AP + lib format). **Débloque** :
conformité EU structurée et le profil décentralisé CTC.

---

## Tier 2 — France de bout en bout (marché cible)
*Pourquoi : l'app est orientée FR (profil FR, SIRET, statut « encaissée » déjà modélisé). La réforme
2026 = e-invoicing via PDP + e-reporting + statuts de cycle de vie.*

6. **Socle async durable** — rendre réels les Effects du runtime
   (`lifecycle/runtime.ts` SCHEDULE_POLL/AWAIT_CALLBACK/ARM_TIMER) : les connecter aux stores Prisma +
   cron + `ApplySignalService` + webhook controller **déjà présents** au niveau Nest. Mapper les
   statuts entrants (`lifecycle/runtime.ts:142`, `lifecycle/response.ts:33`) → `applyResponse`.
   **Prérequis de toute régime async (clearance/callback).**
7. **transmission/pdp** réel (`providers/transmission/providers.ts:39,43,47`) → annuaire + remise au
   PDP destinataire + push e-reporting + `sendStatus("encaissée")` (le câblage `markPaid` existe déjà).
8. **reporting/e-reporting** (`reporting/handlers.ts:48`) → push transaction + paiement à
   l'administration (FR).

**Dépend de** : Tier 0/1 + le socle async (#6). **Effort** : XL. **Débloque** : conformité FR complète.

---

## Tier 3 — Signature électronique (transversal)
*Pourquoi : requise pour la validité légale/intégrité dans les régimes clearance et archivage signé
(IT, MX, PL, ZATCA). Le flux dev marche sans, mais pas la conformité légale.*

9. **signing/xades · pades · cades** (`providers/signing/providers.ts:8,16,24`) → signature réelle
   avec certificat (XAdES pour XML clearance, PAdES pour PDF, CAdES si requis).

**Dépend de** : un format réel à signer (Tier 1+). **Effort** : M (gestion certs/HSM).

---

## Tier 4 — Intégrations clearance pays-par-pays
*Pourquoi : chacune est une intégration externe discrète. À traiter selon les marchés visés. Chaque
provider a déjà son `log.todo` pointant le schéma/API exacts.*

10. **Italie** : `format/fatturapa` + `transmission/sdi` (submit + notifiche + `sendStatus`/poll).
11. **Mexique** : `format/cfdi` (SAT CFDI 4.0) + `transmission/pac` (timbre/UUID/folio + poll).
12. **Pologne** : `format/fa-vat` + `transmission/ksef` (auth token/seal + UPO + poll).
13. **Arabie Saoudite** : `format/ksa-ubl` (ZATCA UBL 2.1 + QR) + portail ZATCA.
14. **Portails nationaux génériques** (`transmission/national-portals.ts`, `format/national-formats.ts`,
    `format/national-xml`) : remplacer les hints data-driven par les vraies API au cas par cas.

**Dépend de** : Tier 3 (signature) + socle async. **Effort** : L par pays.

---

## Tier 5 — Conformité de production (intégrité & rétention)
15. **archive/s3-worm** (`providers/archive/providers.ts:18`) → PUT WORM + rétention + intégrité par
    région de résidence. (`archive/local` suffit en dev.)
16. **numbering/gapless hash-chain** (`lifecycle/numbering.ts:29`) → chaînage par hash (tamper-evidence ;
    la numérotation gapless fonctionne déjà). **folio-pool** (`:48,52`) → pools de folios (MX/CL).

**Effort** : M.

---

## Tier 6 — Long-tail (selon besoins réels)
17. **Reporting périodique/agrégé** : EC Sales List/DEB, OSS/IOSS, Intrastat, SAF-T, ledgers
    (`reporting/handlers.ts`, `regimes/handlers.ts`). Fréquence faible, souvent côté comptable.
18. **Réception (AP)** : parse/validation d'e-factures entrantes + ack acheteur
    (`reception/reception-service.ts`). Pertinent seulement si on **reçoit** des e-factures (app
    actuellement orientée émission).
19. **Affinages fiscaux** : empilement sales-tax US comté/ville (`taxsystems/handlers.ts:29`), arrondis
    consumption-tax (`:38`). Niche, dépend du marché US/JP.
20. **operations/validate** (`compliance-service.ts:461`) → agrégation des `ValidationReport` par
    artefact. **operations/contingency** (`:291,296`) → mode dégradé (panne autorité, ex. BR EPEC).

---

## À clarifier (pas forcément à implémenter)
- **`lifecycle/corrections.ts`** (credit-note / corrective / cancel-replace stubs) : le vrai
  `correctInvoice`/`cancelInvoice`/`cancelAndReplaceInvoice` est **déjà implémenté** dans
  `invoices.service.ts`. Cette abstraction parallèle semble redondante — **à auditer** (la câbler comme
  source unique, ou la retirer) plutôt qu'à remplir aveuglément.

---

## Recommandation de séquençage
Tier 0 d'abord (rapide, gros impact) → Tier 1 (socle EU) → Tier 2 (FR + socle async, le gros morceau)
→ le reste selon les marchés. Faire **un provider de bout en bout** avant de dérouler les autres pour
valider le pattern d'intégration (injection service, gestion d'erreur, idempotence, persistance).
