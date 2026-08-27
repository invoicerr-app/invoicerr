# 00 — Inventaire mécanique (Phase 0)

> Généré par `scripts/audit/inventory.ts` le 2026-08-27, **en vigueur au 2026-08-27**.
>
> **Arbre mesuré** : `d59073253213cb6f4771e9e1172bad65760d6ec7` (propre sur les chemins mesurés).
> **Date de référence** : `2026-08-27` (`AUDIT_AS_OF` pour la déplacer). Tout champ dérivé
> d’un profil est calculé **en vigueur à cette date**, jamais aplati sur toutes les périodes.
>
> ⚠️ **Les champs `everDeclared*` de `inventory.json` n’établissent RIEN sur l’état en vigueur.**
> Ils aplatissent toutes les périodes temporelles, périodes **abrogées** comprises. C’est
> exactement cet aplatissement qui a produit deux findings faux (PL-D4, IT-D8) et une synthèse
> transversale fausse avant correction. **Aucun finding ne doit s’y adosser** : ils servent à lire
> l’histoire d’un profil, jamais à juger ce qu’il déclare aujourd’hui. Pour l’état courant, et
> pour lui seul, utiliser les champs de premier niveau — qui sont, eux, filtrés par `as_of`.
> Les champs issus des profils sont les règles **en vigueur** à cette date, pas la totalité des
> périodes déclarées. Rejouer à une autre date : `AUDIT_AS_OF=YYYY-MM-DD`. **Aucun jugement, aucune
> vérification juridique, aucune recherche web.** Uniquement ce qui existe dans le dépôt,
> obtenu en chargeant les registres réels et en lisant les fichiers.
>
> Toute colonne de ce document est une *observation*, pas une *conformité*. Un pays présent
> partout dans ce tableau peut être entièrement non conforme : ce fichier ne le dit pas.

## 1. Volumétrie

| Objet | Compte | Source |
| --- | ---: | --- |
| Profils pays chargés (`ALL_PROFILES`) | 106 | runtime |
| dont profils bespoke | 8 | `BESPOKE_PROFILES` |
| Fiches pays publiées (`documentation/compliance/*.md`) | 106 | disque |
| Routes publiques générées (`/compliance/<cc>`) | 106 | plugin Docusaurus |
| Providers de transmission enregistrés | 62 | runtime |
| dont produits par la fabrique stub `national-portals.ts` | 54 | runtime |
| Providers de format produits par `national-formats.ts` (bytes vides) | 42 | runtime |
| Schémas vendorisés sur disque (.xsd/.sch) | 20 | disque |
| Specs sous `src/compliance` | 123 | disque |
| dont specs live (nom `-live.spec.ts` ou usage `liveDescribe`) | 12 | disque |

### Maturités déclarées

| Maturité | Nb | Providers |
| --- | ---: | --- |
| `IMPLEMENTED` | 17 | afip, anaf, choruspro, dian, eg-eta, es-face, firs, gib, id-coretax, in-irp, ke-kra, myinvois, sdi, sefaz, sii, sri, uy-dgi |
| `PROVEN` | 4 | email, ksef, pdp, peppol |
| `STUB` | 41 | al-cis, bd-nbr, bj-dgi, bo-sin, ci-dgi, cn-sta, cr-hacienda, dgii, es-aeat, gh-gra, gr-aade, gt-sat, hr-fiskalizacija, hu-nav, jofotara, kz-isesf, lv-vid, me-fiscal, np-ird, ose, pa-dgi, pac, ph-bir, pk-fbr, print, rs-sef, rw-rra, seniat, sifen, sk-financnasprava, sv-mh, th-rd, tn-ttn, tw-mof, tz-tra, ua-dps, ug-ura, vn-gdt, zatca, zm-zra, zw-zimra |

### Specs live existantes et ce qu’elles exigent

| Spec | Flag | Variables d’env requises |
| --- | --- | --- |
| `backend/src/compliance/nest/apply-signal.live.spec.ts` | — | (aucune) |
| `backend/src/compliance/nest/full-pipeline-peppol.live.spec.ts` | `PEPPOL_LIVE` | (aucune) |
| `backend/src/compliance/providers/signing/tsa-live.spec.ts` | `TSA_LIVE` | `TSA_URL` |
| `backend/src/compliance/providers/transmission/choruspro-live.spec.ts` | `CHORUSPRO_LIVE` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET` |
| `backend/src/compliance/providers/transmission/email-live.spec.ts` | `EMAIL_LIVE` | (aucune) |
| `backend/src/compliance/providers/transmission/ksef/ksef-live.spec.ts` | `KSEF_LIVE` | `KSEF_AUTH_TOKEN` |
| `backend/src/compliance/providers/transmission/pdp/pdp-afnor-live.spec.ts` | `PDP_AFNOR_LIVE` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` |
| `backend/src/compliance/providers/transmission/pdp/pdp-live.spec.ts` | `PDP_LIVE` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` |
| `backend/src/compliance/providers/transmission/peppol/peppol-live.spec.ts` | `PEPPOL_LIVE` | `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` |
| `backend/src/compliance/providers/transmission/peppol/peppol-sh-live.spec.ts` | `PEPPOL_LIVE` | (aucune) |
| `backend/src/compliance/providers/transmission/portal-live.spec.ts` | — | (aucune) |
| `backend/src/compliance/providers/transmission/sdi/sdi-live.spec.ts` | `SDI_LIVE` | `SDI_ID_TRASMITTENTE`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` |

Harnais paramétré générique sur tous les portails nationaux : présent (`backend/src/compliance/providers/transmission/portal-live.spec.ts`).

