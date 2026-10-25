---
title: Transparence sur l'Accès International
language: fr
---

:::warning[Brouillon]
Brouillon — non encore validé par un avocat.
:::

Cette page est publiée conformément à l'article 28 du règlement (UE) 2023/2854 (le « Data Act »), qui
impose à tout fournisseur d'un service de traitement de données de rendre publics (a) les juridictions
auxquelles est soumise l'infrastructure TIC utilisée pour traiter les données de ce service, et (b) une
description générale des mesures techniques, organisationnelles et contractuelles qu'il met en œuvre
pour empêcher tout accès gouvernemental à des données à caractère non personnel détenues dans l'Union,
ou leur transfert, lorsque cet accès ou ce transfert serait contraire au droit de l'Union ou d'un État
membre. Elle ne s'applique qu'à l'**offre hébergée** d'Invoicerr — les
[Conditions Générales d'Utilisation](./terms-of-service.md), Section 14.4, intègrent la présente page par
référence. Elle ne s'applique pas au logiciel auto-hébergé, qui ne nous envoie jamais aucune donnée.

## 1. Juridictions

L'infrastructure qui héberge les propres données du Service, les données de compte de votre Société et
Vos Données (les documents, données commerciales et paramètres que vous créez au moyen du Service), est
située exclusivement en **France**. Un prestataire se place devant elle, pour le seul transit, tant que
son proxy est activé :

| Rôle | Composant | Prestataire | Juridiction |
| --- | --- | --- | --- |
| Hébergement | Infrastructure Kubernetes managée, base de données PostgreSQL managée (deux nœuds), stockage objet des documents, et sauvegardes (OVHcloud Object Storage, conservées 35 jours) | OVH SAS (OVHcloud) | France |
| Transit, tant que le proxy est activé | DNS et proxy inverse : tout le trafic entre votre navigateur et le Service traverse le réseau de Cloudflare, où le TLS est terminé | Cloudflare, Inc. | États-Unis (le réseau de Cloudflare peut traiter le trafic hors de France) |

**Hébergement.** Vos Données et la base de données du Service sont stockées, traitées et sauvegardées
uniquement en France, par un seul prestataire français. Aucune n'est hébergée, dupliquée ou sauvegardée
en dehors de la France.

**Transit.** Tant que le proxy de Cloudflare est activé devant le Service, chaque requête et chaque
réponse entre votre navigateur et le Service, y compris les documents que vous créez et les données
personnelles qu'ils contiennent, traverse le réseau de Cloudflare en clair avant d'être rechiffrée vers
le Service. Cloudflare, Inc. est une société établie aux États-Unis et soumise à leur droit. Le Service
passera Cloudflare en DNS seul, sans proxy, une fois la production validée, et cette page sera mise à
jour à ce moment.

Lorsqu'un autre sous-traitant nommé dans la [Politique de Confidentialité](./privacy-policy.md),
Section 4, et l'[Accord de Traitement des Données](./data-processing-agreement.md), annexe IV, est une
entité non-UE ou peut traiter des données en dehors de l'EEE (Stripe pour le paiement de l'abonnement,
Resend pour le texte des e-mails transactionnels), ce traitement se limite aux données de compte et de
facturation ou au texte d'un e-mail, jamais aux documents que vous créez, accessibles par un lien de
téléchargement servi depuis la France ; il repose sur les garanties propres à ce prestataire au titre
du Chapitre V du RGPD, comme décrit dans la Politique de Confidentialité, Section 5.

Deux sites web publics et statiques, le site de présentation (`invoicerr.app`) et ce site de
documentation (`docs.invoicerr.app`), ainsi que le dépôt du code source, sont hébergés par **GitHub**,
exploité par GitHub, Inc. (États-Unis, filiale à 100 % de Microsoft Corporation). Aucun d'eux ne
constitue une infrastructure TIC traitant les données du Service : comme l'indiquent les
[Mentions Légales](./legal-notice.md), Section 3, et la Politique de Confidentialité, Section 10,
GitHub ne reçoit ni ne stocke jamais les données de compte, de facturation ou de documents créées au
moyen du Service, uniquement le trafic des visiteurs normalement nécessaire pour servir une page
statique. Ils sont mentionnés ici par souci d'exhaustivité, et non parce qu'ils relèveraient du champ
visé par l'article 28.

## 2. Mesures contre l'Accès International Illicite

