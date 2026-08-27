# 03 — Vérification juridique contre sources primaires (Phase 2)

> Six pays : ceux où le code prétend le plus — profils bespoke, `confidence: OFFICIAL`, schémas
> d'autorité vendorisés. Les 100 autres n'ont pas d'implémentation à confronter à une règle ;
> les sourcer serait un travail de documentation, pas d'audit.
>
> **Discipline de sourçage.** Sources primaires uniquement : administration fiscale nationale,
> journal officiel, spécification technique publiée par l'autorité. Documentation d'opérateur
> accrédité acceptée mais marquée `authority: "vendor"`. Blogs, cabinets, éditeurs : jamais.
> Chaque règle porte son URL, sa date de consultation, sa date d'entrée en vigueur et son statut.
> **Ce qui n'a pas été établi reste `open_question` — jamais une valeur plausible.**
>
> **Toutes les consultations : 2026-08-27.**
>
> Méthode : un agent par pays, questionnaire identique, chacun confronté à ce que le profil du
> logiciel affirme. Les affirmations porteuses ont ensuite été **recontrôlées directement** ; les
> recontrôles sont signalés par ✓✓.

---

## FRANCE

### Sources

Dossier de spécifications externes de la facturation électronique (DSE) **v3.2 du 2026-04-30**,
publié par l'AIFE/DGFiP — [page d'autorité](https://www.impots.gouv.fr/specifications-externes-b2b),
archive `specifications-externes-v3.2.zip` (Document général v3.2, DSE Chorus Pro v1.1, Annexe 1
format sémantique v1.2, Annexe 2 CDV v2.3, Annexe 7 règles de gestion v1.9). Légifrance et BOFiP
pour le droit dur.

### Calendrier ✓✓

Recontrôlé directement sur [economie.gouv.fr](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises)
et [impots.gouv.fr](https://www.impots.gouv.fr/professionnel/je-passe-la-facturation-electronique)
(page modifiée le 2026-07-10), consultés le 2026-08-27 :

| Obligation | Périmètre | Date | Statut |
| --- | --- | --- | --- |
| **Réception** | **toutes** les entreprises, quelle que soit la taille | **2026-09-01** | en vigueur dans 5 jours |
| **Émission** | grandes entreprises, ETI, membres d'un assujetti unique | **2026-09-01** | idem |
| **Émission** | PME, TPE, micro-entreprises | **2027-09-01** | annoncé |

Les micro-entrepreneurs et les entreprises en franchise de TVA sont dans le champ, en réception
comme en émission.

**Réserve** : l'alinéa final de l'art. 1737 CGI autorise un décret à repousser l'application
« sans pouvoir être postérieure au 1er décembre 2026 ». **Aucun décret publié au 2026-08-27.**
À re-vérifier avant toute mise en production.

### Règles établies

| # | Règle | Source | Entrée en vigueur | Statut |
| --- | --- | --- | --- | --- |
| 1 | Correction par **facture rectificative (384)** OU **avoir (381)** — les deux voies sont ouvertes ; les autres types UNTDID 1001 sont interdits | DSE Annexe 7 v1.9, règle G1.01 ; DSE Chorus Pro §3.4.2.2 citant AFNOR XP Z12-014 | 2026-09-01 | en vigueur |
| 2 | Troisième voie : **avoir interne**, non transmis à l'acheteur et **ne devant générer aucun flux F1** vers le PPF | DSE général §3.6.4 | 2026-09-01 | en vigueur |
| 3 | Le contenu d'une facture émise est **intangible** — aucune opération d'annulation n'existe dans le circuit | DSE Chorus Pro §2.4.2 | 2026-09-01 | en vigueur |
| 4 | Authenticité / intégrité / lisibilité par **quatre moyens alternatifs** : piste d'audit fiable, signature électronique qualifiée, EDI, cachet électronique qualifié | [CGI art. 289, VII](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006191855) | — | en vigueur, **abrogé au 2027-01-01** |
| 5 | **Aucun identifiant d'État n'est attribué à la facture.** L'unicité se calcule : numéro de facture + SIREN fournisseur + année | DSE §3.6.8 note 109 | 2026-09-01 | en vigueur |
| 6 | Quatre statuts obligatoires : **200 Déposée, 210 Refusée, 212 Encaissée** (sous conditions art. 290 A CGI), **213 Rejetée** | DSE §3.6.4 tableau 8 ; Annexe 2 | 2026-09-01 | en vigueur |
| 7 | Délai de **24 h** — pour le flux F1 à compter de l'horodatage du statut « Déposée », et pour les flux de cycle de vie à compter de l'horodatage du statut | DSE §3.6.5 et §3.6.6 | 2026-09-01 | en vigueur |
| 8 | Conservation **fiscale : 6 ans**. Les documents établis ou reçus sur support informatique **doivent être conservés sous cette forme** ✓✓ | [LPF art. L102 B](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000041471233/) — version en vigueur 2023-01-01 → 2027-01-01 | — | en vigueur |
| 9 | Conservation **commerciale : 10 ans** pour les documents comptables et pièces justificatives | [C. com. art. L123-22](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006219327/) | — | en vigueur |
| 10 | **Localisation** : stockage en France sauf accès en ligne immédiat, complet, avec téléchargement et utilisation ; interdiction dans un pays sans convention d'assistance mutuelle ; **le lieu de stockage doit être déclaré** et tout changement signalé | [LPF art. L102 C](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006069583/LEGISCTA000006147333/) | — | en vigueur |
| 11 | Numérotation « **basée sur une séquence chronologique et continue** » | [CGI ann. II art. 242 nonies A, 7°](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046086694/) | — | en vigueur |
| 12 | Identifiant de facture : **35 caractères max**, alphanumériques, spéciaux limités à espace `-` `+` `_` `/`, sans espace en tête/fin ni consécutif | DSE Annexe 7 v1.9, règle G1.05 | 2026-09-01 | en vigueur |
| 13 | Socle de formats : **UBL, CII et Factur-X**. Mais le flux F1 vers le PPF n'accepte que **UBL 2.1 ou CII D22B** — pas Factur-X | DSE §2.3.10 et §3.6.3 | 2026-09-01 | en vigueur |
| 14 | Mentions nouvelles : appartenance à un assujetti unique (5° bis), **catégorie d'opération biens/services (8° bis → BT-23, 1..1)**, option paiement TVA sur les débits (11° bis) ; **adresse de livraison (7° bis → BG-15) à compter du 2027-09-01** | [CGI ann. II art. 242 nonies A](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046086694/), décret n° 2024-1195 du 2024-12-21 | 2026-09-01 / 2027-09-01 | en vigueur / annoncé |
| 15 | Sanctions : omission ou inexactitude **15 €** par mention (plafond ¼ du montant) ; défaut d'émission électronique **50 €/facture**, plafond 15 000 €/an ; refus de recourir à une plateforme agréée **500 €** puis **1 000 €** par trimestre | [CGI art. 1737](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046869201) (mod. LOI n° 2026-103 du 2026-02-19) | 2026-09-01 | en vigueur |

### Divergences avec le code — France

Classées par gravité. « Le code est faux » signifie : le profil affirme quelque chose que la source
primaire contredit.

**FR-D1 — `canaux: EMAIL` est illicite dans le champ B2B domestique. ✓✓**
À compter du 2026-09-01, « seule une plateforme agréée est habilitée à assurer toutes les
fonctionnalités prévues » ; l'émission, la transmission et la réception passent par une plateforme
agréée. L'e-mail n'est pas un canal licite pour une facture dans le champ. Sanctions : 50 €/facture,
puis 500 € et 1 000 €/trimestre. Le profil FR déclare pourtant `EMAIL` parmi ses canaux — et
l'inventaire montre que c'est, avec PDP et Peppol, l'un des seuls réellement joignables.
*(Terminologie : « PDP » est périmé ; le terme officiel depuis la LF 2026 est **plateforme agréée**.)*

**FR-D2 — `correctionModel: CREDIT_NOTE` seul : le code est faux.**
G1.01 autorise **Facture rectificative (384)** au même titre qu'**Avoir (381)**, et le modèle
sémantique porte BG-3 « facture antérieure qui doit être **rectifiée** ou faire l'objet d'une facture
d'avoir ». Un moteur qui ne sait émettre qu'un avoir ne peut pas représenter la voie rectificative.

**FR-D3 — l'avoir interne est ignoré : risque de sur-déclaration.**
Sur statut « Refusée » ou « Rejetée », l'annulation comptable se fait par avoir interne, qui
« **ne doit pas générer de flux de données réglementaires (F1) au PPF** » et ne doit pas être
transmis à l'acheteur. Un code qui émet systématiquement un avoir *via* la plateforme transmet à
l'administration précisément dans le cas où la spécification l'interdit.

**FR-D4 — contrainte de localisation absente : lacune de conformité réelle.**
LPF L102 C impose France / pays sous convention avec accès en ligne, **et impose de déclarer le lieu
de stockage**. Le profil FR ne déclare aucune contrainte de résidence
(`10y/BOTH/HASH_CHAIN`, sans `residency`). C'est la divergence la plus opérationnelle pour un
hébergement SaaS ou self-hosted hors de France.

**FR-D5 — `integrity: HASH_CHAIN` n'a aucune base légale française.**
L'art. 289 VII offre quatre moyens alternatifs ; le chaînage de hash n'en fait pas partie. La seule
« inaltérabilité » du droit fiscal français est celle de l'art. 286, I-3° bis, dont le champ est le
**logiciel de caisse enregistrant des règlements de clients particuliers** — obligation distincte,
amende de 7 500 €. Le profil applique donc une contrainte qui n'existe pas, et n'implémente aucun des
quatre moyens qui, eux, existent.

**FR-D6 — `mandatoryReceiveSyntax: FACTURX` : le code est faux, deux fois.**
Le socle compte **trois** formats (UBL, CII, Factur-X) et la plateforme de réception doit convertir
vers un autre format du socle à la demande du client : rien n'impose Factur-X en réception.
Symétriquement, le PPF **n'accepte pas** Factur-X pour le flux F1 — UBL 2.1 ou CII D22B uniquement.

**FR-D7 — BT-23 « Cadre de facturation » manquant, cardinalité 1..1.**
Traduction machine de la mention statutaire 8° bis, obligatoire dès le 2026-09-01, valeurs
limitatives (`B1`, `S1`, `M1`, `B2`/`S2`/`M2`, `B4`/`S4`/`M4`, `S5`, `S6`, `B7`/`S7`). Une facture
sans BT-23 valide échoue aux contrôles fonctionnels du PPF.

**FR-D8 — contrainte de format du numéro non implémentée, et bloquante.**
G1.05 : 35 caractères maximum, spéciaux restreints à espace `-` `+` `_` `/`. Un générateur émettant
`#`, `.` ou un identifiant plus long fera **rejeter le flux F1**. À rapprocher de F-002 : la
numérotation est déjà le point faible du système.

**FR-D9 — `archival: 10 ans` : approximatif et mal fondé. ✓✓**
La durée **fiscale** est de **6 ans** (LPF L102 B) ; les 10 ans relèvent du **droit commercial**
(C. com. L123-22). 10 ans est une enveloppe prudente, mais l'étiqueter comme la règle fiscale est
faux et empêche tout raisonnement correct sur les deux échéances. La contrainte réellement
structurante — conserver le **format d'origine** — n'est, elle, pas modélisée.

**FR-D10 — `REAL_TIME_REPORTING` est inexact.**
Le régime n'est pas temps réel : **24 h** à compter de l'horodatage du statut, avec allotissement.
En revanche `non bloquant` est **correct** : le PPF n'exerce aucun clearance, il ne peut qu'accepter
(250) ou rejeter (251) les données réglementaires **après** émission, sans effet sur la validité de
la facture.

**FR-D11 — `cancellationAllowed: true` à nuancer.**
Aucune annulation d'une facture émise n'existe. Il existe un **statut** 220 « Annulée », inter-
plateformes, signifiant « remplacée par une facture rectificative » et **non transmis à
l'administration**, plus l'annulation comptable par avoir interne. En revanche
`immutableAfter: ISSUE` est **exact et bien fondé** — c'est l'un des rares points où le profil dit
juste.

**FR-D12 — granularité temporelle absente : le blocage serait sur-strict. ✓✓**
L'obligation d'**émission** au 2026-09-01 ne vise que GE, ETI et membres d'un assujetti unique ;
PME/TPE/micro n'émettent qu'au **2027-09-01**. Seule la **réception** est universelle au 2026-09-01.
Un profil qui bloque l'émission de toute entreprise française au 2026-09-01 serait plus strict que
la loi. De même, l'adresse de livraison (BG-15) est CIBLE au 2027-09-01, pas au démarrage.

**FR-D13 — obsolescence programmée des références.**
Les articles 289 et 289 bis CGI sont **abrogés au 2027-01-01** par l'ordonnance n° 2025-1247 du
2025-12-17 (recodification TVA vers le CIBS), certaines dispositions étant maintenues jusqu'à reprise
réglementaire. Les profils étant temporels, la bascule de référence devra être portée.

### Ce que le code fait juste — France

À signaler, parce qu'un audit qui ne relève que les fautes est un mauvais audit :

- `immutableAfter: ISSUE` est exact et correspond au principe d'intangibilité du DSE ;
- `GAPLESS_SELF` est exact : 242 nonies A, 7° exige bien une séquence chronologique **et** continue,
  sanctionnée par l'art. 1737, II ;
- `regimeBlocking: false` est exact : le PPF n'exerce aucun clearance ;
- l'architecture par canal PDP — se raccorder à une plateforme agréée tierce — est le seul chemin
  praticable sans immatriculation DGFiP (voir `04-TESTABILITY.md` §2).

### Open questions — France

1. Délai légal d'émission d'un avoir ou d'une facture rectificative après la facture initiale.
2. Consentement de la contrepartie pour une facture rectificative.
3. Fenêtre de forclusion au-delà de laquelle une rectification n'est plus possible.
4. Texte désignant **ce qui fait foi** en contrôle — aucun texte identifié ne consacre un document
   unique ; le faisceau semble être facture + piste d'audit fiable (289 VII) + CDV 200 horodaté.
5. Obligation et durée de conservation des messages de cycle de vie et accusés de plateforme ;
   qualification en « pièces justificatives » au sens de L102 B non tranchée.
6. Format d'archivage imposé (XML natif seul, XML + PDF, PDF/A-3). Seule règle sûre : conservation
   du **format d'origine**.
7. **AFNOR XP Z12-012 / 013 / 014 sont payantes et n'ont pas été consultées.** Tout ce qui précède à
   leur sujet provient de leur citation par le DSE Chorus Pro v1.1. Elles portent la liste complète
   des statuts (dont 220, 224, 225, 227, 228) et les cas d'usage de correction.
8. Décret de report au 2026-12-01 (art. 1737, dernier alinéa) — aucun publié au 2026-08-27.
9. Mise à jour post-réforme de la doctrine d'archivage BOI-CF-COM-10-10-30, datée du 2012-09-12 et
   donc antérieure au dispositif.

---

---

## POLOGNE

### Sources

*Podręcznik KSeF 2.0, Cz. II — Wystawianie i otrzymywanie faktur*, MF, **état du droit au
2026-02-01** ; ustawa du 2025-08-05 (**Dz.U. 2025 poz. 1203**) et du 2023-06-16 (**Dz.U. 2023 poz.
1598**) via `eli.gov.pl` ; **spécification OpenAPI de production** `api.ksef.mf.gov.pl/docs/v2/openapi.json` ;
broszura FA(3) ; pages `ksef.podatki.gov.pl`.

### Assujettissement échelonné — non modélisé par le profil

| Date | Règle | Statut |
| --- | --- | --- |
| 2026-02-01 | Émission obligatoire si vente TTC 2024 **> 200 000 000 zł** ; **réception obligatoire pour tous** | en vigueur |
| 2026-04-01 | Émission obligatoire pour **tous les autres** | en vigueur |
| 2026-04-01 → 2026-12-31 | Dérogation si vente TTC **≤ 10 000 zł/mois**, perdue dès la facture qui dépasse le seuil (art. 145m) | en vigueur, expire |
| 2026-02-01 → 2026-12-31 | Factures de caisse hors KSeF (art. 145n) | en vigueur, expire |
| 2027-01-01 | Sanctions art. 106ni ; numéro KSeF obligatoire dans les paiements MPP | annoncé |

### Règles établies

| # | Règle | Source | Statut |
| --- | --- | --- | --- |
| 1 | **Aucune annulation n'est possible** après attribution d'un numéro KSeF ✓✓ — « Faktura po przyjęciu do KSeF staje się dokumentem prawnym i nie można jej zmieniać » | [ksef.podatki.gov.pl Q&R](https://ksef.podatki.gov.pl/pytania-i-odpowiedzi-ksef-20/) ; Podręcznik §1.6.3 | en vigueur |
| 2 | Fichier **rejeté ⇒ la facture n'a jamais été émise** ✓✓ — « Nie można więc wystawić faktury korygującej ani anulować faktury ». On corrige le XML et on **renvoie sous le même numéro `P_2`** | idem ; Podręcznik §1.6.7 | en vigueur |
| 3 | Seule voie de correction : la **faktura korygująca**. La *nota korygująca* est **supprimée depuis le 2026-02-01** | Podręcznik §1.6.2 | en vigueur |
| 4 | **Consentement de l'acheteur non requis** pour une korygująca structurée (art. 29a ust. 13 nouvelle rédaction ; ust. 15 pkt 5 abrogé) | Dz.U. 2023 poz. 1598 | en vigueur 2026-02-01 |
| 5 | Date d'émission = **date de transmission** à KSeF si elle coïncide avec `P_1` (art. 106na ust. 1) — **pas** la date d'attribution du numéro. `P_1` au futur ⇒ **rejet** | Podręcznik §1.4 | en vigueur |
| 6 | Le **numéro KSeF n'est pas un champ de la facture** ; il est restitué dans l'**UPO** | Podręcznik §4.1 | en vigueur |
| 7 | Archivage **10 ans par KSeF**, art. 112aa : « art. 112 i art. 112a **nie stosuje się** » — le contribuable **est dispensé** de conserver ✓✓. Suppression automatique au terme, sans récupération | Podręcznik §7 ; Q&R | en vigueur |
| 8 | Trois modes offline permanents : **offline24** (libre choix, envoi J+1 ouvrable), **niedostępność** (J+1 après fin), **awaryjny** (7 jours ouvrables) | art. 106nda / 106nh / 106nf | en vigueur |
| 9 | Anti-doublon sur (NIP vendeur, `P_2`, `RodzajFaktury`), **10 ans en arrière** ⇒ code `440` | Podręcznik §3.4 | en vigueur |
| 10 | KSeF **ne vérifie pas l'arithmétique** : « Nie odrzuci faktury w przypadku wystąpienia na niej błędów rachunkowych » | Podręcznik §1.6.2 | en vigueur |
| 11 | Numérotation : « kolejny numer nadany w ramach **jednej lub więcej serii** » — seule l'**unicité** est contrôlée ; la transmission dans le désordre n'est **pas** un motif de rejet ni de korygująca | art. 106e ust. 1 pkt 2 ; Podręcznik §1.6.7 | en vigueur |

### Divergences avec le code — Pologne

**PL-D1 — `cancellationAllowed: true` : le code est faux. La divergence la plus grave. ✓✓**
« W KSeF nie jest możliwe anulowanie wystawionej faktury » — jamais, quelle que soit l'erreur, et
l'assujetti ne peut pas non plus supprimer la facture. La substitution passe par une korygująca
« do zera » suivie d'une nouvelle facture primitive. Permettre une annulation produit un état
juridiquement inexistant côté autorité.

**PL-D2 — `correctionModel: CREDIT_NOTE + CORRECTIVE_INVOICE` : le code est faux.**
Seule la **faktura korygująca** existe ; il n'y a pas de note de crédit distincte en droit polonais,
et la *nota korygująca* est abrogée depuis le 2026-02-01. La branche `CREDIT_NOTE` produit un
document non conforme.

**PL-D3 — `primarySyntaxes: PLAIN_PDF + FA_VAT` : le code est faux deux fois.**
L'unique syntaxe légale d'émission est **FA(3)** (`kodSystemowy "FA (3)"`, `wersjaSchemy 1-0E`) depuis
le 2026-02-01 ; « FA_VAT » / FA(2) est périmé. Le PDF n'est jamais une syntaxe primaire : c'est une
visualisation pour les acquéreurs de l'art. 106gb ust. 4, qui doit alors porter un code QR.

**PL-D4 — RETIRÉ. C'était un faux positif de mon instrumentation.**

*Le profil polonais est correct.* Il déclare `EMAIL` **jusqu'au 2026-02-01 seulement**, puis
uniquement `GOV_PORTAL_API:ksef` — ce qui est exactement la règle. L'erreur venait de mon
inventaire, qui aplatit **délibérément toutes les périodes temporelles**, y compris révolues, et
présentait donc un canal abandonné comme un canal déclaré.

Reste vrai et non affecté : KSeF est le seul canal d'émission légale, et l'e-mail n'est qu'un mode
convenu de mise à disposition pour les acquéreurs de l'art. 106gb ust. 4.

**PL-D5 — `archival: 10y / BOTH / SIGNED` : durée juste, tout le reste faux. ✓✓**
Les 10 ans sont exacts (art. 112aa) mais **à la charge de KSeF**, le contribuable en étant dispensé.
Aucune obligation de conserver un PDF. La facture XML **n'est pas signée** : l'intégrité vient de
KSeF, et l'empreinte SHA-2 256 bits figure dans l'UPO. **Obligation résiduelle non modélisée** : si
la prescription dépasse les 10 ans, il faut extraire les factures **avant** leur suppression
automatique.

**PL-D6 — `reporting: aucun` : le code est incomplet.**
Depuis les déclarations de février 2026, `JPK_V7M(3)` / `JPK_V7K(3)` exigent le **numéro KSeF de
chaque facture de vente et d'achat**. Cela impose de persister le numéro KSeF **dans les deux
directions**, émission comme réception.

**PL-D7 — `numbering: GAPLESS_SELF` : sur-contrainte.**
La loi exige « kolejny numer […] w ramach jednej lub więcej serii » ; le ministère tolère
explicitement la transmission dans le désordre **sans korygująca**, et KSeF ne contrôle que
l'**unicité**. Un gapless strict côté client forcerait des corrections inutiles. *(« sans chaînage de
hash » est en revanche correct.)*

**PL-D8 — `requiredIdentifiers: LEGAL_ID + VAT` : sur-contrainte et modèle incomplet.**
Côté vendeur, FA(3) n'exige que **NIP + Nazwa + Adres** — aucun KRS/REGON sur la facture. Côté
acheteur, il faut modéliser **quatre cas exclusifs** : `NIP`, `KodUE`+`NrVatUE`, `KodKraju`+`NrID`,
ou **`BrakID="1"`**. Un identifiant mal placé fait que la facture n'est **pas délivrée à l'acquéreur,
silencieusement**.

**PL-D9 — lacunes entières.** Les trois modes offline et leurs délais ; le certificat KSeF `Offline`
et les deux codes QR ; le rejet si `P_1` est au futur ; l'anti-doublon sur 10 ans ; la *korekta
techniczna* ; la procédure NIP acheteur erroné (korekta à zéro **sur le NIP erroné**, puis nouvelle
facture — corriger le NIP est explicitement interdit) ; les statuts par facture (`200` seul succès,
`550` retryable, `440` doublon).

### Ce que le code fait juste — Pologne

`regimeBlocking: true` est **exact** : pas de numéro KSeF, pas de facture. `hashChain: false` est
exact. Et le fait que KSeF **ne valide pas l'arithmétique** confirme qu'un `CLEARANCE` ne dispense
d'aucun contrôle applicatif — le profil ne prétend pas le contraire.

---

---

## ALLEMAGNE

### Sources

`gesetze-im-internet.de` (UStG, UStDV, AO, ERechV) ; BMF — FAQ E-Rechnung **Stand März 2026**,
BMF-Schreiben du **2025-10-15** (GZ III C 2 - S 7287-a/00019/007/243) introduisant le nouvel UStAE,
BMF-Schreiben GoBD du **2025-07-14** ; KoSIT / xeinkauf.de pour XRechnung **3.0.2**.

### Calendrier B2B

Déclencheur : **les deux parties établies en Allemagne** (§ 14 Abs. 2 Satz 3). Une simple
immatriculation TVA allemande ne suffit pas.

| Phase | Date | Contenu | Statut |
| --- | --- | --- | --- |
| **Réception** | **2025-01-01** | Toute entreprise établie en DE doit pouvoir recevoir. **Aucune exception, aucun seuil** — Kleinunternehmer inclus | en vigueur |
| Tolérance émission | → **2026-12-31** | Papier, ou autre format électronique avec accord du destinataire (§ 27 Abs. 38 Nr. 1) | en vigueur |
| **Émission** | **2027-01-01** | Obligatoire si `Gesamtumsatz` N-1 **> 800 000 €** | annoncé, dans 4 mois |
| Tolérance PME | → **2027-12-31** | `Gesamtumsatz` N-1 ≤ 800 000 € (Nr. 2) ; EDI 94/820/EG avec accord, sans condition de CA (Nr. 3) | en vigueur |
| **Obligation générale** | **2028-01-01** | Plus aucune dérogation | annoncé |

**Aucun régime CTC, aucune clearance, aucun reporting n'est en vigueur.** Un `Meldesystem` est
annoncé « zu gegebener Zeit », **sans date ni projet de loi** ; le JStG 2026 (Regierungsentwurf du
2026-05-19) ne le contient pas.

### Règles établies

| # | Règle | Source | Statut |
| --- | --- | --- | --- |
| 1 | Archivage **8 ans** ✓✓ — « acht Jahre aufzubewahren » ; réduction 10 → 8 par le BEG IV | [§ 14b Abs. 1 UStG](https://www.gesetze-im-internet.de/ustg_1980/__14b.html) | en vigueur 2025-01-01 |
| 2 | § 147 Abs. 3 AO : **8 ans** pour les Buchungsbelege ; **10 ans** subsiste pour livres, bilans, inventaires | § 147 AO | en vigueur |
| 3 | **Localisation** ✓✓ — conservation en Allemagne ; ailleurs dans l'UE **seulement** si accès à distance complet et téléchargement, **avec notification du lieu au Finanzamt** ; **hors UE ⇒ autorisation préalable** (§ 146 Abs. 2b AO), sanction 2 500 – 250 000 € | § 14b Abs. 2/4/5 UStG | en vigueur |
| 4 | Intégrité **obligatoire mais à moyen libre** : contrôle interne à piste d'audit fiable, **ou** signature/cachet qualifié eIDAS, **ou** EDI — et elle doit tenir **pendant toute la durée d'archivage** | § 14 Abs. 3 et § 14b Abs. 1 S. 2 UStG ; UStAE 14.4 | en vigueur |
| 5 | Format : **tout** format EN 16931 / dir. 2014/55/UE, ou format convenu bilatéralement permettant l'extraction correcte et complète. ZUGFeRD ≥ 2.0.1 admis (hors profils MINIMUM et BASIC-WL) | § 14 Abs. 1 S. 6 UStG ; UStAE 14.1 | en vigueur |
| 6 | En format hybride, **la partie structurée prime** en cas de divergence avec l'image | UStAE 14.4 Abs. 3 | en vigueur |
| 7 | Numérotation : « eine fortlaufende Nummer …, die … **einmalig vergeben** wird ». Doctrine : « Eine **lückenlose Abfolge … ist nicht zwingend** ». Kleinbetragsrechnungen ≤ 250 €, Fahrausweise et Kleinunternehmer : **aucun numéro requis** | § 14 Abs. 4 Nr. 4 UStG ; UStAE 14.5 Abs. 10/11/14 | en vigueur |
| 8 | Identifiant vendeur : **Steuernummer OU USt-IdNr.** — alternative, pas cumul | § 14 Abs. 4 Nr. 2 UStG | en vigueur |
| 9 | Correction par **document rectificatif** se référant spécifiquement à l'original, dans la **même forme** ; voie de référence `BT-3 = 384` + `BG-3` (BR-DE-26). Aucune correction requise pour les variations § 17 (escompte, remise) | § 31 Abs. 5 UStDV ; UStAE 14.11 | en vigueur |
| 10 | Annulation en cas de `unberechtigter Steuerausweis` : **demande écrite au Finanzamt et accord** de celui-ci (§ 14c Abs. 2) | § 14c UStG | en vigueur |
| 11 | Leitweg-ID : obligatoire **en B2G seulement** (§ 5 Abs. 1 Nr. 1 ERechV) ; en B2B « wird grundsätzlich keine Leitweg-ID benötigt », et BT-10 manquant est « umsatzsteuerlich unbeachtlich » | BMF FAQ 6 ; BMF Rn. 35a | en vigueur |

### Divergences avec le code — Allemagne

**DE-D1 — `archival: 10 ans` : le code est faux. ✓✓**
C'est **8 ans** depuis le 2025-01-01 (§ 14b Abs. 1 Satz 1, texte vérifié verbatim : « acht Jahre »).
Sur-rétention de deux ans, avec les conséquences RGPD que cela implique.

**DE-D2 — `integrity: NONE` : le code est faux.**
§ 14 Abs. 3 impose Echtheit der Herkunft, Unversehrtheit des Inhalts **et** Lesbarkeit, et
§ 14b Abs. 1 Satz 2 impose de les garantir **pendant toute la durée d'archivage**. Ce n'est pas
« aucune exigence », c'est « exigence à moyen libre ». Modélisation correcte :
`AUDIT_TRAIL | QES | EDI` — jamais `NONE`.

**DE-D3 — `mandatoryReceiveSyntax: XRECHNUNG` : le code est faux.**
Tout format EN 16931 est admis, ainsi qu'un format convenu bilatéralement. Le profil rejetterait des
factures parfaitement légales (ZUGFeRD, Factur-X, UBL/CII étrangers, EDIFACT). Aggravant : le
destinataire « **hat kein Anrecht auf eine alternative Ausstellung** » — il ne peut pas exiger un
autre format.

**DE-D4 — `numbering: GAPLESS_SELF` : le code est faux.**
Le critère légal est **`einmalig`** (unique), pas `lückenlos` (sans trou). La doctrine BMF l'énonce
explicitement : « Eine lückenlose Abfolge der ausgestellten Rechnungsnummern ist nicht zwingend ».
Plusieurs séries non contiguës sont admises. Le profil impose donc une contrainte que la loi
allemande ne connaît pas.

**DE-D5 — `requiredIdentifiers: VAT` obligatoire : le code est faux.**
§ 14 Abs. 4 Nr. 2 offre l'alternative **Steuernummer ou USt-IdNr.** Exiger la seconde bloque les
fournisseurs domestiques qui n'en ont pas.

**DE-D6 — `requiredIdentifiers: LEITWEG_ID` : le code est faux en B2B.**
Correct en B2G, faux en B2B. Doit être conditionné à la nature du destinataire.

**DE-D7 — `archivedForm: BOTH` : sur-spécifié.**
La partie structurée seule suffit (GoBD Rz. 119/131) ; le PDF n'est requis que s'il porte des
informations supplémentaires pertinentes fiscalement. Pour les factures sortantes, aucune copie image
n'est requise si un duplicata identique est reproductible à la demande (Rz. 76).

**DE-D8 — `correctionModel: CREDIT_NOTE` : sous-modélisé, avec un piège terminologique.**
La voie allemande de référence est la **Rechnungsberichtigung** (`BT-3 = 384`), pas l'avoir. Et
surtout : en droit allemand, **`Gutschrift` au sens du § 14 Abs. 2 Satz 5 signifie autofacturation**,
mention imposée par le § 14 Abs. 4 Nr. 10. Employer ce terme pour un avoir commercial est un risque
documenté au regard du § 14c.

**DE-D9 — `cancellationAllowed: true` inconditionnel : le code est incomplet.**
En cas de `unberechtigter Steuerausweis` (§ 14c Abs. 2), la correction exige la suppression du risque
fiscal, **une demande écrite séparée au Finanzamt et son accord**. Porte d'autorisation étatique non
modélisée.

**DE-D10 — `canaux: PEPPOL + EMAIL` : à la fois trop étroit et trop large.**
En B2B, la loi ne prescrit **aucun** canal. En B2G fédéral en revanche, le § 4 Abs. 3 ERechV impose
le **portail (OZG-RE) avec enregistrement préalable** : un e-mail direct à l'acheteur public ne
satisfait pas l'obligation.

**DE-D11 — lacunes** : contrainte de localisation (§ 14b Abs. 2) ; déclencheur d'établissement des
deux parties ; seuils et exemptions d'émission (≤ 250 € TTC, Fahrausweise, Kleinunternehmer, B2C,
§ 4 Nr. 8–29) alors que la **réception n'en connaît aucune** ; primauté de la partie structurée ;
obligation que **toutes** les mentions figurent dans la partie structurée.

### Ce que le code fait juste — Allemagne

`regime: POST_AUDIT, non bloquant` et `reporting: aucun` sont **exacts au 2026-08-27**. C'est le seul
des six pays où le régime déclaré correspond exactement à la réalité. Fragile toutefois : émettre une
non-E-Rechnung devient une infraction au 2027-01-01 au-dessus de 800 000 €, puis pour tous au
2028-01-01.

### Open questions — Allemagne

1. **Date du Meldesystem** : `null`. Aucun projet de loi au 2026-08-27. **Le « 2028 » qui circule
   n'apparaît dans aucune source primaire consultée — ne pas le coder.**
2. Articulation avec ViDA : non traitée par une source primaire allemande.
3. Délai légal de la Rechnungsberichtigung : `null` — ni § 31 Abs. 5 UStDV ni § 14 UStG ne fixent de
   fenêtre.
4. Sanctions en cas d'émission d'une non-E-Rechnung après le 2027-01-01 : non établies.
5. GoBD Rz. 135/136 (conditions de conversion de format) : non lues verbatim — à vérifier avant de
   coder une politique de conversion.

---

---

## ITALIE

### Sources

D.Lgs. 127/2015 art. 1 et DPR 633/1972 artt. 21, 26, 39 via `normattiva.it` ; **Provvedimento AdE
prot. 433608 du 2022-11-24** (dont le point 15.1 « sostituisce integralmente il provvedimento del
30 aprile 2018 ») ; **Allegato A — Specifiche tecniche v1.9.1**, mise à jour du 2026-03-31,
utilisables depuis le **2026-05-15** ; DM MEF 17/06/2014 ; Linee Guida AgID sur le document
informatique, applicables depuis le 2022-01-01 ; prassi AdE (Ris. 1/E 2013, Circ. 13/E 2018,
Circ. 14/E 2019, Circ. 20/E 2021, Risposta 447/2023, Guida AdE **décembre 2025**).

### Règles établies

| # | Règle | Source | Statut |
| --- | --- | --- | --- |
| 1 | Les variations **en hausse sont obligatoires** (« devono essere osservate ») → **nota di debito TD05** ; celles en baisse sont **facultatives** (« ha diritto di ») → nota di credito TD04 | art. 26 c. 1 et 2 DPR 633/72 | en vigueur |
| 2 | Il n'existe **aucune facture rectificative** distincte en droit italien : la liste `TipoDocumento` n'en comporte pas | Provv. 433608 pt 6.1 | en vigueur |
| 3 | Fenêtre d'un an **uniquement** pour l'accord postérieur entre parties et la rectification d'inexactitudes ex art. 21 c. 7 ; pour nullité, résolution, rescission : **aucun délai d'un an** | art. 26 c. 3 ; Circ. 20/E « senza specifici limiti di tempo » | en vigueur |
| 4 | Butoir réel : la nota doit être émise avant le **délai de dépôt de la déclaration TVA annuelle** de l'année du fait générateur | Circ. 20/E §3 | en vigueur |
| 5 | **Consentement de la contrepartie non requis** : « Le richieste […] di variazioni […] **non sono gestite dal SdI** » | Provv. 433608 pt 6.2 | en vigueur |
| 6 | **Aucune annulation possible** après RC ou MC : « Le ricevute […] attestano che la fattura è emessa ». Seule voie : nota di variazione art. 26 | Provv. 433608 pt 4.4 ; Risposta 447/2023 | en vigueur |
| 7 | **Date d'émission = le champ `Data` de `DatiGenerali`**, pas la date de transmission. Délai d'émission : **12 jours** depuis l'opération | Provv. 433608 pt 4.1 ; art. 21 c. 4 DPR 633/72 | en vigueur |
| 8 | Un **scarto (NS) ⇒ la facture n'a jamais été émise**, notifié **sous 5 jours** | Provv. 433608 pt 2.4 | en vigueur |
| 9 | Renvoi après scarto : **de préférence même date et même numéro** ; le contrôle d'unicité 00404/00409 est levé précisément parce qu'un NS a été émis ; seul le **nom de fichier** doit changer | Circ. 13/E §1.6 ; Specifiche v1.9.1 App. 1 | prassi, reconfirmée en 2025 |
| 10 | Flux B2B : **RC, NS, MC** seulement (+ MT au destinataire). **NE, DT et AT n'existent que dans le flux B2G** DM 55/2013 | Specifiche v1.9.1 §1.1 | en vigueur |
| 11 | Archivage **10 ans** (art. 2220 c.c.) **prolongés** « anche oltre il termine stabilito dall'articolo 2220 » jusqu'à définition des contrôles | art. 22 c. 2 DPR 600/73 via art. 39 c. 3 DPR 633/72 | en vigueur |
| 12 | **Seul l'original XML** doit être conservé ; le PDF est une faculté (« potrà portare in conservazione **anche** copie informatiche ») | art. 39 c. 3 DPR 633/72 ; Circ. 13/E §3.2 | en vigueur |
| 13 | Ce qui est obligatoire, c'est la signature/sceau du **pacchetto di archiviazione** + un **riferimento temporale opponibile a terzi** — pas la signature de la facture, **optionnelle en B2B** et obligatoire en B2G | DM 17/06/2014 art. 3 c. 2 ; LG AgID §4.8 ; Provv. pt 2.6 | en vigueur |
| 14 | **Pas de contrainte UE** sur la localisation : conservation possible dans tout État lié par un instrument d'assistance mutuelle, avec accès automatisé garanti ; le lieu doit être déclaré | art. 39 c. 3 DPR 633/72 | en vigueur |
| 15 | Numérotation : « numero progressivo che la identifichi in modo **univoco** ». La mention « in ordine progressivo per anno solare » a été **supprimée** en 2013 | art. 21 c. 2 lett. b) DPR 633/72 ; Ris. 1/E 2013 | en vigueur |
| 16 | `Natura` **obligatoire dès que `AliquotaIVA` = 0** (erreurs 00400/00429) et **interdite** si le taux ≠ 0 (00401/00430) | Specifiche v1.9.1 | en vigueur |

### Divergences avec le code — Italie

**IT-D1 — `cancellationAllowed: true` : le code est faux.** Aucune annulation après RC/MC ; seule la
nota di variazione art. 26 existe. Un flux d'annulation produirait un état incohérent avec le
registre TVA.

**IT-D2 — `numbering: GAPLESS_SELF` : le code est faux.** La loi n'exige que l'unicité, et la
Ris. 1/E de 2013 admet « qualsiasi tipologia di numerazione progressiva che garantisca
l'identificazione univoca ». Une lacune n'invalide rien.

**IT-D3 — `correctionModel: CREDIT_NOTE` seul : le code est incomplet.** Il manque la **nota di
debito TD05**, qui couvre les variations en hausse — lesquelles sont **obligatoires**, à la
différence des baisses.

**IT-D4 — `reporting: aucun` : le code est faux, et c'est la divergence la plus structurante.**
L'art. 1 c. 3-bis du D.Lgs. 127/2015 impose la transmission des données des opérations avec des
**non-établis**, via le SdI et le tracciato ordinaire depuis le 2022-07-01 — sortantes « entro i
termini di emissione delle fatture », entrantes « entro il quindicesimo giorno del mese successivo ».
S'y ajoute la liquidation trimestrielle de l'imposta di bollo. **C'est exactement le basculement
domestique → reporting décrit en F-017.**

**IT-D5 — `archivedForm: BOTH` et `integrity: SIGNED` : le code confond deux niveaux.** Seul le XML
doit être conservé. Et la signature obligatoire porte sur le **paquet d'archivage**, pas sur la
facture — laquelle n'est signée obligatoirement qu'en **B2G**. Le profil ne distingue pas B2B et B2G.

**IT-D6 — `archival: 10 ans` : incomplet.** Les 10 ans sont prolongés jusqu'à la définition des
contrôles. Une purge à J+10 ans détruirait des pièces encore exigibles.

**IT-D7 — `primarySyntaxes: PLAIN_PDF + FATTURAPA` : le code est faux.** En domestique,
« sono emesse **esclusivamente** fatture elettroniche utilizzando il Sistema di Interscambio », et
toute autre modalité ⇒ « la fattura si intende **non emessa** ». Le PDF n'est licite que dans les cas
d'exonération, ou comme *copia di cortesia* sans valeur fiscale.

**IT-D8 — RETIRÉ. Faux positif, même cause que PL-D4.**

*Le profil italien est correct.* Il déclare `EMAIL` **jusqu'au 2019-01-01 seulement**, puis `SDI`.
Reste vrai comme point de vocabulaire : les canaux SdI sont **PEC** (qui n'est pas un e-mail
ordinaire), la procédure web/app AdE, **SDICoop** et **SDIFTP**.

**IT-D9 — `requiredIdentifiers: IT_SDI + PEC` cumulés : le code est faux.** Codice destinatario et
PEC sont **alternatifs**. Manquent les valeurs conventionnelles `0000000` (consommateur, forfettario,
canal inconnu) et **`XXXXXXX`** (destinataire non établi — contrôle 00313).

**IT-D10 — `immutableAfter: ISSUE puis CLEARANCE` : mauvais déclencheur.** L'immutabilité naît au
retour **RC ou MC**. Avant la réponse du SdI, ou après un NS, le document peut être librement
recomposé — y compris avec la même date et le même numéro. Le profil **verrouille trop tôt** et
bloquerait le renvoi post-scarto.

**IT-D11 — politique de réponse : risque de statuts fantômes.** Si le profil modélise NE, DT ou AT
en B2B, il attend des messages qui **n'arriveront jamais** — ils n'existent que dans le flux B2G.

**IT-D12 — lacune fonctionnelle majeure** : la règle du renvoi post-scarto sous 5 jours, même date et
même numéro, n'apparaît nulle part. C'est pourtant le chemin nominal de reprise après rejet.

### Contradiction interne relevée

Le profil déclare simultanément `POST_AUDIT + CLEARANCE` et `reporting: aucun`. Or la jambe
« post-audit » du dispositif italien **est** précisément le reporting c. 3-bis que le profil nie.

---

---

## ESPAGNE

### Sources

BOE, textes consolidés (RD 1007/2023, RD 1619/2012, RD 238/2026, Orden HAC/1177/2024, LGT, LIVA,
Código de Comercio, Ley 25/2013) ; AEAT (`sede.agenciatributaria.gob.es`) ; `hacienda.gob.es` pour le
projet d'orden ministerial.

### Deux régimes, deux déclencheurs de nature différente

C'est la particularité espagnole, et elle est structurante :

| Régime | Déclencheur | Pivot |
| --- | --- | --- |
| **Veri\*Factu** | **unilatéral** — un **statut fiscal de l'émetteur** (IS / IRPF activité économique / IRNR **avec établissement permanent** / entité en attribution de revenus), domicile fiscal en territoire commun, **et non inscrit au SII** | **vendeur** |
| **Mandat B2B** (RD 238/2026) | **bilatéral, dominé par le destinataire** — l'émetteur doit être tenu d'émettre selon le RD 1619/2012, **et** le destinataire doit avoir en Espagne son siège, un EP ou son domicile, **et l'opération doit lui être adressée** | **acheteur** |

Le mandat B2B pivote donc sur `buyerEstablishment == ES`, **pas** sur le pays du vendeur. Un moteur
qui l'active sur le vendeur se trompe dans les deux sens : faux positif sur ES → FR, faux négatif sur
un vendeur étranger soumis aux règles espagnoles vendant à un acheteur établi en Espagne.

**Veri\*Factu couvre le transfrontalier sortant** : la norme vise l'émission de factures
« **cualquiera que sea el destinatario** ». Une facture à un client étranger génère un registro de
facturación comme une facture domestique. Un moteur qui court-circuite sur `buyerCountry != ES` est
non conforme.

### Calendrier — trois horloges indépendantes

| Horloge | Échéance | Statut |
| --- | --- | --- |
| Veri\*Factu — contribuables IS | **2027-01-01** | en vigueur (prorogé deux fois : RD 254/2025 puis RD-ley 15/2025, convalidé le 2025-12-11) |
| Veri\*Factu — reste des obligés art. 3.1 | **2027-07-01** | en vigueur |
| Veri\*Factu — **producteurs de logiciel** | **9 mois après l'entrée en vigueur de l'orden ministerial** ✓✓ | **échéance expirée** |
| Mandat B2B | 12 / 24 / 36 mois **à compter de l'entrée en vigueur d'une orden ministerial non publiée** | **horloge non démarrée** |

L'orden ministerial du mandat B2B **n'est pas publiée au 2026-08-27** ; elle existe à l'état de projet
soumis à information publique le 2026-04-17, prévoyant une entrée en vigueur au 2026-10-01. **Ces
dates ne doivent pas être codées comme fermes.**

### Divergences avec le code — Espagne

**ES-D1 — le chaînage est obligatoire, l'algorithme existe, et la chaîne n'est jamais formée.**

*Version corrigée. La première rédaction disait « `hashChain: false` : le code est faux » et laissait
entendre que la capacité était absente. Elle ne l'est pas, et le défaut réel est plus précis.*

**Le droit d'abord.** Le chaînage par empreinte du registre précédent est **obligatoire dans les deux
modalités** (RD 1007/2023 art. 8.2.b, 10.1.ñ, 11.2.e et 12). L'exception de l'art. 16.3 ne lève que la
**signature XAdES**, jamais le hash. Le drapeau de profil `hashChain: false` est donc faux comme
déclaration.

**Ce que le code fait réellement.** `reporting/generators.ts` implémente l'algorithme de la huella —
chaîne canonique, jeu et ordre des champs, casse, SHA-256 hexadécimal majuscule — construit d'après
les documents techniques AEAT nommément cités : « Detalle de las especificaciones técnicas para la
generación de la huella o hash de los registros de facturación » **v0.1.2 du 2024-08-27**, et celui
du code QR **v0.5.0 du 2025-12-10**. `generators.spec.ts` **reproduit les deux exemples chiffrés
officiels de l'AEAT** — cas 1, premier registre non chaîné, et cas 2, registre chaînant le
précédent — avec les SHA-256 publiés par l'autorité en dur. Les 39 tests passent.

> C'est de la **preuve L3** au sens de l'échelle de cet audit : un test vérifié contre un vecteur
> publié par l'autorité. Mon inventaire de phase 0 l'avait manquée, ayant sondé les providers de
> *format* et jamais les générateurs de *reporting*.

**Le défaut, exactement.** Le paramètre `previousHuella` vaut `''` par défaut, et **aucun appelant ne
l'alimente jamais** — vérifié sur tout le dépôt. `handlers.ts:185` le documente d'ailleurs
explicitement, et `generators.ts:695` porte un `TODO(seam)` disant que la lecture arrière du registre
précédent est délibérément laissée à la couche d'I/O. Conséquence : **chaque registre est émis avec
`PrimerRegistro='S'`** — le système produit une chaîne de longueur un, répétée indéfiniment, alors
que toute la valeur probante du dispositif tient dans le chaînage.

**Ce qui manque n'est donc pas une source légale, c'est une requête.** Le `TODO(seam)` décrit lui-même
le correctif : lire, par émetteur, la huella du dernier registre VERIFACTU via `ReportingStore`, et
la passer au générateur. Aucune recherche juridique supplémentaire n'est nécessaire pour cela — ce
qui déplace la séquence de F-018 (voir `06-REMEDIATION.md`).

**ES-D12 — l'URL du QR est celle d'un système vérifiable, que le produit n'est pas.** *(nouveau)*

Le document AEAT « Detalle de las especificaciones técnicas del código QR de la factura… »
**v0.5.0 du 2025-12-10**, obtenu et lu, distingue **deux axes** et non un seul :

| | Environnement de test | Production |
| --- | --- | --- |
| **5.1** Système émettant des factures **vérifiables** | `prewww2.aeat.es/…/ValidarQR` | `www2.agenciatributaria.gob.es/…/ValidarQR` |
| **5.2** Système émettant des factures **non vérifiables** | `prewww2.aeat.es/…/ValidarQRNoVerifactu` | `www2.agenciatributaria.gob.es/…/ValidarQRNoVerifactu` |

Le **chemin** change avec le mode, pas seulement l'hôte avec l'environnement. `generators.ts:656`
code en dur `…/ValidarQR`, c'est-à-dire l'URL d'un **système vérifiable**. Or le produit ne
transmet rien en continu — le handler de reporting journalise `[MOCK]` (F-016) — il est donc un
système **non vérifiable**, qui devrait imprimer `ValidarQRNoVerifactu`.

Le commentaire du code (`generators.ts:653-655`) décrit `prewww2` comme un simple hôte de
préproduction « à basculer par configuration ». C'est exact quant à l'environnement — le PDF le
qualifie bien d'« Entorno de pruebas (Portal de Pruebas Externas) » — mais cela **manque le second
axe** : bascule l'hôte et l'on reste sur le chemin des factures vérifiables.

> Ce défaut se referme sur l'indicateur **1.e** de la déclaration responsable (voir
> `09-F018-ES-DECLARATION.md` §5) : le QR imprimé affirme au destinataire un mode que le système ne
> tient pas. Ce n'est pas une divergence de plus, c'est la même incohérence vue depuis la facture.