> Fait mécanique : le dépôt ne contient **aucune trace machine-lisible d’une exécution live réussie** (pas de fichier de résultat, pas d’horodatage de dernier run, pas d’artefact de réponse d’autorité versionné). Les dates de « dernier run » n’existent que dans de la prose. Rien ici ne les confirme ni ne les infirme.

## 2. Matrice pays × capacités

Légende — `providers` : `id(maturité)`, `⊘` = aucun transport atteignable tel que câblé
(zéro site d’appel réseau dans le voisinage source, port jamais injecté par le registre).
`fmt` : `SYNTAXE→provider`, `∅` = builder à bytes vides, `!` = `validate()` accepte un document vide.

| Pays | Profil | Conf. | Régime | Fiche | status/progress | Canaux | Providers | Formats | Specs live |
| --- | :-: | --- | --- | :-: | --- | --- | --- | --- | --- |
| **AE** United Arab Emirates | archétype | BEST_EFFORT | DECENTRALIZED_CTC/REAL_TIME_REPORTING | ✓ | mandatory/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | PEPPOL_BIS→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **AL** Albania | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:al-cis | al-cis(STUB)⊘ | AL_FISCALIZATION→al-fiscalization∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **AO** Angola | archétype | BEST_EFFORT | PERIODIC_REPORTING | ✓ | mandatory/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **AR** Argentina | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:afip | afip(IMPLEMENTED)⊘ | AR_FE→ar-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **AT** Austria | archétype | BEST_EFFORT | POST_AUDIT | ✓ | post-audit/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **AU** Australia | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **BA** Bosnia and Herzegovina | archétype | PLANNED | POST_AUDIT | ✓ | planned/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **BD** Bangladesh | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:bd-nbr | bd-nbr(STUB)⊘ | BD_NBR→bd-nbr∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **BE** Belgium | archétype | BEST_EFFORT | DECENTRALIZED_CTC/REAL_TIME_REPORTING | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | PEPPOL_BIS→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **BG** Bulgaria | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **BH** Bahrain | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **BJ** Benin | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:bj-dgi | bj-dgi(STUB)⊘ | BJ_MECEF→bj-mecef∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **BO** Bolivia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:bo-sin | bo-sin(STUB)⊘ | BO_FE→bo-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **BR** Brazil | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:sefaz | sefaz(IMPLEMENTED)⊘ | NFE→nfe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CA** Canada | archétype | OFFICIAL | POST_AUDIT | ✓ | voluntary/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **CH** Switzerland | archétype | OFFICIAL | POST_AUDIT | ✓ | —/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **CI** Ivory Coast | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | phased/— | GOV_PORTAL_API:ci-dgi | ci-dgi(STUB)⊘ | CI_FNE→ci-fne∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CL** Chile | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:sii | sii(IMPLEMENTED)⊘ | CL_DTE→cl-dte∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CM** Cameroon | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **CN** China | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:cn-sta | cn-sta(STUB)⊘ | CN_EFAPIAO→cn-efapiao∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CO** Colombia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:dian | dian(IMPLEMENTED)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CR** Costa Rica | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:cr-hacienda | cr-hacienda(STUB)⊘ | CR_FE→cr-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **CY** Cyprus | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **CZ** Czechia | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **DE** Germany | bespoke | OFFICIAL | POST_AUDIT | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | XRECHNUNG→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **DK** Denmark | archétype | BEST_EFFORT | POST_AUDIT | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **DO** Dominican Republic | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:dgii | dgii(STUB)⊘ | DO_ECF→do-ecf∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **DZ** Algeria | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **EC** Ecuador | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:sri | sri(IMPLEMENTED)⊘ | EC_FE→ec-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **EE** Estonia | archétype | BEST_EFFORT | POST_AUDIT | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **EG** Egypt | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:eg-eta | eg-eta(IMPLEMENTED)⊘ | EG_ETA→eg-eta∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **ES** Spain | bespoke | OFFICIAL | REAL_TIME_REPORTING | ✓ | phased/— | GOV_PORTAL_API:es-face<br>GOV_PORTAL_API:es-aeat<br>PEPPOL<br>EMAIL | es-face(IMPLEMENTED)⊘<br>es-aeat(STUB)⊘<br>peppol(PROVEN)<br>email(PROVEN) | ES_FACTURAE→es-facturae!<br>PLAIN_PDF→plain-pdf! | 3 |
| **ET** Ethiopia | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **FI** Finland | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **FR** France | bespoke | OFFICIAL | POST_AUDIT | ✓ | phased/in-progress | EMAIL | email(PROVEN) | EN16931_CII→en16931!<br>FACTURX→en16931! | 1 |
| **GB** United Kingdom | archétype | OFFICIAL | POST_AUDIT | ✓ | —/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **GH** Ghana | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:gh-gra | gh-gra(STUB)⊘ | GH_EVAT→gh-evat∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **GR** Greece | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | phased/— | GOV_PORTAL_API:gr-aade | gr-aade(STUB)⊘ | NATIONAL_XML→national-xml!<br>PLAIN_PDF→plain-pdf! | 0 |
| **GT** Guatemala | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:gt-sat | gt-sat(STUB)⊘ | GT_FEL→gt-fel∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **HN** Honduras | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **HR** Croatia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:hr-fiskalizacija | hr-fiskalizacija(STUB)⊘ | HR_ERACUN→hr-eracun∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **HU** Hungary | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:hu-nav | hu-nav(STUB)⊘ | NATIONAL_XML→national-xml!<br>PLAIN_PDF→plain-pdf! | 0 |
| **ID** Indonesia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:id-coretax | id-coretax(IMPLEMENTED)⊘ | ID_EFAKTUR→id-efaktur∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **IE** Ireland | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | PEPPOL_BIS→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **IN** India | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:in-irp | in-irp(IMPLEMENTED)⊘ | IN_IRP→in-irp∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **IT** Italy | bespoke | OFFICIAL | CLEARANCE | ✓ | mandatory/in-progress | SDI | sdi(IMPLEMENTED)⊘ | FATTURAPA→fatturapa-1.2!<br>PLAIN_PDF→plain-pdf! | 1 |
| **JO** Jordan | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:jofotara | jofotara(STUB)⊘ | JO_JOFOTARA→jo-jofotara∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **JP** Japan | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **KE** Kenya | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:ke-kra | ke-kra(IMPLEMENTED)⊘ | KE_ETIMS→ke-etims∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **KW** Kuwait | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **KZ** Kazakhstan | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:kz-isesf | kz-isesf(STUB)⊘ | KZ_ESF→kz-esf∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **LI** Liechtenstein | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **LK** Sri Lanka | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **LT** Lithuania | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **LU** Luxembourg | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **LV** Latvia | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | phased/— | GOV_PORTAL_API:lv-vid | lv-vid(STUB)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **MA** Morocco | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **MC** Monaco | bespoke | OFFICIAL |  | ✓ | phased/— | — | — | — | 0 |
| **MD** Moldova | archétype | BEST_EFFORT | POST_AUDIT | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **ME** Montenegro | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | phased/— | GOV_PORTAL_API:me-fiscal | me-fiscal(STUB)⊘ | ME_FISCAL→me-fiscal∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **MK** North Macedonia | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **MT** Malta | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **MX** Mexico | bespoke | OFFICIAL | CLEARANCE | ✓ | mandatory/in-progress | PAC | pac(STUB)⊘ | CFDI→cfdi-4.0!<br>PLAIN_PDF→plain-pdf! | 0 |
| **MY** Malaysia | archétype | BEST_EFFORT | CLEARANCE | ✓ | phased/— | GOV_PORTAL_API:myinvois | myinvois(IMPLEMENTED)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **MZ** Mozambique | archétype | BEST_EFFORT | PERIODIC_REPORTING | ✓ | mandatory/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **NG** Nigeria | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:firs | firs(IMPLEMENTED)⊘ | NG_FIRS→ng-firs∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **NI** Nicaragua | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **NL** Netherlands | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **NO** Norway | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **NP** Nepal | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:np-ird | np-ird(STUB)⊘ | NP_CBMS→np-cbms∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **NZ** New Zealand | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **OM** Oman | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **PA** Panama | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:pa-dgi | pa-dgi(STUB)⊘ | PA_FE→pa-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **PE** Peru | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | OSE | ose(STUB)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **PH** Philippines | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:ph-bir | ph-bir(STUB)⊘ | PH_EIS→ph-eis∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **PK** Pakistan | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:pk-fbr | pk-fbr(STUB)⊘ | PK_FBR→pk-fbr∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **PL** Poland | bespoke | OFFICIAL | CLEARANCE | ✓ | phased/in-progress | GOV_PORTAL_API:ksef | ksef(PROVEN) | FA_VAT→fa-vat!<br>PLAIN_PDF→plain-pdf! | 1 |
| **PT** Portugal | archétype | BEST_EFFORT | PERIODIC_REPORTING | ✓ | mandatory/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **PY** Paraguay | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:sifen | sifen(STUB)⊘ | PY_DE→py-de∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **QA** Qatar | archétype | PLANNED | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **RO** Romania | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:anaf | anaf(IMPLEMENTED)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **RS** Serbia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:rs-sef | rs-sef(STUB)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **RW** Rwanda | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:rw-rra | rw-rra(STUB)⊘ | RW_EBM→rw-ebm∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **SA** Saudi Arabia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:zatca | zatca(STUB)⊘ | KSA_UBL→ksa-ubl!<br>PLAIN_PDF→plain-pdf! | 0 |
| **SE** Sweden | archétype | BEST_EFFORT | POST_AUDIT | ✓ | —/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **SG** Singapore | archétype | BEST_EFFORT | DECENTRALIZED_CTC/REAL_TIME_REPORTING | ✓ | phased/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | PEPPOL_BIS→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **SI** Slovenia | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | PEPPOL<br>EMAIL | peppol(PROVEN)<br>email(PROVEN) | PEPPOL_BIS→en16931!<br>PLAIN_PDF→plain-pdf! | 3 |
| **SK** Slovakia | archétype | BEST_EFFORT | POST_AUDIT | ✓ | voluntary/— | GOV_PORTAL_API:sk-financnasprava | sk-financnasprava(STUB)⊘ | EN16931_UBL→en16931!<br>PLAIN_PDF→plain-pdf! | 0 |
| **SM** San Marino | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | SDI | sdi(IMPLEMENTED)⊘ | FATTURAPA→fatturapa-1.2!<br>PLAIN_PDF→plain-pdf! | 1 |
| **SN** Senegal | archétype | PLANNED | POST_AUDIT | ✓ | planned/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **SV** El Salvador | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:sv-mh | sv-mh(STUB)⊘ | SV_DTE→sv-dte∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **TH** Thailand | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:th-rd | th-rd(STUB)⊘ | TH_ETAX→th-etax∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **TN** Tunisia | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:tn-ttn | tn-ttn(STUB)⊘ | TN_TEIF→tn-teif∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **TR** Turkey | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:gib | gib(IMPLEMENTED)⊘ | TR_EFATURA→tr-efatura∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **TW** Taiwan | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:tw-mof | tw-mof(STUB)⊘ | TW_EGUI→tw-egui∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **TZ** Tanzania | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:tz-tra | tz-tra(STUB)⊘ | TZ_VFD→tz-vfd∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **UA** Ukraine | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:ua-dps | ua-dps(STUB)⊘ | UA_TAXINVOICE→ua-taxinvoice∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **UG** Uganda | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:ug-ura | ug-ura(STUB)⊘ | UG_EFRIS→ug-efris∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **US** United States | bespoke | OFFICIAL | POST_AUDIT | ✓ | voluntary/in-progress | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf! | 1 |
| **UY** Uruguay | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:uy-dgi | uy-dgi(IMPLEMENTED)⊘ | UY_CFE→uy-cfe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **VA** Vatican City | archétype | OFFICIAL | POST_AUDIT | ✓ | mandatory/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **VE** Venezuela | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:seniat | seniat(STUB)⊘ | VE_FE→ve-fe∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **VN** Vietnam | archétype | BEST_EFFORT | CLEARANCE | ✓ | mandatory/— | GOV_PORTAL_API:vn-gdt | vn-gdt(STUB)⊘ | VN_TT78→vn-tt78∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **ZA** South Africa | archétype | OFFICIAL | POST_AUDIT | ✓ | planned/— | EMAIL | email(PROVEN) | PLAIN_PDF→plain-pdf!<br>EN16931_UBL→en16931! | 1 |
| **ZM** Zambia | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:zm-zra | zm-zra(STUB)⊘ | ZM_SMARTINVOICE→zm-smartinvoice∅!<br>PLAIN_PDF→plain-pdf! | 0 |
| **ZW** Zimbabwe | archétype | BEST_EFFORT | REAL_TIME_REPORTING | ✓ | mandatory/— | GOV_PORTAL_API:zw-zimra | zw-zimra(STUB)⊘ | ZW_FDMS→zw-fdms∅!<br>PLAIN_PDF→plain-pdf! | 0 |

