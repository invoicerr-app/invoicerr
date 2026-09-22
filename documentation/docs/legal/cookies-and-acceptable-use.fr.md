---
title: Cookies et Politique d'Utilisation Acceptable
language: fr
---

:::warning[Brouillon]
Brouillon — non encore validé par un avocat.
:::

Cette page couvre deux sujets pour l'**offre hébergée** d'Invoicerr : les cookies déposés par le Service,
et les règles d'utilisation acceptable applicables à votre compte. Aucun des deux ne s'applique au
logiciel auto-hébergé.

## Partie A — Cookies et Autres Stockages dans le Navigateur

### 1. Ce Que Nous Déposons

Le Service dépose **deux** cookies, tous deux émis par notre propre domaine, lus par personne d'autre,
et dont aucun ne poursuit de finalité de suivi ou publicitaire :

| Cookie | Finalité | Durée |
| --- | --- | --- |
| `better-auth.session_token` | vous maintient connecté et associe vos requêtes à votre compte et à votre Société active | 7 jours, prolongés à chaque utilisation du Service |
| `sidebar_state` | mémorise si vous avez laissé le menu latéral de navigation ouvert ou replié | 7 jours |

**Nous ne déposons aucun cookie d'analyse, de publicité ou de suivi par un tiers**, et aucun tiers ne
dépose de cookie au travers du Service.

Au-delà des cookies, le Service conserve un petit nombre de valeurs dans le **stockage local de votre
propre navigateur**. Elles ne nous parviennent jamais — seule la page qui s'exécute dans votre
navigateur les lit — mais nous les listons ici parce que l'**article 82 de la loi n° 78-17 du
6 janvier 1978** vise toute inscription d'informations dans votre équipement terminal, ou tout accès à
des informations déjà stockées, et pas les seuls cookies :