**ES-D2 — `reporting: SII + VERIFACTU` : le code est faux s'il cumule.**
Les deux régimes sont **mutuellement exclusifs** : « El presente Reglamento **no se aplicará** a los
contribuyentes que lleven los libros registros en los términos […] del artículo 62 del Reglamento del
IVA » (art. 3.3). Un flag `isSiiFiler` doit arbitrer en amont ; il n'existe aucun état où les deux
sont actifs.

**ES-D3 — `archival: 10 ans` : mal étiqueté.**
Le RD 1619/2012 art. 19.1 renvoie à la LGT sans écrire de durée. Le plancher réel est **6 ans**
(Código de Comercio art. 30.1, via LGT art. 70.2 qui impose le plus long des deux), sur un socle
fiscal de 4 ans. Les 10 ans ne valent que pour les bases et déductions en attente (LGT art. 66 bis.2)
— et sont **insuffisants** pour l'immobilier, la régularisation des biens d'investissement portant sur
neuf années supplémentaires (LIVA art. 107.Tres). 10 ans est un défaut prudent, pas une règle.

**ES-D4 — `archivedForm: BOTH` : incomplet sur deux points opposables.**
(a) Le **format d'origine** doit être conservé — XML natif, données associées **et mécanismes de
vérification de signature** (art. 21.1) ; un rendu PDF ne suffit pas. (b) La conservation **hors
d'Espagne** est licite mais soumise à **communication préalable à l'AEAT** (art. 22.2), de même que la
sous-traitance hors UE (art. 19.4). Le profil ne modélise aucune de ces deux obligations déclaratives.

