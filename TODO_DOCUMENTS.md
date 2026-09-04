# TODO_DOCUMENTS — la couverture documentaire par pays (directive mandant, 2026-09-04)

> Verbatim mandant : « y'a des pays sans Policy (faut mettre un sub-agent par pays qui cherche
> tout ça et remplit les différents documents, il note dans un fichier de TODO genre
> TODO_DOCUMENTS si y'a des documents qui manquent à faire) ». Ce fichier est CE fichier de
> TODO : l'état par pays, et les manques consignés par les agents pays.
> Discipline inchangée (⚖ provenance ou refus de chargement, unverified jamais promu par
> raisonnement, mutations, batterie avant commit). Agents pays par LOTS de 3 (fichiers
> disjoints), validation mandataire par lot.

## Vague A — la doc elle-même (le générateur refondu) — feedback mandant intégral

> ✅ **FAIT** (2026-09-04) — émission EN + FR (i18n/fr/.../current/), table de chaînes à
> garde-fou de forme, glossaire 12 termes au survol, taxes multi-taux depuis vat-rates/ (le bug
> France corrigé : tax-systems/fr.json promu legal avec ses propres lectures), Identifiers en
> colonne, Mentions hors matrice. Piège trouvé : les sourceText des correction-routes mêlent
> analyse française et citations « … » — seul le contenu entre guillemets est extrait désormais
> (la phrase litmus du mandant ne fuit plus : grep zéro côté EN). jest 2229, mutation FR mordante,
> déterminisme deux runs.

