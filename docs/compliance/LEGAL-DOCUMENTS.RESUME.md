# Reprise — inventaire des documents légaux

> **Ce fichier existe pour qu'une session qui ne sait rien puisse continuer.** Le travail a déjà été
> interrompu une fois par un plafond de crédit, au milieu de six recherches pays lancées en
> parallèle ; quatre ont été perdues. Ce qui suit est ce qu'il faut pour repartir sans redemander.
>
> Livrable : **`docs/compliance/LEGAL-DOCUMENTS.yaml`**.

## La règle qui prime sur le reste

**Ne jamais inventer une règle fiscale ou juridique.** Ce fichier alimente un produit de conformité :
une règle plausible et fausse coûte plus cher qu'une règle absente. Toute entrée porte sa
provenance — `repo`, `sourced` (URL + date), ou `unverified`. Un `unverified` n'est pas un trou dans
le document, c'est un trou dans ce que quelqu'un a vérifié, et le signaler EST le travail.

## État au 2026-08-29

| Bloc | État | Provenance |
| --- | --- | --- |
| Modèle par axes (6 axes) | ✅ fait | `sourced` — Schematron CEN/TC 434 + genericode 1001.gc de la Commission |
| Ce que le produit sait faire | ✅ fait | `repo` — grep sur `invoices.service.ts`, `lifecycle/corrections.ts` |
| Italie (11 documents) | ✅ fait | `sourced` — Normattiva, Gazzetta Ufficiale, Agenzia delle Entrate |
| **France** | ⏳ à faire | — |
| **Pologne** | ⏳ à faire | — |
| **Allemagne + Espagne** | ⏳ à faire | — |
| **Mexique + États-Unis** | ⏳ à faire | — |

## Comment relancer une recherche pays

Un sous-agent `general-purpose` par lot, avec ce gabarit. **La contrainte de format compte** : sans
elle, les agents rendent des monographies de 150 000 jetons — c'est arrivé sur l'Italie.

```
Recherche documentaire. WebSearch et WebFetch. Rends un CATALOGUE COURT — aucun fichier, aucun code.

CONTRAINTE DE FORMAT, à respecter : une ligne de tableau par document, pas de monographie.
Vise ~60 lignes de sortie, pas 600.

CONTEXTE : un produit de facturation électronique prépare un refactor où chaque document légal
devient modulaire et activé selon le pays. Il me faut le catalogue de <PAYS>.

Pour chaque document du cycle de facturation :
- nom local + glose anglaise
- une phrase : ce que c'est, quand on l'émet
- LÉGAL (numéroté, à conserver, opposable au fisc) ou COMMERCIAL
- OBLIGATOIRE / OPTIONNEL / INTERDIT
- source : URL + date de consultation

Couvre au minimum : <LISTE DES NOMS LOCAUX À VÉRIFIER, PAS À SUPPOSER>

POINT PRIORITAIRE : <LE PIÈGE CONNU DU PAYS>

SOURCES : <SOURCES PRIMAIRES DU PAYS>

DISCIPLINE, plus importante que l'exhaustivité : une règle inventée est pire qu'une règle absente.
Si tu ne peux pas sourcer, écris `unverified` et dis ce qui trancherait. Ne comble jamais un trou
par une réponse plausible, et n'extrapole jamais la règle d'un pays à un autre — les différences
sont tout l'objet de la liste.

Termine par « ce que je n'ai pas pu établir ».
```

### Les pièges par pays, à mettre en point prioritaire

- **France** — l'avoir et la facture rectificative sont-ils deux documents distincts en droit, ou
  deux noms ? Et le mandat de facturation (CGI art. 289 I-2) : conditions, et le document reste-t-il
  émis au nom et pour le compte du fournisseur ? Sources : Légifrance (CGI art. 289, ann. II
  art. 242 nonies A), BOFiP, impots.gouv.fr.
- **Pologne** — `faktura korygująca` contre `nota korygująca` : qui émet quoi, et que peut corriger
  chacune ? Les confondre est une vraie erreur. Et lesquels de ces documents passent par KSeF en
  2026, lesquels non. Sources : ustawa o VAT sur isap.sejm.gov.pl, podatki.gov.pl.
- **Allemagne** — le piège du mot `Gutschrift`, qui désigne DEUX choses : un avoir, et une facture
  auto-facturée (§14 Abs. 2 UStG). Sources : gesetze-im-internet.de (UStG §14, §14a, UStDV §33).
- **Espagne** — la `factura rectificativa` est-elle la seule voie de correction, ou peut-on annuler
  et remplacer ? Citer l'article du RD 1619/2012. Sources : boe.es, AEAT.
- **Mexique** — le CFDI de type `E` (egreso) est-il l'avoir, et est-il la SEULE voie de correction,
  sachant qu'un CFDI peut aussi être annulé avec substitution ? Sources : sat.gob.mx, Anexo 20,
  CFF art. 29 et 29-A.
- **États-Unis** — un négatif bien sourcé est ici une bonne réponse, pas un échec. Un document
  est-il légalement imposé comme l'est une facture européenne ? Sources : IRS, départements des
  impôts des États, CBP pour la facture commerciale.

## Comment intégrer un résultat

1. Ajouter une entrée sous `countries:` dans le YAML, en suivant la forme de `IT` — clés `key`,
   `local`, `en`, `what`, `nature`, `obligation`, `source`, `note` optionnelle.
2. Mettre les impasses dans `open_questions:` du pays, avec `settled_by`.
3. Mettre à jour `meta.covered` et `meta.status`.
4. Vérifier : `python3 -c "import yaml; yaml.safe_load(open('docs/compliance/LEGAL-DOCUMENTS.yaml'))"`

## Ce qui reste à faire APRÈS l'inventaire

L'inventaire n'est pas le refactor. Le refactor lui-même — rendre chaque document modulaire et
activé par pays — n'est **pas** commencé et n'a pas été demandé. Le point d'appui existe déjà :
`GET /api/compliance/document-kinds?countryCode=…` et `profiles/document-kinds.ts`, qui dérivent
déjà le document de correction du `correctionModel` des 108 profils.

Voir aussi `PLAN-V2.md` pour l'état général du chantier, et son point d'arrêt de phase 3.