- **Localisation des données dès la conception.** La base de données, le stockage documentaire et les
  sauvegardes du Service ne sont hébergés qu'en France, par un prestataire français : un choix, et non
  une configuration par défaut, qui place les données stockées hors de portée de toute demande d'accès
  ne passant pas par une voie légale de l'UE ou française.
- **Le transit par Cloudflare, dit clairement.** Tant que le proxy de Cloudflare est activé, une
  société américaine voit le trafic en clair sur son chemin vers le Service (Section 1). Nous ne
  prétendons pas le contraire, et nous retirons le proxy une fois la production validée.
- **Chiffrement en transit.** L'ensemble du trafic à destination et en provenance du Service est
  chiffré via TLS, avec terminaison au niveau de l'ingress au moyen d'un certificat émis et renouvelé
  automatiquement (cert-manager / Let's Encrypt), voir `deploy/helm/invoicerr/templates/ingress.yaml`,
  et, tant que le proxy est activé, également chez Cloudflare.
- **Chiffrement au repos des identifiants de connexion.** Les identifiants et jetons que le Service
  stocke pour connecter votre Société à un canal ou une plateforme tiers (un transport de facturation
  électronique, un fournisseur OIDC, un certificat de signature, un secret de webhook) sont chiffrés au
  repos avec AES-256-GCM avant d'être écrits en base de données, voir
  `backend/src/utils/secret-crypto.ts`, de sorte qu'une simple copie de la base de données ne suffit
  pas à les exposer.
- **Chiffrement des sauvegardes.** Les copies de sauvegarde des documents et fichiers stockés par le
  Service sont chiffrées (AES-256-GCM) avant d'être écrites sur le stockage de sauvegarde, au moyen
  d'une clé qui n'est jamais écrite sur ce stockage (voir l'Accord de Traitement des Données, annexe
  III), de sorte qu'une copie du compartiment de sauvegarde à elle seule n'atteint que du texte
  chiffré, jamais les documents. Les sauvegardes expirent après trente-cinq (35) jours.
- **Aucun document dans les e-mails.** Les e-mails envoyés par le Service ne portent que leur texte :
  un document n'est jamais joint et il est accessible par un lien de téléchargement servi par le
  Service, de sorte que Resend, prestataire américain, ne reçoit jamais les documents que vous créez.
- **Contrôle d'accès.** L'accès aux données d'une Société au sein du Service est limité par les rôles
  propres à cette Société (propriétaire/administrateur/membre) ; l'accès à l'infrastructure et aux
  données de production au sein de notre propre organisation est limité à ce qui est nécessaire pour
  exploiter et assurer le support du Service, comme décrit dans la Politique de Confidentialité,
  Section 7, et l'Accord de Traitement des Données, annexe III.
- **Garanties contractuelles avec les sous-traitants.** Chaque sous-traitant est tenu, par contrat, à
  des obligations de protection des données substantiellement équivalentes à l'Accord de Traitement des
  Données (art. 28, § 4, du RGPD), voir l'Accord de Traitement des Données, clause 7.7 et annexe IV, et,
  lorsqu'un sous-traitant peut traiter des données en dehors de l'EEE, aux clauses contractuelles types
  de la Commission européenne ou à une autre garantie prévue au Chapitre V du RGPD.
- **Absence d'accès permanent ou automatisé pour une autorité étrangère.** Nous n'accordons à aucun
  gouvernement, autorité ou tiers un accès permanent, automatisé ou dérobé à l'infrastructure ou à la
  base de données décrites à la Section 1. Toute demande de Vos Données émanant d'une autorité publique
  devrait être formulée au moyen d'un instrument juridiquement contraignant reconnu par le droit de
  l'UE ou le droit français ; à défaut, elle est refusée. Lorsque nous y sommes légalement autorisés,
  nous informerons la Société concernée avant de divulguer toute donnée en réponse à une telle demande.

## 3. Mise à Jour de Cette Page

Cette page est mise à jour chaque fois que la juridiction de l'infrastructure propre du Service, ou les
mesures décrites ci-dessus, change de manière substantielle — le même engagement que celui pris par les
[Conditions Générales d'Utilisation](./terms-of-service.md), Section 20.1, pour ce document. Il s'agit d'un
document de référence : accessible via `GET /api/legal/documents` comme tout document qui y est listé,
mais — comme les Mentions Légales, l'Accord de Traitement des Données et les Cookies et Politique
d'Utilisation Acceptable — son acceptation n'est jamais requise pour utiliser le Service.

## 4. Contact

Toute question relative à cette page peut être adressée à **contact@invoicerr.app**.
