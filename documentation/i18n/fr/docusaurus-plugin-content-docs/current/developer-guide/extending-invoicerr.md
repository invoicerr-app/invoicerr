---
sidebar_position: 5.5
---

# Étendre Invoicerr

Deux questions, et seulement deux, décident de la façon dont une nouveauté s'ajoute à cette base de
code — et elles reçoivent deux réponses complètement différentes, délibérément tenues séparées :

|  | « Que peut dire la loi d'un **pays** sur un document ? » | « Quel **genre** de document est-ce ? » |
| --- | --- | --- |
| Répondu par | **La donnée** — un fichier JSON par pays, par mécanisme | **Un descripteur** — un objet TypeScript par type |
| Se trouve dans | `backend/src/modules/documents/*/data/<cc>.json` | `backend/src/modules/documents/descriptors/<type>.descriptor.ts` |
| En ajouter un nécessite | Un nouveau fichier (presque toujours rien d'autre — voir ci-dessous) | Un nouveau fichier plus une ligne d'enregistrement |
| Guide | [Ajouter un pays](./adding-a-country.md) | [Ajouter un type de document](./adding-a-document-type.md) |
| Référence générée | La [matrice de conformité par pays](./country-support/index.md) | — (lisez les fichiers descripteurs eux-mêmes) |

## Partie 1 — En clair

Imaginez le cœur de cette application comme une grille : un axe est **ce que vous créez** (un devis ?
une facture ? une note de frais ?), l'autre est **la loi de quel pays s'y applique** (France ?
Pologne ? Portugal ?). Aucun des deux axes ne sait que l'autre existe. Un type de document ne dit
jamais « si c'est une facture française, fais X » — il décrit simplement ses propres champs et
boutons, de la même façon pour chaque pays. Les règles d'un pays ne disent jamais « pour une facture
en particulier » dans le code — elles disent simplement, en donnée pure, « cette combinaison
type de document/action est autorisée ici » ou « voici à quoi doit ressembler un identifiant
français ». L'application combine les deux grilles au moment précis où quelqu'un clique réellement
sur un bouton, et pas avant.

C'est pourquoi ajouter un pays n'est *jamais* un changement de code (presque toujours un simple
nouveau fichier — voir [Ajouter un pays](./adding-a-country.md)), et ajouter un type de document est
un changement de code *modeste*, ponctuel ([Ajouter un type de document](./adding-a-document-type.md))
qui, une fois fait, fonctionne immédiatement pour chaque pays déjà ajouté et chaque pays qui le sera
un jour. Aucun des deux axes n'a besoin d'être touché pour étendre l'autre.

## Partie 2 — Les détails

La règle qui gouverne tout, énoncée précisément : **aucun code métier — aucun contrôleur, aucun
service, aucun gestionnaire d'action — n'a le droit d'écrire `if (country === 'FR')` ou
`if (typeId === 'invoice')` pour décider si quelque chose est *permis*.** Un switch sur `typeId` est
acceptable quand il s'agit vraiment de *forme* (le frontend choisissant quel rendu de champ un `kind`
demande) ; un switch sur le pays n'a lui jamais sa place dans le code. Deux couches indépendantes et
composables rendent cela possible :

- **La couche type de document** (`descriptors/`) décrit la FORME d'un document — ses champs, ses
  boutons (« actions »), son cycle de vie (quels statuts existent, quelle action fait passer de l'un
  à l'autre). Chaque document, quel que soit son type, est stocké dans exactement la même table
  `DocumentInstance`, distingué uniquement par une colonne texte `typeId` — jamais un modèle Prisma
  par type, jamais une migration pour ajouter un sixième type. Voir
  [Ajouter un type de document](./adding-a-document-type.md).
- **La couche pays** (une dizaine de petits mécanismes sous `documents/*/data/`) décrit des FAITS sur
  une juridiction : quelles actions sa loi autorise, quelles voies de correction existent, quels
  identifiants une partie doit fournir, quel canal elle impose, quels sont ses taux de TVA. Aucun de
  ces mécanismes ne sait ce qu'une « facture » *est* structurellement — ils ne font jamais que
  référencer un `typeId`/`actionId` comme une simple clé texte opaque. Voir
  [Ajouter un pays](./adding-a-country.md).

Les deux couches se rencontrent en exactement un seul endroit, au moment de la requête :
`DocumentsService.runAction` (`documents.service.ts`), qui résout le descripteur d'un type de
document (couche 1) et la politique d'un pays pour ce couple exact `(typeId, actionId)` (couche 2),
puis exécute les quatre mêmes portes — politique pays (403), statut (409), implémentation (501),
validation (400) — à chaque fois, pour chaque type et chaque pays, décrites en détail dans
[Ajouter un pays](./adding-a-country.md#les-quatre-portes--ce-qui-se-passe-quand-vous-essayez-réellement-dexécuter-une-action).
Le code d'aucune des deux couches n'a jamais besoin de savoir que l'autre existe pour que cela
fonctionne.

Un troisième mécanisme, bien plus petit, se place *entre* les deux couches sans les confondre :
`country-fields/` permet à un pays d'AJOUTER, MODIFIER ou SUPPRIMER un champ sur la forme tronc d'un
type existant (par exemple le `invoice.lines[].supplyType` propre à la France) — ceci reste de la
donnée, toujours indexée par `(cc, typeId)`, et cela ne change jamais ce qu'*est* un type de document,
seulement ce que la version d'un pays donné porte en plus.

## Pour aller plus loin

- Ajouter les règles d'un pays, ou étendre un pays existant → [Ajouter un pays](./adding-a-country.md).
- Ajouter un nouveau genre de document (ou une action sur un type existant) →
  [Ajouter un type de document](./adding-a-document-type.md).
- Voir ce que les cinq pays couverts obtiennent aujourd'hui, généré directement depuis la donnée → la
  [matrice de conformité par pays](./country-support/index.md).
- Ajouter une capacité qui ne relève d'aucun des deux axes (un événement webhook, un nouveau *genre*
  de champ, un outil MCP) → [Système de plugins](./plugin-system.md).
