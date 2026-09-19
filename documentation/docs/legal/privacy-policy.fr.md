---
title: Politique de Confidentialité
language: fr
---

:::warning Brouillon
Brouillon — non encore validé par un avocat.
:::

La présente Politique de Confidentialité explique comment les données personnelles sont traitées dans le
cadre de l'**offre hébergée** d'Invoicerr — la version du Service exploitée sur notre (nos) propre(s)
domaine(s), telle que définie dans les [Conditions Générales de Vente](./terms-of-service.md). **Elle ne
s'applique pas au logiciel auto-hébergé.** Lorsque vous exécutez Invoicerr sur votre propre
infrastructure, nous ne recevons, ne voyons ni ne traitons jamais aucune de vos données — il n'y a rien
dont nous puissions être responsable de traitement ou sous-traitant, et la présente Politique ne décrit
rien qui vous concerne. Tout ce qui suit ne concerne que le Service hébergé.

## 1. Qui Nous Sommes

Le responsable de traitement des données de compte et de facturation décrites à la Section 3 est
**Roméo Chevrier, entrepreneur individuel**, immatriculé sous le numéro **SIREN 982 187 676
(SIRET 982 187 676 00019)**, dont l'adresse enregistrée est **4 rue du Puits, 26120 Montélier, France**
(« **nous** », « **le Prestataire** »). Contact : **contact@invoicerr.app**.

Compte tenu de la nature et de l'ampleur de nos traitements, nous ne sommes pas tenus par l'**article 37
du RGPD** de désigner un délégué à la protection des données. Utilisez le contact ci-dessus pour toute
question ou demande au titre de la présente Politique.

## 2. Deux Rôles, Deux Types de Données

Comme les Conditions Générales de Vente (Section 15.1), la présente Politique distingue deux rôles :

- **Nous sommes le responsable de traitement** pour vos propres **données de compte** — les informations
  vous concernant, vous et votre Société, nécessaires à l'exploitation de votre abonnement (Section 3
  ci-dessous).
- **Nous ne sommes que le sous-traitant**, agissant sur vos instructions documentées, pour les données
  personnelles que **vous** saisissez dans les documents que vous créez ou recevez au moyen du Service —
  les noms, adresses et informations similaires de vos clients ou contacts figurant sur une facture ou un
  devis. Ce traitement est régi par l'[Accord de Traitement des Données](./data-processing-agreement.md),
  et non par la présente Politique : **vous** demeurez le responsable de traitement de ces données, et
  vous êtes responsable de votre propre information en matière de confidentialité auprès de vos clients.

## 3. Ce Que Nous Collectons, en Tant que Responsable de Traitement, et Pourquoi

Nous collectons l'ensemble des données ci-dessous **directement auprès de vous**, soit lorsque vous les
fournissez (inscription, configuration, support), soit automatiquement lorsque vous utilisez le Service
(données de connexion et de sécurité).

| Donnée | Exemples | Finalité | Base légale (art. 6 du RGPD) |
| --- | --- | --- | --- |
| Données de compte | nom, e-mail, mot de passe haché, jetons de session | vous permettre de vous connecter et d'utiliser le Service | Exécution d'un contrat (art. 6, § 1, b)) |
| Données de la Société | nom de la société, adresse, identifiants nationaux que vous configurez (par exemple SIREN/TVA) | exploiter l'espace de travail de votre Société, renseigner les documents que vous émettez | Exécution d'un contrat (art. 6, § 1, b)) |
| Données d'abonnement | formule, nombre de sièges, statut de l'abonnement, dates d'essai | gérer votre abonnement ; Polar traite et conserve votre moyen de paiement et votre adresse de facturation en qualité de merchant of record — voir Section 5 | Exécution d'un contrat (art. 6, § 1, b)) |
| Données de connexion et de sécurité | adresse IP, horodatage des événements d'authentification, journaux applicatifs | détecter les abus, assurer la sécurité du Service, diagnostiquer les incidents | Intérêt légitime (art. 6, § 1, f)) |
| Preuve d'acceptation | le document légal et la version que vous avez acceptés, la date, ainsi que l'adresse IP et l'agent utilisateur du navigateur depuis lesquels vous les avez acceptés | démontrer que vous avez accepté le texte en vigueur au moment où vous l'avez accepté | Exécution d'un contrat (art. 6, § 1, b)), et notre intérêt légitime à pouvoir en apporter la preuve (art. 6, § 1, f)) |
| Communications de support | le contenu des e-mails que vous envoyez à contact@invoicerr.app | répondre à votre demande | Intérêt légitime (art. 6, § 1, f)), ou exécution d'un contrat lorsque la demande concerne votre abonnement |
| Documents de facturation pour notre propre comptabilité | l'identité de votre Société et les Frais qui lui sont facturés | notre propre obligation légale de tenue de comptabilité | Obligation légale (art. 6, § 1, c)) |

