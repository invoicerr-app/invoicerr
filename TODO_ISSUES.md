# TODO_ISSUES — mon carnet de bord technique

> **Ce fichier n'est pas pour le propriétaire du produit.** Ce qui relève de lui est dans
> `TODO_MANDANT.md`, tenu court exprès. Ici je consigne ce que je n'ai pas pu faire et pourquoi —
> chaque entrée dit ce qui bloque et ce qui le débloquerait, jamais un simple « échoué ».
>
> Une entrée réglée est **supprimée**, pas barrée : le commit qui la ferme la documente mieux que sa
> dépouille. Ce fichier ne doit contenir que de l'ouvert. (Purge du 2026-09-14 : le fichier avait
> dérivé de sa propre règle — des dizaines d'entrées résolues, certaines barrées depuis des semaines,
> s'étaient accumulées. Tout ce qui était clos a été retiré ; voir `git log` pour leur trace.)

## Chorus Pro — deux défauts trouvés en prouvant le canal en direct le 2026-09-14, non corrigés

Le B2G français a été prouvé live ce jour jusqu'à l'état terminal `IN_INTEGRE`
(`CPP0011117000000000425903`, voir `documentation/docs/developer-guide/credentials-guide.md` §3). Le
dernier commit de la session (`2c457a73`) a documenté deux défauts réels trouvés au passage, tous deux
**délibérément non corrigés** dans ce commit (qui ne touche que des commentaires). **Un autre agent
travaille sur `choruspro-client.ts` et `chorus-pro-status-poller.ts` au moment où ceci est écrit** —
ce qui suit décrit l'état à `2c457a73` (HEAD) ; à revérifier avant de recommencer ce travail, ces
lignes sont peut-être déjà closes.

1. **`mapChorusProStatus` ne reconnaît aucune des valeurs réellement renvoyées par Chorus Pro.** Il ne
   connaît que le vocabulaire nu hérité du client de référence — `VALIDE`, `REJETE`, `DEPOSE`. Or
   toutes les valeurs observées en direct portent un préfixe `IN_` : `IN_INTEGRE`, `IN_REJETE`,
   `IN_DEPOT_PORTAIL_EN_ATTENTE_TRAITEMENT_SE_CPP`. Aucune branche ne les reconnaît, tout retombe sur
   `PENDING` : le poller de conformité ne détecterait donc NI un vrai rejet NI une vraie intégration
   comme état terminal, sur le canal qu'on vient justement de prouver.

2. **Le test `invoice-b2g-chorus-pro-send.spec.ts` (phase 2, le rejeu worker) est cassé sur HEAD.**
   Régression réelle introduite par `7de5a90c`, qui a ajouté un refus dur (`BadRequestException`)
   quand la société n'a pas d'IBAN — correct en soi (BT-81 est obligatoire chez Chorus Pro), mais le
   mock `company.findUnique` de ce spec n'a jamais porté d'`iban`. Confirmé par lecture directe du
   fichier (aucune occurrence de `iban`, dernière touche `2c457a73` en commentaires seulement) et par
   le run CI du commit qui l'a cassé (run `34893034327`, job `backend-tests` :
   « Cannot deposit to Chorus Pro: this company has no IBAN on file » à la ligne 219 du spec).
   `ecce4d35` et `2c457a73`, les deux commits suivants, ne touchent pas ce fichier. Les deux commits
   les plus récents de la branche (`ecce4d35`, `2c457a73`) ont leur propre run CI encore en cours au
   moment de cette purge (`34895979653`, `34897087106`) — à vérifier une fois qu'ils se terminent,
   mais rien dans leur diff ne corrige ce mock.

