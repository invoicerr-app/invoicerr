# TODO_FEATURES — fonctionnalités manquantes vs. concurrents (2026-09-15)

> Tâche d'ANALYSE pour §1/§2 (aucun code touché par ce fichier). Méthode : §1 est reconstruit à 100 %
> depuis le code (modules `backend/src/modules/`, écrans `frontend/src/pages/`, specs
> `e2e/cypress/e2e/`) — jamais deviné. §2 recoupe cet inventaire avec une recherche web sur les
> logiciels de facturation concurrents (SaaS et self-hosted, y compris closed-source) pour ne garder
> que les manques réellement récurrents chez eux. Chaque ligne de manque porte une case "e2e" : ce
> qu'un test devrait prouver le jour où l'item est implémenté.
>
> Ce fichier est complémentaire à `TODO_MANDANT.md` (credentials/démarches de conformité e-invoicing)
> et à `TODO_ISSUES.md` (le moteur de conformité pays). Il ne les recoupe pas : il couvre les
> fonctionnalités "métier" génériques (paiement, relances, portail, stock, temps…) que la
> quasi-totalité des concurrents proposent, indépendamment de la conformité e-invoicing par pays
> (déjà très avancée, voir §1.2).
>
> **Réorganisation du 2026-09-15.** L'ancienne « file d'exécution » (décidée le 2026-09-13) et
> l'ancien « Suivi » affichaient encore « en cours »/« en file » pour des features livrées et
> prouvées en CI depuis (run `34875223906`, 2026-09-14, workflow « Tests », job `cypress-run` vert —
> chaque feature listée ci-dessous a sa propre spec Cypress passante, sauf mention contraire).
> Remplacés par la section **Livré** et par les **décisions produit du propriétaire** prises le
> 2026-09-15, qui referment ou reformulent plusieurs manques restants (paiements, PDF, email, mobile,
> abonnement) et ajoutent un sujet nouveau (serveur de mail d'instance vs. de société). Les rangs et
> intitulés numérotés dans ce fichier reprennent ceux du §3 historique — ils ne sont pas repartis de
> zéro.

---

## Livré (15)

| Rang | Feature | Preuve |
|---:|---|---|
| 1 | Paiement en ligne (Stripe) | Câblé et testé à blanc — spec `60-online-payment`, commit `4c0b0c94` (2026-09-14). **Jamais prouvé avec un vrai compte Stripe** : le commit le dit lui-même — « No payment-provider account exists for this project and none will » — la vérification webhook/idempotence est réelle, l'intégration ne l'est pas. Voir Décision A. |
| 2 | Relances automatiques (dunning) | `53-reminders-toggle` |
| 3 | Portail client authentifié | `56-client-portal` |
| 4 | Export comptable (CSV générique) | `52-accounting-export` |
| 5 | Rapprochement bancaire | `59-bank-reconciliation` |
| 6 | Relevé de compte client | `47-client-statement` |
| 7 | Référence client / n° de commande | `46-client-reference` |
| 8 | QR de paiement SEPA (EPC069-12) | `48-payment-qr` |
| 9 | Taux de change automatiques | Livré le 2026-09-14 — `backend/src/modules/company/currency-rates/` (sweep BullMQ quotidien, flux BCE `ecb-rates-client.ts` + repli `open-er-api-rates-client.ts` sans clé). Pas d'écran : preuve = jest + round-trip live réel contre le flux BCE (`ECB_LIVE=1`), pas de spec Cypress. |
| 11 | Suivi du temps & facturation de projets | `57-time-tracking` |
| 12 | Facturation échelonnée multi-jalons | `51-installments` |
| 14 | Langue du document par destinataire | `58-document-recipient-language` — cascade `Client.language` → `Company.language` → `en` (`rendering/language/resolve-recipient-language.ts`), vérifiée dans le code : c'est exactement la cascade que la Décision B redemande pour le PDF, déjà en place. |
| 17 | Workflow d'approbation interne | `50-approval` |
| 18 | Gestion de stock basique | `49-stock` |
| *(hors liste)* | Méthodes de paiement typées par société | `61-payment-methods`, livré le 2026-09-14 (`backend/src/modules/documents/payment-methods/`) |

---

## Restent (7) — vérifiés dans le code au 2026-09-15

| Rang | Feature | État vérifié (2026-09-15) | e2e à prouver |
|---:|---|---|---|
| 10 | Écran « déclarations » — reformulé (voir détail ci-dessous) | Presque sans objet depuis le pivot 5 pays : `find`/`grep` sur `backend/src/modules/documents/reporting/` confirment qu'aucun fichier `mydata`/`nav` ne subsiste (supprimés avec la sortie GR/HU du périmètre) ; seul `reporting/data/pt.json` + `reporting/providers/pt-at-client.ts`/`pt-declaration-provider.ts` existent, statut **implemented-awaiting-accreditation** (jamais éprouvé en réel — 2 gaps dans `TODO_ISSUES.md`). Aucun écran frontend ne lit `reporting/` ni `DocumentAuthorityEvent` (`grep` sur `frontend/src/pages` : rien). | Envoyer une facture PT déclenche `pt-at` ; un écran liste le statut de la déclaration (même en échec) — reste à construire, un seul pays à couvrir désormais. |
| 13 | Notes de frais enrichies | Voir Décision F. | Une dépense avec image stocke le fichier et permet de le retélécharger ; une catégorie apparaît dans les stats. |
| 15 | Champs personnalisés / tags | Voir Décision F. | Un champ personnalisé créé en Settings apparaît sur le formulaire et le PDF des documents suivants. |
| 16 | Personnalisation de template — **redéfini** en préréglages visuels (plus un éditeur) | Voir Décision B. | Un utilisateur choisit un préréglage (couleur/logo/police) et voit le PDF changer, sans toucher au HTML. |
| 19 | Bons de commande / achats fournisseurs | Voir Décision F. | Un BC envoyé puis une facture reçue rapprochée affiche les écarts quantité/montant. |
| 20 | Facturation par abonnement avancée (usage-based) | Sans objet côté produit invoicerr — redirigé vers l'offre hébergée du propriétaire, voir Décision E. | N/A côté produit self-hosted. |
| 21 | Application mobile native | **Plafonnée à une PWA**, voir Décision D. | Manifeste + service worker installables ; hors échelle Cypress pour le reste. |

### Rang 10 en détail — pourquoi le mécanisme `reporting/` ne concerne plus que le Portugal

`reporting/` modélise « le vendeur DÉCLARE les données de la facture à SON autorité fiscale en temps
réel et reçoit un identifiant émis par l'autorité » (`DeclarationResult.authorityId` obligatoire).
NAV (Hongrie) et myDATA (Grèce) étaient les deux seules formes livrées ; les deux pays sont sortis du
périmètre au pivot cinq pays (2026-09-10) et leurs fichiers ont été supprimés (vérifié : `find` ne
trouve plus aucun `*mydata*`/`*nav*` sous `reporting/`). Verdicts pays par pays (étude 2026-09-11,
sources primaires, non repris ici en détail — voir l'historique git de ce fichier pour le texte
complet) : FR (e-reporting via PDP→PPF, transport périodique, pas une déclaration temps réel), PL/IT
(KSeF/SdI = clearance/transport, déjà modélisé ailleurs), DE (Meldesystem pas encore législé). **PT
reste le seul candidat honnête** et a déjà reçu son provider (`pt-at`, DL 198/2012 art. 3º n.º1,
provenance `legal`) — implémenté mais jamais éprouvé en réel (mTLS non câblé, padding RSA
`unverified`). Le besoin produit d'origine (« donner du contenu à l'écran ») reste ouvert : soit
construire l'écran de suivi PT une fois l'accréditation obtenue, soit l'élargir génériquement aux
`DocumentAuthorityEvent` (FR/PL/IT ont déjà des événements d'autorité temps réel dans cette table,
sans lien avec le mécanisme `reporting/`) — **ne pas mélanger les deux mécanismes**, c'est exactement
l'anti-pattern que l'en-tête de `reporting/schema.ts` proscrit.