Nous n'envoyons aucun e-mail marketing au-delà de ce qui est transactionnel pour votre compte et votre
abonnement (par exemple connexion, facturation et notifications de service) — il n'existe pas de
parcours de consentement marketing distinct à décrire.

## 4. Sous-traitants

Nous partageons les données de compte et de facturation ci-dessus avec les sous-traitants suivants,
chacun engagé selon ses propres conditions de traitement des données :

- **Polar Software Inc.** — traitement des paiements et facturation ; agit en qualité de
  **merchant of record** pour votre abonnement (Conditions Générales de Vente, Section 7.1) et est
  lui-même responsable de traitement pour les informations de paiement qu'il collecte directement
  auprès de vous.
- **Resend** — envoi des e-mails transactionnels du Service (liens de connexion, notifications).
- **Cloudflare, Inc.** — routage entrant des e-mails de correspondance envoyés à
  **contact@invoicerr.app** (correspondance de support uniquement ; Cloudflare ne voit jamais les
  données contenues dans les documents que vous créez au moyen du Service).
- **Google LLC (Gmail)** — la boîte aux lettres où est reçue la correspondance de support envoyée à
  **contact@invoicerr.app** (correspondance de support uniquement ; Google ne voit jamais les données
  contenues dans les documents que vous créez au moyen du Service).
- **Scaleway SAS** — hébergement de l'infrastructure du Service : le cluster Kubernetes sur lequel il
  fonctionne, la base de données PostgreSQL managée qui stocke les données de la Société et de compte
  décrites à la Section 3 ainsi que les documents que vous créez au moyen du Service, et le stockage
  objet qui conserve les documents archivés. **Le Service et les Données Client, y compris la base de
  données, sont hébergés au sein de l'Union européenne**, dans la région de Paris (France) de Scaleway,
  la base de données étant accessible via le réseau privé propre de Scaleway plutôt que par l'internet
  public.

**L'OCR (reconnaissance optique de caractères) fonctionne sur une infrastructure que nous exploitons ;
aucun document n'est envoyé à un fournisseur d'OCR tiers.**

**Ne sont pas nos sous-traitants :** les prestataires de paiement que vous connectez pour permettre à
**vos propres clients** de payer les factures que **vous** émettez — Stripe, Mollie, PayPal — sont
**vos propres comptes**, contractés directement entre vous et eux (Conditions Générales de Vente,
Section 14.3). Les **plateformes nationales de facturation électronique et plateformes
gouvernementales** que vous choisissez de connecter (la PDP française, le KSeF polonais, le SdI italien,
l'AT portugaise, Chorus Pro en France) agissent sur vos propres instructions et mandat pour transmettre
les documents que vous envoyez ; leur rôle à l'égard des données personnelles figurant sur ces documents
est traité dans l'Accord de Traitement des Données, et non dans la présente Politique, axée sur notre
rôle de responsable de traitement.

## 5. Transferts Internationaux

Certains des sous-traitants ci-dessus (Polar, Resend, Cloudflare, Google LLC) peuvent traiter des
données en dehors de l'Espace économique européen, y compris aux États-Unis. Le cas échéant, le
transfert repose sur les garanties appropriées propres à ce prestataire au titre du Chapitre V du RGPD
(telles que les clauses contractuelles types de la Commission européenne). La présente section
constitue une déclaration générale, et non une affirmation sur la certification actuelle d'un prestataire
donné — écrivez à contact@invoicerr.app pour connaître le mécanisme précis sur lequel repose un
prestataire donné aujourd'hui. **Scaleway SAS ne figure pas dans cette liste** : il s'agit d'une société
française qui héberge la base de données PostgreSQL managée de la Société, en plus de l'infrastructure
Kubernetes et du stockage objet déjà décrits à la Section 4, entièrement au sein de sa région de Paris
(France) — aucun maillon de la chaîne qui stocke les documents que vous créez, ou les données de compte
et de base de données de votre Société, n'implique d'entité hors UE.

## 6. Conservation

- **Les données de compte et de Société** sont conservées aussi longtemps que votre Société existe sur
  le Service, puis traitées exactement comme le décrit la Section 13 des Conditions Générales de Vente :
  une Société qui ne convertit jamais son essai est supprimée **au plus tôt 30 jours** après l'envoi de
  son archive de fin d'essai (Section 13.3, premier point — la constante `MIN_RETRIEVAL_DAYS` de
  `billing/lifecycle.ts`) ; une Société ayant eu un abonnement payant est supprimée **au plus tôt
  180 jours** après l'envoi de cette archive (Section 13.3, second point — la constante
  `PAID_ZIP_GRACE_DAYS` du même fichier). Ces deux durées correspondent à la fenêtre minimale de
  récupération des données qu'exige l'article 25, paragraphe 2, point g), du règlement (UE) 2023/2854
  (le Data Act) avant que nous puissions supprimer Vos Données une fois que vous cessez d'utiliser le
  Service.
