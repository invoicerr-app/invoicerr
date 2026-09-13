---
sidebar_position: 6.5
---

# Ajouter un type de document

Un **type de document** est l'autre moitié de la thèse « aucun code métier ne nomme une chose » de
cette base de code — voir [Étendre Invoicerr](./extending-invoicerr.md) si vous ne l'avez pas encore
lu. Là où un **pays** est un dossier de fichiers JSON (voir [Ajouter un pays](./adding-a-country.md)),
un **type de document** est un unique fichier TypeScript — un *descripteur* — qui décrit un genre de
papier qu'une entreprise crée : un devis, une facture, un avoir, une note de frais, une facture
reçue. Cette page a la même forme en deux parties que chaque autre guide ici : la Partie 1 pour un
premier lecteur, la Partie 2 pour la personne qui s'apprête réellement à en écrire un.

## Partie 1 — En clair

**Un type de document est une description, pas un programme.** Ouvrez
`backend/src/modules/documents/descriptors/expense.descriptor.ts` et vous y trouverez un unique
objet : « une note de frais a ces champs (une description, un montant, une devise, une date, quelques
notes), ces boutons (« enregistrer », « supprimer »), et elle n'a jamais qu'un seul statut
(« draft »). » Rien dans ce fichier ne dessine un formulaire, ne construit un écran de liste, ni ne
parle à une base de données — le reste de l'application (le formulaire d'édition, la liste des notes
de frais, le widget du tableau de bord) est du code *générique* qui lit cette description et se
construit lui-même à partir d'elle. Ajouter un sixième type de document — disons, un « bon de
commande » — revient à écrire un fichier de plus comme celui-ci, pas à concevoir un nouvel écran à
partir de rien.