---

## Décisions produit du 2026-09-15

### A. Paiements — toutes les plateformes

Mandat du propriétaire : « va falloir checker toutes les façons de pouvoir payer une facture, et
toutes les plateformes (faire fonctionner PayPal, Stripe, et toutes les autres plateformes du
genre) ». Point de départ vérifié dans le code : Stripe est câblé (`payments/providers/stripe/`) mais
**jamais prouvé avec un vrai compte** (voir Livré, rang 1) ; PayPal aujourd'hui n'est qu'un
**descripteur d'affichage** (`payment-methods/paypal.descriptor.ts` — imprime l'email du compte et
construit un lien `paypal.com/cgi-bin/webscr` classique, JAMAIS un webhook vérifié : « recording that
it arrived stays a record-payment action a human … performs afterward »). Les points d'extension
existent déjà et n'ont pas besoin d'être réinventés : `backend/src/modules/documents/payments/
providers/` (registre `PaymentProviderRegistry`, un provider = un fichier + un `register()`) pour un
VRAI encaissement webhook-vérifié, et `backend/src/modules/documents/payment-methods/` (descripteurs
d'affichage : `cash`, `bank-transfer`, `cheque`, `paypal`, `stripe`) pour ce qui reste déclaratif.

**Recherche sur les plateformes utilisables dans les 5 pays avec bac à sable sans entreprise réelle**
(sources officielles citées, 2026-09-15) :

| Plateforme | Moyens de paiement | API (lien + webhook) | Pays FR/PL/IT/PT/DE | Bac à sable sans entreprise | Frais annoncés (page tarifaire, 2026-09) | Famille |
|---|---|---|---|---|---|---|
| **Stripe** | +40 (cartes, SEPA, iDEAL, Przelewy24…) | Oui — Payment Links API | ✓/✓/✓/**?**/✓ | Oui, gratuit (test mode intégré) | Carte 1,5 % + 0,25 € (EEE) ; SEPA 0,35 € | Généraliste — déjà câblé, jamais prouvé |
| **Mollie** | +35 (cartes, SEPA, iDEAL, Przelewy24, Bancontact, MB WAY…) | Oui — Payment Links API | ✓/✓/✓/✓/✓ (30 pays EEE) | Oui, gratuit | Carte 1,8 % + 0,25 € ; SEPA 0,25 % + 0,4 % ; iDEAL 0,29 € | Généraliste — natif UE, couvre tous les moyens locaux des 5 pays |
| **PayPal** | PayPal, cartes, méthodes locales | Oui — Orders API v2 + webhooks | ✓/✓/✓/✓/✓ (200+ pays) | Oui, sandbox développeur gratuit | 3,49 % + fixe (checkout) ; 2,99 % + fixe (cartes) | Généraliste — aujourd'hui descripteur seul dans invoicerr, à construire en vrai encaissement |
| Payplug | Cartes, Apple Pay, Google Pay | Oui — API REST | FR seulement | Oui, environnement de test | Non établi | Spécialiste FR |
| Przelewy24 | +165 banques polonaises, cartes | Oui — API REST | PL seulement | Oui, panel de test | Non établi | Spécialiste PL |
| Nexi (XPay) | Cartes, Satispay, BNPL | Oui — Pay-by-Link API | IT seulement | Non établi | Non établi | Spécialiste IT |
| Easypay | Cartes, MB WAY, Multibanco | Oui — Pay-by-Link | PT seulement | Oui, gratuit | Non établi | Spécialiste PT |
| IfThenPay | Multibanco, MB WAY, Payshop, cartes | Oui — Pay-by-Link | PT seulement | Oui | Non établi | Spécialiste PT |

Chaque frais est celui annoncé par la page tarifaire officielle de la plateforme à la date de la
recherche (2026-09-15), pas un fait durable — à revérifier avant toute décision de câblage. La
couverture Portugal de Stripe n'a pas pu être confirmée (marquée `?`) ; Adyen/Checkout.com/SumUp/
Braintree/GoCardless couvrent aussi tout ou partie des 5 pays mais leur bac à sable n'est pas confirmé
(sauf GoCardless), donc pas retenus pour l'instant. **Écartées et pourquoi** : Paddle et Lemon Squeezy
(famille SaaS/marchand de référence, 5 %+ de frais, pensées pour un abonnement logiciel, pas pour
encaisser une facture ponctuelle) ; Klarna (BNPL uniquement, pas un mode d'encaissement direct) ;
Square (couverture UE non confirmée dans les 5 pays cibles, plateforme centrée USA). **polar.sh est
volontairement absent de ce tableau** : c'est un marchand de référence (MoR) pensé pour un abonnement
logiciel, pas pour l'encaissement d'une facture — il est en revanche retenu pour un tout autre sujet,
voir Décision E.

**Ordre d'implémentation qui en découle** (aucune durée n'est estimée ici — non demandé) :
1. Stripe — déjà câblé, à prouver en premier avec un vrai compte (lève la seule réserve du rang 1).
2. Mollie — nouveau provider, la meilleure couverture native des 5 pays et de leurs moyens locaux.
3. PayPal — remplacer le descripteur d'affichage actuel par un vrai encaissement Orders API v2.
4. Régionaux (Przelewy24 PL, Payplug FR, Nexi IT, Easypay/IfThenPay PT) — seulement si des clients
   dans ces pays le demandent spécifiquement.

**Non établi par la recherche**, à ne pas prendre pour acquis : les frais de Payplug / Nexi /
Przelewy24 / Easypay / IfThenPay ; l'existence d'un bac à sable chez Adyen / Checkout.com / SumUp ; la
couverture Portugal de Stripe et de Klarna.

### B. PDF — document figé, éditeur supprimé

Mandat du propriétaire, confirmé par question explicite : « faut pas d'éditeur de PDF pour les
documents, un document hardcodé, y'a que la langue qui change pour être celle du client, si pas
défini celle de l'entreprise, si pas défini en anglais » — et l'éditeur Handlebars doit être
**supprimé**. Vérification dans le code : **c'est déjà fait, mais pas pour cette raison**. L'onglet
PDF (`frontend/src/pages/(app)/settings/_components/pdf.settings.tsx`) a été retiré le 2026-09-13
(commit `0a4f850a`) — motif à l'époque : les deux routes qu'il appelait (`GET`/`POST
/api/company/pdf-template`) n'ont jamais existé côté backend, l'écran ne faisait donc rien
silencieusement pour tout visiteur. Le champ `pdfConfig` d'`EditCompanyDto` et le modèle de gabarit
associé ont été supprimés avec lui ; **il n'existe aujourd'hui aucun modèle Prisma de gabarit PDF ni
aucun champ `Company.pdfTemplate`** (vérifié par grep sur `backend/prisma/schema.prisma` — le seul
mécanisme de « template » qui subsiste est `MailTemplate`, pour les e-mails, sans rapport). La
décision du 2026-09-15 confirme donc l'absence d'éditeur comme un choix produit définitif, pas
seulement l'état de fait actuel : aucun retour de gabarit personnalisé ne doit être réintroduit.

La cascade de langue demandée (client → société → anglais) est, elle, **déjà livrée** — rang 14,
`rendering/language/resolve-recipient-language.ts`, exactement dans cet ordre, avec `en` en plancher
universel. Rien à faire de ce côté.

Les « thèmes PDF sans code » (ancien rang 16) deviennent une **liste de préréglages visuels**
(couleurs, logo, police) — jamais un éditeur de contenu. État vérifié : aucun champ de marque
n'existe encore sur `Company` (ni `logo`, ni `color`, ni `font` dans le schéma — grep confirmé) ; le
rendu (`rendering/render-html.ts`) produit un unique design hardcodé aujourd'hui. Construire les
préréglages suppose donc d'abord d'ajouter le strict nécessaire (un champ logo, une palette
restreinte de couleurs, un choix de police parmi un jeu fermé) — jamais une zone de texte libre ou de
markup.

**Ce que la suppression retire** : l'onglet Settings (déjà parti), tout gabarit HTML/Handlebars
stocké en base (il n'y en avait déjà plus au moment du retrait — les deux routes qu'il appelait
étaient déjà mortes). **Question ouverte** : pour les sociétés qui croyaient avoir un gabarit
personnalisé actif avant le 2026-09-13, l'écran ne l'a jamais réellement persisté (404 sur les deux
routes) — il n'y a donc rien à migrer côté données, mais aucune communication n'a été faite vers ces
sociétés au moment du retrait ; à trancher si une telle communication est nécessaire.

### C. Emails — un vrai éditeur WYSIWYG

À l'inverse du PDF, le propriétaire veut « un éditeur d'email propre type WYSIWYG ». État actuel
vérifié : `Settings → Email` (`templates.settings.tsx`, testé par `54-email-templates`) est un
éditeur de **texte brut avec jetons `{placeholder}` à accolade simple** (`actions/
email-template.ts`), pas Handlebars malgré la dépendance npm du même nom encore présente dans les
deux `package.json` (elle sert au rendu PDF historique, pas aux emails — aucun usage de `handlebars`
trouvé dans le code d'email). Trois niveaux de repli déjà en place : défaut du descripteur par type,
surcharge par entreprise (`Company.documentEmailTemplates`, modèle `MailTemplate` pour les deux
e-mails système), repli générique. Un placeholder inconnu est SIGNALÉ, jamais bloquant — contrat à
préserver si l'éditeur change.

**Écart à combler** : gabarits texte/`{placeholder}` aujourd'hui → éditeur riche (WYSIWYG) demain.
**Questions ouvertes, non tranchées ici** :
- quelle bibliothèque d'édition riche (TipTap, Lexical, Quill…) — à choisir, ce fichier ne tranche
  pas ;
- que deviennent les variables (`{{invoice.number}}` façon Handlebars, ou la grammaire `{name}`
  actuelle conservée sous une autre UI) — le contrat serveur actuel (placeholder inconnu signalé, pas
  levé) devra être précisé pour la nouvelle grammaire choisie ;
- la même cascade de langue que le PDF (Décision B) doit-elle s'appliquer aux gabarits par défaut —
  probable vu la cohérence produit visée, mais non demandé explicitement pour l'email : à confirmer.

### D. Mobile — PWA, pas plus

Mandat du propriétaire : « le max qu'on peut faire c'est une PWA, pas plus ». Remplace l'ancien
rang 21 (application native iOS/Android). État vérifié : **aucune trace de PWA aujourd'hui** — ni
`manifest.json`, ni service worker, ni `vite-plugin-pwa`/`workbox` dans `frontend/package.json` ou
`vite.config.*` (recherche vide). Reste à construire : manifeste (nom, icônes, couleur de thème),
service worker (mise en cache minimale, installabilité), et éventuellement le scan de reçu via
l'appareil photo du navigateur (`<input type="file" capture>` ou `MediaDevices` — pertinent pour le
rang 13, notes de frais, voir Décision F). **Le README promet plus que ça** :
`README.md:40` — « REST API backend, ready for future integrations (mobile & desktop apps) » — à
corriger pour ne plus laisser entendre une app native à venir.

### E. Abonnement à l'usage — une offre HÉBERGÉE payante

Mandat du propriétaire : « l'objectif c'est que moi je host Invoicerr dans des datacenters allemands
sécurisés, et qu'il y ait un système pour qu'une entreprise paye en fonction de sa taille (2 $ par
utilisateur qui utilise l'application, 1,5 $ dès 5 utilisateurs, et 1 $ pour 10 et + [tarif
dégressif par palier de sièges]) ». Décisions déjà prises par question explicite :

