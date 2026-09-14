---
sidebar_position: 6
---

# Ajouter un pays

Le module `documents` (`backend/src/modules/documents/`) ne se demande jamais « quel est ce pays ? »
dans le code métier — aucun `if (country === 'FR')` nulle part, ni dans un contrôleur, ni dans un
service, ni dans un gestionnaire d'action. À la place, une dizaine de catalogues petits et
indépendants répondent chacun à une question précise sur un pays, sous forme de **données** : un
fichier JSON par pays, découvert et chargé automatiquement au démarrage. Ajouter un pays revient à
ajouter un fichier, presque jamais une ligne de code.

Cette page a la même forme en deux parties que chaque [page propre à un pays](./country-support/index.md) :
la **Partie 1** s'adresse à qui n'a jamais ouvert cette base de code — lisez-la si vous voulez
simplement comprendre ce que signifie « un pays, c'est de la donnée ». La **Partie 2** est la
référence pas à pas pour écrire réellement le fichier — lisez-la quand c'est vous qui ajoutez le
voisin de la France. Pour le *résultat* généré — ce que chacun des cinq pays couverts obtient
aujourd'hui, lu en direct depuis ces mêmes fichiers — voir la [matrice de conformité par
pays](./country-support/index.md) ; cette page est reconstruite à partir des fichiers que ce guide
vous explique comment écrire, à chaque build de la documentation, si bien qu'elle ne peut jamais dire
autre chose que ce que ces fichiers disent.