**Chaque document, quel que soit son type, vit exactement au même endroit.** Il n'y a pas de table de
base de données séparée pour les devis, une autre pour les factures, une autre pour les notes de
frais. Il y a une seule et même table (« DocumentInstance »), et chaque ligne y porte simplement une
petite étiquette disant de quel type elle est (la ligne d'une facture dit `typeId: "invoice"`, celle
d'une note de frais dit `typeId: "expense"`) plus un sac de ses propres valeurs de champ. Ajouter un
nouveau type de document ne signifie jamais « construire un nouveau classeur » — c'est une étiquette
de plus dans le classeur déjà là, et — c'est essentiel — cela ne nécessite jamais de migration de base
de données.

**Les boutons (« actions ») sur un document peuvent être dans l'un de quatre états honnêtes**,
exactement les quatre mêmes que décrit le
[guide pays](./adding-a-country.md#les-quatre-portes--ce-qui-se-passe-quand-vous-essayez-réellement-dexécuter-une-action)
pour les règles propres à un pays — parce qu'il s'agit, en réalité, exactement du même mécanisme : un
pays peut interdire une action purement et simplement, l'état actuel du document lui-même peut rendre
une action indisponible pour l'instant, l'action peut être déclarée mais pas encore réellement
construite (un honnête « non implémenté », jamais un faux succès), ou ce que vous avez saisi peut tout
simplement ne pas correspondre à ce qui est attendu. Un nouveau type de document reçoit ces quatre
vérifications *gratuitement*, automatiquement, dès qu'il est enregistré — personne qui écrit un
nouveau type n'a à réimplémenter quoi que ce soit de tout cela.

## Partie 2 — Les détails

### Le descripteur — tout le contrat, sous forme de donnée

L'interface `DocumentTypeDescriptor` de `descriptors/types.ts` est la forme complète (lisez le
fichier lui-même — chaque champ porte un paragraphe expliquant précisément pourquoi il existe ; ce qui
suit n'est qu'un résumé) :

```ts
interface DocumentTypeDescriptor {
  id: string;                          // e.g. "expense" — the registry key and the API/URL segment
  label: string;                       // plain text, not an i18n key (see below)
  fields: DocumentFieldDescriptor[];    // the document's own data
  actions: DocumentActionDescriptor[];  // the buttons this type offers
  statuses?: DocumentStatusDescriptor[];// the whole lifecycle — omit to opt out entirely
  initialStatus?: string;               // which status a brand-new record starts at
  numbering?: { onEnterStatus: string };// which status hands out a sequential display number
  email?: { subject: string; body: string }; // this type's default email template
  contributions?: WidgetLocation[];     // 'dashboard' | 'statistics' — opts into aggregation screens
  listItem?: { titleFields?: string[]; secondaryFields?: string[] }; // how a generic list card reads it
  usesLegalMentions?: boolean;          // opts into the country-mandated-mentions block on the PDF
}
```

Un **champ** (`DocumentFieldDescriptor`) est `{ key, kind, label, required?, ... }`, où `kind` est
l'un des dix `CORE_FIELD_KINDS` (`text`, `longText`, `number`, `money`, `date`, `boolean`, `select`,
`reference`, `array`, `rowSelection`) ou un genre enregistré par un plugin (toujours préfixé, par
exemple `"plugin:acme.rating"`, pour qu'un futur genre du cœur ne puisse jamais entrer en collision
avec celui d'un tiers). Le même `kind` détermine à la fois comment le backend valide la valeur
(`FieldKindRegistry`) et comment le frontend la rend — un type de document ne réinvente jamais l'un
ni l'autre à la main. Tout ce qui vient après `key`/`kind`/`label` est un *indice optionnel, propre au
genre* : `currency`/`currencyField` pour `money`, `options`/`allowCustomValue` pour `select`,
`entity`/`entities` pour `reference`, `fields`/`min`/`max` pour `array`, et ainsi de suite — voir
`types.ts` lui-même pour la liste complète et richement commentée ; un type ne renseigne que les
indices dont les genres de ses propres champs ont réellement besoin.

Une **action** (`DocumentActionDescriptor`) est `{ id, label, availableWhen, params?, transitions? }`.
`availableWhen` vaut soit `'always'`, soit un tableau de statuts depuis lesquels l'action est
proposée. `transitions` — quand l'action change réellement le statut du document sur lequel on agit —
est la *source unique de vérité* pour cet effet : `availableWhen` est alors *dérivé* de là
(`transitionsAvailableWhen(transitions)`, `lifecycle.ts`) plutôt que retapé une seconde fois à la
main, et `validateLifecycle` (exécuté dès qu'un descripteur est enregistré, voir ci-dessous) le
re-dérive indépendamment pour détecter une dérive. Une action qui change un document **différent**
entièrement (par exemple « convert-to-invoice » écrit une facture toute neuve ; « duplicate » écrit
une copie neuve) ou qui n'a pas encore d'implémentation à observer ne déclare aucune `transitions` du
tout — `availableWhen` reste alors le seul fait, déclaré à la main, sur le moment où elle peut
s'exécuter, exactement comme avant que `transitions` n'existe.

Les libellés (`label` du type, `label` d'action, `label` de statut) sont **du texte brut, pas des
clés i18n** — un descripteur est de la donnée qu'un plugin tiers peut livrer dans la langue de son
choix, si bien qu'il est rendu tel quel par le frontend plutôt que recherché via `t()` — la seule
exception délibérée à la règle habituelle de cette base de code, `t()` partout pour les chaînes
visibles par l'utilisateur.

### Une seule table pour chaque type — `DocumentInstance`

```prisma
model DocumentInstance {
  id            String   @id @default(cuid())
  companyId     String
  typeId        String   // "invoice", "expense", a plugin's own id — never a Prisma enum
  status        String   @default("draft")
  data          Json     // every field value, keyed by DocumentFieldDescriptor.key
  number        Int?
  displayNumber String?
  lastActionError String?
  transportRef    String?
  // ...
}
```

Chaque type de document — du cœur ou tiers — est une ligne de cette UNIQUE table, distinguée
seulement par `typeId`. C'est *pourquoi* ajouter un type ne nécessite aucune migration Prisma : il n'y
a pas de schéma par type à étendre, seulement un nouveau descripteur et, en général, un nouveau
jeu de clés `data` que personne d'autre n'utilise. `number`/`displayNumber` sont posés exactement une
fois, la première fois que le statut d'un enregistrement correspond au `numbering.onEnterStatus`
propre au type — un type qui ne déclare jamais `numbering` (par exemple « expense ») ne les pose
jamais, sur aucun enregistrement.

### Enregistrer le type — une ligne

```ts
// documents-core.module.ts
function buildDocumentTypeRegistry(): DocumentTypeRegistry {
  const registry = new DocumentTypeRegistry();
  registry.register(buildQuoteDescriptor());
  registry.register(buildInvoiceDescriptor());
  registry.register(buildCreditNoteDescriptor());
  registry.register(buildExpenseDescriptor());
  registry.register(buildReceivedInvoiceDescriptor()); // ← adding a type is exactly this one line
  return registry;
}
```

`DocumentTypeRegistry.register()` (`descriptors/type-registry.ts`) fait deux choses, de façon
synchrone, à l'instant même où il s'exécute — au vrai démarrage de l'application, ou au moment où un
test jest l'appelle directement :

1. Refuse un `id` en double (une `Error`, pas une exception HTTP — ce registre doit rester utilisable
   en dehors d'une requête HTTP).
2. Appelle `validateLifecycle(descriptor)` (`lifecycle.ts`) — une déclaration `statuses`/
   `initialStatus`/`transitions` cassée fait échouer l'enregistrement immédiatement, ce qui, pour la
   vraie application, signifie que le backend ne termine jamais son démarrage, et pour un test, que
   l'appel `.register()` lui-même lève une exception. Il n'existe pas d'état « le type a chargé, mais
   son cycle de vie est silencieusement cassé » qui puisse atteindre la production.

### Câbler les boutons — l'`ActionRegistry`

Un descripteur ne fait que *déclarer* qu'une action existe ; il faut encore que quelque chose dise ce
que l'exécuter fait réellement. C'est un second registre, indépendant (`actions/action-registry.ts`),
câblé dans le même module :

```ts
function buildActionRegistry(/* deps */): ActionRegistry {
  const registry = new ActionRegistry();
  registerExpenseActions(registry, webhookDispatcher); // registerSaveDraftAction + registerDeleteAction
  // ...
  return registry;
}
```

Pour les cas courants (`save-draft`, `delete`), `actions/generic-actions.ts` a déjà une implémentation
agnostique au type — `registerSaveDraftAction(registry, typeId, webhooks?)` et
`registerDeleteAction(registry, typeId, webhooks?)` couvrent tout type dont le gestionnaire n'a pas
besoin de lire un seul champ de `data`. Un type dont le comportement dépend réellement de la logique
pays/canal/règlement (le propre « send » de la facture) a besoin de son propre `<type>-actions.ts`
avec un `ActionHandler` sur mesure — `invoice-actions.ts` est le modèle à lire pour cette forme. Une
action déclarée sur le descripteur mais **sans** gestionnaire enregistré ici n'est pas un bug :
`DocumentsService.runAction` transforme cela en la porte 501 ci-dessous, délibérément — l'état
honnête voulu pour, par exemple, « convert-to-invoice » avant qu'un pipeline de facturation existe
pour le porter.

### Les quatre portes — héritées automatiquement

Chaque action de chaque type de document — du cœur ou tiers — passe par exactement le même
`DocumentsService.runAction` (`documents.service.ts`), dans exactement le même ordre, décrit en
détail dans
[Ajouter un pays](./adding-a-country.md#les-quatre-portes--ce-qui-se-passe-quand-vous-essayez-réellement-dexécuter-une-action) :
politique pays (403) → statut (409) → implémentation (501) → validation (400). L'auteur d'un type de
document ne réimplémente jamais rien de tout cela — c'est générique par rapport à `typeId`. La seule
chose que les propres fichiers `country-policy/data/*.json` d'un pays doivent ajouter pour un nouveau
type est une entrée `documentTypes` nommant le nouveau type et des `rules` pour chacune de ses actions
(voir ce guide) ; tant que le fichier d'un pays ne le dit pas, CHAQUE action d'un type tout neuf lui
est refusée, bruyamment, par la même règle « pas de repli permissif » qui gouverne déjà chaque type
existant.

### Composer avec les pays, sans en nommer aucun

Un descripteur de type de document ne mentionne jamais de pays. Trois mécanismes séparés et optionnels
permettent à un pays de façonner malgré tout un type sans qu'aucun des deux ne nomme l'autre :

- **`country-fields/data/<cc>.json`** peut `add`/`modify`/`remove` un CHAMP sur la forme d'un type
  existant pour un pays (le `invoice.lines[].supplyType` de `country-fields/data/fr.json` est
  l'exemple travaillé) — le propre descripteur du type reste la forme tronc dont part chaque pays.
- **`usesLegalMentions: true`** fait entrer un type dans le bloc de mentions imposées par le pays sur
  son PDF rendu (`mentions/`) — seul `invoice.descriptor.ts` le déclare aujourd'hui, puisque
  « expense » n'a pas de champ `issueDate` auquel accrocher une mention et qu'un type tiers peut n'en
  avoir aucune raison.
- **`country-policy/data/<cc>.json`** décide, par pays, lesquelles des actions déclarées par le type
  sont même proposées — le type lui-même n'a aucun avis là-dessus ; voir
  [Ajouter un pays](./adding-a-country.md).

### Un exemple travaillé — lire `expense.descriptor.ts` de bout en bout

`descriptors/expense.descriptor.ts` est le type réel le plus court de cette base de code et un bon
modèle pour un type sans transmission et sans nuance par pays :

- **Un seul statut** (`"draft"`) — `initialStatus: "draft"`, et les propres `transitions` de
  « save-draft » sont `[{ from: 'always', to: 'draft' }]` (une note de frais ne quitte jamais
  « draft »).
- **Deux actions** : « save-draft » (via `registerSaveDraftAction`, générique) et « delete » (via
  `registerDeleteAction`, générique) — restreintes à `availableWhen: ['draft']` puisqu'un
  enregistrement jamais sauvegardé n'a encore rien à supprimer.
- **Pas de `numbering`** — rien dans une simple écriture comptable interne n'a besoin d'un numéro
  d'affichage séquentiel comme une facture émise en a besoin.
- **`contributions: ['dashboard', 'statistics']`** — voir
  `contributions/expense-contributions.ts` pour le vrai code du widget (enregistré séparément,
  exactement comme le gestionnaire d'une action).
- **`listItem: { titleFields: ['description'], secondaryFields: ['amount', 'date'] }`** — une note de
  frais n'a ni client ni document source pour mener une carte, donc sa propre `description`,
  obligatoire et écrite à la main, sert de titre à la place.

### Tests

- **Enregistrer un cycle de vie cassé échoue déjà bruyamment** — `type-registry.spec.ts`/
  `lifecycle.spec.ts` couvrent le mécanisme lui-même ; votre propre nouveau type n'a pas besoin d'un
  test séparé « est-ce que ça charge », puisque `DocumentTypeRegistry.register()` le prouve déjà dès
  qu'un test (ou la vraie application) l'enregistre.
- **Donnez au type son propre `<type>.descriptor.spec.ts`** qui fixe précisément les champs/actions/
  statuts qu'il déclare — une future modification qui supprime silencieusement un champ ou change un
  `availableWhen` doit faire échouer un test nommé, la même discipline que le conseil « figer le
  contenu » d'`adding-a-country.md` impose déjà pour le JSON d'un pays.
- **Si le type a des gestionnaires d'action sur mesure**, testez-les comme
  `invoice-actions.spec.ts` teste `invoice-actions.ts` — y compris, si un gestionnaire dépend du
  pays/canal, un cas par pays concerné.
- **Si le type est visible par l'utilisateur**, étendez la spec Cypress correspondante pour que tout
  le chemin (formulaire → enregistrement → action) soit prouvé à travers la vraie interface, pas
  seulement le descripteur isolé.
