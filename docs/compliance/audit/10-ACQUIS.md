# 10 — L'acquis : ce qui tient

> Écrit le 2026-08-28, après les phases 0 à 3 et le lot de corrections. Les quatre phases
> précédentes ont cartographié ce qui ne va pas. Ce document fait l'inverse, parce que c'est
> l'information qui décide de ce qu'on **étend** plutôt que de ce qu'on **refait**.
>
> **Même discipline qu'ailleurs, appliquée dans le sens favorable.** Un composant n'est « sain »
> que si quelque chose l'établit : un test qui l'exerce, un usage réel, une vérification faite ici.
> Une affirmation flatteuse non prouvée n'est pas un acquis, c'est une hypothèse — d'où la
> **cinquième catégorie**, `plausible`, où atterrit tout ce dont je n'ai pas la preuve. Elle n'est
> pas un purgatoire poli : trois composants importants y sont, et l'un d'eux porte la promesse
> commerciale du produit.
>
> Chiffres de référence, arbre `dbd22664` : suite backend **137 suites / 1812 tests / 0 échec**,
> plus **16 suites délibérément ignorées** (specs `.live` gatées par drapeau + credentials).
>
> ---
>
> **Dette de méthode, soldée sur le chemin français.** La première version de ce document classait
> les composants sur des **comptes de tests**, pas sur leur contenu. Un seul composant avait été lu
> — et c'est le seul où il avait fallu corriger, ce qui suffisait à disqualifier la méthode. Les
> **cinq composants du chemin français** ont depuis été relus au contenu : composition de deux
> profils, validation de format, chaînage générique, moteur `resolve()`, profils temporels. Une
> catégorie a bougé (§4.1, **4 → 3**), deux citations de preuve étaient fausses (§1.1, §1.2), et la
> relecture a mis au jour un défaut que le compte masquait : le régime des opérations françaises
> **transfrontalières** (§1.2). **Les douze autres composants restent classés sur des comptes** et
> doivent être lus avant d'être invoqués pour décider quoi que ce soit.

---

## 1. Sain et utilisable en l'état

### 1.1 Les profils temporels — le socle

`Temporal<T>` avec `validFrom`/`validTo` exclusif, 106 pays, résolution à date.

**Ce qui l'établit — après relecture du contenu, la première citation était fausse.** J'avais
avancé « 128 tests » comme une preuve de largeur. Elle n'en est pas une : `temporal.spec.ts` ne
compte que **5 tests**, et ils portent sur les fonctions `pickByDate`/`allByDate`, pas sur les
profils ; `coverage.spec.ts` déclare 4 tests dont un `it.each(codes)` qui répète **une seule**
assertion sur 106 pays ; `data-integrity.spec.ts` en a ~14, tous de bonne forme et d'intégrité
référentielle. Le total est réel mais il mesure surtout une propriété répétée cent six fois.

**La vraie preuve est ailleurs, et elle est meilleure.** `compliance-engine.spec.ts` contient quatre
tests dédiés à la **correction temporelle française**, au niveau du plan : FR→FR B2B après le mandat
(régime, canal PDP, artefacts CII + Factur-X, statuts obligatoires, rétention 10 ans), FR→FR B2B
avant le mandat (post-audit, e-mail seul), FR→FR B2C après le mandat, et la négative — FR→FR B2B ne
porte **pas** l'e-reporting B2C. C'est le chemin français vérifié de bout en bout, ce que
`temporal.spec.ts` ne fait pas.

S'y ajoutent : `coverage.spec.ts` **lit `documentation/compliance/*.md`** et échoue si un pays
documenté n'a pas de profil ; `data-integrity.spec.ts` échoue si une syntaxe ou un `providerId`
référencé ne résout pas. Ce sont des tests qui cassent quand la donnée dérive.

**La preuve la plus parlante n'est pas un test.** La dimension temporelle a piégé **mon propre
inventaire** : l'aplatir a produit deux findings faux (PL-D4, IT-D8), tous deux rétractés, parce
que la Pologne retire l'e-mail au 2026-02-01 et l'Italie au 2019-01-01. Un modèle assez précis pour
faire échouer un auditeur qui le simplifie est un modèle qui porte de l'information réelle.