Pour ajouter un nouveau *type* de document (une facture, un devis, autre chose entièrement) plutôt
qu'un pays, voir [Ajouter un type de document](./adding-a-document-type.md) — les deux sont des axes
délibérément indépendants ; voir la [vue d'ensemble](./extending-invoicerr.md) pour comprendre
comment ils s'articulent.

## Partie 1 — En clair

**Un pays, dans cette application, est un dossier de petits fichiers texte — pas un bout de code.**
Si vous ouvrez `backend/src/modules/documents/country-policy/data/`, vous trouverez des fichiers
nommés `fr.json`, `de.json`, `it.json`, etc. Chacun est une simple liste de faits sur un pays :
« une entreprise française peut-elle envoyer une facture par e-mail ? oui. » « La Pologne
impose-t-elle un format numéroté particulier ? oui, et voici la règle. » Personne n'écrit de cas
particulier dans le programme lui-même pour la France ou la Pologne — le programme est *identique*
pour chaque pays ; seuls ces fichiers de faits diffèrent. Ajouter un nouveau pays à l'une de ces
listes revient à écrire un fichier de plus, semblable aux autres, dans le même dossier, et — pour
presque tous les mécanismes — rien d'autre : aucune ligne de code, aucun tableau à modifier, aucun
bouton à presser. L'application remarque d'elle-même le nouveau fichier au prochain démarrage (une
liste en « auto-découverte », pas une liste tenue à jour à la main).

**Chaque fait porte une preuve, ou reconnaît honnêtement ne pas en avoir.** À côté de presque chaque
fait de ces fichiers se trouve une petite note indiquant sa provenance : soit une citation exacte
d'un texte de loi réel, avec la date à laquelle quelqu'un l'a vérifiée — soit, tout aussi
honnêtement, une note disant « personne n'a encore vérifié ceci face à la vraie loi, et voici
exactement ce qu'il faudrait vérifier ». L'application est construite pour qu'un fait ne puisse
*jamais* être silencieusement ni l'un ni l'autre — impossible d'écrire une règle qui dit simplement
« oui » sans expliquer d'où vient ce « oui ». Un pays dont le fichier est presque entièrement
« non vérifié » n'est pas un fichier honteux ou raté ; c'est un fichier honnête, exactement aussi
valide et exactement aussi utilisable qu'un fichier entièrement recherché.

**Quand vous essayez de faire quelque chose que l'application n'autorise pas, elle vous dit toujours
exactement pourquoi — l'une de quatre raisons différentes, jamais un vague « non ».** Selon ce qui
cloche, on vous dira : « la loi de votre pays n'autorise pas du tout ceci » (un vrai blocage légal),
« pas maintenant — ce document n'est pas dans le bon état pour cette action » (par exemple, vous ne
pouvez pas repasser une facture en brouillon une fois qu'elle a été envoyée), « cette application n'a
pas encore construit cette fonctionnalité pour votre cas » (un manque honnête, pas un bug), ou
« quelque chose que vous avez saisi ne correspond pas à ce qui est attendu » (un simple problème de
saisie). Ces quatre raisons sont vérifiées dans un ordre fixe, à chaque fois, que ce soit un clic à
l'écran ou un robot envoyant la même requête directement — si bien que l'écran ne promet jamais
quelque chose que le serveur refuse en réalité.

**Vous n'avez jamais à vous souvenir de « mettre à jour la base de données » à la main.** Pour la
plupart de ces fichiers de faits, la base de données n'est qu'un miroir vivant de leur contenu — à
chaque démarrage de l'application (ou de son worker en arrière-plan), elle vérifie discrètement si sa
propre base correspond encore à ce que disent les fichiers, et la corrige sinon. Vous modifiez un
fichier, vous redémarrez l'application, et tout est synchronisé. Il n'y a pas d'étape manuelle
séparée à oublier.

## Partie 2 — Les détails

### La provenance est obligatoire, pas décorative

Chaque fait — une règle, une voie, un taux, une mention — porte un champ `provenance` qui vaut
obligatoirement l'un des deux :

- `{ "kind": "legal", "sourceText": "...", "sourceCheckedAt": "yyyy-mm-dd" }` — une citation exacte
  d'une source primaire (ou clairement officielle), et la date à laquelle elle a été vérifiée par
  rapport à cette source ; ou
- `{ "kind": "unverified", "resolutionNote": "..." }` — un simple énoncé de ce qu'il faudrait
  vérifier, et dans quel texte/auprès de quelle autorité, pour transformer ceci en entrée `legal`.

Il n'y a pas de troisième option, et pas de valeur par défaut silencieuse. Chaque schéma de ce module
impose cela dès le **chargement** (`assertValidProvenance` et ses équivalents propres à chaque
module, appelés depuis le `data/all.ts` de ce mécanisme) : un fichier JSON sans `provenance`, ou une
prétention `legal` sans `sourceText`, échoue au chargement — ce qui, pour `country-policy`/
`b2g-routing`/etc., signifie que **le backend entier ne démarre pas**, et pour les tests, que chaque
exécution jest échoue immédiatement. C'est voulu : une règle sans citation ne doit jamais être à un
commit accidentel de ressembler exactement à une règle qui en a une.

`unverified` est un état honnête, de première classe — pas un état au rabais. Un fichier pays
entièrement composé d'entrées `unverified` bien écrites, chacune nommant précisément la recherche qui
la résoudrait, est un *bon* fichier : il indique au prochain lecteur exactement par où commencer.
Comparez `country-policy/data/pt.json` (3 de ses 23 règles sourcées vers une vraie citation légale
aujourd'hui, le reste honnêtement `unverified`, chacune avec une note de résolution précise) à la
voie `CREDIT_NOTE` de `correction-routes/data/fr.json` (une entrée `legal` citant directement le
BOFiP). Les deux sont des formes tout aussi valides pour ce format ; elles représentent simplement des
degrés différents de recherche achevée.

L'absence est un *refus*, jamais une valeur par défaut. Un pays sans fichier
`country-policy/data/xx.json` n'obtient pas de « valeurs par défaut raisonnables » — toute action
documentaire lui est bloquée, bruyamment, en nommant le fichier manquant (la règle « pas de repli
permissif, pas de trou silencieux » propre à `country-policy.ts`). Un pays sans
`b2g-routing/data/xx.json` obtient un honnête « aucune règle B2G déclarée pour XX », jamais un repli
silencieux vers un canal B2B générique. Si vous livrez un fichier *clairsemé* plutôt qu'*absent* (par
exemple `correction-routes/`, dont le schéma exige la présence des onze voies), ce caractère
clairsemé doit être énoncé fait par fait, jamais sous-entendu par une clé manquante.

### Les mécanismes — une carte

Chacun est indépendant : aucun ne lit les fichiers des autres, et un pays peut en avoir certains sans
avoir les autres. Sur les cinq pays couverts par ce produit aujourd'hui (FR, DE, IT, PL, PT — voir
`TODO_ISSUES.md` pour l'historique de l'élagage jusqu'à ces cinq), aucun n'a de fichier dans chaque
mécanisme — voir la [matrice de conformité par pays](./country-support/index.md) pour savoir
précisément lesquels restent ouverts par pays, et les encarts « Pas encore configuré » de chaque page
pays pour comprendre pourquoi il s'agit d'un manque honnête plutôt que d'une supposition.

| Mécanisme | Répertoire | Répond à | Reflété dans une table BD ? |
| --- | --- | --- | --- |
| Politique d'action documentaire | `country-policy/data/` | Quelles **actions** documentaires (envoi, enregistrement en brouillon, …) une entreprise de ce pays peut exécuter, et sous quelle restriction de statut. | Oui — auto-corrigée à **chaque démarrage**, dans chaque environnement (voir « Auto-correction au démarrage » ci-dessous), plus `prisma/seed.ts` lors d'un migrate/seed explicite. |
| Routage B2G | `b2g-routing/data/` | Quand ce pays est celui du **client public** : quel transport + format, quels identifiants/champs documentaires client sont exigés. | Oui — `boot-upsert.ts`, ré-upsertée inconditionnellement à **chaque** démarrage backend (`OnModuleInit`). |
| Voies de correction | `correction-routes/data/` | Pour chacune des 11 voies de correction canoniques (avoir, facture corrective, annulation et remplacement, …), est-elle `required`/`allowed`/`forbidden`/`unverified` pour ce pays. | Non — lue en direct depuis le fichier. |
| Annulation locale (dérivée) | `correction-routes/cancel-policy.ts` | Si *cette application* peut réellement réaliser `CANCEL_AND_REPLACE` localement pour ce pays (une liste blanche recoupée avec les données de voies de correction ci-dessus). | Non — fonction pure sur le fichier ci-dessus. |
| Politique de canal | `transports/channel-policy/data/` | Pour une entreprise **établie** dans ce pays : un canal de transmission donné est-il simplement usuel (`suggested`) ou légalement obligatoire à partir d'une date (`mandated`) ? | Non — lue en direct depuis le fichier. |
| Système fiscal | `tax/tax-systems/data/` | Ce que le moteur de taxe transfrontalière suppose sur la structure de taux de ce pays (VAT/GST/SALES_TAX/NONE, taux standard). | Non — lue en direct depuis le fichier. |
| Identifiants pays | `country-identifiers/data/` | Quels schémas d'identifiant national (SIRET, EIN, numéro de TVA, …) une partie de ce pays doit fournir. | Oui — auto-corrigée à **chaque démarrage**, même mécanisme que la politique d'action documentaire (voir ci-dessous), plus `prisma/seed.ts`. |
| Overlay de champs pays | `country-fields/data/` | Ajoute/modifie/supprime un **champ** sur la forme d'un type de document existant, pour ce pays. | Non — lue en direct depuis le fichier. |
| Mentions obligatoires | `mentions/data/` | Mentions légales en texte libre (BG-1) que ce pays exige sur chaque facture, temporelles. | Non — lue en direct depuis le fichier. |
| Exigences de contenu | `content-requirements/data/` | Si un champ EN 16931 précis (par exemple BT-23) doit porter une valeur dérivée du pays à partir d'une date. | Non — lue en direct depuis le fichier. |
| Catalogue de taux de TVA | `vat-rates/data/` | L'échelle de taux dans laquelle un utilisateur choisit sur une ligne de facture (donnée de présentation, pas un calcul fiscal). | Non — lue en direct depuis le fichier. |
| Durée de conservation d'archive | `archive/retention/data/` | Combien de temps un document archivé pour ce pays doit être conservé, et — tout aussi important — **à partir de quel point cette durée est comptée** (`origin` : l'instant d'archivage, la date d'émission, la fin de l'année civile, ou une lecture prudente de la clôture d'un exercice). Un pays peut déclarer PLUSIEURS règles : ce sont des obligations simultanées, et le plancher effectif est leur maximum, jamais un choix entre elles. | Non — lue en direct depuis le fichier ; écrite sur `DocumentArchive.retentionUntil`/`retentionBasis` à la création d'une archive. |
| Obligation déclarative | `reporting/data/` | Si ce pays exige du vendeur qu'il **déclare** les données d'une facture à sa propre administration fiscale après émission, indépendamment du mode de remise de la facture. Distinct de la politique de canal, qui concerne la remise. | Non — lue en direct depuis le fichier. |