**ES-D5 — `numbering: GAPLESS_SELF` : non sourcé, et incomplet.**
Le texte n'exige que « la numeración […] **dentro de cada serie** será correlativa ». L'interdiction
des trous n'est écrite nulle part → `open_question`. Surtout, le profil ignore les **séries
obligatoirement séparées** : rectificatives, autofacturation (**une série par tiers émetteur ou
destinataire**), art. 84.Uno.2º.g) LIVA, DA 5ª et art. 61 quinquies.2 RIVA, et **complètes vs
simplifiées dès qu'elles coexistent sur une même année civile**.

**ES-D6 / ES-D7 — `PLAIN_PDF + ES_FACTURAE` : faux pour le mandat B2B.**
Le RD 238/2026 art. 7.1 impose EN 16931 dans l'une de quatre syntaxes — **CII, UBL, EDIFACT ou
Facturae** — et les opérateurs doivent savoir **convertir entre les quatre**. **UBL est la syntaxe de
référence** de la solución pública. Le PDF n'est qu'un **accompagnement transitoire** pendant les
12 premiers mois pour les entreprises de plus de 8 M€. Facturae-seul est une règle **B2G**
(Ley 25/2013 / FACe), pas B2B.

**ES-D8 — canaux : incomplet sur trois obligations.**
Manquent : le **dépôt simultané d'une copie fidèle UBL** au repositorio universel de l'AEAT par toute
plateforme privée ; l'**interconnexion obligatoire** entre plateformes, sous un mois ; et le
**reporting des états de facture** — acceptation ou rejet commercial, paiement effectif — sous
**quatre jours naturels hors week-ends et fériés**. L'e-mail ne satisfera pas le mandat B2B.