- **Les journaux applicatifs** sont conservés **90 jours**, puis supprimés automatiquement par une
  purge récurrente — assez longtemps pour instruire un incident de sécurité ou une demande de support
  qui ne se manifeste que des semaines plus tard, et pas davantage.
- **Les enregistrements de session** — une ligne par connexion, portant l'adresse IP et l'agent
  utilisateur du navigateur depuis lesquels elle a été créée — sont supprimés lorsque vous vous
  déconnectez et, à défaut, conservés aussi longtemps que votre compte existe. La suppression de votre
  compte les supprime avec lui.
- **Votre acceptation des présents documents** — la date, le document et la version acceptés, ainsi que
  l'adresse IP et l'agent utilisateur depuis lesquels elle a été donnée — est conservée aussi longtemps
  que votre compte existe. Nous la conservons parce qu'elle est la preuve que vous avez accepté la
  version que vous avez acceptée ; elle est supprimée avec votre compte.
- **Les communications de support** sont conservées le temps nécessaire pour traiter votre demande et
  pendant une période raisonnable par la suite en cas de relance de votre part.

## 7. Sécurité

Les identifiants et jetons utilisés pour connecter votre Société à des canaux et plateformes tiers sont
chiffrés au repos (AES-256-GCM) ; l'ensemble du trafic à destination et en provenance du Service est
chiffré en transit (TLS) — les mêmes mesures que celles décrites à la Section 15.3 des Conditions
Générales de Vente. L'accès à vos données au sein de notre propre organisation est limité à ce qui est
nécessaire pour exploiter et assurer le support du Service.

## 8. Vos Droits

En vertu du RGPD, vous disposez du droit : d'accéder aux données personnelles que nous détenons à votre
sujet (**art. 15**) ; de les faire rectifier (**art. 16**) ; de les faire effacer (**art. 17**) ; d'en
limiter le traitement (**art. 18**) ; d'en recevoir une copie portable (**art. 20**) ; et de vous
opposer à un traitement fondé sur notre intérêt légitime (**art. 21**). Vous pouvez exercer chacun de ces
droits en écrivant à **contact@invoicerr.app** ; nous vous répondrons dans le délai que le RGPD fixe pour
un responsable de traitement. Vous avez également le droit d'introduire une réclamation auprès de
l'autorité française de protection des données, la **CNIL** (www.cnil.fr), ou auprès de l'autorité de
contrôle de votre propre État membre de l'UE.

Nous ne mettons en œuvre aucun traitement relevant de l'**article 22 du RGPD** — il n'existe aucune
décision automatisée, y compris de profilage, produisant des effets juridiques ou vous affectant de
manière significative de façon similaire.

Pour l'export complet des données en libre-service, l'export du journal comptable et l'export
automatique des données de fin d'abonnement, voir les Sections 8.2 et 13.2 des Conditions Générales de
Vente — ces trois moyens constituent également, en pratique, la façon d'exercer votre droit à la
portabilité.

## 9. Cookies et Autres Stockages dans le Navigateur