Vous n'aurez rarement besoin de tous ces mécanismes pour un nouveau pays. Un pays dont le seul besoin
est « laisser le moteur de taxe OSS calculer un taux de destination pour lui » n'a besoin *que* de
`tax/tax-systems/data/xx.json` — voir l'en-tête de `tax/tax-systems/data/all.ts` pour les États
membres de l'UE ajoutés uniquement pour cette raison.

## Pas à pas

### 1. Décider de ce dont ce pays a réellement besoin

Lisez la demande. « Une entreprise française peut-elle envoyer une facture à un client public
belge ? » nécessite `b2g-routing/data/be.json`. « Peut-on laisser une entreprise hongroise utiliser
cette application du tout ? » nécessite `country-policy/data/hu.json`. Ne livrez pas cinq fichiers
sous prétexte que le format permet cinq fichiers — un fichier absent est un honnête « pas encore », un
fichier clairsemé ou rembourré ne l'est pas.

### 2. Chercher honnêtement, un mécanisme à la fois

Pour chaque fait, essayez de trouver le vrai texte légal (ou clairement officiel — une fiche de la
Commission européenne, le portail d'une administration fiscale nationale). Quand vous le trouvez :

```json
{
  "kind": "legal",
  "sourceText": "the exact text, quoted — never paraphrased, never translated into a summary",
  "sourceCheckedAt": "2026-09-03"
}
```

Quand vous ne le trouvez pas (un registre payant, un portail qui bloque les requêtes automatisées, un
texte que vous n'avez vraiment pas pu atteindre dans le temps imparti) :

```json
{
  "kind": "unverified",
  "resolutionNote": "What, specifically, would settle this — which text, which authority, which register. Not 'needs research' — say what the research IS."
}
```

Les pays déjà présents dans `correction-routes/data/*.json` ont été transcrits à l'origine depuis une
recherche légale dédiée aux voies de correction (2026-08-29, couvrant FR/IT/PL/DE/ES/MX/US) — la
`provenance` de chaque voie porte déjà, mot pour mot, la citation primaire trouvée lors de cette
recherche, si bien que rien de plus n'a besoin d'être cité depuis là aujourd'hui. Un pays ajouté
depuis n'a pas cette recherche commune à réutiliser : sourcez-le directement depuis le texte primaire,
comme le fait `pt.json` (voir l'en-tête de `data/pt.spec.ts`).

### 3. Écrire `data/<cc>.json`, exactement dans la forme que dit `schema.ts`

Le `schema.ts` de chaque mécanisme est le vrai contrat — lisez-le avant d'écrire le fichier ; c'est
généralement une page de commentaires expliquant précisément pourquoi chaque champ existe. Quelques
formes à connaître d'avance :

- `country-policy/data/<cc>.json` a besoin d'un tableau `documentTypes` non vide (quels types de
  document apparaissent du tout pour ce pays) **et** d'un tableau `rules`. Une règle peut se
  restreindre à des statuts précis (`"statuses": ["draft"]`) — voir `invoice.save-draft` dans
  `pl.json`, qui l'utilise pour refléter l'immutabilité réelle de KSeF (une fois qu'une facture
  polonaise a atteint KSeF, la repasser en brouillon est refusé ; seule une facture corrective peut
  la corriger).
- `b2g-routing/data/<cc>.json` enveloppe sa règle unique dans `{ "countryCode": "...", "rule": { ... } }`
  (le seul mécanisme de cette famille avec cette enveloppe — chaque fichier voisin est plat).
- `correction-routes/data/<cc>.json` doit couvrir les **onze** identifiants de voie canoniques
  (`CORRECTION_ROUTE_IDS` dans `correction-routes/schema.ts`) — le clairsemé n'est pas autorisé ; une
  voie non recherchée reçoit une honnête entrée `"status": "unverified"`, jamais une clé omise. Le
  vocabulaire est fermé : vous ne pouvez pas inventer une douzième voie. Si votre recherche fait
  vraiment apparaître un mécanisme de correction qui ne correspond à aucune des onze, c'est un
  changement du vocabulaire fermé — `CORRECTION_ROUTE_IDS` dans `correction-routes/schema.ts` —
  qu'il faut faire d'abord, jamais une valeur supplémentaire glissée silencieusement dans un fichier
  pays.
- `requirement: "mandated"` de `transports/channel-policy/data/<cc>.json` **exige** une provenance
  `legal` et une date `mandatedFrom` — le schéma lève une erreur au chargement si vous marquez
  quelque chose comme obligatoire sur la base d'une prétention `unverified`. Si vous n'êtes pas
  encore certain que le canal est réellement *obligatoire* plutôt que simplement usuel, restez en
  `suggested` — voir les entrées `suggested` propres à `it.json`/`pl.json`, toutes deux encore
  `unverified` aujourd'hui mais honnêtement ; le mécanisme du mandat est binaire (obligatoire ou
  suggéré) et n'a aucun moyen d'encoder une exception conditionnelle ou partielle.
- Les faits de `content-requirements/data/<cc>.json` sont **toujours** `legal` — il n'y a pas
  d'échappatoire `unverified` pour une exigence de contenu ; si vous ne pouvez pas encore la sourcer,
  ne la livrez pas.
- `tax/tax-systems/data/<cc>.json` peut omettre `standardRate` pour un pays à VAT/GST **si**
  `vat-rates/data/<cc>.json` a déjà une entrée de catégorie `STANDARD` — il est alors dérivé de là
  plutôt que dupliqué (voir la « DELIBERATE NON-DUPLICATION » de `tax/tax-systems/schema.ts`).

### 4. Enregistrer le fichier — presque toujours un non-événement

Pour **chaque mécanisme ci-dessus sauf `country-fields`**, cette étape n'existe pas : le loader de
chaque `data/all.ts` appelle son propre `discoverCountryCodes()`, qui fait un `fs.readdirSync` sur le
répertoire `data/` propre à ce mécanisme, garde tout ce qui correspond à `/^[a-z]{2}\.json$/` (un code
à deux lettres minuscules plus `.json` — rien d'autre dans ce dossier ne correspond, y compris ce
fichier `all.ts` lui-même et tout `xx.spec.ts` posé à côté), trie le résultat pour un ordre de
chargement déterministe, et charge chacun d'eux. Déposez `data/hu.json` dans `country-policy/`,
redémarrez le backend (ou lancez la suite de tests), et il est chargé — il n'y a pas de tableau où
ajouter une ligne, et pas de second fichier ailleurs dans la base de code qui doive lui aussi savoir
que la Hongrie existe désormais. Retirer un pays fonctionne de la même façon, à l'envers : supprimez
le fichier et il cesse d'être chargé, sans entrée résiduelle à nettoyer.

**Il n'y a plus d'exception.** Jusqu'au 2026-09-13, deux loaders — `country-fields/data/all.ts` et
`archive/retention/data/all.ts` — lisaient encore un petit tableau `COUNTRY_FILES` entretenu à la
main plutôt que de découvrir leur répertoire, si bien que déposer un fichier dans l'un ou l'autre ne
faisait rien du tout, et le faisait *silencieusement* : rien n'échouait, le pays n'était simplement
jamais chargé. Les deux ont été migrés, si bien que le paragraphe ci-dessus tient désormais pour
chaque mécanisme de ce module, sans exception.

Si vous lisez une branche plus ancienne et trouvez un tel tableau, c'est cette forme-là qui est
décrite ici : ajoutez le code à deux lettres à ce tableau en plus de déposer le fichier, et vérifiez
l'en-tête du loader plutôt que de supposer quel comportement vous avez.

### Auto-correction au démarrage — vous ne réensemencez pas à la main

Deux des onze mécanismes ci-dessus reflètent aussi leurs données dans une table Postgres (lue au
moment de la requête depuis la BD, pas directement depuis les fichiers JSON) — `DocumentCountryActionRule`
(`country-policy`) et `CountryIdentifierRequirement` (`country-identifiers`). Historiquement, ce
miroir n'était rafraîchi que par `prisma/seed.ts`, exécuté lors d'un `migrate dev`/`migrate reset`/un
`db seed` explicite — **pas** lors d'un redémarrage ordinaire d'une base déjà migrée, ce qui était
exactement la brèche qui laissait une modification JSON seule renvoyer silencieusement un 403 sur
chaque action documentaire jusqu'à ce que quelqu'un se souvienne de réensemencer à la main (la note
« `resetAndSeed` ne re-sème pas la politique pays » de `TODO_ISSUES.md`).

Les deux tables s'auto-corrigent désormais à **chaque démarrage backend**, dans chaque environnement
y compris en production (`country-policy/boot-reseed.service.ts` et
`country-identifiers/boot-reseed.service.ts`, chacun un simple `OnModuleInit`) : une comparaison pure,
sans accès BD (`drift.ts` dans le répertoire propre à chaque mécanisme) vérifie d'abord si la table
correspond déjà à ce que disent les fichiers JSON ; ce n'est que si ce n'est pas le cas que la
fonction de seed existante s'exécute réellement, si bien qu'un démarrage déjà synchronisé ne coûte
qu'une requête de lecture, jamais une écriture inutile. Ceci ne lève jamais d'exception — un
incident BD transitoire au démarrage dégrade vers le 403 déjà bruyant existant au moment de la
requête, jamais vers un démarrage planté. `B2gRoutingRule` porte la même garantie depuis plus
longtemps, sous une forme encore plus simple (`b2g-routing/boot-upsert.service.ts` ré-upserte
toujours inconditionnellement, sans étape de détection de dérive séparée — cette table est assez
petite pour qu'un « upserted: 15 » à chaque démarrage soit bon marché et ne vaille pas la peine d'être
optimisé).

En pratique : modifiez n'importe quel fichier `country-policy/data/*.json` ou
`country-identifiers/data/*.json`, redémarrez le backend (ou un worker, qui importe le même module et
exécute la même vérification), et la base de données est déjà correcte — vous n'avez pas besoin de
vous souvenir de `prisma db seed`, même si l'exécuter continue de fonctionner aussi. Chaque AUTRE
mécanisme du tableau ci-dessus n'a aucun miroir BD susceptible de se périmer en premier lieu ; il est
lu directement depuis le fichier à chaque requête.

### Les quatre portes — ce qui se passe quand vous essayez réellement d'exécuter une action

Une fois les fichiers d'un pays en place, `DocumentsService.runAction` (`documents.service.ts`) est
le **seul** endroit où une action s'exécute réellement — les quatre mêmes vérifications, dans le même
ordre, qu'il s'agisse d'un clic à l'écran ou d'un script qui touche l'API directement, si bien que
« ce que l'écran refuse, l'API le refuse » est vrai par construction :

1. **403 — politique pays.** `evaluateCountryPolicy` lit le pays résolu de cette entreprise et la
   règle de `country-policy/data/<cc>.json` pour cette action. Aucun fichier du tout pour ce pays, ou
   une règle qui existe mais dit `allowed: false`, lève une `ForbiddenException`, en nommant le pays
   et exactement ce qui le débloquerait.
2. **409 — statut.** Deux vérifications indépendantes aboutissent sur ce même code, jamais un second
   403 : le propre `availableWhen` du descripteur (cette action est-elle même proposée pour un
   document dans son état actuel ?), et la restriction PAR STATUT propre à la politique pays
   (`DocumentActionRuleFact.statuses` — par exemple `invoice.save-draft` en Pologne, restreinte à
   `draft`, reflétant l'immutabilité réelle de KSeF une fois une facture validée).
3. **501 — implémentation.** L'action est déclarée sur le descripteur et autorisée par chacune des
   vérifications ci-dessus, mais personne n'a encore enregistré d'`ActionHandler` pour elle dans
   l'`ActionRegistry` (par exemple « convert-to-invoice » avant qu'un pipeline de facturation existe
   pour le porter, ou un canal qu'une règle B2G nomme — par exemple `zre-ozgre` — avant que le
   transport correspondant de ce dépôt ne soit construit ; `chorus-pro` était aussi cet exemple,
   jusqu'à ce que `transports/chorus-pro-transport.ts` l'enregistre, prouvé en réel en qualification
   le 2026-09-14, voir `credentials-guide.md` §3). `NotImplementedException`, jamais un
   no-op silencieux : une action déclarée mais non implémentée est un vrai manque, visible, pas un
   oubli à cacher.
4. **400 — validation.** Les valeurs de champ propres au document (par rapport au descripteur
   fusionné pays-et-plugin que produit `applyCompanyFieldView` — jamais le descripteur tronc nu, pour
   qu'un client scripté ne puisse pas contourner ce qu'un overlay pays a ajouté ou exigé) et les
   propres `params` de l'action échouent `validateAgainstDescriptor`. `BadRequestException`, par
   champ.

Un unique point de terminaison d'export scripté (`downloadDocumentFormat`, même fichier) exécute à la
main les quatre mêmes portes, dans le même ordre exact, pour exactement cette raison — il n'existe pas
de second chemin de code, plus permissif, vers l'effet d'une action.

## Ce qu'il ne faut pas faire

- **Ne devinez pas un statut pour combler un trou.** `"status": "required"` sans vraie citation est
  pire que `"status": "unverified"` avec une note honnête — le garde-fou du schéma n'autorise
  techniquement ni l'un ni l'autre (un statut autre que `unverified` *exige* une provenance `legal`),
  mais la revue humaine doit repérer une citation étirée pour paraître plus sûre qu'elle ne l'est en
  réalité.
- **N'étirez pas une citation au-delà de ce qu'elle dit.** Si une source établit qu'un canal existe
  mais pas qu'il est obligatoire, c'est `suggested`, pas `mandated`.
- **Ne promouvez pas une entrée `unverified` en `legal` sans relire réellement la source primaire.**
  Réutiliser la citation *déjà vérifiée* d'un autre fichier pour le même fait (par exemple un
  règlement de l'UE qui s'applique identiquement à chaque État membre — voir le propre `quote.send`
  de `it.json`/`pl.json`, tous deux réutilisant la même citation eIDAS (UE 910/2014, art. 25 §1) déjà
  lue par `de.json`, puisqu'il s'agit d'un RÈGLEMENT et ne nécessite aucune transposition nationale)
  est correct et doit être dit clairement ; inventer un `sourceCheckedAt` pour un texte que vous n'avez
  pas rouvert ne l'est pas.
- **N'inventez pas** un nouvel identifiant de voie de correction, un nouveau `kind` fiscal, ou un
  nouveau `kind` de provenance — les trois vocabulaires sont fermés par leur propre schéma,
  délibérément, pour qu'aucun code métier n'ait jamais à traiter comme cas particulier une orthographe
  utilisée par un seul pays.
- **Ne fusionnez pas deux préoccupations différentes dans un seul fichier** parce qu'elles concernent
  le même pays par hasard — `country-policy` (quelles actions s'exécutent) et `channel-policy` (quel
  canal le pays du vendeur exige) sont lus par du code différent pour des questions différentes et
  doivent le rester, même pour un pays qui a les deux.

## Quand un pays a besoin de plus qu'un fichier

Certains pays ont vraiment besoin de code, pas seulement de données :

- **Un canal de transmission national auquel ce dépôt ne parle pas encore** (un nouveau
  `transportId`) a besoin d'un nouveau transport sous `transports/` implémentant le protocole réel —
  les fichiers de données ne font jamais que *référencer* un `transportId`/`formatSyntax` ; ils ne
  vérifient jamais qu'il correspond à quelque chose de réel (voir le commentaire de
  `b2g-routing/schema.ts` expliquant pourquoi `transportId` n'est délibérément pas vérifié face au
  registre réel au chargement — l'envoi refuse, bruyamment, en nommant exactement le canal manquant,
  plutôt que le fichier échoue à se charger).