**ES-D9 — `cancellationAllowed` : ambigu, et le risque est de n'en faire qu'une moitié.**
Aucune suppression n'existe. L'annulation prend **deux formes distinctes et cumulatives** : un
**registro de anulación** append-only et chaîné côté Veri\*Factu, **et** une facture rectificative à
100 % côté destinataire. Un `cancel` unique qui ne produit que l'un des deux est non conforme.

**ES-D10 — `correctionModel: CREDIT_NOTE` : correct sur le principe, incomplet sur les règles.**
Manquent la **double ancre** de la fenêtre de 4 ans (*devengo* **ou** survenance de la circonstance de
l'art. 80 LIVA), les fenêtres courtes (2 mois en cas de concours, 6 mois pour créances irrécouvrables
puis 1 mois de communication à l'AEAT, 1 mois pour une re-rectification à la hausse), les **deux
représentations** admises — delta ou absolu post-rectification —, et l'interdiction de rectifier à la
hausse un destinataire non-entrepreneur hors art. 80.

**ES-D11 — plafond territorial absent.**
Le profil ne modélise ni l'exclusion du **País Vasco et de la Navarre** (régimes foraux, exclusion par
domicile fiscal), ni les spécificités des Canaries, Ceuta et Melilla, ni l'exclusion des opérations
réalisées via un **établissement permanent à l'étranger** (art. 4.2), ni le fait qu'un assujetti **non
établi mais simplement immatriculé NIF est hors du champ Veri\*Factu**.

