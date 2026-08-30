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
- **`14-articles` : 1 test (« prefills an invoice line when an article is picked »)** — le test
  cherche un bouton d'ajout de ligne dans l'ANCIEN formulaire de facture, supprimé à la démolition.
  Le remplaçant existe (`document-field-lines-add-row` dans le formulaire générique), mais la
  fonctionnalité qu'il teste — pré-remplir une ligne depuis le catalogue d'articles — n'a pas
  d'équivalent dans le nouveau modèle : le kind `array` ne sait pas se pré-remplir depuis une
  entité. À traiter comme une extension du modèle (probablement avec l'item **6**, remises &
  acomptes, qui touche aussi les lignes), pas comme un correctif de test.
