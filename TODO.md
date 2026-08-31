# TODO — reconstruire sur le modèle de document générique

> Inventaire de ce que la suppression du système de documents et du moteur de conformité
> (commit `fffbae77`, repère git `avant-refonte-documents`) a emporté et qu'il faut remettre —
> cette fois sur le nouveau modèle : un type de document est un descripteur, un pays est une
> donnée, tout ce qui est déclaré sans implémentation bloque en le disant.
>
> Établi le 2026-08-30 en comparant les modules du repère avec ceux d'aujourd'hui.
> Remplace `TODO_MASTER_ROADMAP.md`, écrit pour l'architecture d'avant la démolition et
> conservé comme référence historique.
>
> **⚖ = demande de sourcer du droit.** C'est le vrai coût de ces items, pas le code : chaque
> affirmation juridique porte sa source et sa date de consultation, ou est marquée `unverified`
> avec ce qui la trancherait. Ne jamais inventer une règle fiscale ou juridique.

## Dépendances utiles pour ordonner

- **1 → 4, 12, 24** (pas de pièce jointe, de format normalisé ni de lien public sans rendu PDF)
- **17 → 16** (l'arithmétique domestique avant la composition transfrontalière)
- **7 → 8** (pas de lettrage sans paiements)
- **3** conditionne la finesse de tout le reste (la politique pays par statut)
- **10** rouvre la voie aux preuves live conservées au repère (PDP, KSeF)

---

## A — Le quotidien des documents

| # | Titre | Description |
|---|---|---|
| 1 ✅ | **Rendu PDF** (fait, 2026-08-30) | Aucun moteur de rendu n'existe (l'aperçu affiche les données brutes en le disant). Un moteur **générique piloté par le descripteur** — un template par kind de champ, pas par type — pour que tout type de document ait son PDF sans écran dédié. Préalable aux items 4, 12 et 24. |
| 2 ✅ | **Numérotation** ⚖ (fait, 2026-08-31) | Les documents n'ont plus aucun numéro. Compteurs par société et par type, format configurable, numéro pris à l'émission. La règle « séquence sans trou » est du droit à sourcer par pays — l'ancien code (et son bug du `-0000`) est au repère pour référence. |
| 3 ✅ | **Statuts & cycle de vie** (fait, 2026-08-31) | Aujourd'hui : `draft`/`sent` et guère plus. Déclarer les statuts et transitions **par type, en donnée**, et donner à la politique pays la granularité par statut qui lui manque (« corriger, mais seulement une fois parti »). |
| 4 ✅ | **Envoi avec pièce jointe** (fait, 2026-08-31) | L'envoi joint désormais le PDF (le même moteur que l'item 1, jamais une seconde implémentation) — `<displayNumber>.pdf` une fois numéroté, `<typeId>-<id>.pdf` sinon. Gabarits de mail par type de document (`DocumentTypeDescriptor.email`), surchargeables par société (`Company.documentEmailTemplates`) — la table `MailTemplate` pré-existante n'a pas été réutilisée (enum fermé, vocabulaire différent, aucun type "quote" ; voir `actions/company-email-templates.ts`). Un échec de rendu PDF fait échouer l'envoi (jamais un courriel sans pièce jointe envoyé en silence) ; un placeholder de gabarit inconnu est laissé tel quel avec un avertissement, jamais une exception. Prouvé en vrai contre Mailpit (`send-quote.live.spec.ts`, PDF + sujet interpolé réellement reçus). |
| 5 ✅ | **Factures récurrentes** (fait, 2026-08-31) | Mécanisme générique (`documents/schedules/`) : un `DocumentSchedule` rejoue une ACTION sur un document source à une cadence fermée (`weekly`/`monthly`/`quarterly`/`yearly`, jamais de RRULE). Un seul job répétable (le balayage, sur la file existante) tire une occurrence par schedule dû, jobId déterministe incluant l'occurrence pour la déduplication. Le cas facture : `duplicate` avec dates recalées (délai source préservé), enchaînement `send` optionnel appelé SYNCHRONE (hors du job, sinon collision avec sa propre ré-inscription — voir `schedule-sweep-runner.ts`). Écran : action de ligne « Recurrence » générique (gate sur l'action `duplicate`), onglet Réglages « Recurrences ». Un échec d'occurrence pose `lastError`, visible, sans désactivation silencieuse. |
| 6 ✅ | **Remises & acomptes** (fait, 2026-08-31, avec le pré-remplissage catalogue) | L'ancien système avait la remise par ligne, la facture d'acompte et la conversion devis→facture finale. À redéclarer dans les descripteurs. |

## B — L'argent