### Ce que le code fait juste — Espagne

`regimeBlocking: false` est **exact** : Veri\*Factu n'est pas une clearance, l'AEAT ne valide pas la
facture — l'art. 16 n'établit qu'une présomption de conformité **du système**, et l'art. 8.4 du
RD 1619/2012 une présomption d'authenticité et d'intégrité **de la facture**. `immutableAfter: ISSUE`
est exact, et même sous-estimé : l'immutabilité est exigée au niveau du **registre**, append-only,
avec registro de eventos obligatoire en mode non-VERI\*FACTU.

### Open questions — Espagne

Les deux plus bloquantes pour une implémentation : le **document technique AEAT du hash** (algorithme
confirmé, ordre de concaténation, séparateurs, encodage) et celui du **QR** (URL littérale du service
de cotejo, paramètres, variante selon la modalité). L'Orden HAC/1177/2024 y renvoie formellement —
**ne pas implémenter le hash ni l'URL du QR sans ces documents**. S'y ajoutent : les critères exacts
d'assujettissement au SII (c'est pourtant le flag qui arbitre ES-D2), la publication de l'orden
ministerial du mandat B2B, et le cas d'un fournisseur non établi mais immatriculé réalisant une
opération localisée en Espagne vers un acheteur établi.

---

---

## MEXIQUE

### Sources

CFF (art. 28, 29, 29-A, 30) via `sat.gob.mx` ; **RMF 2026, DOF 2025-12-28**, reglas 2.7.1.34 et
2.7.1.35 ; Anexo 20 v4.0 ; et — vérification la plus forte de tout cet audit — **les schémas de
l'autorité eux-mêmes, vendorisés dans le dépôt** : `backend/src/compliance/schemas/mx/cfdv40.xsd` et
`catCFDI.xsd`, plus `TimbreFiscalDigitalv11.xsd` récupéré en ligne.

**Version en vigueur au 2026-08-27 : CFDI 4.0.** Aucune version postérieure publiée ni annoncée.

### Divergences avec le code — Mexique

**MX-D1 — `numbering: AUTHORITY_RANGE` : le code est faux. ✓✓ Vérifié sur le schéma du dépôt.**

Il n'existe **aucune plage de folios attribuée par l'autorité** sous CFDI. Contrôle direct sur
`cfdv40.xsd` :

```
name="Serie" use="optional"
name="Folio" use="optional"
```

L'Anexo 20 les qualifie de « para **control interno del contribuyente** ». L'identifiant fiscal est
l'**`UUID`**, attribué **par document, par le PAC, au moment du timbrado** — le
`TimbreFiscalDigital` porte d'ailleurs `RfcProvCertif`, « el RFC del proveedor de certificación […]
que genera el timbre fiscal digital ». Le « folio » du CFF art. 29 fr. IV désigne cet UUID, pas une
plage. Le mécanisme de plages a existé sous les régimes CFD/CBB, **abrogés**.

