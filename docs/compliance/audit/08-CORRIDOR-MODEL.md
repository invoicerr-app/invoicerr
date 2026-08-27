# 08 — Le corridor : note de conception

> Note de conception, **pas d'implémentation**. Rédigée le 2026-08-27, à partir de F-017 et des six
> vérifications de la phase 2. Aucun code n'est proposé ; ce document dit **quelle forme** doit
> prendre le modèle, et ce qu'il en coûte.

---

## 1. Ce qui est déjà juste, et qu'il faut étendre plutôt que remplacer

`engine/compliance-engine.ts` **résout déjà deux profils** : `s` pour le fournisseur, `b` pour
l'acheteur. Et `determineTax(ctx, sp, vat, bp)` les compose correctement — l'autoliquidation
intracommunautaire, l'exonération d'export et les indicateurs `EC_SALES_LIST` sortent justes de la
reproduction F-017.

**L'architecture « composer deux profils plutôt qu'une matrice N×N » est la bonne.** Elle n'a
simplement jamais été étendue au-delà de la couche fiscale — le commentaire de la ligne 91 le dit
lui-même : « Tax — the only step that reads both profiles deeply ». Cinq couches sur sept lisent
`sp` seul.

Cette note décrit comment étendre cette composition. Elle ne propose ni matrice, ni remplacement.

---

## 2. Un prédicat par couche d'obligation — jamais un booléen unique

C'est le point structurant, et l'Allemagne le démontre mieux que les cinq pivots : **le mot
« établi » n'a pas une seule définition, même à l'intérieur d'une seule loi.**

| Couche | Base allemande | Définition retenue |
| --- | --- | --- |
| Déclencheur d'**émission** | § 14 Abs. 2 S. 3 UStG | Sitz, Geschäftsleitung, **Betriebsstätte participante**, ou à défaut de Sitz : Wohnsitz / gewöhnlicher Aufenthalt |
| Obligation de **réception** | UStAE 14.1 Abs. 5 S. 1 ; BMF FAQ 12 | **unilatéral** — le seul destinataire établi |
| Localisation d'**archivage** | § 14b Abs. 3 UStG | **Zweigniederlassung**, et Wohnsitz **sans condition** |

Un unique `isEstablished(party, country)` ne peut pas servir les trois : il donnerait la même réponse
là où la loi en donne trois différentes.

**Forme proposée.** Chaque couche du plan porte son propre prédicat, résolu séparément :

```
issuanceTrigger      (supplier, buyer, supply) → OBLIGED | PERMITTED | FORBIDDEN
receptionObligation  (buyer)                   → OBLIGED | NOT_OBLIGED
archivalJurisdiction (supplier)                → { retention, residency, notificationDuty }
deliveryChannel      (placeOfSupply, buyer)    → ChannelSpec[]      // voir §4
reportingObligation  (supplier, buyer, supply) → ReportingKind[]
```

Le déclencheur lui-même devient **une donnée du profil**, au même titre que le régime ou
l'archivage — pas une règle câblée dans le moteur. Les six pays vérifiés donnent cinq pivots
différents :

| Pays | Déclencheur d'émission | Pivot |
| --- | --- | --- |
| France | bilatéral, cumulatif | les deux établis (art. 289 bis I) |
| Allemagne | bilatéral, conjonctif | les deux établis (§ 14 Abs. 2 S. 2 Nr. 1) |
| Italie | bilatéral pour le SdI, unilatéral pour c. 3-bis | résidents ou établis / le transmetteur |
| Pologne | **unilatéral** | le vendeur (art. 106ga ust. 2) |
| Espagne — Veri\*Factu | **unilatéral** | un **statut fiscal** du vendeur |
| Espagne — mandat B2B | **bilatéral** | **l'acheteur** (RD 238/2026 art. 3) |