## 3. Matrice de divergence

### Catégorie 1a — Fiche publique **sans aucun** transport atteignable (56)

> Vue **en vigueur au 2026-08-27**. Une première version de cette matrice
> aplatissait toutes les périodes temporelles, périodes abrogées comprises : elle comptait 48 pays
> ici, parce que des canaux e-mail depuis longtemps abrogés faisaient paraître certains pays
> joignables. Le chiffre corrigé est **plus lourd**, pas plus léger.

Critère mécanique : une page `/compliance/<cc>` est générée, mais aucun `ChannelSpec` du profil
ne résout — via `defaultTransmissionRegistry.resolve()`, la logique de production — vers un
provider disposant d’un site d’appel réseau. Pour ces pays, `transmit()` ne peut structurellement
rien émettre : le résultat est `SKIPPED` ou une exception interne.

| Pays | Route publique | status fiche | Régime déclaré | Canaux du profil | Providers résolus |
| --- | --- | --- | --- | --- | --- |
| AL Albania | `/compliance/al` | mandatory | CLEARANCE | GOV_PORTAL_API:al-cis | al-cis(STUB)⊘ |
| AR Argentina | `/compliance/ar` | mandatory | CLEARANCE | GOV_PORTAL_API:afip | afip(IMPLEMENTED)⊘ |
| BD Bangladesh | `/compliance/bd` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:bd-nbr | bd-nbr(STUB)⊘ |
| BJ Benin | `/compliance/bj` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:bj-dgi | bj-dgi(STUB)⊘ |
| BO Bolivia | `/compliance/bo` | mandatory | CLEARANCE | GOV_PORTAL_API:bo-sin | bo-sin(STUB)⊘ |
| BR Brazil | `/compliance/br` | mandatory | CLEARANCE | GOV_PORTAL_API:sefaz | sefaz(IMPLEMENTED)⊘ |
| CI Ivory Coast | `/compliance/ci` | phased | REAL_TIME_REPORTING | GOV_PORTAL_API:ci-dgi | ci-dgi(STUB)⊘ |
| CL Chile | `/compliance/cl` | mandatory | CLEARANCE | GOV_PORTAL_API:sii | sii(IMPLEMENTED)⊘ |
| CN China | `/compliance/cn` | mandatory | CLEARANCE | GOV_PORTAL_API:cn-sta | cn-sta(STUB)⊘ |
| CO Colombia | `/compliance/co` | mandatory | CLEARANCE | GOV_PORTAL_API:dian | dian(IMPLEMENTED)⊘ |
| CR Costa Rica | `/compliance/cr` | mandatory | CLEARANCE | GOV_PORTAL_API:cr-hacienda | cr-hacienda(STUB)⊘ |
| DO Dominican Republic | `/compliance/do` | mandatory | CLEARANCE | GOV_PORTAL_API:dgii | dgii(STUB)⊘ |
| EC Ecuador | `/compliance/ec` | mandatory | CLEARANCE | GOV_PORTAL_API:sri | sri(IMPLEMENTED)⊘ |
| EG Egypt | `/compliance/eg` | mandatory | CLEARANCE | GOV_PORTAL_API:eg-eta | eg-eta(IMPLEMENTED)⊘ |
| GH Ghana | `/compliance/gh` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:gh-gra | gh-gra(STUB)⊘ |
| GR Greece | `/compliance/gr` | phased | REAL_TIME_REPORTING | GOV_PORTAL_API:gr-aade | gr-aade(STUB)⊘ |
| GT Guatemala | `/compliance/gt` | mandatory | CLEARANCE | GOV_PORTAL_API:gt-sat | gt-sat(STUB)⊘ |
| HR Croatia | `/compliance/hr` | mandatory | CLEARANCE | GOV_PORTAL_API:hr-fiskalizacija | hr-fiskalizacija(STUB)⊘ |
| HU Hungary | `/compliance/hu` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:hu-nav | hu-nav(STUB)⊘ |
| ID Indonesia | `/compliance/id` | mandatory | CLEARANCE | GOV_PORTAL_API:id-coretax | id-coretax(IMPLEMENTED)⊘ |
| IN India | `/compliance/in` | mandatory | CLEARANCE | GOV_PORTAL_API:in-irp | in-irp(IMPLEMENTED)⊘ |
| IT Italy | `/compliance/it` | mandatory | CLEARANCE | SDI | sdi(IMPLEMENTED)⊘ |
| JO Jordan | `/compliance/jo` | mandatory | CLEARANCE | GOV_PORTAL_API:jofotara | jofotara(STUB)⊘ |
| KE Kenya | `/compliance/ke` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:ke-kra | ke-kra(IMPLEMENTED)⊘ |
| KZ Kazakhstan | `/compliance/kz` | mandatory | CLEARANCE | GOV_PORTAL_API:kz-isesf | kz-isesf(STUB)⊘ |
| LV Latvia | `/compliance/lv` | phased | REAL_TIME_REPORTING | GOV_PORTAL_API:lv-vid | lv-vid(STUB)⊘ |
| MC Monaco | `/compliance/mc` | phased |  | — | **aucun** |
| ME Montenegro | `/compliance/me` | phased | REAL_TIME_REPORTING | GOV_PORTAL_API:me-fiscal | me-fiscal(STUB)⊘ |
| MX Mexico | `/compliance/mx` | mandatory | CLEARANCE | PAC | pac(STUB)⊘ |
| MY Malaysia | `/compliance/my` | phased | CLEARANCE | GOV_PORTAL_API:myinvois | myinvois(IMPLEMENTED)⊘ |
| NG Nigeria | `/compliance/ng` | mandatory | CLEARANCE | GOV_PORTAL_API:firs | firs(IMPLEMENTED)⊘ |
| NP Nepal | `/compliance/np` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:np-ird | np-ird(STUB)⊘ |
| PA Panama | `/compliance/pa` | mandatory | CLEARANCE | GOV_PORTAL_API:pa-dgi | pa-dgi(STUB)⊘ |
| PE Peru | `/compliance/pe` | mandatory | CLEARANCE | OSE | ose(STUB)⊘ |
| PH Philippines | `/compliance/ph` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:ph-bir | ph-bir(STUB)⊘ |
| PK Pakistan | `/compliance/pk` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:pk-fbr | pk-fbr(STUB)⊘ |
| PY Paraguay | `/compliance/py` | mandatory | CLEARANCE | GOV_PORTAL_API:sifen | sifen(STUB)⊘ |
| RO Romania | `/compliance/ro` | mandatory | CLEARANCE | GOV_PORTAL_API:anaf | anaf(IMPLEMENTED)⊘ |
| RS Serbia | `/compliance/rs` | mandatory | CLEARANCE | GOV_PORTAL_API:rs-sef | rs-sef(STUB)⊘ |
| RW Rwanda | `/compliance/rw` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:rw-rra | rw-rra(STUB)⊘ |
| SA Saudi Arabia | `/compliance/sa` | mandatory | CLEARANCE | GOV_PORTAL_API:zatca | zatca(STUB)⊘ |
| SK Slovakia | `/compliance/sk` | voluntary | POST_AUDIT | GOV_PORTAL_API:sk-financnasprava | sk-financnasprava(STUB)⊘ |
| SM San Marino | `/compliance/sm` | mandatory | CLEARANCE | SDI | sdi(IMPLEMENTED)⊘ |
| SV El Salvador | `/compliance/sv` | mandatory | CLEARANCE | GOV_PORTAL_API:sv-mh | sv-mh(STUB)⊘ |
| TH Thailand | `/compliance/th` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:th-rd | th-rd(STUB)⊘ |
| TN Tunisia | `/compliance/tn` | mandatory | CLEARANCE | GOV_PORTAL_API:tn-ttn | tn-ttn(STUB)⊘ |
| TR Turkey | `/compliance/tr` | mandatory | CLEARANCE | GOV_PORTAL_API:gib | gib(IMPLEMENTED)⊘ |
| TW Taiwan | `/compliance/tw` | mandatory | CLEARANCE | GOV_PORTAL_API:tw-mof | tw-mof(STUB)⊘ |
| TZ Tanzania | `/compliance/tz` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:tz-tra | tz-tra(STUB)⊘ |
| UA Ukraine | `/compliance/ua` | mandatory | CLEARANCE | GOV_PORTAL_API:ua-dps | ua-dps(STUB)⊘ |
| UG Uganda | `/compliance/ug` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:ug-ura | ug-ura(STUB)⊘ |
| UY Uruguay | `/compliance/uy` | mandatory | CLEARANCE | GOV_PORTAL_API:uy-dgi | uy-dgi(IMPLEMENTED)⊘ |
| VE Venezuela | `/compliance/ve` | mandatory | CLEARANCE | GOV_PORTAL_API:seniat | seniat(STUB)⊘ |
| VN Vietnam | `/compliance/vn` | mandatory | CLEARANCE | GOV_PORTAL_API:vn-gdt | vn-gdt(STUB)⊘ |
| ZM Zambia | `/compliance/zm` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:zm-zra | zm-zra(STUB)⊘ |
| ZW Zimbabwe | `/compliance/zw` | mandatory | REAL_TIME_REPORTING | GOV_PORTAL_API:zw-zimra | zw-zimra(STUB)⊘ |

