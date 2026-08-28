# 09 — F-018 : séquence, question préalable, et grille de déclaration

> Rédigé le 2026-08-27. Ce document **ne constitue aucune déclaration, aucun engagement, et n'a
> aucune valeur juridique.** Il prépare des éléments et identifie qui doit trancher.

---

## 1. Le correctif évident est le plus coûteux

| Manquement | Montant | Base |
| --- | --- | --- |
| Absence de déclaration responsable | **1 000 €** par système commercialisé | LGT art. 201 bis.1 f) |
| Système ne respectant pas les spécifications de l'art. 29.2.j) LGT | **150 000 €** par exercice **et par type de système** | LGT art. 201 bis.1 a)–e) |

**Le rapport de 1 à 150 commande toute la séquence.** Déclarer vite pour rattraper le retard, alors
que la chaîne de registres ne se forme pas, ne rattrape rien : cela fait passer l'exposition du
montant plancher au montant plafond.

*(Montants relayés depuis la vérification pays ; l'art. 201 bis n'a pas été relu verbatim par mes
soins. L'échéance, elle, l'a été — voir F-018.)*

---

## 2. Question préalable — à poser à un juriste espagnol, non tranchée ici

**Le rattachement d'Invoicerr à l'obligation n'est pas établi**, et tout le finding en dépend.

### La question

> Le RD 1007/2023 art. 3.2 dispose que le règlement « **también se aplicará a los productores y
> comercializadores de los sistemas informáticos** », s'agissant de leur activité de production et
> de commercialisation de systèmes **mis à disposition des obligés tributaires visés au paragraphe
> 1** (contribuables IS / IRPF activité économique / IRNR avec établissement permanent / entités en
> attribution de revenus, domiciliés en territoire commun).
>
> **Question 0 — celle qui teste l'entrée dans le régime.** L'obligation de déclaration responsable
> de l'art. 13 vise-t-elle **tout système de facturation**, ou seulement un système **destiné à être
> utilisé par un obligé tributaire au sens de l'art. 3.1** ? Les questions suivantes présupposent
> toutes que le régime s'applique et cherchent où il s'arrête ; celle-ci demande s'il commence.
>
> **Invoicerr est-il un « productor » au sens de l'art. 3.2 s'il n'a aucun utilisateur assujetti en
> Espagne et n'y est pas commercialisé ?**
>
> Sous-questions :
> 1. **Quel fait déclenche le rattachement de l'art. 3.2 ?** Le règlement énonce-t-il un critère, et
>    lequel ? Notamment, ce critère se rattache-t-il à la mise à disposition d'un système à un obligé
>    tributaire déterminé, à la disponibilité publique du logiciel sans destinataire identifié, à un
>    acte de commercialisation, ou à un autre fait ?
> 2. Dans un modèle **auto-hébergé** par un tiers, sans relation contractuelle ni connaissance de
>    l'éditeur, **qui porte l'obligation de l'art. 13**, et à quel titre ?
> 3. Si un utilisateur espagnol apparaît après une échéance déjà échue, **à quelle date le
>    rattachement prend-il effet**, et quelles conséquences en tire le règlement quant à l'échéance
>    passée ?
> 4. **Quel rôle joue, le cas échéant, l'existence d'une contrepartie financière** dans la
>    qualification de « productor » et dans celle de « comercializador » ? Ces deux qualifications
>    obéissent-elles au même critère ?

> **Note de rédaction.** Les cinq questions sont formulées de manière à ne pas orienter la réponse.
> La sous-question 1 posait auparavant une alternative entre « mise à disposition effective » et
> « **simple** disponibilité » : l'adjectif disqualifiait l'une des deux branches avant que le
> juriste ne se prononce. Les sous-questions 3 et 4 portaient le même défaut sous une forme plus
> discrète — « rétroactif », et un oui/non sur la contrepartie financière. Elles sont désormais
> ouvertes : elles demandent le critère, pas une confirmation.

### Éléments de fait à joindre à la question

- Invoicerr est distribué en **open source** et **auto-hébergeable** ; l'éditeur n'a pas
  nécessairement connaissance ni contrôle des instances déployées.
