# 08 — Le modèle de déclenchement

> Note de **conception**. Aucun code n'est écrit, aucune migration n'est proposée. Elle tranche la
> forme de la donnée qui manque, en s'appuyant sur `10-ACQUIS.md` : on **étend** un patron qui
> marche, on n'en remplace aucun.
>
> Orientée France. Le modèle doit porter les cinq pivots (FR, DE, IT, PL, ES) et le Mexique, mais
> c'est la France qu'il faut faire fonctionner, et c'est elle qui fournit le cas le plus contraignant :
> déclencheur **bilatéral**, deux régimes disjoints qui coexistent, trois couches d'obligation.

---

## 1. Le défaut, mesuré

Le moteur choisit le régime dans le **profil du fournisseur**, filtré par le **rôle de l'acheteur**.
Il ne regarde jamais *où les parties sont établies*. Résultat, sur l'arbre courant :

| Transaction | `regime` produit | `reporting` produit | Attendu |
| --- | --- | --- | --- |
| FR→FR B2B | `DECENTRALIZED_CTC` | `[]` | ✅ e-invoicing |
| FR→FR B2C | `REAL_TIME_REPORTING` | `[E_REPORTING]` | ✅ e-reporting |
| FR→IT B2B | **`DECENTRALIZED_CTC`** | `[EC_SALES_LIST]` | ❌ **e-reporting**, pas d'e-invoice |
| FR→US B2B | **`DECENTRALIZED_CTC`** | `[]` | ❌ **e-reporting**, pas d'e-invoice |

Les deux dernières lignes sont le défaut, et il va dans le sens dangereux : une facture
transfrontalière est **routée vers le canal domestique** (PDP) alors que l'art. 289 bis I du CGI
réserve l'e-invoicing aux opérations entre assujettis **tous deux établis en France**, et que
l'art. 290 place ces opérations en **e-reporting**. Le produit émettrait un e-invoice là où la loi
demande une transmission de données, et n'émettrait pas la transmission de données due.

La cause est en une ligne : `RegimeRule.appliesTo` ne connaît que `roles`. Il n'existe aucun moyen
d'écrire « quand les deux parties sont établies ici ».

---

## 2. Le modèle proposé

### 2.1 Le déclencheur est une donnée du profil

```ts
/**
 * Ce qui fait qu'une obligation s'applique À CETTE opération.
 *
 * Discriminé, pas booléen : la règle de rattachement diffère par pays, et l'écrire en code
 * ramènerait le nom d'un pays dans la logique métier — ce que l'architecture interdit.
 */
type EstablishmentPredicate =
  /** FR art. 289 bis I, DE §14 UStG : les DEUX parties établies dans le pays. */
  | { kind: 'BOTH_ESTABLISHED_IN'; country: ISO3166Alpha2 }
  /** PL : le vendeur suffit (KSeF s'applique au vendeur établi). */
  | { kind: 'SUPPLIER_ESTABLISHED_IN'; country: ISO3166Alpha2 }
  /** ES mandat B2B : tiré par le destinataire obligé. */
  | { kind: 'BUYER_ESTABLISHED_IN'; country: ISO3166Alpha2 }
  /** IT SdI : l'une ou l'autre suffit. */
  | { kind: 'EITHER_ESTABLISHED_IN'; country: ISO3166Alpha2 }
  /** Le complément : l'opération SORT du champ domestique. C'est lui qui porte l'e-reporting. */
  | { kind: 'NOT_BOTH_ESTABLISHED_IN'; country: ISO3166Alpha2 }
  | { kind: 'ALWAYS' };
```

**Pourquoi discriminé et non un booléen `bilateral`.** Les cinq pivots donnent cinq règles de
rattachement différentes ; un drapeau obligerait à écrire l'arbitrage en code, donc à y nommer des
pays. Une union discriminée le laisse dans la donnée, où `data-integrity.spec.ts` sait déjà le
vérifier.