| Valeur stockée | Finalité |
| --- | --- |
| `i18nextLng` | la langue d'interface que vous avez choisie |
| `vite-ui-theme` | le thème clair/sombre que vous avez choisi |
| `pwa-install-dismissed-at` | mémorise que vous avez écarté la proposition d'installer l'application, afin qu'elle cesse de vous la reproposer |
| `invoicerr_portal_token` | sur le portail client uniquement : le jeton d'accès contenu dans le lien qui vous a été envoyé, pour que la page puisse continuer à charger le document pour lequel elle a été ouverte |
| `invoicerr-sw-reloaded` (stockage de session, effacé à la fermeture de l'onglet) | évite une boucle de rechargement lorsqu'une nouvelle version de l'application est installée |

Si vous utilisez le Service en tant qu'application installable, votre navigateur conserve également un
**cache hors ligne** des fichiers de l'application (scripts, styles, icônes) afin qu'elle puisse
démarrer sans connexion réseau. Ce cache contient du code applicatif, non vos données d'activité, et
l'effacement des données de site de votre navigateur le supprime.

### 2. Absence de Bandeau de Consentement

Tout ce qui figure à la Section 1 est soit **strictement nécessaire** au fonctionnement même du Service
(le cookie de session, le jeton du portail client, le garde-fou de rechargement du service worker, le
cache hors ligne de l'application), soit une **préférence que vous avez vous-même exprimée au travers de
l'interface** et que nous ne conservons que pour vous la restituer (l'état du menu latéral, la langue,
le thème, la proposition d'installation écartée).

Ces deux catégories relèvent des exemptions que l'**article 82 de la loi n° 78-17 du 6 janvier 1978**
(loi Informatique et Libertés) prévoit à l'obligation de consentement préalable, telles que la CNIL les
applique dans ses lignes directrices et sa recommandation relatives aux cookies et autres traceurs —
c'est pourquoi aucun bandeau de consentement aux cookies n'est affiché. **Rien de ce qui précède n'est
utilisé à des fins de mesure d'audience, de publicité, de profilage, ni à aucune finalité qui exigerait
votre consentement.** Il s'agit d'une déclaration sur ce que le Service dépose techniquement
aujourd'hui ; elle ne constitue pas un conseil juridique sur votre propre utilisation de cookies
ailleurs.

### 3. Évolution de Cette Situation

Si une future version du Service venait à ajouter un cookie ou une technologie similaire qui ne serait
ni strictement nécessaire ni une préférence que vous avez vous-même exprimée, cette page — ainsi que le
parcours de consentement que les règles ePrivacy exigeraient alors — sera mise à jour avant que cela ne
se produise.

## Partie B — Utilisation Acceptable

### 4. Utilisation Autorisée

Vous pouvez utiliser le Service pour créer, gérer et transmettre vos propres documents commerciaux, dans
les limites de votre abonnement, comme décrit dans les Conditions Générales de Vente.

### 5. Utilisations Interdites

Vous ne devez pas utiliser le Service pour :

- agir de manière illicite, ou créer ou transmettre un document que vous savez frauduleux ou trompeur ;
- tenter de porter atteinte à la sécurité ou à l'infrastructure du Service, de les sonder ou de les
  perturber, y compris par des tests d'intrusion non autorisés ou des activités de déni de service ;
- contourner ou perturber les contrôles d'accès ou les limites de débit propres au Service hébergé,
  au-delà des droits que la licence open source du logiciel vous accorde déjà sur le code source
  lui-même (Conditions Générales de Vente, Section 11.1) ;
- envoyer des messages non sollicités en masse (spam) au moyen des fonctionnalités d'e-mail sortant ou
  de transmission du Service ;
- revendre ou concéder en sous-licence l'accès au Service hébergé à un tiers sans notre consentement
  écrit ;
- téléverser des logiciels malveillants, ou du contenu portant atteinte aux droits de propriété
  intellectuelle ou à d'autres droits d'un tiers.

### 6. Application

Toute violation de la présente Partie B peut entraîner la suspension ou la résiliation de votre accès,
sans préjudice des dispositions relatives à la suspension et à la résiliation prévues à la Section 13
des Conditions Générales de Vente.

### 7. Disponibilité

Les chiffres de disponibilité que nous pouvons publier sont **fournis à titre indicatif uniquement** et
ne constituent pas un niveau de service contractuel — la même base de moyens raisonnables (best effort)
que celle déjà décrite à la Section 16.1 des Conditions Générales de Vente.

## Partie C — Sites Web Publics

### 8. Aucun Cookie, Aucune Analyse

Notre site web public de présentation à l'adresse **invoicerr.app** et notre site de documentation à
l'adresse **docs.invoicerr.app** sont tous deux des sites statiques servis par **GitHub Pages**
(GitHub, Inc. — voir Politique de Confidentialité, Section 10). **Aucun des deux ne dépose de cookie ni
ne charge de script d'analyse, de publicité ou de suivi, de quelque nature que ce soit.** L'index de
recherche sur la page de docs.invoicerr.app fonctionne entièrement dans votre navigateur ; le choix du
thème sombre/clair sur invoicerr.app n'est mémorisé que dans le `localStorage` de votre navigateur,
jamais dans un cookie. Les propres journaux d'accès techniques de GitHub pour l'un ou l'autre site
(adresse IP du visiteur et en-têtes de requête, nécessaires pour servir la page — et, pour invoicerr.app,
l'unique appel côté client vers `api.github.com` pour le nombre d'étoiles GitHub) sont décrits dans la
Politique de Confidentialité, Section 10, et non ici.

## Partie D — Langue faisant foi

### 9. La version anglaise prévaut

Le présent document est rédigé et conclu en anglais. Lorsqu'une traduction dans une autre langue est
fournie pour votre confort de lecture et votre compréhension, cette traduction ne se substitue pas au
texte anglais : en cas d'incohérence, d'ambiguïté ou de contradiction entre la version anglaise et une
version traduite, **la version anglaise prévaut** et est celle qui régit les droits et obligations des
parties. Les traductions sont fournies de bonne foi pour permettre à chaque public de comprendre le
présent document ; elles ne créent aucun droit distinct ou supplémentaire.