### Catégorie 1b — Régime clearance/temps réel avec le courriel pour seule sortie (0)

**Cette catégorie est vide, et son contenu antérieur était entièrement un artefact.**

Elle listait 8 pays — AL, EG, HR, IT, MY, NG, RO, SA — présentés comme déclarant un régime de
clearance tout en n’ayant que le courriel pour sortir. Aucun n’était réel : la matrice aplatissait
les périodes temporelles, et ces pays portaient un canal `EMAIL` **abrogé** — l’Italie l’abandonne
au 2019-01-01, la Pologne au 2026-02-01. En vue « en vigueur », ils n’ont pas le courriel comme
seule sortie : ils n’ont **aucune sortie du tout**, et ils sont donc en catégorie 1a — ce qui
explique exactement les 8 pays qu’elle a gagnés.

L’énoncé corrigé est plus dur que le faux : ce n’est pas « le seul canal qui marche est illicite »,
c’est « il n’y a pas de canal ».


### Catégorie 2 — Provider présent **sans** schéma ni validation de format effective (105)

Critère mécanique : le pays a au moins un provider de transmission enregistré, mais au moins
une de ses syntaxes n'a aucun provider de format, ou est servie par un builder à bytes vides,
ou son `validate()` déclare `valid: true` sur l'entrée `<garbage/>`.