- **La version open source auto-hébergée reste LIBRE et sans aucun module de facturation.** La
  facturation n'existe que sur l'offre hébergée du propriétaire, activée par une configuration que
  seul son hébergement porte — modèle Gitea/Plausible (le code peut exister dans le dépôt, mais reste
  inerte pour tout self-hébergeur).
- **Plateforme : Polar (polar.sh), offre « Starter »** — décidé le 2026-09-15 : « On go sur Polar en
  starter, ils ont le système pour gérer les seats ». La question « quelle plateforme » n'est donc
  plus ouverte.
- **Modèle de tarification : GRADUÉ (marginal par tranches)** — décidé le 2026-09-15 : « on part sur
  du gradué ». Fermé, l'option « tarif unique par palier » (tout le monde payé au taux de la tranche
  atteinte) est écartée. **Deux grilles à distinguer** :
  - **Grille DÉCIDÉE** (celle du mandat initial) : les 4 premiers sièges à 2 $ chacun, du 5ᵉ au 9ᵉ à
    1,5 $ chacun, le 10ᵉ et au-delà à 1 $ chacun.
  - **Grille ENVISAGÉE, NON TRANCHÉE** — le propriétaire a dit que les prix allaient « sûrement » être
    revus vers 5 $ / 4 $ / 3,5 $ par siège. Il n'a précisé QUE ces trois montants, pas de nouveaux
    seuils : les paliers à 5 et 10 sièges ci-dessous sont une hypothèse de continuité avec la grille
    décidée, **non confirmée par le propriétaire** — ne pas la prendre pour acquise.

  Exemple chiffré pour lever toute ambiguïté, avec les deux grilles :

  | Sièges | Grille décidée (2 $/1,5 $/1 $) | Grille envisagée, non tranchée (5 $/4 $/3,5 $) |
  |---:|---|---|
  | 7 | `4×2 + 3×1,5 = 12,5 $` | `4×5 + 3×4 = 32 $` |
  | 12 | `4×2 + 5×1,5 + 3×1 = 18,5 $` | `4×5 + 5×4 + 3×3,5 = 50,5 $` |

