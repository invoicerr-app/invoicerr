# 06 — Remédiation

> Rédigé le 2026-08-27, à l'issue des phases 0 à 3. Ordonné par **exposition × coût**, jamais par
> numéro de finding. Trois statuts : **décision d'entreprise**, **bloqué par une source**,
> **faisable maintenant** — dans cet ordre, parce que le premier est celui qui ne peut pas avancer
> sans toi.

---

## 1. Bloqué par une décision d'entreprise — à lire en premier

Rien ici n'est technique. Rien ici n'avancera tant que quelqu'un n'aura pas tranché.

| # | Décision | Ce qu'elle débloque | Échéance réelle |
| --- | --- | --- | --- |
| **D1** | **Prévenir ou non les utilisateurs français avant le 2026-09-01.** Quatre défauts produisent un rejet du PPF ou une sanction ; aucun ne se corrige en cinq jours. Texte d'avertissement rédigé, non publié : `07-FR-2026-09-01.md` §3. | La confiance. Un rejet PPF découvert par l'utilisateur coûte plus qu'un avertissement honnête. | **2026-09-01 — cinq jours** |
| **D2** | **Faire poser la question de rattachement espagnole à un juriste.** Invoicerr est-il « productor » au sens du RD 1007/2023 art. 3.2 sans utilisateur ni commercialisation en Espagne ? Question rédigée avec ses éléments de fait : `09-F018-ES-DECLARATION.md` §2. | Tout F-018. Si la réponse est négative, le seul finding à exposition chiffrée disparaît. | échéance **déjà échue** si la réponse est positive |
| **D3** | **Répondre sincèrement à l'indicateur 1.e de la déclaration responsable** — ou décider de ne pas déclarer encore. Aucune des deux cases n'est cochable en l'état : « S » engage une transmission continue non implémentée, « N » engage la signature XAdES des registres et un registro de eventos non implémentés. | L'étape 4 de la séquence F-018. | après D2 |
| **D4** | **Périmètre public de F-004.** Retirer du navigateur les pays non soutenus, ou ajouter un bandeau dérivé, ou refondre par capacité. Recommandation : retirer d'abord, bandeau ensuite. | La promesse publique, et l'exposition de F-004. | aucune, mais c'est le plus gros écart de l'audit |
| **D5** | **Structure de `compliance-truth.json` face à F-017.** Un pays par ligne ne peut pas porter un corridor. Piste proposée, non implémentée : garder un pays par ligne pour les capacités techniques et ajouter un bloc `territorial_scope`. | La suite de l'audit, et la dérivation du site. | aucune |
| **D6** | **Résidence des données mexicaines.** `residency: 'MX'` est plus strict que le droit sourcé, mais le retirer déplace les documents d'un bucket in-country vers GLOBAL. C'est un arbitrage de localisation, pas une correction. | MX-D3. | aucune |
| **D7** | **Existe-t-il, hors dépôt, une preuve datée d'un run live KSeF ou PDP ?** Si oui, la verser dans `evidence/` fait passer ces canaux en L4. | La crédibilité des deux seuls canaux prouvés. | aucune |

---

## 2. Bloqué par une source

Peu de choses, et moins qu'au début de l'audit — la phase 3 et P4 ont fermé les deux plus gros.

| # | Bloqué sur | Ce qui reste | Coût de levée |
| --- | --- | --- | --- |
| **S1** | Conditions d'éligibilité à l'accréditation SdI — partita IVA italienne requise ? éditeur étranger admis ? | Plafonne l'Italie à L2 et conditionne toute la faisabilité IT | contact au Sistema di Accreditamento |
| **S2** | Prérequis d'accès à `preportal.aeat.es` | Plafonne la testabilité espagnole | non documenté par l'AEAT ; demande directe |
| **S3** | Exigences précises d'immatriculation DGFiP (audits, ISO 27001 / SecNumCloud, garanties financières, lieu d'établissement) | Tout `05-FEASIBILITY.md` pour la France | dossier `demarche.numerique.gouv.fr` |
| **S4** | Qualification de « real-time » pour le SII espagnol au sens de l'art. 6(5) ViDA | Si l'Espagne qualifie, son horizon domestique glisse de 2030 à **2035** | non défini par la directive ; probablement une position de la Commission |
| **S5** | Interdiction espagnole des trous de numérotation | ES reste `GAPLESS_SELF` par défaut prudent, non sourcé | doctrine DGT, hors périmètre de sourçage primaire |

