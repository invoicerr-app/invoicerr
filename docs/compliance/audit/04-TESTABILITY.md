# 04 — Testabilité réelle (Phase 3)

> Périmètre volontairement restreint, sur instruction : **pas les 54 portails**. Uniquement les
> 4 canaux `PROVEN`, les portails des 6 pays retenus pour la phase 2, et Chorus Pro. Cartographier
> les sandboxes de 41 stubs reviendrait à refaire l'erreur des 106 pages.
>
> **Discipline de sourçage.** Sources primaires uniquement — autorité fiscale, journal officiel,
> spécification technique publiée par l'autorité. Chaque affirmation porte son URL et sa date de
> consultation. Chaque règle porte sa date d'entrée en vigueur et son statut. Ce qui n'a pas été
> établi reste `open_question` — jamais une valeur plausible.
>
> **Toutes les consultations : 2026-08-27.**
>
> Rappel du plafond : un portail non testable ne peut pas dépasser **L2**, quelle que soit la
> qualité du code. C'est ce document qui fixe ce plafond.

---

## 0. Ce que la phase 3 change, et ce qu'elle ne change pas

Elle **ne tranche pas** la décision 2 (faut-il continuer à proposer les canaux `IMPLEMENTED`).
Ce point était déjà réglé mécaniquement : 17 providers `IMPLEMENTED` sur 17 n'ont aucun transport
atteignable, un sandbox accessible n'y change rien tant qu'aucune ligne de code ne peut l'appeler.
Corrigé séparément sur `fix/channel-ui-gate-on-reachable-transport`.

Elle **tranche** le plafond atteignable par canal, et elle a produit un fait qui dépasse largement
la testabilité — voir §2, France.

---

## 1. Verdict par cible

| Cible | Sandbox officiel | Accès | Plafond |
| --- | --- | --- | --- |
| KSeF (PL) | oui — `api-test.ksef.mf.gov.pl` | **libre**, données anonymisées | L4 atteignable |
| Chorus Pro (FR, B2G) | oui — portail de qualification via PISTE | **libre**, inscription développeur | L4 atteignable |
| OZG-RE / Peppol (DE, B2G) | oui — environnement de test OZG-RE | **libre et gratuit** | L4 atteignable |
| PPF / plateforme agréée (FR) | oui — environnement de qualification AIFE | **réservé aux plateformes agréées** | L2 sans immatriculation |
| Peppol (réseau) | oui — Peppol Testbed | **certificat PKI AP de test requis** | L2 sans statut Service Provider |
| SdI (IT) | oui — ambiente di test | **accréditation préalable obligatoire** | L2 sans accréditation |
| Veri\*Factu / AEAT (ES) | oui — `preportal.aeat.es` | prérequis **non établis** | `open_question` |
| SAT / CFDI (MX) | pas de timbrado direct — passage par un PAC | **contrat commercial avec un PAC** | L2 sans PAC |
| E-mail (SMTP) | sans objet | libre | déjà éprouvé |

---

## 2. France — le fait qui dépasse la testabilité

**L'usage d'une plateforme agréée est obligatoire. Une entreprise ne peut pas transmettre
directement avec son propre logiciel.**

> « Seule une plateforme agréée est habilitée à assurer toutes les fonctionnalités prévues »
> — [impots.gouv.fr, Facturation électronique et plateformes agréées](https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees), consulté le 2026-08-27

> « Les entreprises assujetties devront […] recourir aux services d'une plateforme agréée pour
> transmettre et recevoir leurs factures électroniques et pour adresser des données de transactions
> et de paiement à l'administration »
> — même source, consultée le 2026-08-27

| Règle | Date d'entrée en vigueur | Statut au 2026-08-27 |
| --- | --- | --- |
| Recours obligatoire à une plateforme agréée | **2026-09-01** | **en vigueur dans 5 jours** |