Le Service dépose deux cookies — l'un pour vous maintenir connecté, l'autre pour mémoriser si vous avez
laissé le menu latéral de navigation ouvert — et conserve quelques préférences d'interface dans le
stockage local de votre propre navigateur. Rien de tout cela n'est utilisé à des fins de mesure
d'audience, de publicité ou de profilage, et aucun tiers ne dépose quoi que ce soit au travers du
Service. Voir la
[Cookies et Politique d'Utilisation Acceptable](./cookies-and-acceptable-use.md) pour la liste
complète, la finalité et la durée de chaque élément, et les raisons pour lesquelles aucun bandeau de
consentement n'est affiché.

## 10. Sites Web Que Nous Exploitons

Le Service lui-même fonctionne à l'adresse **my.invoicerr.app**, hébergé par Scaleway comme décrit à la
Section 4. Séparément du Service, nous publions deux sites web publics et statiques, tous deux servis
par **GitHub Pages** — un service d'hébergement exploité par **GitHub, Inc.**, 88 Colin P. Kelly Jr.
Street, San Francisco, CA 94107, États-Unis, filiale à 100 % de Microsoft Corporation :

- **invoicerr.app** — notre site web public de présentation. Il ne dépose aucun cookie et ne charge
  aucun script d'analyse, de publicité ou de suivi, de quelque nature que ce soit. Le thème sombre/clair
  que vous choisissez n'est mémorisé que dans le `localStorage` de votre navigateur, une préférence
  purement locale qui ne nous parvient jamais et ne comporte aucune donnée personnelle. La page effectue
  un unique appel depuis **votre propre navigateur** vers `api.github.com` (l'API publique de GitHub)
  pour afficher notre nombre actuel d'étoiles GitHub ; cette requête est effectuée directement par votre
  navigateur, sans transiter par nous, de sorte que GitHub voit l'adresse IP du visiteur de la même
  manière que pour toute visite directe de github.com — voir la
  [déclaration de confidentialité de GitHub](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **docs.invoicerr.app** — notre site de documentation, construit avec Docusaurus. Il ne dépose aucun
  cookie et ne charge aucun script d'analyse, de publicité ou de suivi — son moteur de recherche sur la
  page fonctionne entièrement dans votre navigateur (voir la
  [Cookies et Politique d'Utilisation Acceptable](./cookies-and-acceptable-use.md)).

La visite de l'un ou l'autre site envoie votre adresse IP et les en-têtes de requête HTTP standard à
GitHub afin qu'il puisse servir la page ; il s'agit du propre journal d'accès technique de GitHub, que
nous ne recevons pas et ne contrôlons pas. **Aucune donnée de compte, de facturation ou autre donnée du
Service décrite à la Section 3 ne transite par, ou n'est stockée sur, l'un ou l'autre site.**

Notre code source est également publié sur GitHub, à l'adresse
[github.com/invoicerr-app/invoicerr](https://github.com/invoicerr-app/invoicerr). Les issues et
discussions qui y sont publiées sont publiques et sont régies par la propre déclaration de
confidentialité et les conditions de GitHub, et non par la présente Politique.

GitHub, Inc. a auto-certifié auprès du Département du Commerce des États-Unis son adhésion au cadre de
protection des données UE-États-Unis (Data Privacy Framework, DPF), y compris l'extension britannique
(UK Extension) à ce cadre, pour les données personnelles qu'il reçoit de l'UE/du Royaume-Uni à ce titre —
la même garantie du Chapitre V que celle visée à la Section 5 pour nos autres prestataires basés aux
États-Unis.

## 11. Mineurs

Le Service est proposé exclusivement dans un cadre interentreprises (Conditions Générales de Vente,
Section 1.2) et ne s'adresse pas, et n'est pas sciemment utilisé par, des personnes agissant en dehors
d'un cadre professionnel.

## 12. Modifications de la Présente Politique

Nous pouvons mettre à jour la présente Politique de temps à autre ; la version et la date d'effet en
haut de cette page identifient la version en vigueur. Lorsqu'une modification est substantielle, nous
vous en informerons par e-mail avant qu'elle ne prenne effet, de la même manière que le décrit la
Section 20.1 des Conditions Générales de Vente pour ce document.

## 13. Contact

Toute question relative à la présente Politique, ou toute demande au titre de la Section 8, peut être
adressée à **contact@invoicerr.app**, ou par courrier à l'adresse indiquée à la Section 1.

## 14. Langue faisant foi

Le présent document est rédigé et conclu en anglais. Lorsqu'une traduction dans une autre langue est
fournie pour votre confort de lecture et votre compréhension, cette traduction ne se substitue pas au
texte anglais : en cas d'incohérence, d'ambiguïté ou de contradiction entre la version anglaise et une
version traduite, **la version anglaise prévaut** et est celle qui régit les droits et obligations des
parties. Les traductions sont fournies de bonne foi pour permettre à chaque public de comprendre le
présent document ; elles ne créent aucun droit distinct ou supplémentaire.
