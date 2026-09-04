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
| HU | ✓ (enrichi : invoice.send legal §175(3)b) | — (canal fermé, B2G_COVERAGE) | ✓ (3/11 — §168(2)/170 cross-vérifié NAV EN) | ✓ (2/2 legal) | ✓ (5 entrées legal dont 27 % — le plus haut d'Europe) | Lot 4 ✅ |
| BE | ✓ | ✓ | ✓ (4/11 legal) | ✓ | ✓ (4 taux legal) | Lot 1 ✅ |
| NL | ✓ | — (NLCIUS : MIT, vendorable — DÉCISION ci-dessous) | ✓ (1/11 legal) | ✓ | ✓ (3 taux legal) | Lot 1 ✅ |
| AT | ✓ | — (ebInterface sans LICENSE, CIUS introuvable) | ✓ (1/11 legal) | ✓ | ✓ (3 taux legal) | Lot 1 ✅ |
| EE | ✓ | ✓ | ✓ (3/11 legal — texte PRIMAIRE via l'API riigiteataja) | ✓ | ✓ (4 taux legal) | Lot 2 ✅ |
| GR | ✓ | ✓ | ✓ (2/11 legal — forin.gr JSON brut) | ✓ | ✓ (3 taux legal) | Lot 2 ✅ |
| CY | ✓ | ✓ | ✓ (1/11 legal — cylaw texte brut) | ✓ | ✓ (4 taux legal) | Lot 2 ✅ |
| LT | ✓ | ✓ | ✓ (2/11 legal — e-tar texte brut) | ✓ (VAT+LEGAL_ID legal, CK 2.44) | ✓ (21/12/5 — le 9 % du brief était FAUX, corrigé par la loi + TEDB live) | Lot 3 ✅ |
| LV | ✓ | ✓ | ✓ (3/11 legal) | ✓ (LEGAL_ID legal — Komerclikums 17(1), clause FRONTALE) | ✓ (4 taux legal) | Lot 3 ✅ |
| LU | ✓ | ✓ | ✓ (3/11 legal — art. 63 §2 al.2, l'assimilation quasi-289 I 5°) | ✓ | ✓ (5 taux legal dont exemption 57bis) | Lot 3 ✅ |
| MT | ✓ | ✓ | ✓ (3/11 legal — /getpdf caché + pdftotext) | ✓ (VAT required UNIVERSEL ; LEGAL_ID honnêtement unverified — la loi distingue business letters/invoices) | ✓ (4 taux legal, 3 paliers réduits) | Lot 4 ✅ |
| SE | ✓ | ✓ | ✓ (3/11 — CREDIT_NOTE REQUIRED, 17 kap. 23§ « ska utfärdas ») | ✓ (organisationsnummer COMPANY-only, honnête) | ✓ (25/12/6 + EXEMPT ; pas de ZERO forcé) | Lot 4 ✅ |
| DK | ✓ | — (OIOUBL : licence floue, non vendorable — évalué) | ✓ (3/11 — kreditnota ET debit-note required) | ✓ (CVR unverified — CVR-loven non atteinte) | ✓ (25 % MONO-TAUX confirmé au texte) | Lot 5 ✅ |
| FI | ✓ | — (CIUS FI) | ✓ (négatif net : pas d'assimilation — CREDIT_NOTE allowed) | ✓ (Y-tunnus unverified — 4 niveaux tentés) | ✓ (25,5/13,5/10 — le 14 % du brief déjà remplacé au 1/1/2026, TEDB live confirme) | Lot 5 ✅ |
| IE | ✓ | — (CIUS IE multiples) | ✓ (5/11 legal — record : credit note ET corrective ET cancel-and-replace required, LEDGER_ANNOTATION 1re promotion du catalogue) | ✓ (CRO unverified — « invoice » absent des 5,7 M chars du Companies Act) | ✓ (5 taux dont le vrai zéro explicite et les décimales 13,5/4,8) | Lot 5 ✅ |
| BG | ✓ | — (CAIS EPP fermé) | ✓ (3/11 — les DEUX известия required чл. 115, le plus fort du catalogue) | ✓ (ЕИК legal chaîne à 3 lois PDF officiels) | ✓ (20/9/0 — vrai zéro intracommunautaire) | Lot 6 ✅ |
| CZ | ✓ | — (NEN fermé) | ✓ (4/11 — opravný doklad UNIQUE § 45, credit/debit forbidden-en-tant-que-distincts, LEDGER général) | ✓ (DIČ legal ; IČO ambigu § 435 NOZ) | ✓ (21/12 — la fusion 2024 citée sur l'état ACTUEL) | Lot 6 ✅ |
| HR | ✓ (Fiskalizacija 2.0 : e-račun B2B obligatoire 1/1/2026, consentement TOMBE) | — (circuit national, pas un CIUS vendorable — confirmé) | ✓ (5/11 — 1ers ANNOTATED_DUPLICATE et COUNTERPARTY_OBJECTION sourcés du catalogue) | ✓ (OIB required — clause frontale « računima ») | ✓ (25/13/5/0) | Lot 6 ✅ |
| PT | ✓ (régime certifié : DL 28/2019, ATCUD/QR 195/2020, signature chaînée 363/2010) | — (CIUS-PT) | ✓ (l'ASYMÉTRIE unique : DEBIT required / CREDIT allowed, même alinéa 78.º n.º 3) | ✓ (NIF required, format unverified — DL 463/79 muré) | ✓ (23/13/6 continent ; Madère/Açores en notes) | Lot 7 ✅ |
| RO | ✓ | — (RO_CIUS) | ✓ (CREDIT+DEBIT required art. 330(2)+287) | ✓ (CUI sans pattern — la loi ne le fixe pas) | ✓ (21/11/0 — la hausse du 1/8/2025 au texte) | Lot 7 ✅ |
| SI | ✓ (ZIERDED voté : applicable 1/1/2028 — lu au statut du portail) | — (e-SLOG) | ✓ (3/11 — assimilation 81. člen) | ✓ (davčna frontale « knjigovodske listine ») | ✓ (22/9,5/5) | Lot 7 ✅ |
| SK | ✓ (IS EFA voté : mandat 1/7/2030 — trois versions comparées) | — (IS EFA fermé) | ✓ (instrument unique § 71 + NO_DOCUMENT_BY_LAW § 25 ods. 3 — la divergence tchèque refusée en calque) | ✓ (IČ DPH ; § 3a = paire fermée sans facture) | ✓ (23/19/5 — réforme 278/2024 par diff de versions) | Lot 7 ✅ |
| AE + autres tax-only | — | — | — | — | — | à trier |

### 🏁 VAGUE B CLOSE (2026-09-05) — l'UE-27 complète + US/MX
29 pays dans country-policy, 28 en correction-routes, 26 en identifiers, 23 en vat-rates —
chaque fait sourcé au texte brut ou honnêtement unverified avec ce qui le trancherait. Sept
lots, sept batteries vertes, ~25 agents pays. Signal RO à traiter : RO-Romania.md (doc
compliance) affirme un « 5 Working Days » au 1/1/2026 qu'AUCUN texte lu ne corrobore — lecture
dédiée avant correction.

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
**Lot 4 (2026-09-04)** — MT : format du C-number introuvable (pattern omis), doctrine
CFR/MBR non atteinte (LEDGER_ANNOTATION vs NO_DOCUMENT_BY_LAW indécis) ; endpoint caché
legislation.mt /getpdf/<id> documenté (3e précédent SPA-cache-API). SE : Skatteverket non
tenté ; export = exonération, pas ZERO (structure signalée) ; personnummer d'entrepreneur
individuel non modélisé ; hausse votée 6→12 % alimentation au 1/1/2028 (Lag 2026:119)
documentée SANS anticipation. HU : njt.hu en TLS-reset — contourné par net.jogtar.hu (ancien
domaine officiel, HTML brut) ; formats adószám/cégjegyzékszám non sourcés au primaire ;
egyéni vállalkozó non recherché. VALIDATION : la mutation « un mot altéré dans la citation
§170 » ne mordait pas → tripwire verbatim ajouté (mord sur l'omission de mots — la classe
de risque de feedback-legal-raw-text, désormais testée).
**Lot 5 (2026-09-04)** — DK : retsinformation désassemblé (endpoints .rdfa et /dan/xml
LexDania — précédent SPA de plus) ; CVR-loven jamais atteinte (l'API de recherche ignore son
paramètre — 13 variantes testées) ; § 27 stk. 6 (créance 80 %) ne départage pas
LEDGER/NO_DOCUMENT. FI : le § 15 de l'yritys- ja yhteisötietolaki localisé mais corps
inaccessible (3 URL + pas de PDF) ; formats Y-tunnus/ALV empiriques (API PRH). IE : le
« debit note » irlandais est un FAUX-AMI documenté (il anticipe un avoir, n'augmente rien) ;
divergence temporelle du Revised Act sur le 9 % restauration (substitution en note
prospective seulement) consignée sans forcer ; format CRO introuvable.
**Lot 6 (2026-09-04)** — BG : la Правилник (règlement d'application) non atteinte ; le moteur
de recherche lex.bg cassé (contournement : liens directs ldoc/<id> de l'accueil, et les PDF de
registryagency.bg) ; la question de vocabulaire CANCEL_AND_REPLACE (« auprès de l'autorité » :
condition ou cas typique ?) remontée vers CORRECTION-ROUTES.yaml. CZ : l'API RDF/LOD
d'e-sbirka réelle mais fragmentée par alinéa (piste à scripter pour un futur agent) ; IČO
requis-sur-facture ambigu (§ 435 NOZ « obchodní listiny », « faktura » jamais nommée) ; format
IČO par recoupement. HR : doctrine Porezna uprava non consultée (LEDGER vs NO_DOCUMENT
indécis) ; le clearance JIR temps réel = tickets B2C, hors types du produit — à signaler si un
type « reçu de caisse » naissait.
**Lot 7 (2026-09-05)** — PT : DL 463/79 (création NIF) muré derrière la SPA du JO (format NIF
unverified) ; Listes I/II et décrets régionaux non atteints ; nouveau précédent
SPA-contournée-par-miroir-officiel (portaldasfinancas sert le CIVA article par article).
RO : legislatie.just.ro RST confirmé ; la convention static.anaf.ro/{TYPE}_{n}_{année}.pdf
documentée ; CUI sans pattern légal. SI : API pisrs.si (/api/rezultat/...) documentée ;
davčna številka sans nombre de chiffres légal. SK : static.slov-lex.sk (le noscript du portail
lui-même) — l'analogue de zakonyprolidi ; IČO délégué au ministère, non publié.
**Transverse** : la convention de specs diverge (BE dans les all.spec.ts partagés, NL/AT en
fichiers <cc>.spec.ts séparés) — les deux tiennent, réconciliation cosmétique un jour ;
WebSearch épuisé pour le lot (200/200), tout en WebFetch pur.