Non établi, trouvé au passage dans ces mêmes commits, moindre enjeu — à garder en tête plutôt qu'à
traiter séparément : le fondement juridique exact du refus Chorus Pro de cheque/cash/stripe comme
moyen de paiement (interdiction formelle ou simple absence d'usage constaté, `ecce4d35`) ; si un
document AIFE postérieur à 2020 a ajouté B1/S1/M1 comme cadres de facturation alternatifs à A1-A25
(`7de5a90c`, l'annexe consultée date de 2020) ; l'algorithme de clé du NIF portugais n'est sourcé
nulle part dans ce dépôt (`dcb63a17`, déjà documenté comme tel dans `country-identifiers/data/pt.json`
lui-même).

## État de la CI au 2026-09-14 21h — pas verte en continu, à revérifier avant la PR

Mesuré par `gh run list`/`gh run view`, pas supposé. Le run `cypress.yml` le plus récent **terminé**
(commit `7de5a90c`, run `34893034327`) est en **échec** : `backend-tests` casse sur l'item 2
ci-dessus (1 suite / 1 test sur 3362), et `cypress-run` casse sur un flake `14-articles.cy.ts` (voir
plus bas). Les deux commits suivants (`ecce4d35`, `2c457a73` = HEAD) ont leurs propres runs encore
`in_progress` au moment de cette purge. Dans la même journée, plusieurs runs `cypress.yml` ont bien
été verts (ex. commits `cab89185` 19:33, `67a94d58` 19:54) et `scenarios.yml` (« Business Scenarios »)
a été vert à plusieurs reprises (dernier vu : commit `b41e99a9`, 17:22). Donc : la CI TOURNE
correctement sur cette branche (elle ne tournait pas du tout avant `5089e60f`/`486aab6a`
aujourd'hui — les six jambes de Business Scenarios n'avaient pas exécuté une seule fois depuis
2026-08-29, `redis://localhost:6399` contre un service Redis qui écoute sur 6379), mais elle n'est
**pas verte à l'instant présent** à cause de l'item 2 ci-dessus. Revérifier `gh run list` avant
d'ouvrir la PR vers `main`.

- **`14-articles.cy.ts` : un flake de visibilité Radix, vu une fois sous Firefox** (run
  `34893034327`, « prefills an invoice line when an article is picked from the catalog » —
  `AssertionError: … not visible because its ancestor has position: fixed`). Distinct du crash
  Electron déjà connu et déjà réglé par le passage à `--browser firefox` en CI (`cypress.yml`
  documente ce choix dans son propre commentaire) : ceci est un flake DE visibilité, pas un crash de
  process, et il apparaît sous le navigateur que CI utilise déjà. Une seule occurrence à ce jour, pas
  confirmée comme permanente — à surveiller plutôt qu'à corriger à l'aveugle.

## Ce qui reste ouvert, par enjeu

| Constat | Ce qui bloque |
| --- | --- |
| **La réception française de factures électroniques est obligatoire depuis le 2026-09-01 — et cette date est passée.** L'écran de dépôt manuel de factures reçues ne satisfait PAS, à lui seul, cette obligation (elle exige une plateforme agréée). | Aucun canal agréé n'est branché en réception (KSeF inbound, dépôt PDP/Peppol entrant) — c'est le remainder nommé du poller de conformité, jamais construit côté réception. |
| La **mise à niveau** d'une installation ancienne n'est toujours pas prouvée | Le feu vert du propriétaire existe déjà (2026-09-13) — ce qui manque n'est plus un accord, c'est que quelqu'un rejoue réellement `sync-schema.ts` avec `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION` sur une base jetable. |
| Le **code destinataire italien** n'a pas d'écran | `country-identifiers/data/it.json` ne déclare que VAT et LEGAL_ID pour un client italien ordinaire (B2B) ; `IT_SDI`/`PEC` n'ont aucun champ de saisie. Une facture B2B domestique italienne part donc avec `codiceDestinatario = 'XXXXXXX'`, le repli que le code qualifie lui-même de « least-wrong fallback ». Le mécanisme backend existe, il manque l'écran qui l'alimente — même forme que le défaut d'identifiant TVA déjà corrigé sur cette branche. |
| Le **B2G portugais** | Le canal est délégué à une portaria (CCP art. 299.º-B n.º 5) jamais retrouvée sur son texte brut ; un essai a rendu un 200 qui n'était pas le document (une page HTML servie à la place). `transportId` reste donc non écrit — sans lui le fichier `b2g-routing/data/pt.json` ne peut pas être honnête. |
| Le catalogue **déclaratif** (`reporting/`) ne connaît que le Portugal | L'obligation française EST établie (CGI art. 290 I) mais transite par la PDP (art. 290 A/B) — un transport déjà implémenté et prouvé en réel. Le schéma ne sait exprimer que `providerId`, jamais « acquittée par un transport déjà implémenté ». Ce qu'il faudrait déterminer avant d'écrire `fr.json` : ce que la PDP transmet d'office vs. ce qui reste à la charge du produit (B2C, clients étrangers). |
| Cinq catégories d'**autoliquidation italienne expirent le 2026-12-31** | `domestic-reverse-charge/` (32 catégories sourcées, DE/FR/IT/PT) n'a aucun axe temporel — une catégorie périmée y est indistinguable d'une catégorie en vigueur. Décision prise le 2026-09-13 de ne PAS câbler le moteur fiscal sur ce catalogue (Invoicerr vise surtout des sociétés tech) — sauf pour un client opérateur télécom, revendeur de matériel électronique, ou fournisseur d'énergie/négociant de quotas, les trois profils que la décision ne couvre pas (voir `DESIGN.md` du catalogue). À revérifier avant le 1er janvier 2027 quoi qu'il arrive. |
| Le `pattern` FA(3) KOR (correction post-clearance polonaise) n'est pas réimplémenté | L'ancien moteur avait un mode KOR complet ; le descripteur `invoice.descriptor.ts` actuel n'a pas de lien de correction compatible avec la forme qu'il attendait — une facture rectificative polonaise part aujourd'hui comme une facture FA(3) ordinaire, jamais en KOR. |
| Le **français dans le code** | Un balayage l'an dernier avait mesuré 310 fichiers avec un commentaire en français ; pas retouché depuis, à re-mesurer avant de le clore. |
| Deux artefacts front morts | `plugins/storage/providers/local/local-form.json` (`"type": "folder"`, jamais lu, l'union `IPluginFormField.type` ne connaît même pas `folder`) et la route `/api/directories` qu'il rendait seul atteignable (`components/folder-select.tsx`). Aucun effet utilisateur, mais méritent leur propre passe de nettoyage. |

## PT `pt-at` (déclaration AT) — implémenté au contrat documenté, PAS éprouvé en réel

Deux gaps techniques nommés, à fermer quand de vraies credentials AT existent (démarche →
`TODO_MANDANT.md` §3) :
1. **mTLS non câblé** — l'AT exige un certificat client X.509 signé pour la connexion HTTPS elle-même,
   `pt-at-client.ts` utilise `fetch()` simple. Câblage prévu même forme `pfx`/`passphrase` que
   `transports/sdi/sdicoop-client.ts`, délibérément pas fait à l'aveugle sans PKCS#12 réel à tester.
2. **Padding RSA du Nonce ⚠ unverified** — le manuel AT nomme « RSA » sans paramètre de padding ;
   PKCS#1 v1.5 retenu comme meilleure lecture (OAEP = défaut Node, écarté), à confirmer au premier
   round-trip réel (un mauvais padding échoue bruyamment : `CodigoResposta` 16/17).

## KSeF — le poller de statut n'est jamais prouvé live, et il manque la clé PROD

Distinct du canal d'ENVOI KSeF, déjà prouvé en réel (2026-06-28, voir mémoire de session). Le
POLLER de statut (`pollers/ksef-status-poller.ts`) existe mais `KSEF_AUTH_TOKEN` est absent de cet
environnement, donc deux points restent non vérifiés : (a) le mapping `{code, description, details}`
→ terminal/rejeté est extrapolé de la convention utilisée par `authenticate()`, jamais confirmé pour
l'endpoint `invoiceStatus` lui-même ; (b) `send()` ferme la session juste après l'envoi — si
`invoiceStatus` répond encore une fois la session close est inconnu à ce jour. Séparément : KSeF n'a
de clé MF vendorée que pour l'environnement TEST — aucune clé PROD n'a jamais existé dans ce dépôt ;
`loadVendorizedKeys('prod')` échoue donc bruyamment par design plutôt que de retomber sur la clé de
test contre un vrai KSeF de production. Pas fait faute de société PROD réelle à ce jour.

## B2G : 13 États membres UE couverts par aucune règle, chacun avec sa raison lue

`b2g-routing/data/` couvre 15 pays au total (le tableau complet vit dans les catalogues eux-mêmes).
Les 13 qui manquent tiennent en deux causes, toutes deux lues et sourcées, jamais devinées : un CIUS
national jamais vendoré (AT ebInterface, DK OIOUBL, FI, HR, IE — trois CIUS distincts, NL NLCIUS —
depuis livré, PT CIUS-PT, RO RO_CIUS, SI e-SLOG, SK jusqu'en 2027), ou un canal fermé sans
joignabilité Peppol confirmée (BG CAIS EPP, CZ NEN, HU NAV). Le refus honnête existant (« aucune règle
B2G déclarée ») reste le comportement voulu tant que le CIUS correspondant n'est pas vendoré. Séparé :
pour 21 des pays déjà couverts, la seule source lue est la fiche eInvoicing de la Commission
(DG CNECT) — un rapport, pas le texte de transposition national ; à recouper un jour pays par pays,
même chantier de provenance que le SIREN/SIRET français.

## Composition vendeur×acheteur en cross-border — une seule couche lue sur deux

La recherche du 2026-08-29 sur le rattachement transfrontalier documente quatre rattachements
distincts ; `correction-routes/` et `cancel-policy.ts` ne lisent que le pays VENDEUR (couche
« quel document mon pays impose »), jamais la couche « base taxable » (rattachée au pays de TAXATION,
potentiellement l'acheteur sous reverse-charge). `LIMITATION_TEXT` le dit à chaque réponse API. La
composition des deux n'est pas écrite — à faire si une correction transfrontalière doit un jour
distinguer « quel document » de « la base taxable réductible comment et jusqu'à quand ».

## Dette webhook et technique diffuse

- **`WebhookEvent` : moins de 15 valeurs sur 94 ont un émetteur réel**, la purge T2bis n'a couvert
  que son périmètre nommé (51 valeurs). Le reste (familles Item, Number-formatting, `PLUGIN_*`,
  `USER_*`, `CRON_JOB_*`…) n'a jamais été émis. Délibérément non retouché — une seconde vague de
  purge est une décision produit à part entière (nouvelle migration Prisma, audit de tout ce qui a pu
  s'abonner en production), pas un sous-effet d'une tâche webhook. Décision à prendre : une seconde
  vague ou non.
- **`ClientsModule` inimportable sous ts-jest** : la chaîne
  `ClientsModule → WebhooksModule → drivers/discord.driver.ts → @teever/ez-hook` (paquet JSR pur ESM)
  ne compile pas sous ts-jest. Tout futur test qui importera `ClientsModule` comme MODULE (pas
  seulement `ClientsService` en position de type) le redécouvrira. À trancher un jour : config ESM de
  ts-jest, ou remplacer la dépendance du driver Discord.
- **Item 15 (mentions) — personnalisation société non faite** : les trois mentions FR sont toutes
  `statutory: true` (taux supplétif légal, indemnité de 40 €, formulation doctrinale de l'escompte) ;
  rien ne permet à une société de stipuler une valeur différente. Pas de besoin exprimé à ce jour ; le
  mécanisme d'interpolation est déjà prêt à recevoir une troisième source de valeur le jour où ce
  besoin existe.
- **Item 14 — pas de provider d'archivage WORM/S3 régional** : un seul provider existe (persistance
  locale content-hash-addressed). Ne rouvrirait qu'avec un vrai besoin de résidence de données
  (MX/BR/SA) et de vrais credentials AWS — aucun des deux n'existe dans cet environnement.