- **Une variante CIUS/format nationale obligatoire que ce dépôt ne vendorise pas** a besoin de ce
  schéma vendorisé sous `formats/vendored/` et d'un vrai fournisseur de format construit dessus —
  jamais un payload Peppol BIS générique affirmé satisfaire une CIUS contre laquelle il n'a jamais été
  validé. C'est exactement pourquoi `b2g-routing/data/pl.json` a choisi KSeF plutôt que la plateforme
  PEF basée sur Peppol, dont l'extension polonaise spécifique n'est pas vendorisée par ce dépôt ; voir
  l'en-tête de ce fichier pour le détail.
- **Un nouveau champ documentaire dont seule la loi d'un pays donne le sens** a besoin d'un overlay
  `country-fields` (`add`/`modify`/`remove` sur la forme tronc), pas d'une modification du descripteur
  tronc lui-même — voir l'ajout `supplyType` de `country-fields/data/fr.json`, qui n'existe que pour
  permettre à l'exigence de contenu française sur le BT-23 de dériver une valeur.

## Deux vrais fichiers qui valent la peine d'être lus en entier

- **`b2g-routing/data/pl.json`** — une décision prise en lisant réellement deux sources officielles
  (la fiche pays Pologne de la Commission européenne *et* le portail KSeF du ministère polonais des
  Finances), qui ont fait apparaître **deux** canaux B2G viables (KSeF et PEF) et choisi celui que ce
  dépôt peut réellement livrer — pas celui qui paraissait le plus « européen ». Lisez son champ
  `notes` pour le raisonnement complet : voilà à quoi ressemble « tranchée par la lecture, pas la
  plus évidente » dans un vrai fichier.
