---
title: Transparence sur l'Accès International
language: fr
---

:::warning Brouillon
Brouillon — non encore validé par un avocat.
:::

Cette page est publiée conformément à l'article 28 du règlement (UE) 2023/2854 (le « Data Act »), qui
impose à tout fournisseur d'un service de traitement de données de rendre publics (a) les juridictions
auxquelles est soumise l'infrastructure TIC utilisée pour traiter les données de ce service, et (b) une
description générale des mesures techniques, organisationnelles et contractuelles qu'il met en œuvre
pour empêcher tout accès gouvernemental à des données à caractère non personnel détenues dans l'Union,
ou leur transfert, lorsque cet accès ou ce transfert serait contraire au droit de l'Union ou d'un État
membre. Elle ne s'applique qu'à l'**offre hébergée** d'Invoicerr — les
[Conditions Générales de Vente](./terms-of-service.md), Section 14.4, intègrent la présente page par
référence. Elle ne s'applique pas au logiciel auto-hébergé, qui ne nous envoie jamais aucune donnée.

## 1. Juridictions

L'infrastructure qui traite les propres données du Service — les données de compte de votre Société et
Vos Données (les documents, données commerciales et paramètres que vous créez au moyen du Service) —
est située exclusivement en **France** et, plus largement, dans l'**Union européenne** :

| Composant | Fournisseur | Juridiction |
| --- | --- | --- |
| Infrastructure applicative/Kubernetes et stockage objet des documents | Scaleway SAS | France (région de Paris) |
| Base de données PostgreSQL managée | Neon, LLC (société affiliée à Databricks, Inc.) | Union européenne (AWS Europe, Francfort) |

Ni l'infrastructure propre du Service ni Vos Données ne sont hébergées, dupliquées ou sauvegardées en
dehors de la France/de l'UE. Lorsqu'un sous-traitant nommé dans la
[Politique de Confidentialité](./privacy-policy.md), Section 4, et l'
[Accord de Traitement des Données](./data-processing-agreement.md), Section 7 (Polar pour la
facturation de l'abonnement, Resend pour les e-mails transactionnels, Cloudflare et Google LLC pour la
correspondance de support entrante) est une entité non-UE ou peut traiter des données en dehors de
l'EEE, ce traitement se limite aux données de compte/facturation ou à la correspondance de support —
jamais à Vos Données ni aux documents que vous créez au moyen du Service — et repose sur les garanties
propres à ce prestataire au titre du Chapitre V du RGPD, comme décrit dans la Politique de
Confidentialité, Section 5.

Deux sites web publics et statiques — le site de présentation (`invoicerr.app`) et ce site de
documentation (`docs.invoicerr.app`) — sont hébergés sur **GitHub Pages**, exploité par GitHub, Inc.
(États-Unis, filiale à 100 % de Microsoft Corporation). Aucun des deux sites ne constitue une
infrastructure TIC traitant les données du Service : comme l'indiquent les
[Mentions Légales](./legal-notice.md), Section 3, et la Politique de Confidentialité, Section 10,
GitHub ne reçoit ni ne stocke jamais les données de compte, de facturation ou de documents créées au
moyen du Service — uniquement le trafic des visiteurs normalement nécessaire pour servir une page
statique. Ils sont mentionnés ici par souci d'exhaustivité, et non parce qu'ils relèveraient du champ
visé par l'article 28.

## 2. Mesures contre l'Accès International Illicite

- **Localisation des données dès la conception.** La base de données et le stockage documentaire
  propres au Service ne sont hébergés qu'en France et dans l'UE (Section 1 ci-dessus) — un choix, et
  non une configuration par défaut, qui à lui seul place les données hors de portée de toute demande
  d'accès ne passant pas par une voie légale de l'UE ou française.
- **Chiffrement en transit.** L'ensemble du trafic à destination et en provenance du Service est
  chiffré de bout en bout via TLS, avec terminaison au niveau de l'ingress au moyen d'un certificat émis
  et renouvelé automatiquement (cert-manager / Let's Encrypt) — voir
  `deploy/helm/invoicerr/templates/ingress.yaml`.
- **Chiffrement au repos des identifiants de connexion.** Les identifiants et jetons que le Service
  stocke pour connecter votre Société à un canal ou une plateforme tiers (un transport de facturation
  électronique, un fournisseur OIDC, un certificat de signature, un secret de webhook) sont chiffrés au
  repos avec AES-256-GCM avant d'être écrits en base de données — voir
  `backend/src/utils/secret-crypto.ts` — de sorte qu'une simple copie de la base de données ne suffit
  pas à les exposer.
- **Contrôle d'accès.** L'accès aux données d'une Société au sein du Service est limité par les rôles
  propres à cette Société (propriétaire/administrateur/membre) ; l'accès à l'infrastructure et aux
  données de production au sein de notre propre organisation est limité à ce qui est nécessaire pour
  exploiter et assurer le support du Service, comme décrit dans la Politique de Confidentialité,
  Section 7, et l'Accord de Traitement des Données, Section 9.
- **Garanties contractuelles avec les sous-traitants.** Chaque sous-traitant est tenu, par contrat, à
  des obligations de protection des données substantiellement équivalentes à l'Accord de
  Traitement des Données (art. 28, § 4, du RGPD) — voir l'Accord de Traitement des Données, Section 7 —
  et, lorsqu'un sous-traitant peut traiter des données en dehors de l'EEE, aux clauses contractuelles
  types de la Commission européenne ou à une autre garantie prévue au Chapitre V du RGPD.
- **Absence d'accès permanent ou automatisé pour une autorité étrangère.** Nous n'accordons à aucun
  gouvernement, autorité ou tiers un accès permanent, automatisé ou dérobé à l'infrastructure ou à la
  base de données décrites à la Section 1. Toute demande de Vos Données émanant d'une autorité publique
  devrait être formulée au moyen d'un instrument juridiquement contraignant reconnu par le droit de
  l'UE ou le droit français ; à défaut, elle est refusée. Lorsque nous y sommes légalement autorisés,
  nous informerons la Société concernée avant de divulguer toute donnée en réponse à une telle demande.

## 3. Mise à Jour de Cette Page

Cette page est mise à jour chaque fois que la juridiction de l'infrastructure propre du Service, ou les
mesures décrites ci-dessus, change de manière substantielle — le même engagement que celui pris par les
[Conditions Générales de Vente](./terms-of-service.md), Section 20.1, pour ce document. Il s'agit d'un
document de référence : accessible via `GET /api/legal/documents` comme tout document qui y est listé,
mais — comme les Mentions Légales, l'Accord de Traitement des Données et les Cookies et Politique
d'Utilisation Acceptable — son acceptation n'est jamais requise pour utiliser le Service.

## 4. Contact

Toute question relative à cette page peut être adressée à **contact@invoicerr.app**.