**Fermés par P4** : l'art. 6(5) de ViDA (le report à 2035 est une disposition opérative, trois voies
d'éligibilité), et les deux documents techniques AEAT — huella **v0.1.2 du 2024-08-27** et QR
**v0.5.0 du 2025-12-10**, obtenus, lus, et confirmés comme étant exactement les versions que le code
encode.

---

## 3. Faisable maintenant

### 3.1 Fait pendant cette session — six branches, poussées

Chaque correction cite sa source dans son commit.

| Branche | Ce qui est corrigé | Effet |
| --- | --- | --- |
| `fix/numbering-toctou` | F-002 — garde déplacée dans la transaction, revendication de ligne avant consommation du compteur | 8 émissions concurrentes : **1 valeur consommée, 0 perdue** au lieu de 8 et 7 |
| `fix/profile-numbering` | MX-D1, MX-D2, DE-D4, IT-D2, PL-D7 — `UNIQUE_SELF` ajouté ; MX sort d'`AUTHORITY_RANGE` ; CURP retiré | **Débloque toute émission mexicaine**, qui était impossible |
| `fix/profile-illicit-email-channel` | FR-D1 — `EMAIL` retiré de la période française postérieure au mandat | Rend visible qu'il ne reste **rien** en France sans identifiants configurés |
| `fix/honest-return-values` | F-016, F-011, F-012 | Trois opérations cessent d'annoncer un succès qu'elles n'ont pas produit |
| `fix/profile-archival-retention` | DE-D1 — huit ans, pas dix | Fin d'une sur-rétention de deux ans de données personnelles |
| `fix/remove-dead-establishment-country` | F-017 (préparation) | Supprime un champ mort qui ressemblait à la source de vérité |
| `fix/channel-ui-gate-on-reachable-transport` | F-009 — UI conditionnée à `PROVEN` | 17 canaux incapables d'émettre cessent d'être proposés |

### 3.2 Reste faisable sans aucune source

| # | Correction | Coût | Débloque | Note |
| --- | --- | --- | --- | --- |
| **A1** | **Former la chaîne Veri\*Factu** — alimenter `previousHuella` depuis `ReportingStore` | **faible** — le `TODO(seam)` décrit la requête | ES-D1, et l'étape 2 de F-018 | L'algorithme est déjà conforme aux vecteurs officiels. Ne **pas** le réécrire. |
| **A2** | **F-008 — rendre le rejet d'autorité visible** : ajouter `REJECTED` à `InvoiceStatus`, écrire `Invoice.status` depuis `apply-signal` | **modéré** — migration Prisma | Une facture rejetée par KSeF ou le SdI cesse de s'afficher `SENT` | **Non fait dans cette session** : une migration de schéma mérite sa propre revue, hors d'un lot de corrections. |
| **A3** | **ES-D12 — chemin du QR** : `ValidarQRNoVerifactu` tant que le système n'est pas vérifiable | faible | Le QR cesse d'affirmer un mode que le système ne tient pas | Se referme sur D3 : le mode déclaré et le QR imprimé doivent coïncider. |
| **A4** | **FR-D8 — contraindre le format du numéro** : 35 caractères, spéciaux limités | faible | Évite un **rejet du flux F1** | À faire avant le 2026-09-01 si possible. |
| **A5** | **FR-D7 — émettre BT-23** en cardinalité 1..1 | modéré — valeurs limitatives à dériver du type d'opération | Évite l'échec des contrôles fonctionnels PPF | Idem. |
| **A6** | **IT-D10 — déplacer le déclencheur d'immutabilité** au retour RC/MC | modéré | Débloque le **renvoi après scarto**, chemin nominal de reprise | |
| **A7** | **PL-D1 / IT-D1 — retirer l'annulation** là où elle n'existe pas | faible en profil, **fort en produit** : il faut offrir la voie de substitution | Évite de produire un état juridiquement inexistant | Le profil seul ne suffit pas ; sans chemin de remplacement, l'utilisateur est bloqué. |
| **A8** | **F-005 — journal append-only en base** : révoquer `UPDATE`/`DELETE`, ou trigger | modéré | L'architecture tient enfin sa promesse d'append-only | Croise F-003. |
| **A9** | **F-001 / F-010 — refuser un artefact vide**, et porter le compte d'artefacts dans le reçu d'archivage | faible | « Archivé » redevient une information vérifiable | Faible urgence : les chemins concernés n'ont pas de transport. |
| **A10** | **F-014 — `COMPLIANCE_ARCHIVE_DIR` dans `archive-registry.spec.ts`** | trivial | Cesse d'écrire dans l'arbre de travail | |

