# 12 — Inventaire de suppression

**Ce document est un inventaire. Aucune suppression n'a été faite.** Il dit ce qui part, ce qui
reste, et ce qui bloque chaque suppression. Les chiffres sont mesurés, pas repris : chaque ligne
porte la commande qui la produit.

Les fiches 00 à 11 vivent sur `audit/compliance-truth`. Celle-ci est sur `feat/compliance-engine-v2`,
parce qu'elle précède un changement de code sur cette branche.

Date : 2026-08-28. Arbre : `feat/compliance-engine-v2` à `9f74e7e2`.

---

## 1. L'état mesuré

### 1.1 Les 62 providers de transmission

La taxonomie existe déjà, dans `providers/transmission/provider-maturity.spec.ts`, et elle est
gardée par un test. Je la reprends telle quelle plutôt que d'en inventer une seconde.

| Palier | Nombre | Ce que c'est |
| --- | --- | --- |
| `PROVEN` | **4** | `ksef`, `pdp`, `peppol`, `email` — aller-retour réel constaté |
| `IMPLEMENTED` | **17** | client de protocole nommé, réel, sans identifiants |
| `STUB` générique | **37** | `buildGenericPortalProvider()`, aucun `httpPort` injecté en production |
| `STUB` autre | **4** | `pac`, `ose`, `print`, `zatca` |

`4 + 17 + 37 + 4 = 62`. **58 ne transmettent rien.**

```
$ ls src/compliance/providers/transmission/portals/*.ts | wc -l      # 37
$ cat src/compliance/providers/transmission/portals/*.ts | wc -l     # 1475 lignes
$ ls src/compliance/providers/transmission/*-client.ts | wc -l       # 18 fichiers
$ cat src/compliance/providers/transmission/*-client.ts | wc -l      # 3698 lignes
```

### 1.2 Les 42 formats nationaux déclarés et vides

```
$ ls src/compliance/providers/format/national/*.ts | wc -l           # 42
$ cat src/compliance/providers/format/national/*.ts | wc -l          # 589 lignes
```

589 lignes pour 42 fichiers : **14 lignes chacun**. Un fichier entier :

```ts
export const AR_FE_FORMAT: NationalFormatSpec = {
  id: 'ar-fe',
  syntax: 'AR_FE',
  label: 'Argentina Factura Electrónica',
  buildHint: 'build ARCA/AFIP WSFE comprobante + request CAE; embed CAE + vencimiento',
};
```

Aucun n'a de `build`. Ce ne sont pas des implémentations partielles : ce sont **42 déclarations
d'intention** que le moteur sélectionne comme s'il s'agissait de formats.

### 1.3 Ce qu'il ne faut PAS confondre avec eux

`src/modules/invoice-rendering/national/` contient **14 fichiers, 3846 lignes**, et ceux-là
produisent des octets réels : `fattura-pa`, `cfdi`, `facturae`, `ksa-ubl`, `fa-vat`… Même mot,
« national », deux répertoires, deux natures opposées. La confusion coûterait cher dans les deux
sens.

### 1.4 Le rapport publié / implémenté

```
$ ls src/compliance/profiles/data/*.ts | wc -l                       # 108 profils
$ find documentation -name "*.md" -path "*compliance*" | wc -l       # 118 pages
```

F-004 le chiffrait à 106 pages publiques et 56 pays sans aucune sortie en vigueur. L'écart 106/118
tient aux fiches ajoutées depuis ; l'ordre de grandeur est le même.

---

## 2. Ce qui part

| Lot | Fichiers | Lignes | Pourquoi |
| --- | --- | --- | --- |
| Portails génériques | 37 | 1 475 | `buildGenericPortalProvider()` sans `httpPort` en production : un objet qui accepte un document et ne l'envoie nulle part |
| Formats nationaux vides | 42 | 589 | Aucun `build`. Le moteur les choisit par syntaxe et obtient zéro octet — c'est le mécanisme de F-001 |
| Clients de portail dédiés | 18 | 3 698 | À décider lot par lot ; voir §4. Ceux-là contiennent du protocole réel, ce n'est pas la même suppression |

**Total du périmètre certain : 79 fichiers, 2 064 lignes.** Le lot des 18 clients (3 698 lignes)
est un arbitrage, pas un acquis.

## 3. Ce qui reste

- **`profiles/data/*.ts` — les 108.** Ce sont des règles sourcées : taux, régime, durée de
  conservation, numérotation, identifiants requis. Elles valent sans transport, et c'est le seul
  endroit du dépôt où le travail juridique est capitalisé. Le profil ghanéen fait onze lignes et
  n'en contient qu'une de faux : le `providerId`.
- **Le moteur, `resolve()`, la composition de profils, le runtime.** L'audit les a établis sains et
  sous-étendus. Hors périmètre, sans exception.
- **Les 14 builders de `modules/invoice-rendering/national/`.** Ils rendent des documents réels.
- **`email`, `print`, `peppol`, `pdp`, `ksef`.**

---

## 4. Ce qui bloque chaque suppression

### B1 — Un profil ne peut pas exprimer « pas de transport » *(bloquant, structurel)*

`profiles/data-integrity.spec.ts` :

```ts
expect(p.transmission.length).toBeGreaterThan(0);
```

… et « every DocumentSyntax and channel providerId it references must resolve to a REAL provider ».

