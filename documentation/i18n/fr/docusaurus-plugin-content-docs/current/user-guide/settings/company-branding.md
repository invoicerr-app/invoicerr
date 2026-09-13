---
sidebar_position: 1
---

# Entreprise

## Entreprise

Votre identité commerciale — ces informations apparaissent sur chaque document émis.

- **Nom** (obligatoire)
- **Numéro de TVA** (facultatif)
- **Identifiant légal / SIRET** (facultatif) — les identifiants proposés dépendent de votre pays ; voir
  [Couverture par pays](../../developer-guide/country-support/index.md)
- **Adresse** — rue, complément d'adresse, code postal, ville, état ou province, pays
- **E-mail** et **téléphone**
- **Devise** — devise par défaut des nouveaux documents
- **Format de date**

Votre pays pèse plus qu'il n'y paraît : il décide des identifiants qui vous sont demandés, des taux de
TVA que vous pouvez choisir, de la façon dont une facture peut être corrigée, et de l'existence ou non
d'un canal de transmission imposé par la loi. La
[matrice de conformité par pays](../../developer-guide/country-support/index.md) montre ce qui est
établi pour chaque pays pris en charge, et dit franchement là où rien ne l'est.

### Format PDF des factures

- Choisissez le format de facturation électronique par défaut : **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL** ou **CII**

### Numérotation des documents

Le motif de numérotation se règle par type de document, et l'application retombe sur une valeur par
défaut raisonnable pour tout type non configuré. Les vendeurs portugais liront la section ATCUD de
l'écran de réglages, où la série de facturation fait partie du motif de numérotation.

## Ce que cette page décrivait, et ne décrit plus

Cette page documentait auparavant un envoi de **logo**, un champ **site web**, une bascule
**exonération de TVA**, un bloc **format de numéro et numéro de départ** par type, et toute une
section **modèles PDF** (typographie, couleurs, marges, libellés personnalisés, aperçu en direct).

Ces descriptions ne correspondaient pas à l'application : les champs ou bien n'existent pas, ou bien
ne sont pas stockés, ou bien ne sont lus par rien de ce qui produit un document. Elles ont donc été
retirées plutôt que maintenues. Ces écarts sont suivis comme défauts dans le `TODO_ISSUES.md` du
dépôt. Le jour où une capacité existe vraiment, elle est de nouveau documentée ici : cette page décrit
ce que le produit fait, jamais ce qu'on attend de lui.