C'est une divergence coûteuse : `AUTHORITY_RANGE` implique une pré-allocation, un compteur
consommable et une gestion d'épuisement — tout cet appareillage est **sans objet** au Mexique, et
produira au mieux du code mort, au pire un blocage d'émission artificiel. Le modèle correct est celui
déjà nécessaire pour KSeF et SdI : **numéro interne libre + identifiant fiscal reçu en retour du
clearance**.

**MX-D2 — `requiredIdentifiers: RFC + CURP` : le code est faux. ✓✓ Vérifié sur le schéma du dépôt.**

`grep -c -i "curp" cfdv40.xsd` → **0**. Le CURP n'apparaît **nulle part** dans le schéma CFDI : ni sur
`Comprobante`, ni sur `Emisor`, ni sur `Receptor`. Il n'existe que dans certains compléments,
principalement **Nómina 1.2**, pour les personnes physiques.

À l'inverse, le `Receptor` exige trois champs que le profil ignore :

```
Rfc -> required · Nombre -> required · DomicilioFiscalReceptor -> required
RegimenFiscalReceptor -> required · UsoCFDI -> required
```

Et `Comprobante` porte `Exportacion` en `use="required"` — l'export n'est pas hors champ, c'est un
cas **paramétré** du CFDI.

**MX-D3 — `archival.residency: MX` : le code est plus strict que le droit sourcé.**

Les sources primaires imposent la **disponibilité au domicilio fiscal** : « La documentación
comprobatoria […] deberá estar **disponible en el domicilio fiscal** del contribuyente » (CFF art. 28
fr. III), et la conservation « **a disposición de las autoridades** » (art. 30). **Aucune source
primaire prononçant une interdiction de stockage hors du Mexique n'a été trouvée.** L'exigence réelle
est une **résidence d'accès**, pas une résidence physique des données. Le profil invente donc ici une
contrainte — le symétrique exact de FR-D4 et DE-D13, où il en **omet** de réelles.

**MX-D4 — `archival: 5 ans` : durée juste, point de départ faux.**
Le CFF art. 30 compte les cinq ans **depuis le dépôt de la déclaration** concernée, non depuis
l'émission de la facture. Et la conservation est **perpétuelle** pour les actes constitutifs, les
mouvements de capital, fusions, scissions, distributions de dividendes et justificatifs de prix de
transfert — et court jusqu'à ce que la résolution mettant fin à un contentieux soit **ferme**.

**MX-D5 — `cancellationAllowed: true` : un booléen ne peut pas porter cette règle.**
L'annulation est **bilatérale par défaut** — acceptation du récepteur, **tacite au bout de trois
jours** (RMF 2026 regla 2.7.1.34) — sauf hydrocarbures et Carta Porte carburants où l'acceptation
**expresse** est exigée et où le silence ne vaut donc pas accord. Elle exige un **motivo**
(`01`…`04`), le `01` imposant de fournir l'UUID du CFDI de substitution. Elle est **bloquée** tant
qu'un document relié est *vigente*. Elle est bornée à **l'exercice fiscal d'émission**. Et douze cas
limitatifs (regla 2.7.1.35) la dispensent entièrement d'acceptation.

**MX-D6 — `correctionModel: CREDIT_NOTE` : incomplet.**
Manque la voie **annulation + substitution** — `motivo 01` avec l'UUID du substitut, puis nouveau
CFDI portant `TipoRelacion = "04"` (« Sustitución de los CFDI previos »). C'est le chemin **normal**
de rectification d'une erreur au Mexique. La nota de crédito (`TipoDeComprobante = E` +
`TipoRelacion 01`) ne couvre que l'ajustement d'une opération qui subsiste.

### Ce que le code fait juste — Mexique

`CLEARANCE` bloquant, canal `PAC`, syntaxe `CFDI`, `immutableAfter: CLEARANCE`,
`archivedForm: AUTHORITATIVE_XML`, `integrity: SIGNED` et `reporting: aucun` sont **tous exacts**.
Le `SelloSAT` scelle le XML et toute modification post-timbrado l'invalide. C'est, avec l'Allemagne,
le profil dont le noyau est le mieux posé.

### Portée territoriale — déclencheur unilatéral, cycle de vie bilatéral

L'obligation d'émettre dépend **exclusivement du statut de l'émetteur** (résident fiscal mexicain ou
établissement permanent). Le pays de l'acheteur ne conditionne **jamais** l'applicabilité : il ne
modifie que le contenu des champs (`Exportacion`, RFC générique étranger, `ResidenciaFiscal`,
`NumRegIdTrib`, complemento Comercio Exterior le cas échéant).

**Conséquence directe pour le correctif `f6888eb2`** : le hard-block sur pays acheteur non résolu est
correct pour la TVA, mais **ne doit pas être réutilisé pour décider si un CFDI est dû**. Au Mexique,
une adresse acheteur non résolue ne doit jamais désactiver l'émission — au pire bloquer sur le choix
`Exportacion` / RFC générique.

Le **cycle de vie**, lui, est bilatéral et temporisé : c'est un cas d'usage direct du runtime
événementiel — `COMMAND(cancel)` → `AWAIT_CALLBACK` + `ARM_TIMER(3 jours)` → `INBOUND_STATUS` ou
`TIMER_ELAPSED`. Avec deux pièges : les douze exceptions doivent être évaluées **avant** d'armer le
timer, et pour les hydrocarbures **le timer ne doit pas conclure**.

---

---

## PORTÉE TERRITORIALE — le volet transfrontalier

Cette section répond à la question ajoutée au questionnaire. **Seule la France a pu être achevée** :
les cinq autres agents ont été interrompus par une limite de service (voir « État de la phase 2 »).

### France — le mandat est bilatéral, et il est domestique

**[CGI art. 289 bis, I](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044051178/2026-08-27)**,
version en vigueur au 2026-02-21 (LOI n° 2026-103 du 2026-02-19, art. 123) — l'obligation s'applique
lorsque « **l'émetteur de la facture et son destinataire sont des assujettis qui sont établis ou ont
leur domicile ou leur résidence habituelle en France** ».

Trois conséquences, toutes contraires à ce que le moteur suppose :

1. Le critère est **l'établissement**, le domicile ou la résidence habituelle. **L'immatriculation à
   la TVA en France n'est pas un critère de rattachement.**
2. La condition est **bilatérale et cumulative** : elle porte sur **les deux parties**.
3. Le transfrontalier est **hors du mandat** ; l'art. 289 bis V exclut en outre les livraisons
   intracommunautaires exonérées (art. 262 ter, 1° du I).

Confirmé par l'autorité, DSE v3.2 §2.3.1 : le dispositif vise « les **transactions domestiques**
entre assujettis à la TVA **établis, domiciliés ou ayant leur résidence habituelle en France** ».

### Ce qui remplace le mandat en transfrontalier : l'e-reporting

[CGI art. 290](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046195617/2026-08-27) et
art. 290 A, applicables aux opérations réalisées **à compter du 2026-09-01**, selon les mêmes deux
vagues que l'e-invoicing.

| Situation | E-invoicing (289 bis) | E-reporting |
| --- | :-: | --- |
| Deux assujettis établis en France | **oui** | sans objet |
| Non établi, mais **immatriculé** TVA en France | **non** | **oui** — art. 290, II |
| Établi en France, opération **localisée à l'étranger** | **non** | **oui** — art. 290, I-1° |

Format : **flux F10**, XML, distinct du F1 (`tar.gz`, UBL 2.1 ou CII D22B). Statuts propres :
**300 Déposée / 301 Rejetée**. Rythme **périodique** adossé au régime de TVA (décadaire, mensuel ou
bimestriel selon le régime), et non transactionnel. Rectification par flux **RE**, qui « annule et
remplace l'ensemble des données agrégées » de la période — un modèle *replace-period* sans aucun
rapport avec l'avoir ou le rectificatif de l'e-invoicing.

### Pourquoi cela aggrave F-017

Le fait générateur du mandat français est **l'établissement conjoint des deux parties**. Sans
connaître le statut d'établissement du **destinataire**, le moteur ne peut pas trancher entre deux
régimes disjoints — deux formats, deux horloges, deux modèles de correction :

- e-invoicing : F1, plateforme agréée, cycle de vie 200/210/212/213, 24 h ;
- e-reporting : F10, périodique, rectification par remplacement de période.

Un `country = FR` déduit du seul fournisseur produira un e-invoicing sur des opérations relevant en
réalité de l'art. 290 — et manquera l'obligation d'e-reporting de l'art. 290 II pour un fournisseur
non établi mais immatriculé en France, que le moteur classera hors périmètre français.

### Italie — mandat bilatéral, reporting unilatéral, et l'immatriculation ne déclenche rien

Art. 1 c. 3 du D.Lgs. 127/2015, texte consolidé vérifié au 2026-08-27 : l'obligation vise les
opérations « effettuate **tra soggetti residenti o stabiliti nel territorio dello Stato** ». La même
condition bilatérale est reprise **mot pour mot** au c. 6 pour la sanction (« la fattura si intende
non emessa »). Le c. 3-bis, lui, n'exige la qualité de résident ou établi **que du transmetteur** :
« I soggetti passivi di cui al comma 3 **trasmettono** […] i dati […] verso e da soggetti non
stabiliti ». **Deux déclencheurs de nature différente dans le même article.**

**L'immatriculation ne déclenche rien — et c'est explicite.** Le mot `identificati` a été
**expressément retiré** de l'art. 1 c. 3 ; le provvedimento de 2018 le portait encore dans son
intitulé, celui de 2022 ne le porte plus. L'AdE :

> « […] tra i soggetti "stabiliti" **non possono essere inclusi i soggetti non residenti meramente
> identificati** » — Circolare 13/E du 2018-07-02, §1.2
>
> « […] espungendo, dall'articolo 1, comma 3 […] il riferimento ai soggetti identificati (tramite
> identificazione diretta ovvero rappresentante fiscale), **i quali non sono tenuti alla
> fatturazione elettronica** » — Circolare 14/E du 2019-06-17, §1.2

**Établissement stable : une propriété de l'opération, pas de l'entité.** L'art. 1 c. 3 ne définit
pas « stabilito » et emprunte la notion TVA de l'art. 7 c. 1 lett. d) du DPR 633/1972 :

> « […] ovvero una **stabile organizzazione** nel territorio dello Stato di soggetto domiciliato e
> residente all'estero, **limitatamente alle operazioni da essa rese o ricevute** »

Confirmé par la Risposta AdE n. 374/2023, qui rattache la règle à l'art. 192 bis de la directive TVA
et au critère d'« intervention » de l'art. 53 du règlement 282/2011 — en précisant que « lo
svolgimento di **meri compiti di supporto amministrativo, quali la contabilità, la fatturazione** o
il recupero crediti, **non è sufficiente** ». Les spécifications techniques v1.9.1 en tirent la
conséquence : le bloc `StabileOrganizzazione` n'est obligatoire que « nei soli casi in cui […]
effettua **la transazione oggetto del documento** tramite stabile organizzazione ».

**Reporting c. 3-bis — vérifié.** Périmètre sortant **et** entrant (« effettuate e ricevute verso e
da »). Délais : sortantes « entro i termini di emissione delle fatture » ; entrantes « entro il
quindicesimo giorno del mese successivo a quello di ricevimento del documento **o di effettuazione
dell'operazione** » — le second terme alternatif est souvent omis. Exclusion à câbler : les achats
non territorialement pertinents (art. 7 à 7-octies) **≤ 5 000 € par opération**.

**Canal unique depuis le 2022-07-01** : les données passent par le SdI au format de la facture
ordinaire ; les fichiers à l'ancien schéma portant une date postérieure au 2022-06-30 « **verranno
scartati** ». L'esterometro autonome ne survit que pour les faits générateurs antérieurs.