Supprimer les 37 portails casse donc les 37 profils qui les nomment. Les repointer vers `EMAIL`
via l'archétype `noMandate` compilerait — et **mentirait** : un pays sous mandat de clearance dont
on déclare le canal « e-mail » affirme une conformité qui n'existe pas. Le schéma n'a aujourd'hui
aucun état pour « un mandat existe, nous n'avons pas de sortie ».

**C'est le vrai blocage, et ce n'est pas un problème de volume de code : c'est un trou dans le
schéma.** Tant qu'un profil ne peut pas dire « non desservi », les 58 stubs sont la seule façon dont
le dépôt sait l'écrire — mal, mais sans mentir moins qu'un `EMAIL` inventé.

Il faut donc, dans l'ordre : ajouter l'état, migrer les profils, puis supprimer.

### B2 — Les 118 pages Docusaurus *(bloquant, F-004)*

Le site publie un navigateur à facettes avec un badge « {count} countries ». Retirer le code sans
traiter les pages produit exactement l'inversion que F-004 dénonce : un site qui promet cent pays
au-dessus d'un dépôt qui en implémente cinq. Le sort des pages fait partie de la suppression, pas de
sa suite.

Trois options, à trancher :

| | Effet | Coût |
| --- | --- | --- |
| Garder, avec un bandeau d'état par pays | Le travail documentaire survit, la promesse est bornée | Un champ d'état à dériver du profil |
| Réduire aux pays servis | Aucune ambiguïté | Perte de 100+ fiches de recherche |
| Déplacer hors du site public | Conserve tout, ne promet rien | Un déplacement, une redirection |

`profiles/coverage.spec.ts` lit `documentation/compliance/*.md` et échoue si un pays documenté n'a
pas de profil. Les profils restant, ce test ne bloque pas — mais si les pages partent, il perd son
objet et devient un test qui ne teste rien.

### B3 — F-001 et F-004 ne doivent pas disparaître avec le code

F-001 (un document de zéro octet traverse le pipeline et est archivé) a pour mécanisme précisément
les 42 formats vides. Les supprimer **résout** le finding — mais si la suppression ne laisse aucune
trace, la prochaine génération de stubs le recréera. Il faut, au moment de supprimer :

- un test qui échoue si un `FormatProvider` enregistré rend zéro octet alors qu'un renderer était
  câblé (la distinction établie en P1-T04 ; la garde existe, il faut qu'elle survive au ménage) ;
- la fermeture explicite de F-001 et F-004 dans `02-FINDINGS.md`, avec le commit qui les ferme.

### B4 — La vérification de la dérivation depuis le taux *(levé)*

La règle de périmètre disait : rien ne se supprime avant d'avoir vérifié, sur les 58, que la
dérivation d'une catégorie TVA depuis un taux n'existe pas ailleurs. **C'est fait** (§1 du rapport
de ce tour). Le résultat, et il change la conclusion :

| Site | Nature |
| --- | --- |
| `invoice-rendering.service.ts:358` | corrigé — lisait le taux, lit le plan |
| `tax-engine.ts:177` | le moteur, `taxCategoryHint ?? (rate === 0 ? 'Z' : 'S')` |
| `tax-engine.ts:250` | le moteur, `rate > 0 ? 'S' : 'Z'` sur une ligne de *sales tax* américaine |
| `europe-builders.ts:40` | myDATA grec, `vatRate > 0 ? '1' : '7'` |
| `europe-builders.ts:96` | `AAA` / `AAM` |
| `cfdi.ts:30` | traslado mexicain émis seulement si taux > 0 |
| `fattura-pa.ts:50` | Natura italienne calculée seulement si taux = 0 |
| `ksa-ubl.ts:207` | `'S'` / `'E'` |
| `latam-builders.ts:121` | `CodigoTarifa` costaricain dérivé de la valeur du taux |

**Dix occurrences, pas trois.** Et le fait notable pour cet inventaire : **six d'entre elles sont
dans les 14 builders qui RESTENT**, pas dans les 79 qui partent. La suppression ne les emporte pas.
Les deux du moteur sont d'une autre nature — là, le moteur est l'autorité qui décide, pas une copie
qui devine — mais `0 ⇒ Z` y ignore E et O, et mérite d'être repris à part.

### B5 — Les 18 clients dédiés sont un arbitrage, pas un acquis

Ils contiennent du protocole réel (SOAP SdI, ChorusPro, ANAF, SEFAZ…), 3 698 lignes, et leur seul
défaut est l'absence d'identifiants. Les supprimer jette du travail exact ; les garder maintient
17 chemins que rien ne parcourt. **À trancher pays par pays selon les marchés visés** — France,
Pologne, Italie sont les marchés déclarés, donc `sdi` et `choruspro` ne relèvent pas du même
jugement que `uy-dgi`.

---

## 5. L'ordre imposé par les blocages

1. Ajouter au schéma l'état « mandat connu, pas de sortie » (B1).
2. Trancher le sort des 118 pages (B2).
3. Migrer les 37 + 42 profils vers le nouvel état.
4. Supprimer les 79 fichiers, en fermant F-001 et F-004 avec le commit (B3).
5. Arbitrer les 18 clients dédiés séparément (B5).
6. Reprendre à part les 6 dérivations depuis le taux qui survivent (B4).

Aucune de ces étapes ne touche le moteur, `resolve()`, la composition de profils ni le runtime.