**Ordre recommandé** : A4 et A5 d'abord — ce sont les seuls dont l'échéance est dans cinq jours.
Puis A1 (débloque F-018), A2 (le plus gros dégât utilisateur restant), A6, A7. A8 à A10 ensuite.

---

## 4. `01-CLAIM-AUDIT.md` — abandonné, et pourquoi

**Ce n'est pas un renoncement, c'est un résultat de l'audit.**

Le livrable prévu comparait les 106 fiches publiques page à page à ce qui est prouvé. F-017 établit
que **l'unité d'analyse n'est pas le pays mais le corridor** : le rattachement d'une facture se joue
sur le triplet (établissement du fournisseur, établissement de l'acheteur, nature et lieu de
l'opération), et la règle de rattachement elle-même **change d'un pays à l'autre** — cinq pivots pour
six régimes vérifiés.

Auditer 106 fiches page à page auditerait donc **la mauvaise question**. Un fournisseur français qui
vend en Italie ne trouve sa réponse ni sur la fiche FR, ni sur la fiche IT : sa situation dépend de
son établissement, de celui de son client, et du lieu de l'opération — trois informations qu'aucune
des deux fiches ne porte, et que le produit ne collecte pas.

La substance de ce qu'aurait dit `01-CLAIM-AUDIT.md` est dans **F-004** (ce que le site promet contre
ce qui existe) et dans **F-017** (pourquoi l'unité est fausse). La comparaison page à page reprendra
son sens **après** la décision D4, quand le seuil de publication sera fixé — et elle portera alors
sur des corridors, pas sur des pays.

---

## 5. `05-FEASIBILITY.md` — différé

Il dépend de S1 (accréditation SdI), S2 (prérequis AEAT) et S3 (immatriculation DGFiP), toutes
ouvertes. L'écrire aujourd'hui reviendrait à le remplir de valeurs plausibles — exactement ce que cet
audit s'est interdit sur trois phases.

Ce qui est **déjà établi** et l'alimentera : la France est `only_with_provider` pour une instance
self-hosted et `requires_certification` avec entité éditrice ; le Mexique est `only_with_provider`
par construction (passage obligé par un PAC). Les deux figurent déjà dans `compliance-truth.json`.

---

## 6. Ce que cette remédiation ne couvre pas

- Les **41 portails stubs** hors des six pays vérifiés. Leur testabilité n'a pas été recherchée, et
  « non recherché » n'est pas « pas de sandbox ».
- Le modèle `Log` applicatif, non audité — seul `ComplianceEvent` l'a été.
- Ce que le **chaînage de hash** devrait couvrir : il porte aujourd'hui sur le `ctx`, pas sur les
  octets émis, et n'est jamais vérifié.
- Les régimes `POST_AUDIT` des 100 autres pays, que la phase 2 n'a pas visités.