**Discriminant technique** : il n'existe **aucun `TipoDocumento` dédié** au flux sortant 3-bis. Le
seul marqueur est `CodiceDestinatario = XXXXXXX`, valide **si et seulement si** `IdPaese ≠ IT` —
sinon rejet **00313**. `0000000` couvre le cas distinct de l'émission volontaire vers un identifié
portant sa partita IVA italienne. Ce sont deux branches disjointes, pas un repli. Entrantes :
TD17 (services étrangers), TD18 (biens intracommunautaires), TD19 (art. 17 c. 2), TD28
(Saint-Marin).

### Allemagne — déclencheur bilatéral conjonctif, et trois prédicats d'établissement distincts

Sources : UStG « zuletzt geändert durch Art. 5 G v. 29.6.2026 » ; **UStAE consolidé, Stand
2026-04-09** ; BMF-Schreiben du 2025-10-15 ; BMF FAQ E-Rechnung, Stand mars 2026.

**§ 14 Abs. 2 Satz 2 Nr. 1** : la facture est électronique « wenn der leistende Unternehmer **und**
der Leistungsempfänger im Inland […] ansässig sind ». Et l'UStAE tranche le cas contraire sans
ambiguïté :

> « Ist **mindestens einer** der am Umsatz beteiligten Unternehmer nicht im Inland […] ansässig,
> besteht **keine Pflicht** zur Ausstellung einer E-Rechnung » — UStAE Abschnitt 14.1 Abs. 6 S. 3

Le régime de repli n'est ni l'interdiction ni l'obligation : le papier reste **toujours licite**, et
l'électronique — E-Rechnung comme PDF — est licite **sous consentement du destinataire**
(§ 14 Abs. 1 S. 5), consentement « bedarf **keiner besonderen Form** » et pouvant être **tacite**,
donné par CGV, ou même **a posteriori** (UStAE 14.1 Abs. 7).

**Le territoire n'est pas « l'Allemagne ».** Le test porte sur « im Inland **oder in einem der in
§ 1 Absatz 3 bezeichneten Gebiete** » — ports francs, eaux et estrans. Un moteur qui teste
`country == "DE"` est sous-inclusif.

**L'établissement stable ne compte que s'il participe** — § 14 Abs. 2 Satz 3 :

> « […] eine Betriebsstätte, **die an dem Umsatz beteiligt ist** […] »

Et la doctrine précise ce que « participer » exclut :

> « **Nicht als Nutzung** […] gelten **unterstützende Arbeiten** durch die Betriebsstätte wie
> **Buchhaltung, Rechnungsausstellung oder Einziehung von Forderungen**. » — UStAE 13b.11 Abs. 1 S. 5

Avec une règle **auto-référentielle** à connaître : porter sur la facture le numéro de TVA de
l'établissement stable **vaut présomption de participation** (UStAE 13b.11 Abs. 1 S. 6, renvoi à
l'art. 53 du règlement 282/2011). Autrement dit, le numéro de TVA choisi pour la facture décide de
l'obligation qui pèse sur cette même facture.

**L'immatriculation ne figure dans aucune des quatre branches** du § 14 Abs. 2 S. 3. Le BMF ne
l'écrit pas ainsi mais en tire la conséquence opérationnelle (FAQ Frage 3) : un assujetti étranger
immatriculé sans établissement « können auf diesen Umstand in ihrer Rechnung hinweisen, um zu
begründen, warum sie **keine E-Rechnung** stellen », et le destinataire peut s'y fier.

#### Trois prédicats d'établissement distincts dans le seul UStG

C'est le point le plus lourd pour la modélisation, et il n'apparaît nulle part dans le profil :

| Usage | Base | Définition |
| --- | --- | --- |
| Déclencheur d'**émission** | § 14 Abs. 2 S. 3 | Sitz, Geschäftsleitung, **Betriebsstätte participante**, ou à défaut de Sitz : Wohnsitz / gewöhnlicher Aufenthalt |
| Obligation de **réception** | UStAE 14.1 Abs. 5 S. 1 ; FAQ Frage 12 | **unilatéral** — porte sur le seul destinataire établi |
| Localisation d'**archivage** | § 14b Abs. 3 | **Wohnsitz** (sans condition), Sitz, Geschäftsleitung, ou **Zweigniederlassung** — pas « Betriebsstätte participante » |

Un unique booléen `isEstablishedDE` ne peut donc servir les trois.

#### § 14 Abs. 7 — l'art. 219 bis transposé, et il retourne le problème

> « […] so gelten **abweichend von den Absätzen 1 bis 6** für die Rechnungserteilung die
> **Vorschriften des Mitgliedstaats**, in dem der Unternehmer seinen Sitz, seine Geschäftsleitung,
> eine Betriebsstätte, von der aus der Umsatz ausgeführt wird […] hat. »

Lorsque le fournisseur n'est pas établi en Allemagne et que le preneur est redevable au titre du
§ 13b — et **sauf** convention d'autofacturation (S. 2) — ce n'est plus le droit allemand qui régit
la facturation, mais celui de l'État du **fournisseur**.

C'est exactement la dérogation de l'art. 219 bis de la directive 2006/112/CE. Elle a une conséquence
inconfortable pour l'audit : dans ce cas précis, la résolution « fournisseur seul » du moteur donne
le **bon** résultat. Mais elle le donne sans connaître la condition qui l'y autorise — donc elle
l'appliquerait tout aussi bien aux cas où elle est fausse. Une règle juste par accident n'est pas
une règle.

#### Zusammenfassende Meldung — ce qui couvre le transfrontalier

§ 18a UStG, déclaration au Bundeszentralamt für Steuern, **sortant uniquement**. Périmètre :
livraisons intracommunautaires et prestations § 3a Abs. 2 imposables dans un autre État membre où le
preneur est redevable. Hors périmètre : exportations pays tiers, acquisitions, services reçus, B2C,
Kleinunternehmer. Délai : **25e jour** après le mois (biens ; option trimestrielle sous 50 000 €) ou
après le trimestre (services). Sanction : Bußgeld jusqu'à **5 000 €**, sans Verspätungszuschlag.

**Aucune transmission de facture n'y est jointe** : le § 18a Abs. 7 énumère limitativement le numéro
de TVA de chaque acquéreur, la **somme** des bases par acquéreur, et des indicateurs de nature. Ni
numéro de facture, ni date, ni ligne, ni document. C'est un agrégat périodique par client.

Le `Meldesystem` transactionnel reste `annoncé` sans texte ni date : le Regierungsentwurf du JStG
2026 ne le contient pas, et ne touche ni le § 14 ni le § 27 Abs. 38.

### Pologne — déclencheur **unilatéral**, et cela invalide une généralisation

Sources : texte consolidé de l'ustawa o VAT (Dz.U. 2025 poz. 775), surchargé par la loi du
2025-08-05 (Dz.U. 2025 poz. 1203) ; **Objaśnienia podatkowe MF du 2026-01-28** sur le
`stałe miejsce prowadzenia działalności` (SMPD) pour les besoins du KSeF — document opposable au
titre de l'art. 14n § 4 pkt 1 de l'Ordynacja podatkowa. Contrôle négatif effectué : les actes
modificatifs postérieurs (Dz.U. 2025 poz. 1811 et Dz.U. 2026 poz. 846) ne touchent ni l'art. 106a,
ni 106ga, ni 106gb.

L'art. 106ga ust. 2 pose le rattachement par **exclusion négative**, et ses points 1 et 2 sont tous
deux rédigés « **przez podatnika** » — par l'assujetti **émetteur** :

> 1) « przez podatnika nieposiadającego siedziby działalności gospodarczej ani stałego miejsca
> prowadzenia działalności gospodarczej na terytorium kraju ;
> 2) przez podatnika nieposiadającego siedziby […] qui possède un SMPD sur le territoire national,
> **przy czym to stałe miejsce prowadzenia działalności nie uczestniczy w dostawie towarów lub
> świadczeniu usług**, dla których wystawiono fakturę »

Le seul point où l'acquéreur apparaît est le pkt 4, et il ne vise que sa **qualité** (personne
physique non entrepreneur), jamais sa localisation. Le ministère l'énonce explicitement :

> « Podatnicy z siedzibą na terytorium Polski, nabywający towary lub usługi od podatników z siedzibą
> za granicą, **dla celów stosowania KSeF nie są zobowiązani do dokonywania weryfikacji, czy taki
> zagraniczny podatnik posiada SMPD w Polsce**. »

**Conséquences :**

| Situation | Émission KSeF |
| --- | --- |
| Assujetti étranger **immatriculé** en Pologne, sans établissement | **non** — art. 106ga ust. 2 pkt 1 ; option ouverte et **révocable transaction par transaction** |
| Étranger avec SMPD polonais **participant** à l'opération | **oui** |
| Étranger avec SMPD polonais **passif** | **non** |
| Assujetti polonais réalisant **WDT, export, prestation B2B intracommunautaire** | **oui** — « Faktury dokumentujące np. WDT, eksport towarów czy świadczenie usług na rzecz zagranicznych podatników są **obowiązkowo wystawiane w KSeF** » |

**La Pologne n'exclut donc pas le transfrontalier du mandat** — contrairement à la France et à
l'Italie. Elle le maintient dans le champ de l'**émission**, et traite l'extranéité à l'étape
suivante, distincte : la **mise à disposition**. L'art. 106gb ust. 4 est une **disjonction à six
branches** dont la première est purement géographique (`miejsce świadczenia ∉ PL`), imposant une
remise « w sposób z nim uzgodniony » assortie d'un **code QR** obligatoire (art. 106gb ust. 5,
spécifié par Dz.U. 2025 poz. 1815, norme ISO/IEC 18004:2024). Pour l'acquéreur étranger, le document
porteur du QR **est** la facture.

Effet secondaire à modéliser : **deux horloges de date de réception** — date d'attribution du numéro
KSeF pour un acquéreur ordinaire, date de réception effective hors KSeF pour tout acquéreur relevant
de l'art. 106gb ust. 4.

Seule dérogation réellement transfrontalière : l'**autofacturation** par un acquéreur UE dépourvu de
NIP polonais (rozporządzenie Dz.U. 2025 poz. 1740, § 2 pkt 5 et § 3).

### La généralisation que je retire

J'avais écrit que les juridictions vérifiées posaient toutes « le même schéma : mandat domestique à
déclencheur bilatéral, transfrontalier renvoyé vers une obligation déclarative distincte ». **C'est
faux.** La Pologne est unilatérale et garde le transfrontalier dans le champ de l'émission.

Le constat correct est plus fort, pas plus faible :

| Pays | Déclencheur | Transfrontalier |
| --- | --- | --- |
| France | **bilatéral** (art. 289 bis I) | hors mandat → e-reporting art. 290 |
| Allemagne | **bilatéral** (§ 14 Abs. 2 S. 3 UStG) | hors mandat → ZM § 18a |
| Italie | résidents ou établis (à préciser) | hors mandat → données c. 3-bis |
| **Pologne** | **unilatéral — vendeur seul** | **dans le mandat**, extranéité traitée au canal de remise |

**La règle de rattachement varie d'un pays à l'autre.** Une stratégie de résolution unique est donc
fausse quel que soit le choix retenu : la résolution « fournisseur seul » du moteur se trouve être
juste pour la Pologne et fausse pour la France et l'Allemagne. Cela ne réhabilite pas F-017, cela
l'aggrave — il ne suffit pas d'ajouter le pays de l'acheteur, il faut que **le déclencheur lui-même
soit une donnée du profil**, au même titre que le régime ou l'archivage.

### Espagne — deux régimes, deux déclencheurs opposés