Une stratégie unique est fausse quel que soit le choix retenu. Et l'Allemagne fournit le piège :
le **§ 14 Abs. 7 UStG** — l'art. 219 bis transposé — rend la résolution « fournisseur seul »
**correcte** lorsque le fournisseur n'est pas établi et que le preneur est redevable au titre du
§ 13b. Le moteur actuel y tombe juste, sans connaître la condition qui l'y autorise, donc il
appliquerait la même règle là où elle est fausse. Une règle juste par accident n'est pas une règle.

---

## 3. Le prédicat s'évalue sur la transaction, pas sur l'entité

La donnée manquante **n'est pas dans le profil pays. Elle est dans le document.**

La qualité d'établi se juge opération par opération — art. 7 c. 1 lett. d) du DPR 633/1972 :
« una stabile organizzazione nel territorio dello Stato […] **limitatamente alle operazioni da essa
rese o ricevute** ». Et l'UStAE 13b.11 précise ce que « participer » exclut : « **Nicht als Nutzung**
[…] gelten **unterstützende Arbeiten** […] wie Buchhaltung, Rechnungsausstellung oder Einziehung von
Forderungen ».

**L'Italie a déjà formalisé exactement cela.** Le bloc `StabileOrganizzazione` des spécifications
techniques n'est à renseigner que « nei soli casi in cui il cedente/prestatore è un soggetto non
residente ed effettua **la transazione oggetto del documento** tramite stabile organizzazione ». Le
format de l'autorité porte la donnée ; le modèle canonique n'a aucun emplacement pour elle.

Et une règle **auto-référentielle** doit être modélisée : porter sur la facture le numéro de TVA de
l'établissement stable **vaut présomption de participation** (UStAE 13b.11 Abs. 1 S. 6, art. 53 du
règlement 282/2011). Le numéro choisi décide de l'obligation qui pèse sur cette facture même.

> C'est pourquoi `establishmentCountry` a été **supprimé** plutôt que peuplé
> (`fix/remove-dead-establishment-country`) : un champ au niveau de la partie aurait modélisé la
> mauvaise chose de façon convaincante.

**Forme proposée** — porté par la transaction, pas par la partie :

```
TransactionContext {
  supplierEstablishment: { country, kind: SEAT | FIXED_ESTABLISHMENT | REGISTRATION_ONLY | NONE,
                           participatesInThisSupply: boolean }
  buyerEstablishment:    { … idem … }
  placeOfSupply:         ISO3166Alpha2      // art. 219 bis
}
```

`REGISTRATION_ONLY` est une valeur à part entière, pas un cas dégradé : c'est précisément celle que
l'AdE exclut du SdI (« i soggetti non residenti **meramente identificati** […] non sono tenuti alla
fatturazione elettronica ») et que le BMF autorise à justifier sur la facture qu'elle n'émet pas de
E-Rechnung.

---

## 4. Le canal de remise est un prédicat séparé de l'obligation d'émission

**La Pologne le démontre en les distinguant explicitement.** Le transfrontalier reste **dans** le
champ de l'émission — « Faktury dokumentujące np. WDT, eksport towarów […] są obowiązkowo wystawiane
w KSeF » — et l'extranéité est traitée à l'étape suivante : l'art. 106gb ust. 4 est une **disjonction
à six branches**, dont la première est purement géographique, imposant une remise « w sposób z nim
uzgodniony » assortie d'un code QR obligatoire.

Fusionner les deux en un test bilatéral unique est l'erreur de conception à éviter : elle ferait
sortir à tort les WDT et les exports du champ d'émission polonais.

Conséquences à modéliser :

- **Deux prédicats disjoints** : `mustIssueVia(channel)` et `mustDeliverOutOfBand(placeOfSupply, buyer)`.
- **Deux horloges de date de réception** : attribution du numéro KSeF pour un acquéreur ordinaire,
  réception effective hors KSeF pour ceux de l'art. 106gb ust. 4.
- Un flag **par facture**, pas par société : l'option KSeF d'un non-établi est révocable
  transaction par transaction.

---

## 5. La troisième couche n'existe pas du tout