Plutôt que de répéter la même ligne pour chaque pays partageant une syntaxe, voici la sonde
par **syntaxe** (54 syntaxes distinctes réellement demandées par les profils), puis la liste
des pays concernés.

| Syntaxe | Provider | Builder à bytes vides | `<garbage/>` rejeté | **Document vide rejeté** | Pays |
| --- | --- | :-: | :-: | :-: | --- |
| `AL_FISCALIZATION` | al-fiscalization | ✓ | **non** | **non** | AL |
| `AR_FE` | ar-fe | ✓ | **non** | **non** | AR |
| `BD_NBR` | bd-nbr | ✓ | **non** | **non** | BD |
| `BJ_MECEF` | bj-mecef | ✓ | **non** | **non** | BJ |
| `BO_FE` | bo-fe | ✓ | **non** | **non** | BO |
| `CFDI` | cfdi-4.0 |  | ✓ | **non** | MX |
| `CI_FNE` | ci-fne | ✓ | **non** | **non** | CI |
| `CL_DTE` | cl-dte | ✓ | **non** | **non** | CL |
| `CN_EFAPIAO` | cn-efapiao | ✓ | **non** | **non** | CN |
| `CR_FE` | cr-fe | ✓ | **non** | **non** | CR |
| `DO_ECF` | do-ecf | ✓ | **non** | **non** | DO |
| `EC_FE` | ec-fe | ✓ | **non** | **non** | EC |
| `EG_ETA` | eg-eta | ✓ | **non** | **non** | EG |
| `EN16931_CII` | en16931 |  | **non** | **non** | FR |
| `EN16931_UBL` | en16931 |  | **non** | **non** | AO, AT, AU, BA, BG, BH, CA, CH … (47) |
| `ES_FACTURAE` | es-facturae |  | ✓ | **non** | ES |
| `FA_VAT` | fa-vat |  | ✓ | **non** | PL |
| `FACTURX` | en16931 |  | **non** | **non** | FR |
| `FATTURAPA` | fatturapa-1.2 |  | ✓ | **non** | IT, SM |
| `GH_EVAT` | gh-evat | ✓ | **non** | **non** | GH |
| `GT_FEL` | gt-fel | ✓ | **non** | **non** | GT |
| `HR_ERACUN` | hr-eracun | ✓ | **non** | **non** | HR |
| `ID_EFAKTUR` | id-efaktur | ✓ | **non** | **non** | ID |
| `IN_IRP` | in-irp | ✓ | **non** | **non** | IN |
| `JO_JOFOTARA` | jo-jofotara | ✓ | **non** | **non** | JO |
| `KE_ETIMS` | ke-etims | ✓ | **non** | **non** | KE |
| `KSA_UBL` | ksa-ubl |  | **non** | **non** | SA |
| `KZ_ESF` | kz-esf | ✓ | **non** | **non** | KZ |
| `ME_FISCAL` | me-fiscal | ✓ | **non** | **non** | ME |
| `NATIONAL_XML` | national-xml |  | **non** | **non** | GR, HU |
| `NFE` | nfe | ✓ | **non** | **non** | BR |
| `NG_FIRS` | ng-firs | ✓ | **non** | **non** | NG |
| `NP_CBMS` | np-cbms | ✓ | **non** | **non** | NP |
| `PA_FE` | pa-fe | ✓ | **non** | **non** | PA |
| `PEPPOL_BIS` | en16931 |  | ✓ | **non** | AE, BE, IE, SG, SI |
| `PH_EIS` | ph-eis | ✓ | **non** | **non** | PH |
| `PK_FBR` | pk-fbr | ✓ | **non** | **non** | PK |
| `PLAIN_PDF` | plain-pdf |  | **non** | **non** | AE, AL, AO, AR, AT, AU, BA, BD … (104) |
| `PY_DE` | py-de | ✓ | **non** | **non** | PY |
| `RW_EBM` | rw-ebm | ✓ | **non** | **non** | RW |
| `SV_DTE` | sv-dte | ✓ | **non** | **non** | SV |
| `TH_ETAX` | th-etax | ✓ | **non** | **non** | TH |
| `TN_TEIF` | tn-teif | ✓ | **non** | **non** | TN |
| `TR_EFATURA` | tr-efatura | ✓ | **non** | **non** | TR |
| `TW_EGUI` | tw-egui | ✓ | **non** | **non** | TW |
| `TZ_VFD` | tz-vfd | ✓ | **non** | **non** | TZ |
| `UA_TAXINVOICE` | ua-taxinvoice | ✓ | **non** | **non** | UA |
| `UG_EFRIS` | ug-efris | ✓ | **non** | **non** | UG |
| `UY_CFE` | uy-cfe | ✓ | **non** | **non** | UY |
| `VE_FE` | ve-fe | ✓ | **non** | **non** | VE |
| `VN_TT78` | vn-tt78 | ✓ | **non** | **non** | VN |
| `XRECHNUNG` | en16931 |  | **non** | **non** | DE |
| `ZM_SMARTINVOICE` | zm-smartinvoice | ✓ | **non** | **non** | ZM |
| `ZW_FDMS` | zw-fdms | ✓ | **non** | **non** | ZW |

