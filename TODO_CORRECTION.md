# TODO_CORRECTION — les écrans de correction et d'annulation, pilotés par pays

> Directive mandant (2026-09-03) : « faut faire les écrans de correction/annulation (je suppose
> des "documents", pour rappel chaque pays a une façon de faire, faut bien que ça soit
> modulaire) ». Constat T6 qui l'a déclenchée : AUCUN écran dédié n'existe ; la seule voie
> visible est le save-draft bloqué par policy.
>
> **Discipline identique aux bords précédents** (voir TODO_PRODUIT.md en tête) : une tâche à la
> fois via sub-agent Sonnet briefé au maximum ; validation mandataire = tests unitaires ET e2e,
> mutations rejouées avec lieu de morsure vérifié, jest complet + batterie Cypress complète
> (Firefox, --config trashAssetsBeforeRuns=false) avant CHAQUE commit ; jamais git add -A ni
> git checkout sur un fichier modifié ; aucune dépendance npm nouvelle sans signalement ;
> ⚖ JAMAIS une règle fiscale inventée — provenance légale ou refus de chargement.

## État des lieux vérifié (2026-09-03, ne pas redécouvrir)

- **La donnée existe, sourcée** : `docs/compliance/CORRECTION-ROUTES.yaml` — 11 voies
  (CREDIT_NOTE, DEBIT_NOTE, CORRECTIVE_INVOICE, CANCEL_AND_REPLACE, INTERNAL_CREDIT_NOTE,
  AUTHORITY_ANNULMENT, RESUBMIT_SAME_IDENTITY, ANNOTATED_DUPLICATE, LEDGER_ANNOTATION,
  NO_DOCUMENT_BY_LAW, COUNTERPARTY_OBJECTION) × 7 pays pivots (FR IT PL DE ES MX US), chaque
  pays avec provenance/consulted/caveat/temporal. AUCUNE voie n'a le même statut partout
  (l'avoir interne : imposé FR/IT, interdit PL/ES/MX — c'est la raison d'être du mécanisme).
  `docs/compliance/CORRECTION-JURISDICTION.yaml` : la règle de juridiction (art. 219 bis),
  22/49 paires sourcées — la COMPOSITION vendeur×acheteur (P3-U02) n'est PAS écrite.
- **Le mécanisme code N'EXISTE PLUS** : `CorrectionRouteRule`/`correctionModel` vivaient dans
  l'ancien moteur (démoli, tag avant-refonte-documents). `modules/documents/` n'a RIEN pour les
  voies de correction. Le patron à suivre est celui des mécanismes pays existants :
  `country-policy/`, `b2g-routing/` (fichier par pays + provenance + gate de chargement +
  boot/lecture + refus honnête pour pays absent).
- **Ce qui est branchable tel quel** : INTERNAL_CREDIT_NOTE → la création d'avoir EXISTE
  (référence facture obligatoire, devise verrouillée T4-d, crédit au règlement T3).
  Le garde de ré-édition T4-c (save-draft re-résout la fiscalité) et les policies pays
  (FR : save-draft restreint à draft, art. 289 I.5) sont en place.
- **Les quatre gates maison** : 403 policy pays → 409 statut → 501 implémentation → 400
  validation. Une voie déclarée sans mécanisme implémenté = 501 NOMMÉ au clic, jamais cachée
  ni simulée.
- T6 a prouvé qu'aucune action cancel n'existe dans les 5 descripteurs et que le garde
  isActionAvailable ne fuiterait pas une action restreinte.

## C1 — Le mécanisme pays `correction-routes/` + l'API des voies par document

> ✅ **FAIT** (2026-09-03) — 7 pays × 11 voies transcrits du YAML (77/77 contre-vérifiés par
> le mandataire, zéro dérive ; open→allowed documenté ; unverified jamais promu ; sous-nuances
> consignées en notes, jamais une 12e voie), gate bidirectionnel (statut légal sans citation ET
> citation sous unverified refusés), lecture fichier (choix documenté), API GET correction-routes
> avec les 4 gates (404 type/document/pays nommé, 501 type ≠ invoice, 409 draft), implemented
> honnête (seule INTERNAL_CREDIT_NOTE), limitation P3-U02 citée. jest 2088, 4 mutations
> mordantes (3 mandataire + gate agent), batterie 251 verts (spec 43 nouvelle).

`modules/documents/correction-routes/` sur le patron b2g-routing : un fichier par pays
(`data/{fr,it,pl,de,es,mx,us}.json`) TRANSCRIT depuis CORRECTION-ROUTES.yaml en PORTANT sa
provenance (citation verbatim + source + date de consultation du YAML — le YAML est lui-même
sourcé, la transcription cite le YAML ET sa source primaire) ; schéma avec gate : une voie
sans provenance légale fait échouer le chargement ; specs de chargement + contenu épinglé
(l'inversion FR/PL sur l'avoir interne = le test canonique). Lecture par PAYS VENDEUR (celui
de la société) avec la LIMITE documentée : la composition vendeur×acheteur (P3-U02) n'existe
pas — consigner, jamais improviser. API : pour un document émis, `GET .../correction-routes`
rend les voies avec statut (required/allowed/forbidden), le libellé légal, et `implemented`
(mappé sur ce qui existe réellement). Pays sans fichier = refus honnête nommé.
**Accepte si** : les 7 pays chargent avec provenance ; un 8e inventé sans provenance refuse de
charger ; l'API rend l'inversion FR vs PL ; jest + un e2e API minimal.

## C2 — L'écran de correction

Sur une facture émise (sent/send_failed) : un bouton « Corriger » ouvre le dialogue des voies
de SON pays — chaque voie avec son statut et sa base légale (les mots de la provenance, pas un
résumé inventé) ; les interdites visibles mais désactivées AVEC leur raison (le patron
policyBlockedReason existant) ; choisir INTERNAL_CREDIT_NOTE (là où permise/imposée) mène à la
création d'avoir RÉELLE pré-liée à la facture (le mécanisme existant, rien de nouveau) ;
choisir une voie déclarée mais non implémentée → 501 nommé à l'écran (le gate maison), jamais
un stub qui fait semblant. i18n ; data-cy ; e2e : FR voit l'avoir imposé et aboutit à un avoir
pré-lié ; PL voit l'avoir interne INTERDIT avec sa raison ; un pays sans fichier voit le refus
honnête.
**Accepte si** : l'écran n'offre JAMAIS une voie que le pays interdit ; la voie branchée
aboutit au vrai mécanisme ; la non-implémentée dit 501 ; mutations sur le filtrage des voies.

## C3 — L'annulation

La voie d'annulation telle que la donnée la porte (AUTHORITY_ANNULMENT / NO_DOCUMENT_BY_LAW /
CANCEL_AND_REPLACE selon pays) : établir par la donnée quels pays ont une annulation REELLE et
implémentable aujourd'hui (sans canal autorité branché, l'annulation « par l'autorité » est
peut-être non-implémentable → 501 honnête) ; là où un statut local suffit et est sourcé,
l'action cancel entre dans le descripteur (lifecycle déclaré, restrictions de statut, webhook
DOCUMENT_* ? — trancher et documenter) avec son écran ; sinon consigner. Même exigences que C2.
**Accepte si** : aucun pays ne reçoit une annulation que sa donnée ne fonde pas ; e2e sur un
cas implémenté et un cas 501.

## Clôture du bord

Marquer ici, consigner les restes dans TODO_ISSUES.md (dont : composition vendeur×acheteur
P3-U02, pays non-pivots sans fichier), mémoire projet, appli qui tourne + identifiants.
