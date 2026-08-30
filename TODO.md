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
| 4 | **Envoi avec pièce jointe** | L'envoi actuel est un texte. Joindre le PDF (dépend de 1), templates de mail par type de document. |
| 5 | **Factures récurrentes** | Module supprimé. À repenser dans le nouveau modèle — probablement une planification générique qui rejoue une action sur n'importe quel type, plutôt qu'un module facture-only. |
| 6 | **Remises & acomptes** | L'ancien système avait la remise par ligne, la facture d'acompte et la conversion devis→facture finale. À redéclarer dans les descripteurs. |

## B — L'argent

| # | Titre | Description |
|---|---|---|
| 7 | **Paiements** | `record-payment` est déclarée sur la facture et bloque en 501 — c'est le cas vivant du test de blocage. Modèle de paiement, écran, méthodes de paiement (module supprimé). |
| 8 | **Lettrage** | Rapprocher paiements ET avoirs de la facture qu'ils soldent — le `settlementOf` d'avant était pur et vérifié par mutation, récupérable au repère. Dépend de 7. |
| 9 | **Multi-devises** | `CurrencyConversion` supprimé. Conversion et affichage ; les décimales par devise ont déjà été sauvées dans `utils/financial.ts`. |

## C — La sortie (conformité)

| # | Titre | Description |
|---|---|---|
| 10 | **Transports nationaux** | Le registre n'a que `email`. Réintégrer PDP, KSeF, SdI… comme transports enregistrés avec credentials par société. Les round-trips PDP et KSeF **prouvés en réel** sont au repère — c'est une reprise, pas une réécriture. |
| 11 | **Canal imposé par pays** ⚖ | Aujourd'hui le transport est un choix de la société. Mécanisme pour qu'un fichier pays en rende un obligatoire, avec sa source. |
| 12 | **Formats normalisés** ⚖ | EN 16931 (Factur-X, UBL, CII…) pour que ce qui part soit conforme. Dépend de 1 et 17. |
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
| 22 | **Mode worker & files d'attente** | `worker.ts` et BullMQ supprimés. Nécessaire dès que les envois et les relances deviennent asynchrones (10). |
| 23 | **Serveur MCP** | Module supprimé avec la démolition. |
| 24 | **Liens publics de téléchargement** | `pdf-links` supprimé (partager une facture par lien). Dépend de 1. |
| 25 | **Contributions manquantes** | Le dashboard n'a que la facture. « Les dépenses du mois », devis, avoir ; et l'i18n des libellés de descripteurs (données brutes aujourd'hui). |