**54 syntaxes sur 54 déclarent `valid: true` pour un document de zéro octet**, et 49 sur 54 pour `<garbage/>`.

Le second chiffre doit être lu avec la réserve Schematron rappelée plus haut (une règle qui ne trouve pas son contexte ne lève rien). Le premier n'a aucune réserve : `providers.ts:145` court-circuite explicitement — `if (!rendered.bytes.length) return okValidation(…'stub path')` — et les 42 providers de `national-formats.ts` renvoient `{ valid: true, warnings: ['… (stub)'] }` quoi qu’on leur passe. Un artefact vide traverse donc build → validate sans objection. Le comportement en aval (signature, archivage, transmission) est un point de la phase 1, pas d’ici.

Pays concernés par au moins une syntaxe non validée : 105.

### Catégorie 3 — Provider **sans aucune** spec live dédiée, jamais (56 / 62)

Critère mécanique : aucun fichier `*-live.spec.ts` / `*.live.spec.ts` n’est attribuable à cet id.
Le harnais paramétré `portal-live.spec.ts` boucle sur les 54 portails nationaux, mais cela prouve l'existence d'un point d'entrée de test, pas qu'il ait jamais été exécuté ni qu'il puisse l'être.

| Provider | Canal | Maturité | Fabrique | LOC voisinage | Transport tel que câblé | Pays référençants |
| --- | --- | --- | :-: | ---: | --- | --- |
| `afip` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1843 | aucun — aucun site d'appel réseau | AR |
| `anaf` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 2110 | aucun — port stub **codé en dur** | RO |
| `dian` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1780 | aucun — port par défaut = stub | CO |
| `eg-eta` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 2160 | aucun — port stub **codé en dur** | EG |
| `es-face` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 2113 | aucun — court-circuit `SKIPPED` | ES |
| `firs` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1958 | aucun — aucun site d'appel réseau | NG |
| `gib` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 2067 | aucun — port stub **codé en dur** | TR |
| `id-coretax` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1967 | aucun — aucun site d'appel réseau | ID |
| `in-irp` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 2011 | aucun — aucun site d'appel réseau | IN |
| `ke-kra` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1930 | aucun — aucun site d'appel réseau | KE |
| `myinvois` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1971 | aucun — aucun site d'appel réseau | MY |
| `sefaz` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1870 | aucun — aucun site d'appel réseau | BR |
| `sii` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1811 | aucun — port par défaut = stub | CL |
| `sri` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1777 | aucun — port par défaut = stub | EC |
| `uy-dgi` | GOV_PORTAL_API | IMPLEMENTED | dédiée | 1740 | aucun — port par défaut = stub | UY |
| `al-cis` | GOV_PORTAL_API | STUB | générique | 1168 | aucun — fabrique générique, `SKIPPED` | AL |
| `bd-nbr` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | BD |
| `bj-dgi` | GOV_PORTAL_API | STUB | générique | 1169 | aucun — fabrique générique, `SKIPPED` | BJ |
| `bo-sin` | GOV_PORTAL_API | STUB | générique | 1160 | aucun — fabrique générique, `SKIPPED` | BO |
| `ci-dgi` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | CI |
| `cn-sta` | GOV_PORTAL_API | STUB | générique | 1168 | aucun — fabrique générique, `SKIPPED` | CN |
| `cr-hacienda` | GOV_PORTAL_API | STUB | générique | 1160 | aucun — fabrique générique, `SKIPPED` | CR |
| `dgii` | GOV_PORTAL_API | STUB | générique | 1167 | aucun — fabrique générique, `SKIPPED` | DO |
| `es-aeat` | GOV_PORTAL_API | STUB | générique | 1168 | aucun — fabrique générique, `SKIPPED` | ES |
| `gh-gra` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | GH |
| `gr-aade` | GOV_PORTAL_API | STUB | générique | 1175 | aucun — fabrique générique, `SKIPPED` | GR |
| `gt-sat` | GOV_PORTAL_API | STUB | générique | 1160 | aucun — fabrique générique, `SKIPPED` | GT |
| `hr-fiskalizacija` | GOV_PORTAL_API | STUB | générique | 1174 | aucun — fabrique générique, `SKIPPED` | HR |
| `hu-nav` | GOV_PORTAL_API | STUB | générique | 1189 | aucun — fabrique générique, `SKIPPED` | HU |
| `jofotara` | GOV_PORTAL_API | STUB | générique | 1169 | aucun — fabrique générique, `SKIPPED` | JO |
| `kz-isesf` | GOV_PORTAL_API | STUB | générique | 1167 | aucun — fabrique générique, `SKIPPED` | KZ |
| `lv-vid` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | LV |
| `me-fiscal` | GOV_PORTAL_API | STUB | générique | 1169 | aucun — fabrique générique, `SKIPPED` | ME |
| `np-ird` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | NP |
| `ose` | OSE | STUB | dédiée | 1897 | aucun — port par défaut `throw` | PE |
| `pa-dgi` | GOV_PORTAL_API | STUB | générique | 1160 | aucun — fabrique générique, `SKIPPED` | PA |
| `pac` | PAC | STUB | dédiée | 1821 | aucun — port par défaut `throw` | MX |
| `ph-bir` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | PH |
| `pk-fbr` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | PK |
| `print` | PRINT | STUB | dédiée | 1640 | aucun — aucun site d'appel réseau | — |
| `rs-sef` | GOV_PORTAL_API | STUB | générique | 1168 | aucun — fabrique générique, `SKIPPED` | RS |
| `rw-rra` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | RW |
| `seniat` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | VE |
| `sifen` | GOV_PORTAL_API | STUB | générique | 1167 | aucun — fabrique générique, `SKIPPED` | PY |
| `sk-financnasprava` | GOV_PORTAL_API | STUB | générique | 1168 | aucun — fabrique générique, `SKIPPED` | SK |
| `sv-mh` | GOV_PORTAL_API | STUB | générique | 1166 | aucun — fabrique générique, `SKIPPED` | SV |
| `th-rd` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | TH |
| `tn-ttn` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | TN |
| `tw-mof` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | TW |
| `tz-tra` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | TZ |
| `ua-dps` | GOV_PORTAL_API | STUB | générique | 1161 | aucun — fabrique générique, `SKIPPED` | UA |
| `ug-ura` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | UG |
| `vn-gdt` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | VN |
| `zatca` | GOV_PORTAL_API | STUB | `log.todo` | 1504 | aucun — fabrique `log.todo` | SA |
| `zm-zra` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | ZM |
| `zw-zimra` | GOV_PORTAL_API | STUB | générique | 1162 | aucun — fabrique générique, `SKIPPED` | ZW |