**Utilisable pour la France telle quelle** : le profil FR encode déjà les deux périodes autour du
2026-09-01, régime, formats, canaux, cycle de vie et reporting compris.

### 1.2 Le moteur de résolution, côté fournisseur

`resolve(ctx) → CompliancePlan` : 9 dimensions de politique produites depuis les profils.

**Ce qui l'établit.** 5 specs, 58 tests — mais cette fois le contenu vaut mieux que le compte :
`compliance-engine.spec.ts` seul porte 17 tests, dont les quatre tests temporels français ci-dessus,
la délégation monégasque, le repli sur pays inconnu avec avertissement visible, et le croisement
canal Peppol × artefact sur cinq pays. Le moteur est aussi la seule voie d'accès du produit aux
règles : aucun chemin parallèle ne contourne les profils.

**Et la relecture a trouvé un défaut que le compte de tests masquait.** Aucun test n'assert le
`regime` d'une opération française **transfrontalière**. En sondant le moteur directement :

```
FR→FR B2B   regime=DECENTRALIZED_CTC   reporting=[]
FR→IT B2B   regime=DECENTRALIZED_CTC   reporting=[EC_SALES_LIST]      ← devrait être e-reporting
FR→US B2B   regime=DECENTRALIZED_CTC   reporting=[]                   ← devrait être e-reporting
```

Une facture transfrontalière est routée vers le régime **domestique**, canal PDP compris, alors que
l'art. 289 bis I réserve l'e-invoicing aux opérations entre parties **toutes deux établies** en
France. La catégorie 1 tient — le moteur fait correctement ce qu'on lui a demandé de faire — mais
ce qu'on lui a demandé est incomplet. C'est le sujet de `08-CORRIDOR-MODEL.md`.

### 1.3 Les registres de fournisseurs, comme architecture

Quatre couches de capacité derrière des registres : format, signature, transmission, archivage.

**Ce qui l'établit.** **63 specs** sous `providers/`, et la propriété structurelle qui compte :
ajouter une juridiction demande un profil et, au plus, une stratégie. `data-integrity.spec.ts` le
garde honnête en refusant un `providerId` qui ne résout pas.

*Réserve, et elle est sérieuse* : l'architecture est saine, **la couche format ne valide rien** —
voir §4.1. Ne pas confondre la forme et le contenu.

### 1.4 La file BullMQ

Six processors, jobs répétables, `jobId` déterministes pour la déduplication, aucun cron ni verrou
distribué.

**Ce qui l'établit.** 4 specs d'intégration sous `nest/queue/__tests__`, exécutées **en CI contre un
vrai Redis et un vrai Postgres** (job `queue-integration` de `cypress.yml`) — pas contre des
doubles. C'est le seul sous-système du dépôt dont l'infrastructure réelle soit exercée
automatiquement à chaque PR.

### 1.5 L'archivage et la signature

**Ce qui l'établit.** Archivage : 20 tests. Signature : 42 tests passants, 3 ignorés (TSA live).
Les deux couches ont des stratégies réelles et une registry testée.

*Réserve* : F-001 (un artefact vide traverse et est archivé) et F-010 (le reçu d'archivage n'est ni
vérifié ni persisté) restent ouverts. La mécanique tient ; ce qu'elle archive n'est pas contrôlé.

### 1.6 La réception (sens entrant)

Parseurs entrants, routeur, sink, service, gestion du P7M italien.

**Ce qui l'établit.** 21 tests. C'est proportionnellement l'un des modules les mieux couverts, et
il est **indépendant des credentials** : parser un document reçu ne demande aucune autorité.

---

## 2. Sain mais non branché

### 2.1 Les ports injectables — la couture qui n'a jamais été cousue

Chaque provider de transmission accepte un port HTTP injectable ; le registre de production
n'en passe jamais.

**Ce qui l'établit — dans les deux sens.** Que la couture **fonctionne** : les specs live de KSeF,
PDP et Peppol injectent un port réel et pilotent le vrai client. Qu'elle ne soit **pas branchée** :
`grep httpPort providers/transmission/registry.ts` ne renvoie rien — le registre ne passe que des
credentials (F-009).