- Le dépôt ne contient **aucun indice d'utilisateur espagnol** : les canaux espagnols (`es-face`,
  `es-aeat`) sont des stubs sans transport, et aucun identifiant de client espagnol n'y figure.
- Le produit **modélise l'Espagne** (profil `ES`, générateurs SII et Veri\*Factu) sans être
  commercialisé sur ce marché à ma connaissance.
- Le marché principal déclaré du projet est France, Pologne et Italie.

**Fait technique à joindre — il détermine ce qui est évalué.** L'exposition dépend de ce que le
système fait réellement, et non de ce qu'il ne fait pas :

- L'**algorithme de la huella est implémenté et conforme**, suivant le document AEAT
  **v0.1.2 du 2024-08-27** ; la suite de tests reproduit **les deux exemples chiffrés officiels** de
  ce document, cas non chaîné et cas chaîné, avec les SHA-256 publiés par l'autorité.
- **Mais la chaîne ne se forme jamais.** `previousHuella` vaut `''` par défaut et **aucun appelant ne
  l'alimente** : chaque registre part avec `PrimerRegistro='S'` — une chaîne de longueur un, répétée,
  là où l'art. 8.2.b exige le rattachement au registre précédent.
- Le code QR est produit, mais sur le chemin `ValidarQR` des **systèmes vérifiables**, alors que le
  produit ne transmet rien en continu (ES-D12).

Un juriste qui ignorerait ces trois points évaluerait la mauvaise chose — soit un système supposé
dépourvu de capacité de hachage, soit un système supposé conforme.

> **Cette question n'est pas tranchée ici, et ne doit pas l'être par moi.** Si la réponse est
> négative, F-018 sort de l'axe « exposition juridique de l'éditeur » et redevient un point de
> préparation. Si elle est positive, la séquence ci-dessous s'applique.

---

## 3. La séquence, si le rattachement est confirmé

Elle est contrainte et ne s'inverse pas. **Elle a changé depuis la correction d'ES-D1.**

| # | Étape | État | Bloqué par |
| --- | --- | --- | --- |
| 1 | Confirmer que les spécifications techniques AEAT encodées dans le code sont toujours à jour | **fait** — voir ci-dessous | — |
| 2 | **Former la chaîne** : alimenter `previousHuella` depuis `ReportingStore` | **faisable maintenant** | rien |
| 3 | Vérifier — les vecteurs officiels sont déjà dans la suite de tests | faisable après 2 | rien |
| 4 | Déclarer | **décision d'entreprise** | question §2, puis étapes 1–3 |

**Ce qui a changé, et l'étape 1 est close.** La première rédaction posait « obtenir les deux
documents techniques AEAT » en étape bloquante. **Les deux ont été obtenus et lus le 2026-08-27**, et
ce sont exactement les versions que le code cite :

- *Detalle de las especificaciones técnicas para la generación de la huella o hash…* — **v0.1.2,
  27/08/2024**. Son exemple chiffré donne
  `3C464DAF61ACB827C65FDA19F352A4E3BDC2C640E9E9FC4CC058073F38F12F60`, valeur que
  `generators.spec.ts` affirme **à l'octet près**. Vérifié indépendamment sur le PDF de l'autorité.
- *Detalle de las especificaciones técnicas del código «QR» de la factura…* — **v0.5.0, 10/12/2025**.

La lecture du second a toutefois produit un **défaut neuf**, ES-D12 : la spec distingue le chemin
`ValidarQR` (systèmes vérifiables) du chemin `ValidarQRNoVerifactu` (non vérifiables), et le code
code en dur le premier. Voir `03-LEGAL-VERIFICATION.md`.

**Ce qui manque réellement est une requête, pas une source.** Le `TODO(seam)` de
`generators.ts:695` décrit lui-même le correctif : lire par émetteur la huella du dernier registre
VERIFACTU via `ReportingStore`, et la passer au générateur. Tant que ce n'est pas fait, chaque
registre porte `PrimerRegistro='S'` : une chaîne de longueur un, répétée.