### 2.2 Une obligation par couche

```ts
/** Les trois couches divergent. L'Allemagne le prouve, la France l'exige aussi. */
type ObligationLayer = 'EMISSION' | 'RECEPTION' | 'ARCHIVAL';

interface ObligationRule {
  layer: ObligationLayer;
  applies: EstablishmentPredicate;
  roles?: PartyRole[];
  supplyTypes?: SupplyType[];

  /** Ce qu'il faut FAIRE quand elle s'applique. Aucun champ n'est nouveau : ce sont les
   *  dimensions que `CompliancePlan` porte déjà, redistribuées par obligation. */
  regime: RegimeRule;
  formats?: FormatRule;
  channels?: ChannelSpec[];
  lifecycle?: LifecyclePolicy;
  reporting?: ReportingKind[];
}
```

**Pourquoi trois couches et pas une.** La réception est due avant l'émission — en France toutes les
entreprises doivent **recevoir** au 2026-09-01, l'obligation d'émettre est échelonnée. L'archivage a
sa propre horloge et sa propre durée. Un seul prédicat par pays ne peut pas porter trois échéances
distinctes, et c'est exactement ce que le profil FR encode aujourd'hui en aplatissant les trois.

### 2.3 Le plan devient un ensemble, pas un singleton

C'est le seul changement de forme dans `CompliancePlan` :

```ts
- regime: RegimeRule;
+ obligations: ResolvedObligation[];   // 0..n, une par couche déclenchée
```

Une opération FR→FR B2B en résout **une** (émission, e-invoicing). Une opération FR→IT B2B en
résout **une** (émission, e-reporting) — et surtout **pas** de canal PDP. Une opération de services
domestique en résout **deux** : l'e-invoicing et l'e-reporting de données de paiement, qui ont deux
horloges différentes. Le singleton actuel ne peut pas exprimer la troisième situation.

### 2.4 Le prédicat s'évalue sur l'opération, pas sur la partie

C'est le point que le code a déjà identifié — `canonical-document.ts:49` le dit :
l'établissement est une propriété **de l'opération** (l'établissement stable intervient-il dans
CETTE livraison ?), pas de la partie.

Aujourd'hui `PartyTaxProfile.countryCode` est alimenté par
`invoices.helpers.ts:130` et `:136` :

```ts
countryCode: company.countryCode ?? guessCountryCode(company.country) ?? 'FR',
```

Deux défauts dans une ligne : c'est le pays **de la société**, pas l'établissement intervenant ; et
le repli final est **silencieux et français**. Une société sans pays renseigné devient française et
tombe dans le mandat français. C'est le même motif que F-006 côté acheteur, corrigé alors par un
blocage dur à l'émission ; ici il faut la même chose, côté fournisseur.

Ce que le prédicat doit recevoir n'est donc pas `party.countryCode` mais un champ d'opération —
appelons-le `establishmentIntervening: ISO3166Alpha2 | null` par partie — dont `null` **bloque**
au lieu de se replier.

---

## 3. E-invoicing et e-reporting : deux régimes disjoints

Le tableau que le modèle doit rendre exprimable. Rien ici n'est nouveau juridiquement ; c'est ce
que le moteur ne sait pas dire aujourd'hui.

| | E-invoicing (art. 289 bis) | E-reporting (art. 290) |
| --- | --- | --- |
| Déclencheur | `BOTH_ESTABLISHED_IN: 'FR'`, B2B/B2G | `NOT_BOTH_ESTABLISHED_IN: 'FR'`, ou B2C |
| Flux | **F1** (facture) | **F10** (transmission de données) |
| Statuts | 200 / 210 / 212 / 213 | 300 / 301 |
| Horloge | par facture, statuts sous 24 h | **périodique** |
| Correction | avoir ou facture rectificative | **remplacement de la période entière** |
| Canal | PDP obligatoire | transmission de données, pas de routage de facture |

