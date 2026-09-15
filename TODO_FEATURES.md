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
>
> **État de la CI, honnêtement (dernière mise à jour de la nuit).** Aucun run entièrement vert depuis
> la reprise des chantiers ce soir : chaque commit a corrigé le rouge du précédent et le suivant en a
> apporté un nouveau. Dernier vert complet : `fb00877b` (spec 30) ; depuis, 29 commits, rouges
> successifs tous identifiés et traités ; résultat des trois derniers runs (`de30e2a4`, `d24a7c6e`,
> `c7e80579`) à lire au réveil.

---

## Livré (21)

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
| 10 | Écran « déclarations » (Portugal seul) | `c6a06617`, sans migration. `reporting-runner.ts` persistait déjà chaque résultat dans `DocumentAuthorityEvent` — ce qui manquait était la lecture au niveau société : `reporting/list-declarations.ts` (liste paginée, filtrable par statut, fournisseurs découverts dynamiquement depuis `reporting/data/*.json`), route `GET /documents/declarations`, écran « Declarations », SSE qui invalide désormais aussi cette liste. Spec Cypress `64-declarations` écrite mais **pas exécutée** (backend en cours d'édition au moment du commit) — à confirmer par la CI. |
| 11 | Suivi du temps & facturation de projets | `57-time-tracking` |
| 12 | Facturation échelonnée multi-jalons | `51-installments` |
| 13 | Notes de frais enrichies (pièce jointe, catégorie, kilométrage) | `6cb60096`, sans migration. Réutilise le stockage des factures reçues (`received-invoices/storage.ts`, volume `documents_data`) et le hash SHA-256 de `archive/hashing.ts` ; nouveau type de champ générique `file` au descripteur. Deux choix de produit pris au plus simple, **à valider** (voir Questions ouvertes) : dix catégories fixes + « Other », taille max 750 Kio (dérivée de la limite globale bodyParser 1 Mo — refusera la plupart des photos de téléphone). |
| 14 | Langue du document par destinataire | `58-document-recipient-language` — cascade `Client.language` → `Company.language` → `en` (`rendering/language/resolve-recipient-language.ts`), vérifiée dans le code : c'est exactement la cascade que la Décision B redemande pour le PDF, déjà en place. |
| 15 | Champs personnalisés (clients + documents) | `3ff59800`, avec migration `20260914170000_company_custom_fields` (renommée le 2026-09-15, voir Questions ouvertes #1). CRUD scopé société, clé immuable dérivée du libellé, suppression = archivage (`archivedAt`), rendu fusionné avec les descripteurs génériques côté formulaire et PDF. **Fusion terminée** (`9f2e3585`) : un champ personnalisé requis bloque désormais toute action, `send` compris, avant tout effet de bord — ce n'est plus « en cours ». Bug latent de collision de clés corrigé au passage (`findAvailableKey`, deux libellés se réduisant au même slug sous des scopes différents). Choix à valider : voir Questions ouvertes. |
| 17 | Workflow d'approbation interne | `50-approval` |
| 18 | Gestion de stock basique | `49-stock` |
| 19 (1ʳᵉ passe) | Bons de commande à un fournisseur — émission | `de30e2a4`, sans migration : un `DocumentTypeDescriptor` de plus (fournisseur, date, date de livraison attendue, devise, référence, lignes), statuts calqués sur la facture, numérotation `PURCHASE-ORDER-` à l'entrée en `sending`, envoi réutilisant tel quel `runAsyncSendAction`/`sendDocumentInstanceEmail`. **Aucun code frontend touché** — menu, liste et formulaire pilotés par le descripteur. Country-policy étendu aux cinq pays (sinon 403 partout et invisible au menu). Bug latent corrigé en passant : `compute-totals.ts` plantait (« no usable VAT rate ») sur un type dont les lignes n'ont aucun champ de TVA — jamais exercé avant. **Le rapprochement 3-way avec la facture reçue est une seconde passe, non livrée** — voir Restent. Trois choix pris pour l'émission, à valider : voir Questions ouvertes. **Non établi** : l'exécution réelle du spec Cypress 66 (Cypress non lancé). |
| 21 | Application mobile — PWA (Décision D) | `b7a6581d` (manifeste, service worker, icônes générées depuis le logo, `vite-plugin-pwa`, `/api/*` jamais mis en cache) puis `acbc2011` (le SW s'enregistrait sans garde et faisait tomber `29-document-recurrence` en CI — corrigé : enregistrement manuel sous garde `!("Cypress" in window)`, rechargement réel à l'activation d'un nouveau SW via `virtual:pwa-register`). README corrigé dans le même commit, ne promet plus d'app native. **Non établi** : installabilité réelle sur iOS/Android, aucun appareil ni simulateur ici. |
| G | Serveur de mail — instance→société, fournisseur Resend (Décision G) | **COMPLÈTE : backend + écran.** Backend : `f1ed72e4`, `63b42ef9`, `1958c47a`. Écran Réglages → Mail : `7a61f3f7` — état courant sans jamais rendre de secret, formulaire SMTP/Resend, « Tester l'envoi » toujours disponible (erreur backend affichée mot pour mot), retour au serveur de l'instance après confirmation, onglet masqué aux MEMBER. Voir Décision G pour le détail. **Réserve** : son spec Cypress 65 a échoué à sa première exécution (3 échecs sur 4) ; instrumenté (`c7e80579`, un vrai défaut d'écran corrigé au passage), mais la cause du premier échec reste NON établie — voir Questions ouvertes. |
| *(hors liste)* | Méthodes de paiement typées par société | `61-payment-methods`, livré le 2026-09-14 (`backend/src/modules/documents/payment-methods/`) |

---

## Restent (5) — vérifiés dans le code au 2026-09-15

| Rang | Feature | État vérifié (2026-09-15) | e2e à prouver |
|---:|---|---|---|
| 16 | Personnalisation de template — **redéfini** en préréglages visuels (plus un éditeur) | Débloqué le 2026-09-15 (migrations renommées, Questions ouvertes #1) : à construire — champs de marque sur `Company` (logo, couleur, police) via une nouvelle migration, puis les préréglages. Voir Décision B. | Un utilisateur choisit un préréglage (couleur/logo/police) et voit le PDF changer, sans toucher au HTML. |
| 20 → E | Facturation par abonnement avancée (usage-based) | Sans objet côté produit invoicerr — redirigé vers l'offre hébergée du propriétaire (Décision E), elle-même bloquée par la clé sandbox Polar que le propriétaire crée demain matin (Questions ouvertes #4). | N/A côté produit self-hosted. |
| A | Paiements — Mollie, PayPal réel, régionaux | Stripe seul est câblé (rang 1, voir Livré) et jamais prouvé avec un vrai compte ; Mollie, PayPal (vrai encaissement Orders API v2) et les régionaux restent à construire — bloqués par les clés sandbox (Polar, Stripe, Mollie, PayPal), le propriétaire les crée demain matin (Questions ouvertes #4). Voir Décision A. | Un paiement Stripe réel encaissé ; Mollie et PayPal câblés et testés en sandbox. |
| C | Emails — éditeur WYSIWYG | Bibliothèque d'édition riche non choisie (TipTap/Lexical/Quill…, Questions ouvertes #5) — l'éditeur texte brut actuel (`templates.settings.tsx`) reste en place tant que ce choix n'est pas fait. Voir Décision C. | Non définissable avant le choix de bibliothèque. |
| 19 (2ᵉ passe) | Bons de commande — rapprochement 3-way | Émission livrée en première passe (`de30e2a4`, voir Livré). Le rapprochement avec la facture reçue reste à construire sur `received-invoices/supplier-reconciliation.ts` existant, une fois choisis les écarts tolérés, qui valide, et blocage vs avertissement. Voir Décision F. | Un BC envoyé puis une facture reçue rapprochée affiche les écarts quantité/montant. |

### Rang 10 — pourquoi le mécanisme `reporting/` ne concerne toujours que le Portugal

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
`unverified`). Le besoin produit d'origine (« donner du contenu à l'écran ») **est réglé** : l'écran
est livré (`c6a06617`, rang 10 — voir Livré) et lit `DocumentAuthorityEvent` en le distinguant d'un
événement de conformité ordinaire par `providerId`, sans mélanger les deux mécanismes — exactement ce
que l'en-tête de `reporting/schema.ts` demande. Reste, à part ça, la mise en réel du fournisseur PT
(mTLS, padding RSA) une fois l'accréditation obtenue.

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
rang 21 (application native iOS/Android). **Livré cette nuit** (voir Livré, rang 21) : `b7a6581d`
(manifeste, icônes générées depuis le seul logo du dépôt, service worker avec `/api/*` en
`NetworkOnly` — jamais mis en cache, pour raison multi-tenant) puis `acbc2011` (le SW s'enregistrait
sans garde `window.Cypress` et faisait tomber le spec `29-document-recurrence` en CI ; corrigé par un
enregistrement manuel gardé, et un effet de bord bienvenu : le runtime `virtual:pwa-register` porte
désormais le vrai rechargement à l'activation d'un nouveau SW, ce que l'`autoUpdate` du premier commit
n'avait pas). **Le README a été corrigé dans le même commit** (`b7a6581d`) : il dit désormais
« Installable as a Progressive Web App (PWA) » et ne promet plus d'app native mobile/desktop.

**Non établi** : l'installabilité réelle sur iOS et Android, et le rendu du splash Android — aucun
appareil ni simulateur disponible ici, à vérifier par le propriétaire sur un vrai téléphone. Le scan
de reçu via l'appareil photo (pertinent pour le rang 13, notes de frais) n'a pas été construit — hors
du périmètre de ces deux commits.

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

Mandat du propriétaire : « j'ai rien contre, faut mettre ça dans TODO_FEATURES et détailler ». Au
moment de cette décision (2026-09-15), aucune des trois fonctionnalités n'avait de trace dans le code
(`grep` vide sur `customField`/`CustomField`, sur `purchase.order`/`PurchaseOrder`/
`PurchaseOrderReference` hors formats vendorés E-invoicing). **Rang 13, rang 15 et la première passe
du rang 19 sont livrés depuis** (voir Livré) ; seule la seconde passe du rang 19 (rapprochement
3-way) reste ouverte, décrite ci-dessous.

**Rang 13 — notes de frais enrichies.** Livré (`6cb60096`, voir Livré) : pièce jointe, catégorie et
kilométrage, en réutilisant le stockage de `received-invoices/storage.ts` plutôt qu'en le dupliquant.
OCR non branché, délibérément : le pipeline existant (`received-invoices/ocr/`) extrait un vocabulaire
de facture (`grossAmount`, `supplier`), pas de dépense, et ne tente l'OCR que sur un PDF alors que le
cas principal ici est une photo — un adaptateur à écrire, pas fait ici. Pas de barème kilométrique
fiscal : deux champs informationnels seulement, l'utilisateur reporte lui-même le résultat.

**Rang 15 — champs personnalisés / tags.** Livré (`3ff59800`, voir Livré) : un mécanisme parallèle de
champs définis en base par société, mergés au rendu du formulaire et du PDF, sans toucher aux
`DocumentTypeDescriptor` figés existants. Clé dérivée du libellé et immuable ; suppression = archivage,
jamais une perte du lien avec les valeurs déjà saisies sur des documents émis. **Fusion terminée**
(`9f2e3585`) : un champ personnalisé requis bloque désormais toute action, `send` compris, avant tout
effet de bord — plus une « fusion en cours ». Bug latent de collision de clés trouvé et corrigé au
passage (`findAvailableKey`).

**Rang 19 — bons de commande / achats fournisseurs.** Première passe livrée (`de30e2a4`, voir
Livré) : émettre un bon de commande à un fournisseur, un `DocumentTypeDescriptor` de plus, aucune
migration. Le rapprochement 3-way avec la facture reçue reste une seconde passe, décrite dans le
commit : elle demande des décisions produit (quels écarts tolérer, qui valide, blocage ou
avertissement) et d'établir ce que « 3-way » désigne ici — un troisième document de réception
n'existe pas dans le modèle. Le mécanisme à réutiliser alors est
`received-invoices/supplier-reconciliation.ts`, jamais une mécanique dupliquée. Trois choix pris pour
l'émission, à valider : voir Questions ouvertes.

### G. Serveur de mail — instance puis société

Demande du propriétaire, avec insistance explicite (« Ajoute ça au TODO bien expliqué qu'on l'oublie
pas ») : « une instance peut déclarer un serveur de mail global, c'est lui qui sera utilisé par défaut,
si une entreprise n'a pas défini le sien dans les paramètres. Pour le serveur de mail de l'instance ça
peut être soit SMTP soit Resend (Resend en priorité si les deux sont définis). »

**Livré cette nuit, côté backend** (voir Livré) :
- `f1ed72e4` — fournisseur Resend (`providers/resend.provider.ts`, REST brute plutôt que le SDK :
  deux pièges rencontrés et traités, pièces jointes en `content_type` snake_case et `User-Agent`
  obligatoire sous peine de 403). Résolution au niveau instance quand `MAIL_PROVIDER` est absent :
  rien→smtp, SMTP seul→smtp, Resend seul→resend, les deux→resend — **un `MAIL_PROVIDER` explicite
  continue de gagner**, choix soumis au propriétaire (voir Questions ouvertes), pas tranché par le
  mandat qui ne couvrait que le cas implicite. `CompanyChannelConfig` (déjà chiffrée AES-256-GCM par
  `ChannelCredentialsService`) réutilisée avec `providerId='mail'`, **aucune migration**. Quatre
  routes sur le contrôleur company : lire, définir, effacer, tester l'envoi. Câblage DI prouvé par un
  boot réel sur le port 4100.
- `63b42ef9` — la cascade société→instance branchée sur les six chemins d'envoi réels : document
  (devis/facture, `send-document-email.ts`), relances d'impayés, demande de signature et son OTP, OTP
  de la zone de danger (route corrigée pour porter `@ActiveCompany()`, vérifié avant d'y toucher que
  `RolesGuard`/`AuthGuard` garantissent déjà une société active à ce point), invitation au portail
  client. **Volontairement non branché** : le transport PEC italien, qui envoie par la boîte PEC
  certifiée de la société sous son propre identifiant de canal `sdi-pec` — un canal réglementaire
  distinct du serveur de mail courant, documenté comme seul holdout.
- `1958c47a` — un test qui dépendait de l'environnement ambiant (`.env.test` fournissait un
  expéditeur par défaut que la CI n'a pas) rendu hermétique.

**Livré cette nuit, côté écran** (`7a61f3f7`) — Réglages → Mail, ce qui manquait à la décision G.
**La décision G est donc COMPLÈTE (backend + écran).**
- État courant : instance par défaut, ou serveur de société avec son fournisseur et son expéditeur.
  **Aucun secret n'est jamais rendu** : la route de lecture ne renvoie que
  `{configured, kind, fromAddress}`, le formulaire d'édition repart toujours vide sur le mot de passe
  et la clé API.
- SMTP ou Resend, validation zod par fournisseur en écho de celle du serveur.
- **Tester l'envoi** disponible en permanence, même sans configuration de société, parce qu'il exerce
  la cascade réelle : l'erreur affichée est celle du backend, mot pour mot.
- **Revenir au serveur de l'instance** efface la configuration, après confirmation. Onglet masqué aux
  MEMBER, cohérent avec les routes d'écriture réservées à OWNER/ADMIN.

**Réserve, non résolue** : le spec Cypress 65 a échoué à sa première exécution (3 échecs sur 4, tous
en « toast jamais apparu » ou « bouton de retour introuvable ») — écrit sans être lancé, comme les
specs 62/63/64. Instrumenté (`c7e80579` — assertions sur le code HTTP avant chaque attente de toast ;
un vrai défaut d'écran corrigé au passage, indépendant de la cause : le toast de succès de « Tester
l'envoi » affichait le message générique de `sendForCompany`, jamais le texte dédié attendu). **Cause
du premier échec NON établie** : le journal backend du run prouve que `PUT /api/company/mail-settings`
n'a jamais abouti (piste `CredentialAudit` : six `mail:* RESOLVE_ACTIVE MISS`, jamais un `UPLOAD`),
sans dire pourquoi — ni 400/403/503 (chacun produirait un toast d'erreur, absent), donc soit une
requête qui ne part jamais du navigateur, soit une réponse jamais reçue ; à trancher au prochain run,
avec le journal navigateur/accès cette fois.

**Questions ouvertes, à ne pas trancher ici** :
- **Que devient Brevo ?** Le propriétaire a une clé Brevo compromise à régénérer (trouvée en clair
  dans un `compose` de PR) et envisageait déjà de passer à Resend. `brevo.provider.ts` reste dans le
  code ; il n'a pas dit s'il reste un troisième fournisseur d'instance à côté de SMTP/Resend, ou s'il
  est purement remplacé par Resend — laissé ouvert.
- **`MAIL_PROVIDER` explicite gagnant sur `RESEND_API_KEY`** (choix pris par défaut dans `f1ed72e4`,
  au-delà de ce que le mandat tranchait) — à valider.
- Le comportement de repli exact si Resend est configuré mais échoue à l'exécution (retombée sur
  SMTP, ou refus direct) — non précisé, non implémenté.
- **Lien avec la production** : `invoicerr.chevrier.dev` n'a aujourd'hui AUCUN serveur de mail
  configuré, donc aucun email ne part (établi le 2026-09-14, voir `5aed5154`). L'écran société
  (`7a61f3f7`) réduit ce risque désormais qu'il est construit ; renseigner les cinq variables SMTP sur
  l'hôte, ou configurer un serveur de société via l'écran, reste une action immédiate distincte, déjà
  notée dans `TODO_MANDANT.md`.

---

## Questions ouvertes

**À trancher par le propriétaire dès son réveil — la liste courte, actionnable :**

1. **Migrations à date future — tranché : renommées le 2026-09-15** (préfixe `20260920…` → `20260914…`, sept migrations, `_prisma_migrations` réaligné sur les deux bases locales).
2. **Choix de produit de la nuit — tranchés le 2026-09-15** : tout validé tel quel (pièce jointe
   ≤ 750 Kio ; champs personnalisés : kinds text/longText/number/money/date/boolean/select, écran
   OWNER/ADMIN, champ requis bloque aussi `send` ; bons de commande : fournisseur = `Client.supplier`,
   statuts calqués sur la facture, préfixe `PURCHASE-ORDER-`) — **SAUF les catégories de notes de
   frais** : « pas fixe mais dynamique dans le back » → table `ExpenseCategory` par société (migration),
   jeu par défaut inséré à la création de la société, CRUD dans Réglages, sélecteur alimenté par l'API.
   En cours.
3. **`MAIL_PROVIDER` explicite gagne sur `RESEND_API_KEY`** — **tranché le 2026-09-15 : gardé** (un
   `MAIL_PROVIDER` posé est respecté tel quel ; Resend ne prime que si rien n'est posé).
4. **Comptes sandbox** (Polar, Stripe, Mollie, PayPal) — guide publié, pas encore créés. Les chantiers
   A (paiements) et E (abonnement) attendent ces clés.
5. **Bibliothèque WYSIWYG pour les emails** (Décision C) — **tranché le 2026-09-15 : TipTap**. En cours.
6. **Spec 65 (réglages mail), cause du premier échec non établie.** Le journal backend du run prouve
   que `PUT /api/company/mail-settings` n'a jamais abouti, sans dire pourquoi (aucune hypothèse
   vérifiable par lecture — 400/403/503 — n'explique l'absence totale de toast). Le spec (`c7e80579`)
   nomme désormais l'appel qui échoue au lieu d'attendre un toast ; à lire au prochain run.

*Note de méthode, en une phrase : quatre specs Cypress écrits sans être lancés sur cinq ont cassé à
leur première exécution en CI cette nuit (62, 63, 64, 65) — jamais un bug produit, toujours une
hypothèse fausse du spec lui-même.*

---

Regroupées ici pour relecture rapide — aucune n'est tranchée par ce fichier, toutes attendent une
décision ou une vérification du propriétaire :

- **A (paiements)** — rien d'ouvert sur le choix des plateformes prioritaires (Stripe → Mollie →
  PayPal → régionaux, décidé) ; restent à vérifier au moment du câblage : les frais non établis
  (Payplug, Nexi, Przelewy24, Easypay, IfThenPay) et la couverture Portugal de Stripe.
- **B (PDF, y compris l'ancien rang 16)** — communication (ou non) aux sociétés qui pensaient avoir
  un gabarit personnalisé actif avant le retrait de l'onglet (2026-09-13). **Tranché le 2026-09-15** :
  champs de marque = logo (upload, stockage fichiers existant) + une couleur d'accent + une police
  parmi un jeu fermé embarqué (4-5) ; les préréglages sont des combinaisons nommées de ces trois.
- **C (emails)** — bibliothèque d'éditeur WYSIWYG à choisir ; grammaire des variables dans le nouvel
  éditeur ; extension ou non de la cascade de langue du PDF aux gabarits email par défaut.
- **E (abonnement hébergé)** — **TRANCHÉS** le 2026-09-15, ne plus rouvrir : plateforme (Polar
  Starter), modèle gradué (grille 2 $/1,5 $/1 $), périodicité (mensuel ET annuel), définition du siège
  (`UserCompany`, OWNER inclus, invitation comptée seulement à l'acceptation), cycle de vie complet
  dans les deux cas (jamais payé : essai 7 j sans `'send'` → bloquée 14 j → zip → suppression
  immédiate ; a payé puis lapsé : bloquée 14 j → zip → **suppression réelle 180 jours après le zip**,
  tranché le 2026-09-15). Restent réellement ouverts : la rédaction de la clause CGU transférant la responsabilité de conservation légale au client une fois
  le zip livré ; la grille de prix envisagée (5 $/4 $/3,5 $) n'est PAS tranchée, ni ses seuils (5/10
  sièges supposés par continuité, non confirmés) ; une remise éventuelle sur la formule annuelle ; ce
  que couvre exactement le plugin `@polar-sh/better-auth` (vérification annoncée séparément) et si ses
  routes passent par `AuthGuard`/`RolesGuard` ou les contournent (`app.module.ts:75`,
  `disableGlobalAuthGuard: true`).
- **G (serveur de mail)** — **COMPLÈTE, backend + écran** (`f1ed72e4`, `63b42ef9`, `1958c47a` pour le
  backend — fournisseur Resend, cascade société→instance branchée sur tous les envois sauf la PEC
  italienne, volontairement — puis `7a61f3f7` pour l'écran Réglages → Mail, qui ne rend jamais de
  secret). **Réserve** : le spec Cypress 65 a échoué à sa première exécution (3 échecs sur 4) ;
  instrumenté (`c7e80579`, un vrai défaut d'écran corrigé au passage) mais la cause du premier échec
  reste NON établie — le journal backend prouve que `PUT /api/company/mail-settings` n'a jamais abouti
  pendant ce run, sans dire pourquoi ; à lire au prochain run (voir Questions ouvertes #6). Restent
  ouverts : le comportement de repli exact si Resend est configuré mais échoue à l'exécution (retombée
  sur SMTP, ou refus direct) — non précisé. **Tranchés le 2026-09-15** : Brevo est SUPPRIMÉ (SMTP ou
  Resend seulement ; Brevo reste utilisable via son relais SMTP — en cours) ; `MAIL_PROVIDER` explicite
  continue de gagner sur `RESEND_API_KEY`.

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
- **Dépenses** : pièce jointe, catégorie (liste fermée + « Other ») et kilométrage — livré rang 13,
  `6cb60096` (voir Livré), en réutilisant le stockage et le hash de `received-invoices/`, avec un
  nouveau type de champ générique `file` au descripteur.
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
- **Déclarations temps réel** : mécanisme `reporting/`, **un seul pays livré** — le Portugal
  (`reporting/providers/pt-at-*`, statut implemented-awaiting-accreditation). Les fournisseurs
  Grèce/Hongrie qui existaient avant le pivot cinq pays ont été supprimés avec lui. **Écran de suivi
  livré** (rang 10, `c6a06617`, voir Livré) : liste paginée scopée société, lue depuis
  `DocumentAuthorityEvent`.

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