- **`b2g-routing/data/de.json`** — le trajet inverse sur le MÊME axe, et un aller-retour complet :
  lire le vrai texte fédéral allemand (§ 4 ERechV) a fait apparaître un canal que ce dépôt
  n'implémentait pas du tout (`zre-ozgre`), si bien que l'envoi a été correctement BLOQUÉ, nommément,
  plutôt que routé silencieusement vers l'e-mail ; un addendum ultérieur et daté a ensuite documenté
  une seconde lecture indépendante (la FAQ des plateformes ZRE/OZG-RE elles-mêmes) ayant établi que
  Peppol était entre-temps devenu un canal accepté, l'a câblé, et a prouvé un vrai envoi en conditions
  réelles de bout en bout ; un nouvel addendum, daté du 2026-09-15, consigne que le transport Peppol a
  été retiré du produit (aucun compte réel chez un fournisseur d'Access Point ne l'a jamais soutenu)
  et que la règle est revenue à nommer `zre-ozgre`. L'historique du fichier lui-même est la preuve que
  « bloqué, honnêtement » est un état légitime aux deux bouts de ce trajet — combler une lacune, et
  la rouvrir honnêtement quand ce qui l'avait comblée ne tient plus, valent tous deux mieux qu'une
  supposition.
- **`country-policy/data/pt.json`** — 20 de ses 23 règles sont `unverified`, chacune avec une note de
  résolution précise et utile. Ce n'est pas un fichier inachevé dont il faudrait avoir honte ; c'est
  exactement à quoi ressemble une recherche honnête et partielle dans ce format, et il est tout aussi
  chargeable et tout aussi appliqué qu'un fichier entièrement `legal`.

## Voir le résultat

Une fois votre fichier en place, reconstruisez la documentation (`npm run build` ou `npm run start`
dans `documentation/` — la [matrice pays](./country-support/index.md) se régénère automatiquement
comme étape `prebuild`/`prestart`, directement depuis les fichiers que vous venez d'écrire) pour voir
exactement ce que disent désormais la matrice, la page propre à votre pays, et ses encarts « Pas
encore configuré ». Si le résultat ne dit pas ce que vous attendiez, ce sont presque certainement les
données — pas le générateur — qu'il faut corriger.