| # | Titre | Description |
|---|---|---|
| 7 ✅ | **Paiements** (fait, 2026-08-31) | `record-payment` est déclarée sur la facture et bloque en 501 — c'est le cas vivant du test de blocage. Modèle de paiement, écran, méthodes de paiement (module supprimé). |
| 8 ✅ | **Lettrage** (fait, 2026-08-31) | Rapprocher paiements ET avoirs de la facture qu'ils soldent — le `settlementOf` d'avant était pur et vérifié par mutation, récupérable au repère. Dépend de 7. |
| 9 ✅ | **Multi-devises** (fait, 2026-08-31) | Devise de référence opt-in (`Company.referenceCurrency`, null = rien ne change), taux saisis à la main (`CurrencyRate`, jamais d'inverse dérivé), consolidation dashboard qui porte toujours son taux — ou rien du tout si un taux manque. Une conversion est une information, jamais un remplacement : les montants d'origine restent la vérité. L'ancienne `CurrencyConversion` (globale, Float, TTL) rejetée en bloc. Le lettrage ne convertit toujours pas — choix consigné dans `TODO_ISSUES.md`. |

## C — La sortie (conformité)

| # | Titre | Description |
|---|---|---|
| 10 ◐ | **Transports nationaux** (vague 1 faite, 2026-08-31 : socle credentials + PDP ; reste KSeF/SdI) | Le registre n'a que `email`. Réintégrer PDP, KSeF, SdI… comme transports enregistrés avec credentials par société. Vague 1 : `CompanyChannelConfig` (AES-256-GCM, `modules/company/channels/`), transport `pdp` (`documents/transports/pdp-transport.ts`) déposant un Factur-X (`formats/facturx-provider.ts`, item 12), écran « Canaux » (`/settings/channels`, suggestion FR→PDP en donnée pays, jamais un `if`). Dépôt réel PROUVÉ (superpdp sandbox, `pdp/pdp.live.spec.ts`) — l'accusé de dépôt seulement, le suivi du statut de conformité (poll) reste à faire, voir TODO_ISSUES.md. Vague 2 (KSeF, SdI — credentials absents aujourd'hui) non commencée. |
| 11 | **Canal imposé par pays** ⚖ | Aujourd'hui le transport est un choix de la société. Mécanisme pour qu'un fichier pays en rende un obligatoire, avec sa source. |
| 12 ◐ | **Formats normalisés** ⚖ (CII/UBL/Factur-X faits, 2026-08-31 ; reste XRechnung/Peppol BIS) | EN 16931 CII, UBL 2.1 et Factur-X (PDF/A-3 + CII embarqué, item 10) : `documents/formats/` (registre de `DocumentFormatProvider`, motif `transports/transport-registry.ts`), pont descripteur → modèle sémantique (`semantic/build-semantic-invoice.ts`, montants venant de `compute-totals.ts`, jamais recalculés), gate XSD-équivalent + Schematron EN 16931 VENDORÉ (repris du repère, jamais un compilateur maison) — un artefact invalide n'est jamais servi. Action `download-xml` sur la facture (param `syntax` ∈ {cii, ubl, facturx}), bouton front, i18n. XRechnung/Peppol BIS (rulesets rangés, non branchés) et la légalité du caractère obligatoire (item 11/15) sont consignés dans `TODO_ISSUES.md`, pas devinés ici. Dépend de 1 et 17. |
| 13 | **Signature électronique** | Certificats de société et signature des documents (module supprimé). |
| 14 | **Archivage légal** ⚖ | Rétention par pays, intégrité. |
| 15 | **Mentions obligatoires** ⚖ | Les notes légales sur facture (pénalités de retard, escompte…), en donnée pays sourcée. |
| 16 | **Transfrontalier** ⚖ | La limite la plus profonde : rien ne compose pays émetteur × pays destinataire (TVA intra-UE, autoliquidation, OSS). Touche la forme même du contexte — deux pays, pas un. |
| 17 ✅ | **Calcul fiscal** (fait, 2026-08-30) | Totaux HT/TVA/TTC à partir du taux choisi par ligne. L'arithmétique domestique d'abord ; base du 16. |

## D — L'entrée

| # | Titre | Description |
|---|---|---|
| 18 | **Réception de factures** | Écran et flux entrant supprimés. À refaire sur le nouveau modèle. |

## E — Données pays

| # | Titre | Description |
|---|---|---|
| 19 | **Allemagne + Royaume-Uni** ⚖ | Les 5 tests e2e rouges restants : leurs fichiers d'exigences d'identifiants n'existent pas. |
| 20 | **Couverture recherche 40→118** | La liste des pays de `company-lookup` venait des profils supprimés. Décider de sa nouvelle source. |
| 21 | **Sourcer FR et US** ⚖ | Tout ce qui existe est `unverified` — honnête mais non tranché. Lire les textes (Légifrance refuse les requêtes automatisées : il faudra peut-être un humain). |

## F — Infrastructure

| # | Titre | Description |
|---|---|---|
| 22 ✅ | **Mode worker & files d'attente** (fait, 2026-08-31) | BullMQ recâblé (split Core/Module/Worker, `WORKER_INLINE`, `jobId` déterministe, Redis requis au boot) sur le modèle du repère. Job générique `(companyId, typeId, documentId, actionId, payload)` rejoué par `DocumentsService.runAction` — les quatre portes y compris côté worker. "send" devient asynchrone pour quote/invoice/credit-note : `draft/send_failed → sending → sent \| send_failed`, numéro pris en entrant dans `sending`. Item 5 (relances) réutilisera le même job. |
| 23 | **Serveur MCP** | Module supprimé avec la démolition. |
| 24 | **Liens publics de téléchargement** | `pdf-links` supprimé (partager une facture par lien). Dépend de 1. |
| 25 ◐ | **Contributions manquantes** (contributions faites 2026-08-31 ; reste l'i18n des libellés) | Le dashboard n'a que la facture. « Les dépenses du mois », devis, avoir ; et l'i18n des libellés de descripteurs (données brutes aujourd'hui). |