Traité dans la section Espagne ci-dessus. En résumé : **Veri\*Factu** est **unilatéral** et attaché à
un **statut fiscal de l'émetteur**, indépendamment de l'opération — une facture à un client étranger
génère un registro comme une facture domestique. Le **mandat B2B** du RD 238/2026 est au contraire
**bilatéral et dominé par l'acheteur** : il se déclenche « cuando el destinatario […] **tenga en
España la sede de su actividad económica, o tenga en España un establecimiento permanente** ». Une
résolution fondée sur le vendeur s'y trompe **dans les deux sens**.

### Mexique — unilatéral à l'émission, bilatéral au cycle de vie

Traité dans la section Mexique ci-dessus. L'obligation d'émettre dépend **exclusivement du statut de
l'émetteur** ; le pays de l'acheteur ne conditionne jamais l'applicabilité, il ne modifie que le
contenu des champs (`Exportacion`, RFC générique étranger, `ResidenciaFiscal`). En revanche
l'**annulation** est bilatérale et temporisée — acceptation du récepteur, tacite au bout de trois
jours.

---

---

## ViDA — vérifié en source primaire

Directive (UE) 2025/516, texte consolidé sur
[EUR-Lex, CELEX 32025L0516](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025L0516),
consulté le **2026-08-27**. Publication au JO : **2025-03-25** (série L, 2025/516).

| Disposition | Contenu établi | Statut |
| --- | --- | --- |
| **Art. 6(1)** | « Member States may apply the laws, regulations and administrative provisions regarding Article 1, points 2 and 3 **from 14 April 2025** » — soit les modifications des art. 218 et 232 de la directive 2006/112/CE | **en vigueur** |
| **Art. 6(4)** | Article **4** : adoption au 2029-06-30, application au **2029-07-01** | annoncé |
| **Art. 6(5)** | Article **5** : adoption au 2030-06-30, application au **2030-07-01** | annoncé |
| **Art. 6(5), 3ᵉ alinéa** | **Report au 2035-01-01** — disposition opérative, voir ci-dessous | annoncé |
| **Art. 5 → nouvel art. 218** | Impose la facture électronique conforme à **la norme européenne** et à la liste de ses syntaxes au titre de la **directive 2014/55/UE**, avec données structurées selon les art. 262 et 271b | annoncé, 2030-07-01 |
| **Art. 5 → nouvel art. 232** | Une facture électronique conforme à la norme européenne **ne requiert pas l'acceptation du destinataire** ; les autres formats peuvent y rester soumis selon le droit national | annoncé, 2030-07-01 |
| **Art. 5(6) → art. 222** | Émission « **no later than 10 days following the chargeable event** » | annoncé, 2030-07-01 |
| **Art. 7** | Entrée en vigueur « on the **twentieth day** following that of its publication » — publication au JO le 2025-03-25, directive adoptée à Bruxelles le **2025-03-11** | en vigueur |

### Le report au 2035 : établi, et c'est une disposition opérative

*Correction. Deux rendus HTML successifs de la page CELEX se sont tronqués au même endroit, et
j'avais consigné le report comme non établi, en notant qu'un considérant n'est pas une disposition
opérative. Le PDF du Journal officiel, converti localement, donne le texte. J'avais aussi attribué
par erreur la date du 2030-07-01 à l'art. 6(4) : celui-ci porte sur l'**article 4** et le
2029-07-01. C'est l'art. 6(5) qui porte l'article 5.*

Troisième alinéa de l'art. 6(5), verbatim :

> « By way of derogation from the second subparagraph of this paragraph, Member States **having a
> domestic digital real-time transaction-based reporting obligation in place on 1 January 2024** or
> having been granted an authorisation on the basis of Article 395 before 1 January 2024 allowing
> them to put such an obligation in place, or where such authorisation was not necessary, having
> adopted national legislation before 1 January 2024 providing for the introduction of such a
> domestic digital real-time transaction-based reporting obligation, **shall apply the measures
> regarding Article 5, point (5), related to Article 218, and the measures regarding Article 5,
> point (19), related to Articles 271a and 271b, by 1 January 2035**, in so far as **domestic**
> electronic invoicing and reporting are concerned. »

Trois voies d'éligibilité, alternatives : obligation **déjà en place** au 2024-01-01 ; **autorisation
art. 395** obtenue avant cette date ; ou, si l'autorisation n'était pas nécessaire, **législation
nationale adoptée** avant cette date prévoyant l'introduction d'une telle obligation.

Le report est **borné** : il ne couvre que l'art. 218 et les art. 271a/271b, et **uniquement pour la
facturation et le reporting domestiques**. L'intracommunautaire reste au 2030-07-01. Une clause de
revoyure permet en outre à la Commission, si le rapport intermédiaire de l'art. 271c révèle des
lacunes, de proposer un report supplémentaire.

**Portée pratique.** L'Espagne (SII depuis juillet 2017), l'Italie (SdI) et la Hongrie relèvent
manifestement de la première voie ; la France et la Pologne, dont les dispositifs ont été adoptés
avant 2024, relèvent au moins de la troisième. Un profil qui coderait « EN 16931 obligatoire au
2030-07-01 » pour ces pays serait donc trop strict de cinq ans sur leur périmètre domestique.

### L'Espagne ouvre-t-elle une des trois voies ? — analyse, et ce qui reste ouvert

La question mérite d'être posée voie par voie plutôt que laissée en bloc.

| Voie de l'art. 6(5) | Application à l'Espagne | Verdict |
| --- | --- | --- |
| 1. Obligation **en place** au 2024-01-01 | Le **SII** fonctionne depuis juillet 2017 et est transactionnel — mais son délai de remise est de **quatre jours**. « Real-time » n'est pas défini par la directive. | **incertain** |
| 2. Autorisation **art. 395** obtenue avant le 2024-01-01 | L'Espagne ne figure pas dans les dérogations « Articles 218 and 232 » de la Commission, et n'en a jamais demandé. | **non** |
| 3. **Législation nationale adoptée** avant le 2024-01-01 prévoyant l'introduction d'une telle obligation | Le **RD 1007/2023 est du 5 décembre 2023**, donc antérieur au 2024-01-01, et il institue Veri\*Factu — dont la modalité vérifiable est définie par une remisión « **automática, continua e instantánea** » des registres. | **paraît rempli** |

**La voie 3 est la plus solide**, et elle ne dépend pas de la qualification du SII : la date
d'adoption est vérifiable, et « automática, continua e instantánea » correspond mot pour mot à ce que
« real-time transaction-based » décrit. Si elle est retenue, **l'horizon domestique espagnol glisse du
2030-07-01 au 2035-01-01**, et tout le volet ES doit se lire à cette échéance.

`open_question` — je ne le tranche pas, pour deux raisons précises et non par prudence de façade :
la directive ne définit **ni** « real-time » **ni** « transaction-based », et l'appréciation de la
voie 3 suppose de qualifier Veri\*Factu au regard de termes non définis. C'est une position que la
Commission ou l'administration espagnole doit prendre, pas moi. Ce qui est **établi** : la voie 2 est
exclue, et la voie 3 repose sur une date antérieure vérifiée.

**Conséquence immédiate, et elle est datée du 2025-04-14** : un État membre n'a plus besoin d'une
dérogation du Conseil au titre de l'art. 395 pour imposer la facturation électronique domestique sans
acceptation du destinataire. L'option figure désormais directement dans la directive. Cela explique
que ni la France ni l'Espagne n'aient eu à en demander une pour leurs dispositifs récents.

### Ce qui reste ouvert sur ViDA

1. **EN 16931-1:2026** : la directive renvoie à « la norme européenne […] au titre de la directive
   2014/55/UE » **sans nommer de version**. Qu'une version 2026 ait été publiée par le CEN en mars
   2026, et qu'elle soit « figée », **n'a pas été vérifié** et ne figure pas dans le texte de la
   directive. `open_question`.
2. La qualification de « real-time » pour le SII espagnol (remise à quatre jours) au sens du
   troisième alinéa de l'art. 6(5) — la directive ne définit pas le terme.

---

# SYNTHÈSE DES SIX PAYS

La phase 2 est complète. Trois constats transversaux, chacun vérifié dans plusieurs juridictions.

## 1. La numérotation est fausse dans cinq pays sur six

| Pays | Ce que le profil déclare | Ce que le droit exige |
| --- | --- | --- |
| France | `GAPLESS_SELF` | **exact** — « séquence chronologique **et continue** » |
| Allemagne | `GAPLESS_SELF` | **faux** — « **einmalig** » ; « eine lückenlose Abfolge […] ist nicht zwingend » |
| Pologne | `GAPLESS_SELF` | sur-contrainte — seule l'**unicité** est contrôlée |
| Italie | `GAPLESS_SELF` | **faux** — « numero progressivo che la identifichi in modo **univoco** » |
| Espagne | `GAPLESS_SELF` | non sourcé — « correlativa **dentro de cada serie** », l'interdiction des trous n'est écrite nulle part ; et **cinq cas de séries obligatoirement séparées** sont ignorés |
| Mexique | `AUTHORITY_RANGE` | **faux** — `Serie` et `Folio` sont `optional`, l'UUID vient du PAC |

**Un seul pays sur six est correctement modélisé.** Et le rapprochement avec **F-002** est cruel : le
produit impose une contrainte que cinq de ses six marchés n'exigent pas — tout en ne la tenant pas
là où elle est réellement exigée.

## 2. L'archivage est mal modélisé dans les six

| Pays | Profil | Réalité |
| --- | --- | --- |
| France | 10 ans | **6 ans** fiscal (LPF L102 B) ; les 10 ans sont commerciaux |
| Allemagne | 10 ans | **8 ans** depuis le 2025-01-01 (§ 14b Abs. 1 S. 1) |
| Italie | 10 ans | 10 ans **prolongés** jusqu'à définition des contrôles |
| Pologne | 10 ans, à la charge du contribuable | 10 ans **à la charge de KSeF**, le contribuable en est **dispensé** |
| Espagne | 10 ans | plancher **6 ans**, jusqu'à ~14 ans pour l'immobilier |
| Mexique | 5 ans depuis l'émission | 5 ans **depuis le dépôt de la déclaration**, perpétuel pour certains actes |

Aucun des six n'est juste. Et la **localisation des données** est fausse dans les deux sens : la
France (LPF L102 C), l'Allemagne (§ 14b Abs. 2, autorisation préalable hors UE) et l'Italie imposent
des contraintes que les profils **omettent**, tandis que le Mexique se voit **imposer** une résidence
que le droit sourcé n'exige pas.

## 3. Le canal illicite — un pays, pas trois

**Correction d'une première rédaction de cette synthèse.** J'avais écrit que `EMAIL` figurait dans
les profils FR, PL et IT et qu'il y était illicite dans les trois. C'est vrai pour la **France
seulement**.

Les profils sont **temporels**, et deux des trois font déjà le bon découpage : la Pologne abandonne
l'e-mail au **2026-02-01** pour KSeF, l'Italie au **2019-01-01** pour le SdI. Seule la France le
conservait dans sa période postérieure au 2026-09-01.

L'erreur venait de mon propre inventaire, qui aplatit délibérément **toutes** les périodes — un
choix défendable pour un audit, qui doit voir les règles révolues, mais qui rend le résultat
inexploitable tel quel pour juger de l'état courant. Toute lecture de `profile.channels` dans
`inventory.json` porte ce biais.

Ce qui subsiste, et qui est le vrai point : en retirant `EMAIL` de la France, on lui retire **le seul
canal qui fonctionnait sans configuration**. PDP et Peppol exigent des identifiants, Chorus Pro n'a
aucun transport. La France non configurée n'émet donc plus rien du tout — c'est le résultat correct,
et il est désormais visible plutôt que masqué par un canal sanctionné.