### Catégorie 4 — Maturité déclarée que rien dans le dépôt ne justifie

`provider-maturity.spec.ts` assied ses trois classes sur `COMPLIANCE_AUDIT.md` et des notes
de handoff — c'est-à-dire sur de la prose, pas sur une preuve d'exécution. Le tableau ci-dessous
confronte la maturité déclarée aux seuls faits vérifiables mécaniquement.

| Provider | Maturité déclarée | Spec live dédiée | Transport tel que câblé | Sites d’appel réseau | Écart mécanique |
| --- | --- | :-: | --- | ---: | --- |
| `afip` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `anaf` | IMPLEMENTED | ✗ | aucun — port stub **codé en dur** | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `choruspro` | IMPLEMENTED | ✓ | aucun — port stub **codé en dur** | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre |
| `dian` | IMPLEMENTED | ✗ | aucun — port par défaut = stub | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `eg-eta` | IMPLEMENTED | ✗ | aucun — port stub **codé en dur** | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `es-face` | IMPLEMENTED | ✗ | aucun — court-circuit `SKIPPED` | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `firs` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `gib` | IMPLEMENTED | ✗ | aucun — port stub **codé en dur** | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `id-coretax` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `in-irp` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `ke-kra` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `myinvois` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `sdi` | IMPLEMENTED | ✓ | aucun — port par défaut `throw` | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre |
| `sefaz` | IMPLEMENTED | ✗ | aucun — aucun site d'appel réseau | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `sii` | IMPLEMENTED | ✗ | aucun — port par défaut = stub | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `sri` | IMPLEMENTED | ✗ | aucun — port par défaut = stub | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |
| `uy-dgi` | IMPLEMENTED | ✗ | aucun — port par défaut = stub | 0 | IMPLEMENTED alors que le transport par défaut ne peut rien émettre ; IMPLEMENTED sans spec live dédiée |

