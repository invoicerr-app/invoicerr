# TODO_ISSUES — ce qui n'a pas pu être fait, et pourquoi

> Tenu au fil de l'exécution du `TODO.md`. Chaque entrée dit ce qui bloque et ce qui le
> débloquerait — jamais un simple « échoué ».

## Rouges e2e permanents (7), connus et rattachés à des items du TODO

- **`05-clients` : 5 tests (Allemagne, Royaume-Uni)** — ces pays n'ont aucun fichier d'exigences
  d'identifiants. Le produit dit correctement qu'il n'en connaît aucune ; les tests attendent un
  champ `LEGAL_ID`. Rattaché à l'item **19** du TODO : les livrer demande de sourcer leur droit,
  pas de l'inventer.
- **`16-company-lookup` : 1 test (`expected 40 to be above 100`)** — la couverture de la recherche
  d'entreprise est tombée de 118 à ~40 pays à la démolition (la liste venait des profils
  supprimés). Rattaché à l'item **20** : décider de la nouvelle source de la liste.
- ~~`14-articles` : pré-remplissage depuis le catalogue~~ — **RÉSOLU à la tâche 6** (2026-08-31) :
  le descripteur déclare `prefillFrom`, le formulaire générique offre « From catalog », la spec 14
  est à 10/10. La base de rouges permanents passe de 7 à 6.

## Limites consignées en cours de route

- ~~« Sent » avant l'envoi~~ (découvert à la tâche 4) — **RÉSOLU à l'item 22** (2026-08-31) : `send`
  déclare désormais `draft`/`send_failed` → `sending` → `sent` | `send_failed` (quote/invoice/
  credit-note — voir actions/async-send.ts). Le numéro est pris en ENTRANT dans `sending`, avant que
  la livraison ne soit même tentée ; un échec (PDF, SMTP, transport) après épuisement des retries
  BullMQ laisse `send_failed` avec l'erreur enregistrée et visible (`DocumentInstance.lastActionError`)
  — jamais `sent` sans livraison réelle. Le retry est l'action `send` elle-même, redisponible depuis
  `send_failed`.

- **`resetAndSeed` ne re-sème pas la politique pays** (découvert à la tâche 8) : les tables de
  référence sont exclues de la troncature, mais une NOUVELLE règle ajoutée aux JSON n'existe en
  base qu'après un `prisma db seed` manuel — sinon l'action est 403 en silence pour tout le monde.
  À automatiser un jour (seed au boot du backend de test, ou détection de dérive JSON↔base) ; en
  attendant, toute tâche qui touche `country-policy/data/*.json` doit re-semer les deux bases.

- **Les taux existent, mais paiements et avoirs ne convertissent toujours pas** (choix consigné à la
  tâche 9) : `record-payment` refuse toujours une devise étrangère et le lettrage ignore toujours un
  avoir en devise étrangère (avec warning nommé). C'est délibéré, pas un oubli : la consolidation du
  dashboard est un AFFICHAGE approximatif qui porte son taux ; un lettrage est une écriture exacte —
  y appliquer un taux saisi à la main déciderait en silence du montant réellement soldé. Si un jour
  le lettrage multi-devises est voulu, il faudra un taux PAR opération (saisi au moment du paiement,
  stocké sur lui), pas le taux ambiant de la société. Les briques (table `CurrencyRate`,
  `convertMinor`) sont prêtes pour ça.

- **`ClientsModule` inimportable sous ts-jest** (découvert à la tâche 22, préexistant) : la chaîne
  `ClientsModule → WebhooksModule → drivers/discord.driver.ts → @teever/ez-hook` (paquet JSR pur
  ESM) ne compile pas sous ts-jest. Tout futur test qui importera `ClientsModule` comme MODULE (pas
  seulement `ClientsService` en position de type) le redécouvrira ; le test d'intégration de la file
  (`queue/__tests__`) le contourne en construisant `DocumentsService` à la main. À trancher un jour :
  config ESM de ts-jest, ou remplacer la dépendance du driver Discord.