**Ce qu'il ne faut toujours pas faire** : réécrire l'algorithme de la huella ou l'URL du QR « au
plus probable ». Ils sont déjà conformes à des vecteurs publiés ; les toucher sans le document à
jour ne peut que dégrader.

---

## 4. Grille des indicateurs — Orden HAC/1177/2024 art. 15

Renseignée **uniquement** avec ce qui est factuel au 2026-08-27. Les cases non établies sont laissées
vides — elles relèvent de l'entreprise, pas de l'audit.

| Réf. | Champ exigé | État |
| --- | --- | --- |
| 1.a | Nom commercial du système | `Invoicerr` |
| 1.b | **Code identifiant du SIF** (2 caractères, unique par produit) | *(à choisir — non attribué)* |
| 1.c | Identifiant de version | dernier tag : `v1.4.6b`. **Écart à lever** : `backend/package.json` porte `0.0.1` et `frontend/package.json` `0.0.0` — la version publiée n'est pas celle du paquet |
| 1.d | Composants matériels/logiciels et fonctionnalités | Application web ; backend NestJS + PostgreSQL + Redis ; frontend React ; déploiement conteneurisé, deux rôles (`api`, `worker`) |
| 1.e | **Le système fonctionne-t-il uniquement en mode VERI\*FACTU ?** | **voir §5 — aucune des deux réponses n'est aujourd'hui exacte** |
| 1.f | **Le système supporte-t-il plusieurs obligés tributaires ?** | **S** — multi-tenant par conception : 22 services applicatifs cadrent leurs requêtes par `companyId`, et le décorateur `@ActiveCompany()` lève une 403 hors contexte société |
| 1.g | Types de signature en mode non-VERI\*FACTU | **non implémenté pour les registres.** Le produit dispose de providers XAdES, CAdES et PAdES, mais ils signent des **artefacts de facture**, pas des `registros de facturación` |
| 1.h | Raison sociale du producteur | *(entreprise)* |
| 1.i | Identification fiscale | *(entreprise — un producteur non espagnol peut porter son numéro de TVA intracommunautaire, type `02`)* |
| 1.j | Adresse postale | *(entreprise)* |
| 1.k | Formule de conformité | *(texte imposé par l'Orden ; à reprendre littéralement)* |
| 1.l | Date et lieu — jour, mois, année, puis localité **et pays** | *(à la signature)* |

Rappels de forme (Orden art. 15.3 et 15.4) : la déclaration doit être lisible et individualisée
**dans le produit lui-même**, accessible « de forma rápida, fácil e intuitiva » ; il en faut **une par
version** ; et chaque composant ou extension de tiers exige **sa propre déclaration, pour chaque
version**.

---

## 5. Le piège de l'indicateur 1.e

L'indicateur demande si le système fonctionne **exclusivement** en mode VERI\*FACTU. Les deux
réponses engagent des obligations que le produit ne remplit pas aujourd'hui :

| Réponse | Ce qu'elle engage | État du produit |
| --- | --- | --- |
| **S** — exclusivement VERI\*FACTU | Remisión **automatique, continue et instantanée** de tous les registres à l'AEAT | **non implémenté** — le handler de reporting journalise `[MOCK]` et ne transmet rien (F-016) |
| **N** — non exclusivement | **Signature XAdES des registres** (art. 12), **registro de eventos**, conservation et exportation des registres | **non implémenté** pour les registres |

> **Aucune des deux cases ne peut être cochée sincèrement en l'état.** Ce n'est pas un défaut de la
> grille : c'est la grille qui révèle que la conformité espagnole n'est pas atteinte, indépendamment
> de la question de rattachement du §2. C'est la raison pour laquelle l'étape 4 de la séquence est
> une **décision d'entreprise** et non une tâche technique.

---

## 6. Ce que ce document ne fait pas

Il n'émet aucune déclaration responsable. Il ne tranche pas le rattachement. Il ne recommande pas de
déclarer, ni de s'en abstenir. Il établit que **déclarer avant d'avoir formé la chaîne et choisi une
réponse sincère à 1.e multiplierait l'exposition par cent cinquante**, et il identifie les deux
personnes qui doivent décider : un juriste espagnol pour le §2, la direction pour l'étape 4.