**Ce qui manque pour l'activer** : par canal, un client HTTP réel et ses credentials, passés à la
construction. **Coût : faible par canal** — c'est une injection, pas une réécriture. Le coût réel
est ailleurs : obtenir les credentials.

**C'est le bon choix pour le PAC mexicain et pour un PDP français** : le fournisseur change, le
port change, le provider ne bouge pas.

### 2.2 Le runtime de cycle de vie — branché, jamais actionné par une autorité

**Rectification d'une affirmation courante, y compris de ma part** : `AWAIT_CALLBACK` et
`ARM_TIMER` **ne sont pas « jamais branchés »**. Ils sont émis par `runtime.ts`, consommés par
`apply-signal.ts` (6 sites), armés dans `ScheduledJob`/`CallbackRegistration`, projetés sur BullMQ
par `timer.processor.ts` et `poll.processor.ts`, et il existe des endpoints entrants réels :
`POST compliance/pdp/webhook` et `POST compliance/sdi/notifica`.

**Ce qui l'établit.** 13 specs `lifecycle/` + les 4 specs de file en CI ; `apply-signal-callback-
correlation.spec.ts` prouve qu'une registration est bien corrélée sur la **référence externe** de
l'autorité et qu'un message portant l'identifiant interne n'est **pas** apparié.

**Ce qui manque.** Aucune autorité ne l'a jamais actionné : pas de credentials, donc aucun webhook
réel n'est jamais entré. Le chemin est câblé et testé contre des doubles ; il n'est pas *éprouvé*.
**Coût pour l'éprouver : nul en code** — il faut un sandbox et une transmission qui aboutisse.

### 2.3 Le CAS de `transitionIfStatus`

`updateMany` conditionné au statut attendu : deux signaux concurrents, un seul écrit, le perdant
annule toute sa transaction.

**Ce qui l'établit.** Exercé par les doubles qui honorent le `WHERE`
(`apply-signal-reject-projection.spec.ts`, `-callback-correlation.spec.ts`), et par un test
déterministe de TOCTOU dans `apply-signal.live.spec.ts`.

**Ce qui manque.** Ce dernier est **gaté par `COMPLIANCE_LIVE_DB_TESTS`**, positionné uniquement
dans `compliance-live.yml`, qui est `workflow_dispatch`. **Il ne tourne donc jamais
automatiquement.** Le mécanisme lui-même a été vérifié contre un vrai Postgres 16.11 cette session,
mais sur la projection de facture, pas sur `transitionIfStatus`. **Coût pour le brancher : trivial**
— ajouter Postgres au job jest existant, qui provisionne déjà Redis.

---

## 3. Bon patron, à étendre

### 3.1 La composition de deux profils — le patron le plus important du dépôt

`determineTax(ctx, supplierProfile, vat, buyerProfile)` compose **deux** profils au lieu d'une
matrice N×N. C'est ce qui rend 106 pays tenables.

**Ce qui l'établit.** 58 tests dans `engine/`, dont `tax-matrix.spec.ts` qui exerce la composition
sur des corridors réels : autoliquidation SA→AE, livraison intra-union, GST indien, fournisseur
sans TVA (Qatar), et surtout **taux de destination OSS lu depuis le profil de l'acheteur** (FR→IT
B2C à 22 %) — c'est-à-dire la composition elle-même, pas seulement son résultat.

**Pourquoi le périmètre est trop étroit — chiffré.** `CompliancePlan` porte **9 dimensions**. Le
profil de l'acheteur n'en influence que **deux** : la fiscalité (composée pour de bon) et les
artefacts (via `mandatoryReceiveSyntax`, `compliance-engine.ts:187-190`). Les **sept autres** —
`regime`, `channels`, `numbering`, `lifecycle`, `archival`, `reporting`, `taxSystemKind` — sont
prises **du seul profil fournisseur**. C'est exactement F-017, et c'est le chemin critique : tant
que `regime` n'est pas composé, e-invoicing et e-reporting ne se distinguent pas, et la France
devra être codée deux fois.

**Confirmé par relecture, et la conséquence est chiffrable.** `US→FR B2B` fait bien produire par le
profil **acheteur** un artefact Factur-X de réception — la composition marche pour les artefacts.
`FR→IT B2C` prend le taux de destination italien lu dans le profil italien. Mais `FR→IT B2B` et
`FR→US B2B` reçoivent le régime **domestique** `DECENTRALIZED_CTC`, canal PDP compris, parce que
`regime` n'emprunte pas cette porte. La limite n'est pas théorique : elle produit un plan faux sur
deux des quatre flux français.

**À étendre, pas à refaire.** La signature est déjà la bonne ; c'est le nombre de dimensions qui
l'empruntent qui doit changer.

### 3.2 Le chaînage de hash espagnol — l'algorithme est une référence

L'algorithme de huella reproduit **les deux exemples chiffrés officiels de l'AEAT** (doc v0.1.2 du
2024-08-27), cas non chaîné et cas chaîné, **octet pour octet**.

**Ce qui l'établit.** `generators.spec.ts` assert les SHA-256 publiés par l'autorité, et
`verifactu-chain.spec.ts` (5 tests) vérifie qu'une suite de trois registres forme une chaîne
recalculable de bout en bout depuis les champs propres de chaque enregistrement.

**À étendre** : c'est le modèle de ce qu'un chaînage vérifiable doit être, et la France exige un
`hashChain` (profil FR, `numbering.hashChain: true`) qui n'a pas cette qualité de preuve — voir
§5.2.

### 3.3 L'événementiel comme projection

Le statut est une projection d'un journal append-only, pas une colonne mutée. Le patron est juste et
il vient de payer : le résiduel de F-008 a été réglé en ajoutant deux entrées de table et une
seconde direction, sans toucher à la machine à états.

**À étendre** : F-005 constate que le journal n'est **pas réellement append-only en base** — rien
n'empêche un `UPDATE`/`DELETE` sur `ComplianceEvent`. La promesse est architecturale, pas garantie
par le schéma.

---

## 4. À refaire

### 4.1 La couche de validation de format — **catégorie corrigée : 4 → 3 sur le chemin français**

**Ce que j'avais écrit** : « à refaire », sur la foi du chiffre mesuré — 54 syntaxes sur 54
déclarent `valid: true` pour un document de zéro octet, 49 sur 54 pour `<garbage/>`. Le chiffre est
juste. **La conclusion était trop large**, et la relecture du contenu des tests l'a montrée.

**Ce que la relecture établit.** Il existe de vraies portes de validation, avec tests positifs *et*
négatifs : XSD FatturaPA (`Schema_VFPR12.xsd`), XSD CFDI 4.0, et surtout — pour la France —
`providers.ts:171` fait passer l'artefact **`EN16931_CII` par le Schematron EN 16931**. Le test
négatif correspondant attrape BR-06 (nom du vendeur), BR-07 (nom de l'acheteur) et BR-16 (au moins
une ligne), avec au moins 8 erreurs sur un CII structurellement incomplet.

**Donc, sur le chemin français, la validation n'est pas à refaire : elle existe et elle mord.** Ce
qui reste est nommable en trois points, ce qui est le propre d'une catégorie 3 :

1. **Le court-circuit sur artefact vide.** `providers.ts:145` :
   `if (!rendered.bytes.length) return okValidation(…'stub path')`. Un artefact de zéro octet
   traverse build → validate sans objection, quelle que soit la syntaxe. C'est **un** endroit à
   retourner, pas 54.
2. **Factur-X n'est pas validé, honnêtement.** `rendered.bytes` est un PDF/A-3 ; extraire le XML
   embarqué n'est pas implémenté, et le code le dit plutôt que de faire semblant. Or Factur-X est la
   copie humaine française. Le défaut est réel, la posture est saine.
3. **Un test dont le nom ment.** `format-validation.spec.ts` contient
   `it('rejects completely empty XML')` qui assert `expect(result.errorCount).toBe(0)` — il
   **documente** que rien ne se déclenche, sous un nom qui affirme l'inverse. Un lecteur pressé y
   lit une garantie ; c'est un trou.

**Ce qui reste vraiment en catégorie 4** : les 42 providers de `national-formats.ts` qui renvoient
`{ valid: true, warnings: ['… (stub)'] }` quoi qu'on leur passe. Aucun n'est sur le chemin français.

### 4.2 L'infrastructure de test du frontend

Zéro runner — ni vitest, ni jest, ni `@testing-library/react` (F-019). Le seul filet est Cypress.

**Pourquoi refaire plutôt que compléter** : il n'y a rien à compléter. Et le coût de l'absence est
mesuré, pas supposé : cette session a livré **quatre défauts frontend qu'aucun test backend ne
pouvait voir** — la bannière sous la ligne de flottaison, le motif jamais récupéré, un remplacement
de texte silencieusement non appliqué, et le mappage statut→filtre qui faisait passer un statut
inconnu pour « envoyée ». Les quatre ont été trouvés par la **première** spec e2e écrite sur ces
écrans.

---

## 5. Plausible — non établi

> La catégorie que la discipline impose. Rien ici n'est réputé faux ; simplement, rien ne
> l'établit dans le dépôt, et je refuse une affirmation favorable non prouvée comme j'ai refusé
> les autres.

### 5.1 La maturité `PROVEN` des quatre canaux

`email`, `peppol`, `pdp` et `ksef` sont déclarés `PROVEN` dans le code.

**Ce qui manque.** `evidence/` ne contient que les reproductions de cet audit. **Aucun artefact de
réponse d'autorité n'est versionné** : pas d'UPO KSeF, pas de ricevuta SdI, pas d'accusé PDP, aucun
horodatage de dernier succès. Les dates de « dernier run réussi » n'existent que dans de la prose
(F-013). Cet audit ne les infirme pas — il constate qu'il ne peut ni les confirmer ni les dater, et
que `PROVEN` **n'est donc pas falsifiable en l'état**.

**Ce qui la ferait basculer en catégorie 1** : un artefact d'acquittement versionné, daté, par
canal. C'est peu de travail et cela change le statut de la promesse commerciale du produit.

### 5.2 Le chaînage de hash générique des documents

`compliance-service.ts:244-251` lit l'`immutableHash` du document précédent et le chaîne — donc,
contrairement au cas espagnol d'avant correction, **la chaîne est alimentée**.

**Ce qui manque — confirmé par relecture, la catégorie tient.** Le seul test qui l'approche assert
littéralement `expect(document.immutableHash).toBeDefined()`, dans un test dont le sujet est
l'interdiction d'éditer après émission.
Personne ne vérifie que la chaîne **relie** deux documents, ni qu'un recalcul reproduit la valeur
stockée. C'est précisément la propriété que `verifactu-chain.spec.ts` établit pour l'Espagne et que
le chaînage générique n'a pas. La France l'exige (`numbering.hashChain: true`).

### 5.3 L'isolation multi-tenant

95 usages de `@ActiveCompany`, services scopés par `companyId`, 28 clauses `where` scopées dans le
seul service de facturation.

**Ce qui manque.** La discipline est visible et constante, mais **rien ne l'impose** : aucun test ne
tente d'atteindre les données d'une autre société. Le seul filet est `15-multi-company.cy.ts`,
**4 tests**, qui vérifie la bascule de société — pas l'isolation. Une méthode de service qui
oublierait son `companyId` passerait.

**Ce qui la ferait basculer en catégorie 1** : un test qui tente explicitement la traversée et
échoue si elle aboutit.

---

## 6. Ce que cela dit pour la France B2B

Trois choses, dans l'ordre.

1. **Rien de fondamental n'est à refaire.** Le socle — profils temporels, moteur, registres, file —
   est en catégorie 1 avec des preuves. C'est un point d'appui, pas un chantier.
2. **Le chemin critique est §3.1**, la composition limitée à 2 dimensions sur 9. Tant que `regime`
   n'est pas composé, e-invoicing et e-reporting ne se distinguent pas — deux régimes disjoints,
   deux formats, deux horloges — et la France sera codée deux fois. C'est le sujet de
   `08-CORRIDOR-MODEL.md`.
3. **Deux dettes bloquent la France spécifiquement**, indépendamment du corridor : la validation de
   format (§4.1), sans quoi un rejet PPF n'est pas prévenu, et le chaînage générique (§5.2), que le
   profil FR exige et dont personne n'a vérifié qu'il chaîne.