- **Périodicité : DÉCIDÉE le 2026-09-15 — mensuel ET annuel, pas un choix exclusif.** Les deux
  formules seront proposées. Non précisé par le propriétaire, à ne pas inventer : si l'annuel porte
  une remise par rapport à 12 fois le tarif mensuel.
- **Définition d'un siège : TRANCHÉE le 2026-09-15 — un siège = un rattachement utilisateur × société,
  né à l'acceptation, jamais à l'envoi d'une invitation.** Mot du propriétaire, à citer : « Un
  utilisateur paye pour être relié à une entreprise. Imaginons un comptable qui veut utiliser
  Invoicerr, chaque entreprise à laquelle il est rattaché doit payer pour l'avoir dans son équipe. »
  Conséquences, toutes closes le 2026-09-15 :
  - le compteur facturable d'une société est le nombre de ses rattachements utilisateur (modèle
    Prisma réel : `UserCompany` — le propriétaire dit « CompanyMembership » au sens générique, il n'y
    a pas de modèle de ce nom dans ce schéma), **jamais** le nombre d'utilisateurs distincts de toute
    la plateforme, et **sans aucune notion d'activité** (pas de « connecté dans les 30 derniers
    jours ») ;
  - un même utilisateur membre de trois sociétés compte pour **trois sièges**, chacun facturé à sa
    propre société ;
  - le payeur est toujours la société, jamais l'utilisateur ;
  - **l'OWNER compte comme un siège**, comme tout membre — pas d'exemption de rôle ;
  - **une invitation ne compte qu'à l'acceptation** — le siège naît avec la ligne `UserCompany`,
    jamais à l'envoi de l'invitation (`modules/invitations/`) : une invitation en attente ne doit rien
    ajouter au compteur facturable.

**Cycle de vie de l'abonnement — trois états datés, décidés le 2026-09-15** (aucun n'est implémenté,
c'est une exigence produit à consigner) :
1. **Essai** — 7 jours gratuits à compter de la création de la société. Mot du propriétaire, à citer :
   « dans les 7 j d'essai il doit pas pouvoir envoyer de factures, il doit pouvoir tout faire mais pas
   en envoyer, donc on n'est pas obligé de les conserver ». Concrètement : **l'action `'send'`**, le
   seul point d'entrée partagé par `invoice`/`quote`/`credit-note` via `actions/async-send.ts`
   (numérotation définitive, dépôt PDP/Chorus Pro/KSeF, envoi email — vérifié dans le code, c'est bien
   la même action id pour les trois types) **est refusée nommément** pendant l'essai. Tout le reste
   reste utilisable : brouillons, clients, articles, PDF de prévisualisation.
2. **Bloquée** — si aucun paiement n'est enregistré au terme des 7 jours d'essai, la société bascule
   en blocage total : **plus aucune action possible** (lecture/écriture, à préciser à l'implémentation
   si un mode lecture-seule minimal doit subsister). Ce blocage dure 14 jours.
3. **Supprimée** — la mécanique et son délai diffèrent selon si la société a déjà payé, **TRANCHÉ
   dans les deux cas le 2026-09-15** :
   - **Société qui n'a jamais payé** (jamais sortie de l'essai) : au terme des 14 jours de blocage
     (donc 21 jours après la création sans paiement), **zip de tous ses documents créés** envoyé ou
     mis à disposition (courtoisie, pas une obligation), puis **suppression réelle immédiate**.
     Cohérent précisément parce que cette société n'a, par construction, **jamais émis aucun document
     légalement** (le rang 1 du cycle de vie bloque `'send'`) : aucune obligation de conservation
     légale (`archive/retention/`) ne s'applique à elle.
   - **Société qui A payé puis cesse de payer** (a réellement émis des factures) : même mécanique de
     principe — bloquée 14 jours, puis **zip**, puis **suppression réelle** — mais avec **un délai
     plus long entre le zip et la suppression**, pour lui laisser le temps de récupérer son archive.
     **La durée exacte de ce délai n'est PAS fixée** : le propriétaire a choisi cette option en le
     sachant explicitement « à fixer » — à consigner comme question ouverte chiffrable (> 14 jours,
     aucune valeur proposée ici). Une fois le zip livré, **la responsabilité de la conservation légale
     passe au client** : une clause des CGU doit le dire explicitement (non rédigée ici). Le zip doit
     contenir tout ce qui est nécessaire à une conservation légale, pas seulement les PDF : d'après ce
     qu'`archive/` sait déjà produire (`DocumentArchive.artifacts`, typé par `mime` —
     `application/pdf`, `application/xml`), le zip doit inclure PDF, XML signés (factures
     électroniques FR/PL/IT), pièces jointes (factures reçues, notes de frais une fois le rang 13
     livré) et le journal d'événements d'autorité (`DocumentAuthorityEvent`, déjà alimenté pour
     FR/PL/IT).

**Cycle complet, les deux cas côte à côte** :
- Jamais payé : essai 7 j (tout sauf `'send'`) → bloquée 14 j → zip → suppression immédiate.
- A payé puis a cessé de payer : bloquée 14 j → zip → suppression après un délai à fixer (> 14 j,
  non chiffré à ce jour).

**Vérifié le 2026-09-15 contre la documentation officielle Polar** (URL par point) :
- **Le modèle gradué EST modélisable tel quel** — fonction « Seat-Based Pricing »,
  https://polar.sh/docs/features/seat-based-pricing.md : trois modèles supportés, fixe, **gradué**
  (« les sièges sont facturés selon leur palier respectif ») et volume ; l'exemple officiel donné
  (1-10 sièges à 10 $, 11ᵉ et + à 8 $ → 14 sièges = `10×10 + 4×8 = 132 $`) est structurellement le
  même calcul que le barème 2 $/1,5 $/1 $ retenu ci-dessus. Ferme le point qui restait à vérifier.
- Mise à jour du nombre de sièges par API : `PATCH /v1/subscriptions/{id}` avec les champs `seats` et
  `proration_behavior` (`invoice` | `prorate` | `next_period` | `reset`), prorata automatique —
  https://polar.sh/docs/api-reference/2026-10/subscriptions/update-subscription.md (**URL rapportée
  par la recherche, non revérifiée directement ici**).
