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

- **« Sent » avant l'envoi** (découvert à la tâche 4) : le document est persisté `sent` — et parfois
  numéroté — AVANT que le courriel ne parte. Un échec du rendu PDF ou du SMTP laisse donc un
  enregistrement « envoyé » jamais livré. Ce n'est pas une régression (le même risque existait côté
  SMTP), mais le corriger demande un statut intermédiaire (`sending`) que le cycle de vie déclaré
  rend désormais facile à ajouter — à traiter avec l'item **3** déjà livré comme socle, ou lors de
  l'item **22** (files d'attente), où l'envoi deviendra asynchrone de toute façon.

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