**La ligne « correction » est celle qui interdit de traiter l'e-reporting comme un e-invoicing
dégradé.** Corriger une facture est un document de plus ; corriger un e-reporting est le
remplacement d'une période. Le cycle de vie n'est pas le même objet, ce qui est précisément pourquoi
`lifecycle` doit vivre **dans** l'obligation et non à côté du plan.

---

## 4. Ce qu'on étend plutôt qu'on refait

`10-ACQUIS.md` §3.1 : `determineTax(ctx, supplierProfile, vat, buyerProfile)` compose déjà **deux
profils**, correctement, et c'est prouvé — `compliance-engine.spec.ts` vérifie qu'une opération
`US→FR` fait produire par le profil **acheteur** un artefact Factur-X de réception, et
`tax-matrix.spec.ts` qu'une vente `FR→IT` B2C prend le **taux de destination italien lu dans le
profil italien**.

La signature est donc déjà la bonne. Ce qui manque n'est pas un mécanisme, c'est le **nombre de
dimensions** qui l'empruntent : deux sur neuf. L'extension consiste à faire passer `regime`,
`channels`, `lifecycle` et `reporting` par la même porte, via l'évaluation de prédicat.

**Trois choses ne bougent pas**, et c'est ce qui rend l'extension abordable :

- les profils temporels et leur résolution à date — le prédicat s'évalue *après* `pickByDate` ;
- le registre de fournisseurs et la résolution de canal ;
- le runtime de cycle de vie, qui consomme un `LifecyclePolicy` sans savoir d'où il vient.

---

## 5. Coût

Estimations en jours de développement, avec ce qui les porte. Elles valent ce que vaut une
estimation faite sans avoir écrit le code — je les donne parce que refuser de chiffrer est aussi une
manière de ne rien dire.

| Lot | Coût | Ce qui le porte |
| --- | --- | --- |
| `EstablishmentPredicate` + évaluateur | **1–2 j** | Type pur + fonction pure ; testable sans base ni réseau |
| `ObligationRule` dans le schéma de profil, FR seule | **2–3 j** | Réécriture du profil FR en obligations ; les autres profils gardent la forme actuelle derrière un adaptateur |
| `plan.obligations` + adaptateur de compatibilité | **3–5 j** | Le point dur : ~40 sites lisent `plan.regime`. Un accesseur `primaryObligation()` évite de tous les toucher d'un coup |
| Champ d'opération `establishmentIntervening` + blocage sur `null` | **2–3 j** | Migration Prisma, UI de saisie, et la garde dure — modèle : le blocage F-006 déjà en place |
| Extension des 5 autres profils | **3–5 j** | Mécanique une fois FR faite |
| **Total** | **11–18 j** | Hors validation de format et chaînage (liste §6, indépendants) |

Le lot 3 est celui qui peut déraper : l'adaptateur est ce qui évite un big-bang, et c'est aussi ce
qui peut faire vivre deux modèles en parallèle plus longtemps que prévu.

---

## 6. Ce que cette note ne tranche pas

- **Le format du champ d'établissement.** `ISO3166Alpha2 | null` est le minimum ; savoir s'il faut un
  identifiant d'établissement (SIRET de l'établissement intervenant, et non de l'entité) est une
  question à poser au cadre PPF, pas à trancher ici.
- **La cardinalité pour les groupes TVA.** Un assujetti unique au sens du 5° bis peut avoir plusieurs
  établissements ; le modèle suppose un établissement intervenant par partie et par opération. Non
  vérifié contre le cas des groupes.
- **La coexistence des deux obligations sur une même facture.** Le modèle la rend exprimable ; il ne
  dit pas comment le runtime ordonnance deux cycles de vie sur un même document, ni si un rejet sur
  l'une doit affecter l'autre.
- **Rien sur l'e-reporting de données de paiement**, qui a sa propre échéance et son propre flux, et
  qui mérite sa propre analyse.