- Webhooks — https://polar.sh/docs/integrate/webhooks/events.md : `subscription.created/updated/
  canceled/revoked/past_due`, et surtout `customer_seat.assigned/claimed/revoked` — Polar a sa propre
  notion de **siège assigné à une personne**, qui correspond naturellement à un `UserCompany`. Piste
  d'implémentation à retenir : un siège Polar par rattachement `UserCompany`, plutôt qu'une simple
  quantité numérique côté abonnement.
- Offre Starter — https://polar.sh/docs/merchant-of-record/fees.md : gratuite à l'entrée, **5 % +
  0,50 $ par transaction**, +1,5 % sur les cartes internationales, la tarification par siège est
  incluse dans l'offre.
- **Polar est Merchant of Record** —
  https://polar.sh/docs/merchant-of-record/introduction.md : Polar collecte et reverse lui-même la
  TVA dans les cinq pays cibles à la place de l'hébergeur ; l'hébergeur ne gère plus que son propre
  impôt sur ses revenus en France. Conséquence à consigner : **la facture reçue par la société
  cliente est émise par Polar, pas par le propriétaire d'Invoicerr.**
- Bac à sable gratuit — https://polar.sh/docs/integrate/sandbox.md :
  `sandbox.polar.sh` / API `sandbox-api.polar.sh`, cartes de test Stripe.

**Point économique, chiffré, avec les deux grilles** : le fixe de 0,50 $/transaction de l'offre
Starter pèse proportionnellement beaucoup plus sur une petite société, et nettement moins si les prix
sont revus à la hausse (grille envisagée) :

| Société | Grille décidée (2 $/1,5 $/1 $) | Frais Polar (5 % + 0,50 $) | Grille envisagée (5 $/4 $/3,5 $) | Frais Polar |
|---|---|---|---|---|
| 1 siège | 2 $/mois | `0,50 + 5%×2 = 0,60 $` → **30 %** | 5 $/mois | `0,50 + 5%×5 = 0,75 $` → **15 %** |
| 4 sièges | 8 $/mois | `0,50 + 5%×8 = 0,90 $` → **11 %** | 20 $/mois | `0,50 + 5%×20 = 1,50 $` → **7,5 %** |

Le fixe pèse donc deux fois moins, en proportion, si la grille envisagée (non tranchée) remplace la
grille décidée — un argument en sa faveur, mais ce fichier ne tranche pas le choix de grille. Avec la
périodicité annuelle désormais décidée (voir ci-dessus), reste ouvert : si l'annuel porte une remise,
qui diluerait encore ce fixe sur un montant plus gros — non précisé par le propriétaire.

**Chemin d'intégration à évaluer EN PREMIER, avant tout client Polar écrit à la main** : le plugin
Polar de better-auth (`@polar-sh/better-auth`) — better-auth est déjà l'auth du dépôt
(`backend/src/lib/auth.ts`), le plugin couvrirait a priori checkout, portail client et webhooks
rattachés à l'utilisateur authentifié en un seul mécanisme plutôt que trois clients séparés. **Marqué
« à vérifier sur la doc officielle »** : ce que ce plugin couvre exactement n'est pas encore confirmé
(vérification annoncée séparément, ne pas la devancer). **Point d'attention vérifié dans ce dépôt**
(pas un problème établi, juste à regarder au moment du câblage) : `app.module.ts:75` désactive
délibérément le guard propre de better-auth (`disableGlobalAuthGuard: true`) parce qu'il « ignore
API-key requests » — tout plugin better-auth qui ajoute ses propres routes doit être vérifié sous cet
angle : ces routes passent-elles par le même `AuthGuard`/`RolesGuard` globaux que le reste de
l'API, ou contournent-elles ce mécanisme ? Le garde-fou `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`
ci-dessous s'applique de la même façon à toute route ajoutée par ce plugin — absente (404) tant que
la variable n'est pas définie, qu'elle vienne du code du propriétaire ou du plugin.

**Garde-fou d'activation — exigence, pas encore implémentée**, à reproduire EXACTEMENT : tout le
système d'abonnement (écrans, routes, compteur de sièges, tout — y compris les routes qu'ajouterait
le plugin better-auth ci-dessus) doit rester **invisible** tant que la variable d'environnement
globale `WARNING__ENABLE_BILLING_FOR_USERS__WARNING` n'est pas définie (nom à copier au caractère
près, doubles soulignés compris, `WARNING` en tête ET en queue — délibérément dissuasif pour qu'aucun
self-hébergeur ne l'active par accident). C'est la concrétisation technique de la décision « le
self-hosted reste libre, la facturation n'existe que sur l'offre hébergée ». Ce que ça implique pour
l'implémentation à venir :
- la variable doit être lue en **UN SEUL endroit** côté backend (un module de configuration dédié),
  jamais via des `process.env.WARNING__ENABLE_BILLING_FOR_USERS__WARNING` dispersés dans le code ;
- elle doit être exposée au frontend par **une seule route de configuration** (le frontend ne doit
  jamais lire une variable d'environnement backend directement) ;
- **chaque contrôleur de facturation doit refuser en 404, jamais en 403**, quand la variable est
  absente — un 403 révèle que la route existe, un 404 la rend indiscernable d'une route qui n'a
  jamais existé, cohérent avec l'objectif de discrétion de la variable elle-même.

### F. Les autres (13 notes de frais, 15 champs personnalisés, 19 bons de commande)

Mandat du propriétaire : « j'ai rien contre, faut mettre ça dans TODO_FEATURES et détailler ». Aucune
de ces trois fonctionnalités n'a de trace dans le code (`grep` vide sur `customField`/`CustomField`,
sur `purchase.order`/`PurchaseOrder`/`PurchaseOrderReference` hors formats vendorés E-invoicing —
seule occurrence réelle : le champ `clientReference`, rang 7, qui est un simple numéro de commande
client imprimé, pas un bon de commande structuré ni un rapprochement 3-way).

**Rang 13 — notes de frais enrichies.** Le type `expense` (`descriptors/expense.descriptor.ts`) est
volontairement minimal : `description`/`amount`/`currency`/`date`/`notes`, aucun champ pièce jointe,
aucune catégorie, pas d'action `send` (une dépense n'est jamais transmise à un tiers). Point d'appui
déjà présent à réutiliser : `received-invoices/storage.ts`, le mécanisme de stockage de fichier déjà
câblé pour les factures fournisseurs (upload + retéléchargement), à brancher sur `expense` plutôt
qu'à réinventer. Le pipeline OCR existant (`received-invoices/ocr/`, Mistral et moteur local
`ocrmypdf`) est également réutilisable pour extraire un montant depuis une photo de reçu. Ce que
l'e2e devra prouver : une dépense avec image stocke le fichier et permet de le retélécharger ; une
catégorie choisie apparaît dans les stats (`contributions/expense-contributions.ts`).

**Rang 15 — champs personnalisés / tags.** Rien dans l'architecture actuelle ne permet à un
utilisateur d'ajouter un champ sans toucher au code : chaque type de document est un
`DocumentTypeDescriptor` figé (`descriptors/*.descriptor.ts`), ses champs déclarés en dur par
`fields: DocumentFieldDescriptor[]`. Construire ce rang suppose un mécanisme parallèle (des champs
définis en base, mergés au rendu du formulaire ET du PDF) — une extension du système de descripteurs,
pas une modification d'un descripteur existant. Ce que l'e2e devra prouver : un champ personnalisé
créé en Settings apparaît sur le formulaire et sur le PDF des documents suivants, jamais sur les
documents déjà émis.

**Rang 19 — bons de commande / achats fournisseurs.** Seul le rapprochement AVAL existe
(`received-invoices/supplier-reconciliation.ts` : rapprocher une facture reçue avec un fournisseur
connu) ; rien n'émet de bon de commande ni ne le rapproche a priori avec la facture reçue (3-way
match quantité/montant/BC). Ce que l'e2e devra prouver : un BC envoyé puis une facture reçue
rapprochée affiche les écarts quantité/montant, en s'appuyant sur `supplier-reconciliation.ts`
existant plutôt qu'en le dupliquant.

### G. Serveur de mail — instance puis société

Demande du propriétaire, avec insistance explicite (« Ajoute ça au TODO bien expliqué qu'on l'oublie
pas ») : « une instance peut déclarer un serveur de mail global, c'est lui qui sera utilisé par défaut,
si une entreprise n'a pas défini le sien dans les paramètres. Pour le serveur de mail de l'instance ça
peut être soit SMTP soit Resend (Resend en priorité si les deux sont définis). »

**Ce qui existe déjà, vérifié dans le code** : `backend/src/mail/mail.service.ts` sélectionne son
fournisseur au démarrage via `MAIL_PROVIDER=smtp|brevo` (`providers/smtp.provider.ts` /
`providers/brevo.provider.ts`) — **Brevo, pas Resend : Resend n'existe pas aujourd'hui dans ce
dépôt, à construire**, `brevo.provider.ts` étant le modèle d'implémentation `IMailProvider` à suivre.
`SmtpMailProvider` prévient déjà au démarrage si `SMTP_HOST` est vide (commit `5aed5154`,
2026-09-14) plutôt que d'attendre le premier envoi échoué. Une **surcharge SMTP par appel** existe
déjà pour un cas précis : `MailService.sendMail(options, smtpOverrides)` — la seule utilisation
actuelle de `smtpOverrides` dans tout le code est `transports/sdi-pec-transport.ts`, le canal PEC
italien, qui construit ses identifiants SMTP à la volée pour UN envoi. C'est le point d'accroche
naturel désigné pour généraliser cette surcharge à tous les envois d'une société, pas seulement la
PEC — mais **aucun écran de réglages société pour un serveur de mail n'existe aujourd'hui** (grep sur
`frontend/src/pages/(app)/settings/_components/` : aucun composant SMTP/mail de société ; grep sur le
schéma Prisma : aucun champ `smtp*`/`mailProvider` sur `Company`) : à construire entièrement.

**À consigner, détaillé** :
1. **Deux niveaux distincts** : un serveur de mail d'**INSTANCE** (variables d'environnement, posé par
   l'hébergeur — l'existant `MAIL_PROVIDER`/`SMTP_*` d'aujourd'hui) et un serveur de mail de
   **SOCIÉTÉ** (à construire, réglages dans l'interface, généralisant `smtpOverrides`). Cascade de
   résolution à chaque envoi : société si elle en a défini un → sinon instance → **sinon refus nommé,
   jamais un envoi silencieusement perdu**. L'avertissement au démarrage ajouté le 2026-09-14
   (`5aed5154`) couvre déjà le niveau instance ; il faudra construire l'équivalent (un refus explicite,
   pas un échec silencieux) pour le niveau société.
2. **Au niveau instance, deux fournisseurs possibles : SMTP ou Resend** (Resend à construire — voir
   ci-dessus). **Règle de priorité explicite : si les deux sont configurés, Resend gagne.** Exemple :
   `SMTP_HOST` ET `RESEND_API_KEY` tous deux présents dans l'environnement → Resend est utilisé, la
   configuration SMTP est ignorée pour l'instance (elle resterait disponible comme repli si Resend
   échouait à l'exécution — non précisé, à trancher à l'implémentation).

**Questions ouvertes, à ne pas trancher ici** :
- **Que devient Brevo ?** Le propriétaire a une clé Brevo compromise à régénérer (trouvée en clair
  dans un `compose` de PR) et envisageait déjà de passer à Resend. Il n'a pas dit si Brevo reste un
  troisième fournisseur d'instance à côté de SMTP/Resend, ou s'il est purement remplacé par Resend —
  laissé ouvert.
- **Lien avec la production** : `invoicerr.chevrier.dev` n'a aujourd'hui AUCUN serveur de mail
  configuré, donc aucun email ne part (établi le 2026-09-14, voir `5aed5154`). Cette entrée G est ce
  qui rendra la configuration propre une fois construite ; en attendant, renseigner les cinq variables
  SMTP sur l'hôte reste une action immédiate distincte, déjà notée dans `TODO_MANDANT.md`.

---

## Questions ouvertes

Regroupées ici pour relecture rapide — aucune n'est tranchée par ce fichier, toutes attendent une
décision ou une vérification du propriétaire :

- **A (paiements)** — rien d'ouvert sur le choix des plateformes prioritaires (Stripe → Mollie →
  PayPal → régionaux, décidé) ; restent à vérifier au moment du câblage : les frais non établis
  (Payplug, Nexi, Przelewy24, Easypay, IfThenPay) et la couverture Portugal de Stripe.
- **B (PDF, y compris l'ancien rang 16)** — communication (ou non) aux sociétés qui pensaient avoir
  un gabarit personnalisé actif avant le retrait de l'onglet (2026-09-13) ; liste exacte des
  préréglages visuels (nombre, noms, quels champs de marque — logo/couleurs/police) à définir avec le
  propriétaire une fois ces champs ajoutés au schéma.
- **C (emails)** — bibliothèque d'éditeur WYSIWYG à choisir ; grammaire des variables dans le nouvel
  éditeur ; extension ou non de la cascade de langue du PDF aux gabarits email par défaut.
- **E (abonnement hébergé)** — **TRANCHÉS** le 2026-09-15, ne plus rouvrir : plateforme (Polar
  Starter), modèle gradué (grille 2 $/1,5 $/1 $), périodicité (mensuel ET annuel), définition du siège
  (`UserCompany`, OWNER inclus, invitation comptée seulement à l'acceptation), cycle de vie complet
  dans les deux cas (jamais payé : essai 7 j sans `'send'` → bloquée 14 j → zip → suppression
  immédiate ; a payé puis lapsé : bloquée 14 j → zip → suppression après délai). Restent réellement
  ouverts : **la durée du délai zip→suppression pour une société qui a payé puis cesse de payer**
  (> 14 jours, non chiffrée — le propriétaire a choisi l'option en la sachant « à fixer ») ; la
  rédaction de la clause CGU transférant la responsabilité de conservation légale au client une fois
  le zip livré ; la grille de prix envisagée (5 $/4 $/3,5 $) n'est PAS tranchée, ni ses seuils (5/10
  sièges supposés par continuité, non confirmés) ; une remise éventuelle sur la formule annuelle ; ce
  que couvre exactement le plugin `@polar-sh/better-auth` (vérification annoncée séparément) et si ses
  routes passent par `AuthGuard`/`RolesGuard` ou les contournent (`app.module.ts:75`,
  `disableGlobalAuthGuard: true`).
- **G (serveur de mail)** — ce que devient Brevo (troisième fournisseur d'instance à côté de
  SMTP/Resend, ou remplacé par Resend) ; le comportement de repli exact si Resend est configuré mais
  échoue à l'exécution (retombée sur SMTP, ou refus direct) — non précisé.

**Ce que ce fichier n'a pas pu établir** : les frais de Payplug/Nexi/Przelewy24/Easypay/IfThenPay ; si
Adyen/Checkout.com/SumUp offrent un bac à sable sans entreprise réelle ; la couverture Portugal chez
Stripe et Klarna ; la couverture exacte du plugin `@polar-sh/better-auth` (vérification en cours
ailleurs) ; si l'URL versionnée `api-reference/2026-10/subscriptions/update-subscription.md` de Polar
reste stable dans le temps (rapportée par la recherche, non revérifiée directement ici).

---

## 1. Inventaire de l'existant (100 % code)

### 1.1 Documents (devis, factures, avoirs, dépenses, factures reçues)
Un seul mécanisme générique — `backend/src/modules/documents/descriptors/` (`type-registry.ts` +
un descripteur par type : `quote.descriptor.ts`, `invoice.descriptor.ts`,
`credit-note.descriptor.ts`, `expense.descriptor.ts`, `received-invoice.descriptor.ts`) — pilote
tout : champs, statuts, actions, numérotation, email, contributions dashboard/statistics. Aucun type
n'a son propre contrôleur/service Prisma ; `documents.service.ts` + `persistence.ts` sont génériques.
Preuves e2e : `17-document-descriptor`, `19-document-pdf`, `20-document-totals`,
`21-document-lifecycle`, `22-document-numbering`, `23-document-email`, `28-document-async-send`.

- **Devis → facture** : conversion intégrale (`actions/convert-to-invoice.ts`) ou **acompte en %**
  (`actions/request-deposit.ts`, recalcule le TTC du devis, refuse si plusieurs taux de TVA sans
  ligne unique) ou **facturation échelonnée multi-jalons** (`actions/request-installments.ts`) — e2e
  `26-document-deposit`, `51-installments`.
- **Avoirs (credit notes)** : type dédié, seul type autorisé à réduire une facture
  (`settlement/credits.ts`) — e2e via `24-document-payments`/`25-document-settlement`.
- **Dépenses** : type "expense" minimal — description/montant/devise/date/notes, **aucune pièce
  jointe, aucune catégorie** (voir Décision F, rang 13 — gap confirmé).
- **Factures reçues (AP)** : module dédié `received-invoices/` avec extraction (`extraction.ts`),
  OCR (`received-invoices/ocr/`, moteurs Mistral **et** local `ocrmypdf`), stockage de fichier
  (`storage.ts`) et rapprochement fournisseur automatique/manuel
  (`supplier-reconciliation.ts`, marque `Client.isSupplier`) — e2e `36-received-invoices`.
- **Lignes** : remise en % par ligne déjà supportée, appliquée avant TVA
  (`totals/compute-totals.ts`).
- **Paiements & lettrage** : `DocumentPayment` générique à tout type de document
  (`settlement/payments.ts`), conversion multi-devise **au moment du paiement** avec taux figé
  (`settlement/convert-payment.ts`), paiement en ligne (Stripe, voir Livré rang 1) et méthodes de
  paiement typées par société (`payment-methods/`) — e2e `24-document-payments`,
  `27-multi-currency-consolidation`, `60-online-payment`, `61-payment-methods`.
- **Récurrence** : moteur générique `schedules/` (cadence weekly/monthly/quarterly/yearly,
  `cadence.ts`), rejoue une action sur un document gabarit, option `{thenSend:boolean}` pour
  enchaîner l'envoi — écran `settings/recurring.settings.tsx` — e2e `29-document-recurrence`.
- **Partage/consultation publique** : lien à jeton hashé, PDF seul (`share-links/`,
  `public/public-documents.controller.ts`) ; **portail client authentifié livré séparément**
  (`56-client-portal`, voir Livré rang 3) — e2e `37-document-share-link`.
- **Signature électronique** : OTP par email, jeton dédié (`signatures/otp.ts`,
  `signature-token.ts`), webhook `DOCUMENT_SIGNED` — e2e `45-signature`.
- **Archivage légal / WORM** : `archive/` (`persistence.ts`, `storage.ts`,
  `archive-verdict-on-terminal.ts`, `verdict-artifact.ts`), rétention (`archive/retention/`) — e2e
  `34-document-archive`.

### 1.2 Conformité e-invoicing (le cœur de la branche)
Voir `CLAUDE.md`. En bref, déjà en place et prouvé par des specs dédiées (hors périmètre de ce
document, non reproduit ici en détail) :
- Formats nationaux + sémantiques (`formats/national`, `formats/semantic`,
  `formats/vendored/{en16931,pl,es,nl,de,it}`) — e2e `30-document-xml-format`.
- Canaux/transports (`transports/{pdp,ksef,sdi,chorus-pro,face,anaf}`) — e2e `31-national-channels`,
  `32-channel-mandate`.
- B2G (`b2g-routing/`, 15 pays livrables — voir les catalogues eux-mêmes) — e2e `40-b2g-routing`.
- Politique pays (types de documents disponibles, mentions obligatoires, identifiants requis,
  routes de correction/annulation) : `country-policy/`, `mentions/`, `country-identifiers/`,
  `correction-routes/` — e2e `39-document-conformity`, `43-correction-routes`, `44-country-policy`.
- Fiscalité transfrontalière par composition de profils, jamais une matrice N×N (`tax/tax-engine.ts`)
  — e2e `35-cross-border-tax`.
- **Mentions légales calculées** : ex. FR — indemnité forfaitaire de recouvrement (40 €) et taux de
  pénalités de retard (taux BCE + 10 pts, figé à l'émission) générés automatiquement
  (`mentions/data/fr.json`) — une sophistication que peu de concurrents grand public égalent.
- **Déclarations temps réel** : mécanisme `reporting/`, **un seul pays livré aujourd'hui** — le
  Portugal (`reporting/providers/pt-at-*`, statut implemented-awaiting-accreditation). Les
  fournisseurs Grèce/Hongrie qui existaient avant le pivot cinq pays ont été supprimés avec lui —
  aucun écran dédié n'expose l'historique de ces déclarations (voir rang 10, section « Restent »).

### 1.3 Clients, articles, fournisseurs
- `modules/clients/` : CRUD complet, `ClientType` (particulier/société), `ClientKind`
  (BUSINESS/GOVERNMENT — routage B2G), flag `isSupplier` indépendant (réconciliation AP), champ
  `language` (rang 14) — écran `pages/(app)/clients/`, e2e `05-clients`.
- `modules/articles/` : catalogue produit/service, pré-remplissage de ligne depuis le catalogue,
  quantité en stock + seuil d'alerte (`Article.quantity`/`lowStockThreshold`, rang 18) — e2e
  `14-articles`, `49-stock`.
- `modules/company-lookup/` + `modules/sirene/` : enrichissement automatique à la création d'un
  client depuis un registre officiel (SIRENE FR + ~250 capacités par pays, REGISTER/PARTIAL) — e2e
  `16-company-lookup`.

### 1.4 Multi-société, auth, API
- `modules/companies/` + `modules/company/` (+ `signing-certificates/`, `channels/`,
  `currency-rates/`) : multi-société par utilisateur (`UserCompany`, `CompanyRole`
  OWNER/ADMIN/MEMBER), `@ActiveCompany()` scope toutes les requêtes — e2e `15-multi-company`,
  `02-company`.
- Auth better-auth + fallback clé API (`modules/api-keys/`, scopes) — e2e `13-api-keys`,
  `01-register`, `03-auth`.
- `modules/invitations/` : invitation de membres par code — écran
  `settings/_components/invitations.settings.tsx`.
- `modules/danger/` : reset app/société avec confirmation OTP.
- Taux de change (`company/currency-rates/`) : flux BCE quotidien automatique + repli
  `open.er-api.com`, saisie manuelle toujours possible (`CurrencyRate.source` — rang 9, voir Livré).

### 1.5 Intégrations & extensibilité
- **Webhooks** : `modules/webhooks/` — 7 types de destination (`WebhookType`: GENERIC, DISCORD,
  MATTERMOST, SLACK, TEAMS, ZAPIER, ROCKETCHAT), événements génériques `DOCUMENT_*`/`CLIENT_*`/
  `COMPANY_*`/`WEBHOOK_*` (purgés de ~80 valeurs mortes en 2026-09-03, ne restent que celles avec un
  émetteur réel) — e2e `42-webhooks`.
- **Serveur MCP** : `modules/mcp/` — outils génériques par type de document, scopés par clé API
  (`tools/tool-registry.ts`), permet à un agent IA de piloter l'appli.
- **Plugins in-app** : `modules/plugins/` — `PluginType` SIGNING/STORAGE/OCR, registre interne
  (le mécanisme de plugins tiers chargés dynamiquement a été retiré en 2026, voir le commentaire de
  tête de `plugins.service.ts` — jugé sans point d'extension réel).

### 1.6 PDF, mails, i18n
- **Rendu PDF : un design unique, hardcodé** (`rendering/render-html.ts`), sans éditeur ni gabarit
  stocké en base — l'onglet Settings qui prétendait l'éditer a été retiré le 2026-09-13 (deux routes
  qu'il appelait n'ont jamais existé côté backend). Décision produit du 2026-09-15 (voir Décision B) :
  cet état reste tel quel par choix, pas seulement par défaut — la seule variation admise est la
  langue du contenu (rang 14, déjà livré) et, à venir, un jeu restreint de préréglages visuels
  (couleur/logo/police) — e2e `19-document-pdf`.
- Gabarits e-mail : UN SEUL moteur pour tout ce que le back envoie (`actions/email-template.ts`) —
  jetons `{placeholder}` à accolade simple, un jeton inconnu laissé verbatim et SIGNALÉ plutôt que
  levé (un e-mail ne doit jamais être bloqué par une faute de frappe), une partie HTML et une partie
  texte (dérivée du HTML quand le gabarit n'en fournit pas, liens compris). Trois niveaux : défaut du
  descripteur par type, surcharge par entreprise (`Company.documentEmailTemplates`, écrite par
  `actions/company-email-templates.ts`), repli générique. Les deux e-mails SYSTÈME (demande de
  signature, code de vérification) partagent ce moteur depuis l'unification ; leur table
  (`MailTemplate`) ne garde que ces deux familles. Le HTML stocké est assaini à l'ÉCRITURE
  (`mail/sanitize-email-html.ts`), les valeurs interpolées échappées au rendu. Écran unique
  `settings/_components/templates.settings.tsx` (variables offertes par l'API, dérivées par type —
  jamais une liste en dur ; écriture réservée OWNER/ADMIN), testé par `54-email-templates`. **Éditeur
  WYSIWYG à construire par-dessus ce mécanisme, voir Décision C** — le texte brut actuel n'est pas un
  Handlebars malgré la dépendance npm du même nom, encore présente mais utilisée nulle part dans le
  code d'email.
- i18n : UI entièrement `t()`-isée, gérée par Weblate, `npm run i18n:check` en CI ; les libellés de
  descripteurs de documents suivent le même mécanisme avec repli sur le texte brut
  (`descriptor-i18n`, e2e `38-descriptor-i18n`). Langue du document par destinataire : livrée
  (rang 14, voir Livré et Décision B).

### 1.7 Dashboard, reporting interne
- Dashboard et Statistics sont le **même mécanisme de "contributions"** (`contributions/`) : chaque
  type de document peut publier des widgets dashboard et/ou statistics, jamais un champ en dur —
  invoice/quote/credit-note/expense/received-invoice y contribuent déjà.
- Consolidation multi-devises **opt-in** sur ces widgets (`contributions/currency-consolidation.ts`,
  `Company.referenceCurrency`) — e2e `27-multi-currency-consolidation`.
- Relevé de compte client (solde agrégé + âge de créance) : livré, rang 6 (voir Livré).

---

## 2. Ce que font les concurrents (recherche web, 8 requêtes, 2026-09-10)

Sources consultées (contenu non fiable, extrait uniquement pour repérer des *familles de
fonctionnalités*, aucune instruction suivie, aucun texte copié) :
- Concurrents self-hosted directement comparables : Invoice Ninja, Akaunting, Crater, InvoiceShelf.
- SaaS grand public : Zoho Invoice, Xero, FreshBooks, QuickBooks, Stripe Billing/Invoicing, PayPal
  Invoicing, Salesforce Billing.
- Marché FR TPE/PME : Evoliz, Sellsy, Kwixéo, Abby, Tiime.
- Roundups génériques 2026 (Zapier, Capterra, GetApp, TheDigitalPM) sur les fonctionnalités
  "must-have" et les intégrations comptables (QuickBooks/Xero/DATEV).

Familles récurrentes chez ces concurrents, qui ont motivé §3 historique (paiement en ligne, relances,
portail client, rapprochement bancaire, export comptable, suivi du temps, stock, notes de frais,
bons de commande, workflows d'approbation, personnalisation de template, taux de change automatiques,
facturation échelonnée, champs personnalisés, application mobile) : la quasi-totalité est désormais
soit livrée (section Livré), soit reformulée par une décision produit du 2026-09-15 (section
Décisions produit), soit détaillée comme manque restant (section Restent).