1. **Langue** : la doc suit sa locale — le générateur émet EN dans docs/ ET FR dans
   i18n/fr/.../current/ ; les libellés (oui/non/restreinte, en-têtes, phrases d'explication)
   viennent d'une table de chaînes par locale, JAMAIS du prose des fichiers de données.
2. **Le prose des données ne fuit plus** : les notes/resolutionNotes (rédigées en français
   dans les data) ne sont PLUS déversées dans la doc — la doc rend des FAITS structurés
   (statut, source, date) dans la langue du lecteur ; les CITATIONS légales verbatim
   apparaissent dans un bloc « Source (langue originale) » clairement marqué — une citation ne
   se traduit pas, elle se cite.
3. **Colonne taxes refondue** : lire vat-rates/ ET tax-systems/ — TOUTES les catégories de
   taux du pays (normal/réduit/super-réduit/zéro/franchise…) avec la provenance PAR TAUX ;
   fini le taux unique. Corriger la donnée FR : tax-systems/fr.json est unverified alors que
   sa propre note documente les lectures directes (CGI 293 B, art. 278) — promouvoir en legal
   avec ces citations (⚖ : uniquement ce que la note documente déjà comme LU).
4. **Identifiers pour chaque pays** dans la matrice (colonne) et les pages pays.
5. **Mentions retirée de la matrice** (gardée en détail de page pays si présente).
6. **Pédagogie double lecture** : compréhensible par un novice ET utile à un pro — les termes
   techniques (B2G, CIUS, Peppol, EAS, Schematron, avoir, e-reporting, franchise…) portent une
   définition au survol (abbr/tooltip générés depuis un glossaire par locale dans le script).

## Vague B — un sub-agent par pays (par lots de 3)

Périmètre par pays : country-policy (les actions du vendeur, l'immutabilité), correction-routes
(les 11 voies), country-identifiers, vat-rates (toutes catégories), vérification channel-policy.
B2G : seulement si RÉELLEMENT livrable (CIUS officiel téléchargeable ET vendorable → le faire ;
sinon l'absence honnête reste, consignée ici — jamais un BIS générique contre une règle lue).
Tout ce qui n'est pas trouvé/atteignable : unverified avec ce qui trancherait + une entrée ici.

### État par pays (l'union de la matrice — 34)
| Pays | policy | b2g | correction | identifiers | vat-rates | Lot |
|---|---|---|---|---|---|---|
| FR DE IT PL ES MX US | ✓ | ✓ | ✓ | partiel | FR seul | — (compléter identifiers/vat-rates en vague B fin) |
| HU | ✓ | — | — | — | — | à venir |
| BE | ✓ | ✓ | ✓ (4/11 legal) | ✓ | ✓ (4 taux legal) | Lot 1 ✅ |
| NL | ✓ | — (NLCIUS : MIT, vendorable — DÉCISION ci-dessous) | ✓ (1/11 legal) | ✓ | ✓ (3 taux legal) | Lot 1 ✅ |
| AT | ✓ | — (ebInterface sans LICENSE, CIUS introuvable) | ✓ (1/11 legal) | ✓ | ✓ (3 taux legal) | Lot 1 ✅ |
| EE | ✓ | ✓ | ✓ (3/11 legal — texte PRIMAIRE via l'API riigiteataja) | ✓ | ✓ (4 taux legal) | Lot 2 ✅ |
| GR | ✓ | ✓ | ✓ (2/11 legal — forin.gr JSON brut) | ✓ | ✓ (3 taux legal) | Lot 2 ✅ |
| CY | ✓ | ✓ | ✓ (1/11 legal — cylaw texte brut) | ✓ | ✓ (4 taux legal) | Lot 2 ✅ |
| LT | ✓ | ✓ | ✓ (2/11 legal — e-tar texte brut) | ✓ (VAT+LEGAL_ID legal, CK 2.44) | ✓ (21/12/5 — le 9 % du brief était FAUX, corrigé par la loi + TEDB live) | Lot 3 ✅ |
| LV | ✓ | ✓ | ✓ (3/11 legal) | ✓ (LEGAL_ID legal — Komerclikums 17(1), clause FRONTALE) | ✓ (4 taux legal) | Lot 3 ✅ |
| LU | ✓ | ✓ | ✓ (3/11 legal — art. 63 §2 al.2, l'assimilation quasi-289 I 5°) | ✓ | ✓ (5 taux legal dont exemption 57bis) | Lot 3 ✅ |
| MT SE | — | ✓ | — | — | — | lot 4 |
| BG CZ DK FI HR IE PT RO SI SK | — | — | — | — | — | lots suivants |
| AE + autres tax-only | — | — | — | — | — | à trier |

### DÉCISION MANDANT EN ATTENTE — NLCIUS vendorable !
L'agent NL a établi que le NLCIUS est publiquement téléchargeable SOUS LICENCE MIT (dépôt
officiel peppolautoriteit-nl/validation : si-ubl-2.0.sch incluant les règles NLCIUS, LICENSE.txt
MIT © Stichting Simplerinvoicing) — ce qui ROUVRE le verdict « non livrable » de
B2G_COVERAGE.md : NL pourrait passer couvert en B2G (peppol + Schematron NLCIUS vendoré).
Chantier : vendorer, brancher un format nlcius (delta bloquant, le patron xrechnung),
b2g-routing/nl.json. À valider par le mandant.

### Manques consignés (lot 1, 2026-09-04)
**BE** : l'AR n°1 (29/12/1992) introuvable en texte primaire sur ejustice (ELI → page d'aide) —
l'art. 5 §1 (mentions) et l'art. 12 (rectificatif) connus via la reformulation officielle
d'efacture.belgium.be seulement ; CSA art. 2:20 §1 : seule la table des matières atteinte
(bloque la promotion legal du LEGAL_ID) ; format du n° TVA belge non sourcé au texte primaire ;
7/11 voies de correction unverified (pistes : Code TVA art. 44/77/79).
**NL** : 10/11 voies unverified — pas de clause générale néerlandaise d'assimilation (piste :
Uitvoeringsbeschikking OB 1968, doctrine Belastingdienst) ; invoice.save-draft = composition de
textes (art. 35a lid 1.b + doctrine), pas de clause frontale ; KOR (art. 25) non lue.
**AT** : RIS (portail officiel) en 503 systématique — tout lu via le miroir jusline.at
(recoupé) ; 20/22 policy et 10/11 voies unverified (UStR/findok inaccessibles — coquille JS) ;
patterns UID/Firmenbuchnummer non confirmés au texte primaire ; taux Jungholz/Mittelberg et
Kleinunternehmerregelung non modélisés (délibéré) ; ebInterface : AUCUNE LICENSE au dépôt
AUSTRIAPRO, CIUS AT introuvable en téléchargement — b2g reste correctement non livré.
**Lot 2 (2026-09-04)** — EE : Äriregistri seadus non localisée (trancherait le
registrikood-sur-facture) ; fausse divergence TEDB levée en validation (situationOn = date
d'observation, note corrigée). GR : ΓΕΜΗ derrière le paywall forin (Ν.4919/2022 art. 16/22),
9/11 voies unverified (le mur aade.gr), et le « art. 15A » cité par reporting/gr.json N'EXISTE
PAS dans le texte consolidé (la TOC saute de 15 à 16) — à savoir pour le chantier myDATA.
CY : les Κανονισμοί ΦΠΑ (règlements d'application) introuvables depuis cylaw — portent le
détail opérationnel (mentions, formats) ; Companies Law Cap. 113 non ouvert ; portails fiscaux
en 403/DNS-mort. TRANSVERSE MAJEUR : le fetch-résumé a FABRIQUÉ des articles (CY « 12A/12B »)
et omis des mots — règle « texte brut obligatoire » désormais en mémoire et dans tous les
briefs ; trouvailles méthode : l'API publique non documentée de riigiteataja
(/public-api/api/v1/en/akt/{id}/blob-html) et la route JSON de forin.gr, réutilisables pour
les futurs lots EE/GR.
**Lot 3 (2026-09-04)** — LT : formats numériques (PVM kodas, juridinio asmens kodas) non
sourcés en droit primaire ; e-seimas non fiable en saisie automatisée (clavier virtuel jQuery),
contournement e-tar documenté dans lt.json (setter natif JS + PrimeFaces.ab) ; le 9 % supposé
par le brief N'EXISTE PAS (12 % lu art. 19 §3, TEDB live convergent — re-vérifié par le
mandataire). LV : VID (fisc) en 404 partout ; format 11 chiffres du numéro d'immatriculation =
INFÉRENCE marquée et épinglée par spec ; loi du registre non localisée. LU : la disposition
d'ajustement de base (créance irrécouvrable) non localisée — LEDGER_ANNOTATION/NO_DOCUMENT_BY_LAW
unverified pour cette raison précise ; accès Legilux par SPARQL ELI documenté (réutilisable).
**Transverse** : la convention de specs diverge (BE dans les all.spec.ts partagés, NL/AT en
fichiers <cc>.spec.ts séparés) — les deux tiennent, réconciliation cosmétique un jour ;
WebSearch épuisé pour le lot (200/200), tout en WebFetch pur.