## 4. Divergences transverses

- Fiche publique **sans** profil moteur (0) : —
- Profil moteur **sans** fiche publique (0) : —
- Providers enregistrés qu'**aucun profil n'atteint** (3) : choruspro, pdp, print
  (résolution faite via `defaultTransmissionRegistry.resolve()` : un provider n'est "atteint" que s'il gagne réellement la résolution d'un `ChannelSpec` d'un profil.)

### Schémas vendorisés

| Répertoire | Fichiers |
| --- | --- |
| `de` | XRechnung-UBL-validation-preprocessed.sch |
| `en16931` | EN16931-CII-codes.sch, EN16931-CII-model.sch, EN16931-CII-syntax.sch, EN16931-CII-validation-preprocessed.sch, EN16931-CII-validation.sch, EN16931-UBL-validation-preprocessed.sch |
| `es` | Facturaev3_2_2.xsd, xmldsig-core-schema.xsd |
| `it` | Schema_VFPR12.xsd, xmldsig-core-schema.xsd |
| `mx` | catCFDI.xsd, cfdv40.xsd, tdCFDI.xsd |
| `peppol` | PEPPOL-EN16931-UBL.sch |
| `pl` | ElementarneTypyDanych_v10-0E.xsd, KodyKrajow_v10-0E.xsd, StrukturyDanych_v10-0E.xsd, schemat_FA2.xsd, schemat_FA3.xsd |

Les 20 schémas couvrent 7 espaces. Toutes les autres syntaxes déclarées dans les profils n’ont aucun schéma vendorisé — voir catégorie 2.

## 5. Ce que ce document ne dit pas

- Il ne dit pas si une règle légale est correcte : aucune source primaire n’a été consultée (phase 2).
- Il ne dit pas si un sandbox existe pour un portail donné (phase 3).
- Il ne dit pas si une fiche publique surpromet : la comparaison prose ↔ preuve est la phase 1.7 / le livrable `01-CLAIM-AUDIT.md`.
- La présence d'un provider `IMPLEMENTED` avec de l'I/O dans la source ne prouve pas que l'API distante existe, ni que le protocole est le bon.