Immatriculation : dossier en ligne sur `demarche.numerique.gouv.fr`, instruction par le Service
d'Immatriculation de la DGFiP, **validité 3 ans renouvelable**. La page cite des « garanties
suffisantes » et une « capacité à assurer les fonctions attendues » sans détailler les exigences
techniques ; l'obligation d'établissement dans l'UE n'est pas énoncée sur cette page.
→ `open_question` : exigences précises d'immatriculation (audits, certifications type ISO 27001 /
SecNumCloud, garanties financières, lieu d'établissement). Non établies depuis une source primaire.

Environnement de qualification AIFE — [impots.gouv.fr, publication du 2025-10-08](https://www.impots.gouv.fr/actualite/immatriculation-des-plateformes-agreees-levee-des-reserves-ouverture-de-lenvironnement-de),
consulté le 2026-08-27 :

- ouverture le **2025-10-14 à 14 h** ;
- comptes rendus de tests d'interopérabilité attendus au plus tard le **2026-01-14** ;
- instruction AIFE : 2 mois après dépôt.

La page s'adresse exclusivement aux plateformes agréées et **ne dit pas** si un éditeur non
immatriculé peut y accéder. → `open_question`, mais l'absence de tout chemin d'accès documenté vaut
présomption d'inaccessibilité.

Première liste publiée : **101 plateformes agréées, le 2026-01-16**
([economie.gouv.fr](https://www.economie.gouv.fr/actualites/facturation-electronique-la-liste-des-101-premieres-plateformes-agreees-est-disponible), consulté le 2026-08-27).

### Conséquence pour Invoicerr

Elle est structurelle, et elle valide l'architecture existante plutôt qu'elle ne l'invalide :

- une instance self-hosted **ne peut pas** transmettre légalement des factures françaises par
  elle-même — `self_hosted_anonymous: only_with_provider` ;
- se connecter à une plateforme agréée tierce est le seul chemin praticable sans immatriculation, et
  c'est exactement ce que fait le provider `pdp` ;
- devenir soi-même plateforme agréée est possible mais suppose l'immatriculation DGFiP —
  `with_publisher_entity: requires_certification`.

**Chorus Pro reste un cas distinct et bien plus accessible.** Le portail de qualification est ouvert
aux éditeurs : un compte PISTE génère automatiquement une application `APP_SANDBOX_<email>` dédiée à
l'environnement de qualification, sur jeu de données fictif
([Communauté Chorus Pro — Portail de qualification](https://communaute.chorus-pro.gouv.fr/portail-de-qualification/?lang=en), consulté le 2026-08-27).
C'est le seul canal français aujourd'hui testable sans démarche d'immatriculation — et le provider
`choruspro` ne peut pourtant rien émettre (F-009). L'écart est ici entièrement dans le code, pas
dans l'accès.

---

## 3. Pologne — KSeF, le cas le plus favorable

Trois environnements publiés par le ministère des Finances
([ksef.podatki.gov.pl — wsparcie dla integratorów](https://ksef.podatki.gov.pl/ksef-na-okres-obligatoryjny/wsparcie-dla-integratorow/), consulté le 2026-08-27) :

| Environnement | URL | Données |
| --- | --- | --- |
| Test (intégration) | `https://api-test.ksef.mf.gov.pl` | **anonymisées** |
| Préproduction (Demo) | `https://api-demo.ksef.mf.gov.pl` | identifiants réels, cohérents avec le registre |
| Production | `https://api.ksef.mf.gov.pl` | réelles |

La documentation indique explicitement que l'environnement d'intégration s'utilise avec des données
anonymisées, là où la préproduction exige des identifiants d'authentification réels. **Aucune
inscription, aucun contrat, aucune approbation ministérielle n'est documentée pour l'environnement
de test.** Un éditeur étranger ou une instance self-hosted peut donc y accéder.

Calendrier ([gov.pl / KAS](https://www.gov.pl/web/finanse/we-wrzesniu-zamiana-srodowisk-testowych-z-ksef-10-na-ksef-20), consulté le 2026-08-27) :

| Jalon | Date | Statut au 2026-08-27 |
| --- | --- | --- |
| Documentation API KSeF 2.0 publiée | 2025-06-30 | passé |
| Arrêt de l'environnement de test KSeF 1.0 | 2025-09-01 | passé |
| Ouverture des tests ouverts API KSeF 2.0 | 2025-09-30 | passé |
| Préproduction (Demo) disponible | 2025-10-15 | passé |
| Module Certyfikatów i Uprawnień (MCU) | 2025-11-01 | passé |
| **KSeF 2.0 obligatoire** | **2026-02-01** | **en vigueur** |

→ **L4 est atteignable pour KSeF sans aucune démarche.** C'est le canal où l'écart entre le
plafond théorique et la preuve détenue est le plus facile à combler.

---

## 4. Italie — accréditation avant test

L'accréditation **précède** le test, elle ne le suit pas. Le processus passe par un accord de
service conclu via le [Sistema di Accreditamento](https://accreditamento.fatturapa.gov.it/), puis
des tests d'interopérabilité, puis une demande de passage en production
([fatturapa.gov.it — Sperimentazione](https://www.fatturapa.gov.it/it/sistemainterscambio/sperimentazione/), consulté le 2026-08-27).

- Canaux : SDICoop (web service), SDIFTP, SPCoop. Un canal SFTP accrédité active toujours émission
  **et** réception ; un canal WS peut être accrédité dans un seul sens.
- Les codes destinataires de test s'obtiennent dans le système d'accréditation, section
  « Test di interoperabilità — Gestione test interoperabilità — Codici destinatario » : 6 caractères
  pour la PA, 7 pour le B2B.
- Les factures émises en test **n'ont aucune valeur juridique ni fiscale**.
- Une limite journalière de transmission est appliquée : « Al fine di evitare il sovraccarico
  dell'ambiente di test, è stato posto un limite giornaliero alla trasmissione di file e supporti ».

**Non établi** : qui peut accréditer un canal. La FAQ dédiée à l'accréditation ne traite que la
gestion des accréditations existantes et ne donne aucune condition d'éligibilité. Partita IVA
italienne requise ? Identifiants Entratel/Fisconline ? Certificat qualifié ? Éditeur étranger
admis ? → `open_question`. À reprendre auprès du Sistema di Accreditamento lui-même.

Conséquence : le plafond de `sdi` est **L2** tant qu'une accréditation n'est pas obtenue — et le
provider ne peut de toute façon rien émettre (port par défaut qui `throw`).

---

## 5. Peppol — statut de Service Provider requis

L'accès au [Peppol Testbed](https://peppol.org/tools-support/testbed/) (consulté le 2026-08-27)
exige un **certificat de test Peppol PKI AP** importé dans le magasin du navigateur :

> « Service Providers must have obtained a Peppol PKI AP – Test Certificate, and have it imported in
> their browser's keystore in order to access the new test suites and test cases. »

Le rapport de test réussi sert ensuite de pièce justificative à la demande de certificat de
production. Les certificats PKI se demandent via le service desk d'OpenPeppol.

**Non établi sur cette page** : si l'adhésion à OpenPeppol et la signature d'un accord Service
Provider sont formellement obligatoires, et si des frais s'appliquent. La page ne le dit pas.
→ `open_question`. Ce qui est établi, c'est qu'un certificat AP de test est nécessaire, et qu'il est
délivré à des *Service Providers* — une instance self-hosted qui n'est pas SP n'y accède pas
directement.

Conséquence : `self_hosted_anonymous: only_with_provider` pour Peppol. Le code du dépôt en tient
déjà compte (adaptateurs d'AP tiers : `peppol-sh`, `storecove`).

---

## 6. Allemagne — le plus ouvert, pour le périmètre B2G

- Consolidation ZRE → OZG-RE à l'été 2025 ; **fin d'exploitation de ZRE le 2025-12-31**. OZG-RE est
  depuis l'unique plateforme fédérale de dépôt
  ([e-rechnung-bund.de — Platform consolidation](https://e-rechnung-bund.de/en/platform-consolidation/), consulté le 2026-08-27).
- **Inscription libre et gratuite** sur OZG-RE, à tout moment ; connexion possible via le compte
  entreprise ELSTER.
- Environnement de test OZG-RE disponible : une fois la transmission Peppol validée en test, on peut
  émettre en production
  ([FAQ — How can I send test invoices via Peppol to the OZG-RE portal](https://e-rechnung-bund.de/en/faq/how-can-i-send-test-invoices-via-peppol-to-the-ozg-re-portal/), consulté le 2026-08-27).
- Trois voies pour Peppol, dont un **web service fédéral gratuit** : demande informelle à
  `peppol.support@nortal.com` pour obtenir le « starter package ». Alternative : passer par un
  Peppol service provider vérifié.

→ **L4 atteignable pour le B2G allemand sans démarche lourde.** Attention au périmètre : ceci couvre
le dépôt de factures à l'administration fédérale, **pas** le futur régime B2B allemand, dont le
calendrier n'a pas été vérifié ici. → `open_question` pour le B2B DE.

---

## 7. Espagne — partiellement établi

- Un portail de tests externes existe : **`https://preportal.aeat.es`**
  ([AEAT — Información técnica, SIF et Veri\*Factu](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html), consulté le 2026-08-27).
- La page ne documente **ni** les prérequis d'accès (certificat électronique ? NIF espagnol ?
  inscription ?), **ni** les capacités exposées. → `open_question`.
- La certification des systèmes passe par une **déclaration responsable** du producteur du logiciel.
  La page renvoie à des exemples mais n'énonce pas les exigences, et ne dit pas si un producteur
  établi hors d'Espagne peut en émettre une. → `open_question` — point décisif pour le verdict
  « avec entité éditrice » en phase 4.
- FAQ développeurs mise à jour le **2025-12-04**.

Le calendrier Veri\*Factu et l'existence d'une prorogation de délai d'adaptation apparaissent dans
l'index du site (« NOTA INFORMATIVA: Ampliación del plazo de adaptación ») mais **n'ont pas été
vérifiés** contre la note elle-même. → `open_question`, à faire en phase 2. Ne rien inférer d'ici.

---

## 8. Mexique — pas d'accès direct, par conception

- Le timbrado passe obligatoirement par un **PAC** (Proveedor Autorizado de Certificación), acteur
  privé autorisé par le SAT. Le PAC valide, timbre, et transmet copie à l'autorité
  ([SAT — Proveedores Autorizados de Certificación](https://www.sat.gob.mx/consulta/76969/proveedores-autorizados-de-certificacion-(pac%C2%B4s)-), consulté le 2026-08-27).
- Le SAT délivre des **certificats de sceau numérique (CSD) de test**, inutilisables en production.
- Devenir PAC suppose une autorisation du SAT selon l'**Anexo 1-A de la RMF** en vigueur, avec
  notamment être à jour de ses obligations fiscales — donc une présence fiscale mexicaine.
- CFDI 4.0 : en vigueur depuis le **2022-01-01**, seule version valide depuis le **2023-04-01**.

Conséquence : `self_hosted_anonymous: only_with_provider` (un PAC commercial). Le modèle `pac` du
dépôt — un port injectable plutôt qu'un protocole unique — est le bon choix d'architecture ; il n'a
simplement aucune implémentation par défaut.

**Non établi** : si un PAC expose un sandbox librement accessible, et à quelles conditions. Cela
dépend de chaque PAC, pas du SAT. → `open_question`.

---

## 9. Ce que ce document ne dit pas

- Il ne dit pas si les règles de facturation de ces pays sont correctement implémentées — c'est la
  phase 2.
- Il ne dit pas si Invoicerr peut obtenir tel statut ou telle certification, ni à quel coût — c'est
  la phase 4.
- Il ne couvre **pas** les 54 portails nationaux, par décision de périmètre. Leur testabilité reste
  entièrement inconnue, et leur plafond reste donc L2 par défaut, faute d'information contraire.
- Les `open_question` ci-dessus sont des trous réels, pas des formules de prudence : chacun bloque
  une conclusion précise, et chacun est adressable par une source identifiée.