Pour FR→IT, le plan ne porte du profil acheteur que `{ country: 'IT', confidence: 'OFFICIAL' }`. Il
n'existe **ni `buyerArchival`, ni `buyerObligations`**. L'archivage du plan est celui du fournisseur,
appliqué aux deux côtés.

Or les obligations du récepteur sont réelles, autonomes, et parfois asymétriques : l'Allemagne impose
la **réception** à toute entreprise établie **sans aucune exception** — Kleinunternehmer compris,
alors qu'ils sont dispensés d'émission — et le destinataire « **hat kein Anrecht auf eine alternative
Ausstellung** ». C'est une obligation unilatérale portant sur l'acheteur, que rien dans le plan ne
représente.

**Forme proposée** : le plan porte deux jeux d'obligations, `outbound` et `inbound`, résolus par des
prédicats distincts. C'est la seule des quatre propositions qui ajoute une **structure** au plan
plutôt qu'un champ.

---

## 6. Ce que cette note ne tranche pas

1. **Où vit la donnée d'établissement.** Elle doit être saisie quelque part — paramètres de société,
   fiche client, ou choisie par facture. Les trois ont des coûts d'UX très différents, et la règle
   auto-référentielle du § 13b (le numéro de TVA porté décide) suggère qu'elle est au moins
   partiellement **dérivable** plutôt que saisie.
2. **Comment l'émetteur constate l'établissement du destinataire.** La Pologne fournit un arbre de
   décision opposable (défaut « pas de SMPD » ; `oświadczenie` de l'acquéreur prévaut ; NIP polonais
   sans déclaration contraire = présomption). La France ne dit rien : l'annuaire sert au routage, pas
   à qualifier l'établissement. `open_question`.
3. **Si `placeOfSupply` doit être calculé ou saisi.** L'art. 219 bis en dépend, et son calcul est
   lui-même une machine à règles (art. 31 à 61 de la directive).
4. **La granularité temporelle.** Les déclencheurs sont datés — France au 2026-09-01 pour l'émission
   GE/ETI et au 2027-09-01 pour les PME. Les prédicats doivent être temporels comme le reste du
   profil, ce qui multiplie les périodes.

---

## 7. Coût estimé d'un modèle canonique modifié

Estimation d'ordre de grandeur, à confirmer par qui implémentera.

| Poste | Ampleur | Remarque |
| --- | --- | --- |
| `TransactionContext` + `PartyTaxProfile` | **modéré** | Ajout de champs ; le point dur est qu'ils doivent être **peuplés** depuis `invoices.helpers.ts`, donc saisis quelque part (voir §6.1) |
| Schéma de profil (`profiles/schema.ts`) | **modéré** | Un `trigger` par couche, temporel. 106 profils à migrer — mais 98 sont construits par archétypes, donc la migration porte surtout sur `archetypes.ts` et les 8 bespoke |
| `compliance-engine.resolve()` | **modéré** | Étendre la composition déjà présente pour la fiscalité aux autres couches ; la structure d'appel existe |
| Structure `inbound`/`outbound` du plan | **important** | C'est le seul changement qui touche la **forme** de `CompliancePlan`, donc l'exécuteur, la persistance (`plan` est stocké en JSON sur `ComplianceDocument`) et les projections |
| Saisie et UX de l'établissement | **inconnu** | Dépend entièrement de §6.1, non tranché ici |
| Migration des documents existants | **faible** | `ComplianceDocument.plan` est un snapshot historique ; les plans anciens restent lisibles s'ils sont versionnés |

**Le poste dominant n'est pas le moteur, c'est la saisie.** Le moteur sait déjà composer deux
profils ; ce qui manque est une information que personne ne demande aujourd'hui à l'utilisateur.
Tant qu'elle n'est pas collectée, tout prédicat sur l'établissement retombera sur une valeur par
défaut — et une valeur par défaut sur ce sujet est exactement ce que F-017 reproche au code actuel.
