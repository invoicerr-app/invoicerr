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

**PL-D4 — `canaux: EMAIL` : le code est faux en modélisation.**
KSeF est le **seul** canal d'émission légale. L'e-mail n'est qu'un mode convenu de **mise à
disposition** pour les acquéreurs de l'art. 106gb ust. 4 — jamais un substitut. Traiter `EMAIL`
comme un canal pair risque une émission hors KSeF, sanctionnable dès le 2027-01-01.

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

**IT-D8 — `canaux: EMAIL` : faux ou ambigu.** Les canaux SdI sont **PEC** (≠ e-mail ordinaire), la
procédure web/app AdE, **SDICoop** et **SDIFTP**.

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

### Reste à établir

Espagne et Mexique : agents relancés, résultats non parvenus. Ne rien inférer.

---

## ViDA — vérifié en source primaire

Directive (UE) 2025/516, texte consolidé sur
[EUR-Lex, CELEX 32025L0516](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32025L0516),
consulté le **2026-08-27**. Publication au JO : **2025-03-25** (série L, 2025/516).

| Disposition | Contenu établi | Statut |
| --- | --- | --- |
| **Art. 6(1)** | « Member States may apply the laws, regulations and administrative provisions regarding Article 1, points 2 and 3 **from 14 April 2025** » — soit les modifications des art. 218 et 232 de la directive 2006/112/CE | **en vigueur** |
| **Art. 6(4)** | « Member States shall adopt and publish, **by 30 June 2030** […] necessary to comply with Article 5 […] They shall apply those measures **from 1 July 2030** » | annoncé |
| **Art. 5 → nouvel art. 218** | Impose la facture électronique conforme à **la norme européenne** et à la liste de ses syntaxes au titre de la **directive 2014/55/UE**, avec données structurées selon les art. 262 et 271b | annoncé, 2030-07-01 |
| **Art. 5 → nouvel art. 232** | Une facture électronique conforme à la norme européenne **ne requiert pas l'acceptation du destinataire** ; les autres formats peuvent y rester soumis selon le droit national | annoncé, 2030-07-01 |
| **Art. 5(6) → art. 222** | Émission « **no later than 10 days following the chargeable event** » | annoncé, 2030-07-01 |

**Conséquence immédiate, et elle est datée du 2025-04-14** : un État membre n'a plus besoin d'une
dérogation du Conseil au titre de l'art. 395 pour imposer la facturation électronique domestique sans
acceptation du destinataire. L'option figure désormais directement dans la directive. Cela explique
que ni la France ni l'Espagne n'aient eu à en demander une pour leurs dispositifs récents.

### Ce qui reste ouvert sur ViDA

1. **Report au 2035-01-01** pour les États disposant d'un reporting transactionnel en temps réel
   avant le 2024-01-01 : **non établi**. L'art. 6(5) est tronqué dans le rendu obtenu ; une échéance
   2035 apparaît au **considérant 24**, mais elle y vise les systèmes **domestiques**, et un
   considérant n'est pas une disposition opérative. Deux sources indépendantes de cet audit
   l'affirment ; je ne le retiens pas tant que l'art. 6(5) n'a pas été lu. Enjeu réel : si l'Espagne
   en bénéficie au titre du SII (2017), son horizon d'alignement glisse de cinq ans.
2. **EN 16931-1:2026** : la directive renvoie à « la norme européenne […] au titre de la directive
   2014/55/UE » **sans nommer de version**. Qu'une version 2026 ait été publiée par le CEN en mars
   2026, et qu'elle soit « figée », **n'a pas été vérifié** et ne figure pas dans le texte de la
   directive. `open_question`.
3. **Art. 7** (entrée en vigueur de la directive elle-même) : non lisible dans le rendu obtenu. La
   date du 2025-04-14 est établie par l'art. 6(1), pas par l'art. 7.

## État de la phase 2 au 2026-08-27

| Pays | Rapport principal | Volet transfrontalier |
| --- | --- | --- |
| France | **complet** | **complet** |
| Pologne | **complet** | interrompu |
| Allemagne | **complet** | interrompu |
| Italie | **complet** | interrompu |
| Espagne | **manquant** — seul un addendum a été transmis | interrompu |
| Mexique | **manquant** | interrompu |

Cinq des six agents ont été interrompus par une limite de service (réinitialisation annoncée à
18 h 20, Europe/Paris). L'Espagne a produit un addendum substantiel — recalibrant notamment sa durée
de conservation à un **plancher de 6 ans** (Código de Comercio art. 30.1 combiné à LGT art. 70.2),
et non 4 — mais son rapport principal, auquel cet addendum se réfère, n'a jamais été transmis.
**Aucune divergence espagnole ou mexicaine n'est donc consignée ici** : les inférer serait
exactement ce que cet audit s'interdit.
