# TODO_ISSUES — ce qui n'a pas pu être fait, et pourquoi

> Tenu au fil de l'exécution du `TODO.md`. Chaque entrée dit ce qui bloque et ce qui le
> débloquerait — jamais un simple « échoué ».

## Rouges e2e permanents (7), connus et rattachés à des items du TODO

- ~~`05-clients` : 5 tests (Allemagne, Royaume-Uni)~~ — **RÉSOLU à l'item 19** (2026-09-01) :
  fichiers de/gb livrés avec les sources primaires lues (UStG, VAT Regulations 1995), spec 05 à
  23/23. La base de rouges permanents passe de 6 à UN (16-company-lookup, item 20).
- ~~`16-company-lookup` : 1 test (`expected 40 to be above 100`)~~ — **RÉSOLU à l'item 20**
  (2026-09-01, décision utilisateur : liste ISO complète) : 250 capabilities (REGISTER pour les
  registres dédiés, PARTIAL + note pour le reste via GLEIF/Peppol Directory), spec 16 à 7/7.
  **La base de rouges permanents est VIDE — première batterie intégralement verte.**
- ~~`14-articles` : pré-remplissage depuis le catalogue~~ — **RÉSOLU à la tâche 6** (2026-08-31) :
  le descripteur déclare `prefillFrom`, le formulaire générique offre « From catalog », la spec 14
  est à 10/10. La base de rouges permanents passe de 7 à 6.

## Limites consignées en cours de route

- ~~« Sent » avant l'envoi~~ (découvert à la tâche 4) — **RÉSOLU à l'item 22** (2026-08-31) : `send`
  déclare désormais `draft`/`send_failed` → `sending` → `sent` | `send_failed` (quote/invoice/
  credit-note — voir actions/async-send.ts). Le numéro est pris en ENTRANT dans `sending`, avant que
  la livraison ne soit même tentée ; un échec (PDF, SMTP, transport) après épuisement des retries
  BullMQ laisse `send_failed` avec l'erreur enregistrée et visible (`DocumentInstance.lastActionError`)
  — jamais `sent` sans livraison réelle. Le retry est l'action `send` elle-même, redisponible depuis
  `send_failed`.

- **`resetAndSeed` ne re-sème pas la politique pays** (découvert à la tâche 8) : les tables de
  référence sont exclues de la troncature, mais une NOUVELLE règle ajoutée aux JSON n'existe en
  base qu'après un `prisma db seed` manuel — sinon l'action est 403 en silence pour tout le monde.
  À automatiser un jour (seed au boot du backend de test, ou détection de dérive JSON↔base) ; en
  attendant, toute tâche qui touche `country-policy/data/*.json` doit re-semer les deux bases.

- **Les taux existent, mais paiements et avoirs ne convertissent toujours pas** (choix consigné à la
  tâche 9) : `record-payment` refuse toujours une devise étrangère et le lettrage ignore toujours un
  avoir en devise étrangère (avec warning nommé). C'est délibéré, pas un oubli : la consolidation du
  dashboard est un AFFICHAGE approximatif qui porte son taux ; un lettrage est une écriture exacte —
  y appliquer un taux saisi à la main déciderait en silence du montant réellement soldé. Si un jour
  le lettrage multi-devises est voulu, il faudra un taux PAR opération (saisi au moment du paiement,
  stocké sur lui), pas le taux ambiant de la société. Les briques (table `CurrencyRate`,
  `convertMinor`) sont prêtes pour ça.

- **`ClientsModule` inimportable sous ts-jest** (découvert à la tâche 22, préexistant) : la chaîne
  `ClientsModule → WebhooksModule → drivers/discord.driver.ts → @teever/ez-hook` (paquet JSR pur
  ESM) ne compile pas sous ts-jest. Tout futur test qui importera `ClientsModule` comme MODULE (pas
  seulement `ClientsService` en position de type) le redécouvrira ; le test d'intégration de la file
  (`queue/__tests__`) le contourne en construisant `DocumentsService` à la main. À trancher un jour :
  config ESM de ts-jest, ou remplacer la dépendance du driver Discord.

- **Le rattrapage des récurrences reste automatique, jamais confirmé par un humain** (item 5, tâche
  "les récurrences") : le balayage tire UNE occurrence par passage (jamais une rafale dans le MÊME
  passage — voir `documents/schedules/schedule-sweep.ts`), mais rien n'empêche plusieurs PASSAGES
  successifs de rattraper tout un retard tout seuls. Avec l'intervalle par défaut (60 s), une
  facture mensuelle en retard de trois mois finit quand même par produire trois duplicatas en trois
  minutes, sans qu'un humain n'ait rien validé — throttlé, jamais silencieux (chaque occurrence est
  visible, `lastRunAt`/`lastError` avancent), mais toujours automatique. Une alternative plus prudente
  existerait (un état "rattrapage en attente, à confirmer" dès qu'un schedule est trouvé plus d'UN
  cycle en retard, avant de tirer quoi que ce soit) — non retenue ici faute d'un vrai besoin produit
  exprimé, et pour ne pas inventer un mécanisme de confirmation supplémentaire sans qu'on l'ait
  demandé. À reconsidérer si un utilisateur relève un jour un rattrapage surprenant.

- **`invoice.duplicate` manquait de règle FR/US** (découvert en écrivant l'item 5, tâche "les
  récurrences") : l'extension "duplicate" n'était câblée QUE sur `quote` avant cette tâche —
  l'ajouter à `invoice` (nécessaire pour que le mécanisme de récurrence fonctionne) a immédiatement
  buté sur `invoice.duplicate` absent des deux fichiers de politique pays (fr.json, us.json), refusé
  par défaut (403) pour toute société. Ajouté aux deux (motif "commodité produit pure", `"kind":
  "unverified"` comme le reste), et les deux bases reseedées. À noter : `quote.duplicate` reste NON
  déclaré côté US — délibérément, comme trou "jamais examiné" gardé vivant et documenté dans us.json
  même (le bouton "Duplicate" d'un devis y est donc 403 en le disant) ; le combler serait le deviner,
  pas le trancher.

- **Aucun XSD racine UBL 2.1 / UN-CEFACT CII n'a jamais été vendoré dans ce dépôt** (item 12,
  "formats normalisés", tâche `formats/`) : vérifié sur TOUT l'historique git (pas seulement le
  repère `avant-refonte-documents`) avant d'écrire la moindre ligne — seuls des XSD NATIONAUX (PL
  FA(2)/FA(3), ES Facturae, IT FatturaPA, MX CFDI) et le Schematron EN 16931/Peppol/XRechnung ont
  jamais été vendorés ; l'ancien `providers.ts` lui-même ne validait CII/UBL EN 16931 de base QUE
  par Schematron. La porte « XSD » demandée pour cette tâche n'a donc pas de ruleset officiel à
  charger tel quel — fabriquer un XSD maison aurait été exactement le « compilateur maison »
  interdit. `formats/structural-check.ts` fait donc office de porte structurelle : bonne formation
  XML (`@xmldom/xmldom`, déjà whitelisté) + élément racine attendu (repris de `wrongRootElement` de
  l'ancien `providers.ts`), PUIS le vrai Schematron EN 16931 vendoré (`formats/vendored/`). Un futur
  format NATIONAL (PL/ES/IT/MX, hors périmètre ici) qui voudrait un vrai XSD n'aurait qu'à reprendre
  `validateXsd` du repère (`compliance/schemas/validate.ts`) — rien ne s'y oppose.

- ~~Factur-X : embarqueur existant au repère, NON repris~~ (item 12) — **RÉSOLU à l'item 10, vague 1**
  (2026-08-31) : `formats/facturx-provider.ts` fait exactement ce que cette entrée décrivait —
  `buildEuInvoiceForDocument` (partagé avec `cii-provider.ts`/`ubl-provider.ts`), le MÊME gate
  Schematron EN 16931 que le provider CII (jamais un CII non validé embarqué — la validation tourne
  sur le CII brut avant même de tenter le PDF), puis `service.generate(euInvoice, { format:
  'Factur-X-EN16931', pdf: {...} })` avec le PDF de `rendering/render-instance-pdf.ts`. Enregistré
  dans `format-registry.ts` (`id: 'facturx'`), troisième option `syntax` de `download-xml`, et
  transport `pdp` (`transports/pdp-transport.ts`) l'utilise comme payload de dépôt. Deux bugs réels
  du pont sémantique trouvés en poussant l'artefact jusqu'au VRAI dépôt PDP (jamais vus par le seul
  Schematron vendoré, qui ne vérifie pas l'ORDRE des éléments ni le routage) et corrigés dans
  `build-semantic-invoice.ts`, au bénéfice de CII/UBL aussi, pas seulement Factur-X :
  1. `ApplicableHeaderTradeDelivery` (BT-72) n'était jamais émis par `@e-invoice-eu/core` en l'absence
     de contenu — un `cac:Delivery: {}` vide ne suffit pas, il faut au moins `ActualDeliveryDate`. Le
     schéma CII exige pourtant cet élément de séquence, present ou non-fourni par le business — sans
     lui, superpdp refuse tout dépôt CII/Factur-X net : "ApplicableHeaderTradeSettlement... not
     expected. Expected is ApplicableHeaderTradeDelivery". Corrigé en calant BT-72 par défaut sur la
     date d'émission (une convention, jamais une règle fiscale — BT-72 n'a aucune incidence TVA).
  2. `endpointFor()` dérivait toujours l'adresse électronique (BT-34/BT-49) du LEGAL_ID (SIREN) —
     confondant l'identité légale et l'adresse de routage, deux faits EN 16931 distincts. Le SIREN
     n'est pas toujours une adresse de routage valide (le bac à sable superpdp refusait le dépôt :
     "receiver address <0225:...> does not accept this document"). Corrigé en lisant en priorité
     l'identifiant `PEPPOL_ENDPOINT` déjà collecté (et déjà persisté) par `company.settings.tsx`/
     `client-upsert.tsx` — une fonctionnalité écran existante, jamais branchée jusqu'ici au pont de
     formats. `explicitEndpointFor()`'s own header.

  ~~Reste NOMMÉ de cette vague : le dépôt réussit sur l'ACCUSÉ (`api:uploaded`, identifiant non vide,
  prouvé en réel — `transports/pdp/pdp.live.spec.ts`), jamais suivi au-delà. Construire le POLLER
  lui-même (l'ancien moteur avait un `InboxPoller`) est un chantier à part, non commencé ici.~~ —
  **RÉSOLU** (2026-09-01) : `conformity/` — un journal append-only (`DocumentAuthorityEvent`, dédup
  par `(documentId, providerId, statusCode)`, jamais un statut de descripteur muté — le cycle déclaré
  reste la vérité des actes de l'utilisateur, le verdict de la plateforme est une information de
  transport superposée), un sweep (`conformity-sweep-runner.ts`, même moule que le sweep des
  récurrences — un seul repeatable, un jobId par fenêtre d'horloge) et un `AuthorityStatusPoller` par
  provider (`pollers/pdp-status-poller.ts`, `pollers/ksef-status-poller.ts` — gaté, voir sa propre
  note d'honnêteté ; jamais "sdi", qui est du push SOAP, pas du poll). **Preuve live, avec le VRAI
  code du sweep (pas une copie)** : `pdp/pdp-conformity.live.spec.ts` — un dépôt conforme atteint
  fr:200→201→202 et le journal les contient réellement ; un dépôt délibérément non conforme (mentions
  BG-1 retirées de l'artefact embarqué) atteint fr:213 avec son motif réel
  ("BR-FR-05/BT-22 ... absente ... BG-1"), reproduit trois fois. Écran : section "Suivi de conformité"
  (timeline + badge) sur le document, indicateur discret sur la liste pour un rejet — rien pour un
  envoi par e-mail ou un canal sans poller (`document-conformity-section.tsx`).

  **MISE À JOUR (item 15, 2026-08-31) — les mentions BG-1 sont désormais émises, et le poll
  informationnel a changé de motif exactement comme prévu.** Le `fr:213 Rejetée` observé par un poll
  manuel pendant la vague 1 citait DEUX causes distinctes : les trois mentions BG-1 absentes (item 15,
  résolu par `documents/mentions/`) et BT-23 cadre de facturation (item 12, `business-process.ts`,
  toujours non branché — voir l'entrée dédiée ci-dessous). Une fois item 15 posé, le MÊME poll
  informationnel ne cite plus QUE BT-23 — les trois mentions ont bien disparu du motif de rejet, la
  preuve que ce dépôt exigeait. Un TROISIÈME bug réel trouvé par ce même poll, cette fois propre à
  item 15 : `facturx-provider.ts` (et `pdp.live.spec.ts`'s own manual recipe) demandent à
  `@e-invoice-eu/core` de RÉGÉNÉRER le CII en interne pour l'embarquage Factur-X, une copie que le
  correctif texte `splitCiiIncludedNotes` (appliqué au CII "plat" que le gate structurel+Schematron
  juge) n'atteint jamais — documenté comme "gap réel mais jamais atteint" tant que ce pont n'émettait
  jamais plus d'une note, et RÉELLEMENT atteint dès qu'un vendeur français a porté trois mentions plus
  sa propre note. Corrigé par `splitCiiIncludedNotesInObject` (`semantic/cii-post-process.ts`), câblé
  via `InvoiceServiceOptions.postProcessor` — le point d'extension PUBLIC de la librairie (appelé sur
  l'objet intermédiaire juste avant le rendu XML), jamais une resérialisation maison. Preuve OFFLINE
  ajoutée (`facturx-provider.spec.ts`, extraction du CII embarqué via `pdf-lib`'s `decodePDFRawStream`
  + le VRAI gate structurel+Schematron) : ce test échoue sans le correctif (vérifié en le retirant
  temporairement) et passe avec. BT-23 reste le seul point ouvert de ce dépôt — item 12, pas 15 (voir
  ci-dessous pourquoi le brancher n'est délibérément PAS fait ici).

- ~~**BT-151 (catégorie de TVA) : seules S et Z sont atteignables aujourd'hui**~~ — **AE, K, G et O
  DÉSORMAIS ATTEIGNABLES** (item 16, 2026-08-31) : EN 16931 distingue six catégories (S, Z, E, AE, K,
  G, O), chacune avec des exigences contradictoires (voir `formats/semantic/build-semantic-
  invoice.ts`'s own header, "VAT category"). `documents/tax/resolve-invoice-tax.ts` (item 16, "le
  transfrontalier") résout désormais le traitement fiscal réel d'une ligne CROISSANT UNE FRONTIÈRE
  (vendeur/acheteur de pays différents) via le moteur repris du repère
  (`documents/tax/tax-engine.ts`), et injecte la catégorie résolue dans le pont via un sidecar
  in-memory (`__crossBorderCategory`/`__crossBorderExemptionReason`/`__crossBorderMentions`, JAMAIS
  stocké — voir ce fichier's own header, "Never a blind store") — `build-semantic-invoice.ts` la
  préfère à sa propre dérivation naïve (`vatCategoryFor`, rate>0→S/rate=0→Z) quand elle existe.
  Preuve, jugée par le VRAI Schematron vendoré, pas une opinion : `documents/tax/cross-border-
  formats.spec.ts` — FR→DE B2B (VAT valide) → AE + art. 196 Directive 2006/112/EC ; FR→DE B2B biens →
  K + art. 138 ; FR→US B2B biens → G + art. 146 ; FR→US B2B services → O. `BR-AE-10`/ses sœurs (la
  raison d'exemption au niveau BG-23, jamais au niveau de la ligne — `@e-invoice-eu/core`'s own ajv
  schema refuse `cbc:TaxExemptionReasonCode` sur `cac:Item/cac:ClassifiedTaxCategory`, un vrai piège
  trouvé en poussant contre la vraie librairie, pas deviné) sont satisfaites via un VATEX code réel
  (`VATEX-EU-AE`/`VATEX-EU-IC`/`VATEX-EU-G`/`VATEX-EU-O`, les valeurs mêmes du moteur repris du
  repère, qui sont bien dans l'énumération `VATExemptionReasonCode` de `@e-invoice-eu/core`).
  **Reste NOMMÉ, pas deviné** : `E` (exonéré, franchise en base 293 B) reste INATTEIGNABLE — le
  chemin DOMESTIQUE (vendeur = acheteur pays) ne passe volontairement PAS par le moteur (item 16's
  own brief : "un envoi pure-domestique existant : rien ne change" — les tests existants dépendent
  de rate=0→Z pour une ligne franchise 293B, et les changer aurait été une régression, pas une
  correction demandée ici) ; une ligne domestique à 0% reste donc `Z`, jamais `E`, même pour un
  vendeur `hasDomesticZeroRate: false` (le moteur reprisé sait dériver `E` correctement — voir
  `tax-engine.ts#domesticCategoryFor` — mais la couche de câblage ne l'invoque jamais pour le cas
  domestique). Une invoice mixant DEUX catégories résolues au MÊME taux à 0% (ex. une ligne K biens
  + une ligne AE services dans la même facture transfrontalière) verrait tout le sous-total BG-23 à
  0% rapporté sous la catégorie de la PREMIÈRE ligne qui porte ce taux — `vatBreakdown`
  (`compute-totals.ts`, pur, inchangé) agrège par TAUX SEUL, jamais par (taux, catégorie) — limitation
  documentée dans `build-semantic-invoice.ts`'s own header, jamais rencontrée par les scénarios
  réels de cette tâche (un acheteur, un traitement) mais réelle en théorie. `formats/pitfalls.spec.ts`
  prouve depuis toujours que le GATE (Schematron) réagit correctement à E et O directement — c'est
  desormais le pont qui PRODUIT G/AE/K/O pour le cas transfrontalier ; E reste hors d'atteinte, par
  choix explicite pour ne pas régresser le domestique.

- ~~**BT-23 (cadre de facturation français) : logique reprise et testée, jamais branchée**~~ —
  **RÉSOLU** (2026-08-31, suite de l'item 12) : branché conditionnellement par pays via le nouveau
  `content-requirements/` (même moule que channel-policy : provenance `legal` obligatoire, gel à la
  date d'émission — citation verbatim 242 nonies A 8° bis vérifiée sur codes.droit.org le
  2026-08-31), alimenté par le premier VRAI overlay pays de `country-fields/` (sous-champ de ligne
  `supplyType` GOODS/SERVICES, optionnel, ajouté par fr.json — non déclaré → M1, la seule valeur qui
  n'affirme rien de faux). **Preuve live : la chaîne de conformité française est PLEINE** —
  fr:200 → fr:201 → fr:202 sans aucun motif, dépôts 392768/392770/392773 (agent) + 392820 (rejoué en
  validation de session). Limite honnête : la porte temporelle (mandatedFrom 2026-09-01) ne peut pas
  être exercée live AUJOURD'HUI (BT-2 ≤ date du jour côté sandbox, mandat demain) — le live prouve la
  mécanique avec le code appelé directement, la porte est prouvée par jest. Entrée d'origine ci-dessous.

  Ancien texte : (item 12) :
  `formats/semantic/business-process.ts` reprend `frenchBusinessProcessCode`/
  `applyFrenchBusinessProcess` VERBATIM du repère (seul l'import a changé), avec son propre spec
  repris quasi verbatim (`business-process.spec.ts`) — mais rien dans le pont générique
  (`build-semantic-invoice.ts`) ne l'appelle : les valeurs limitatives qu'elle dérive (`B1 S1 M1...`)
  sont une exigence FRANÇAISE (CGI ann. II art. 242 nonies A 8° bis), et le brancher sans condition
  de pays affirmerait une règle française sur une facture américaine. Décider QUELS pays l'exigent,
  avec quelles valeurs, est l'item 11 (« canal imposé par pays ») ou 15 (« mentions obligatoires »),
  pas celui-ci — le descripteur `invoice.descriptor.ts` est délibérément sans pays, il n'a rien sur
  quoi conditionner ce branchement aujourd'hui.

  **CONFIRMÉ hors du périmètre de l'item 15** (2026-08-31, en le faisant) : l'item 15 (mentions
  obligatoires, BG-1/BT-21/BT-22) est fait et prouvé en direct — voir plus haut. Une fois BG-1 posé,
  le poll informationnel post-dépôt PDP ne cite plus QUE BT-23 : c'est la preuve, en direct, que BT-23
  est un fait DISTINCT (un code de cadre de facturation, pas une mention textuelle) que le mécanisme
  de l'item 15 (données pays → texte de note, avec placeholders temporels) ne pouvait pas et ne
  devait pas absorber sans sortir de son propre mandat. Reste donc entièrement le remainder de l'item
  12, pour qui voudrait le prendre : dériver `SupplyType` par ligne (le descripteur n'a aucun champ
  pour ça aujourd'hui — biens/services/mixte n'est PAS le même fait qu'un `unit` de ligne) est le vrai
  travail, pas le branchement lui-même.

- **Un vrai bug trouvé en testant contre le vrai serveur, pas contre un fixture à la main** (item
  12) : la première version du pont passait `data.issueDate` tel quel à `@e-invoice-eu/core` ; tous
  les fixtures jest écrits à la main l'écrivaient déjà comme une date nue ("2026-08-30"), ce qui
  cachait le vrai format stocké par le champ 'date' du descripteur — un DATETIME ISO complet
  ("2026-05-31T00:00:00.000Z"). Un `curl` contre le backend de test, sur une VRAIE facture
  enregistrée par l'écran, a renvoyé 500 (l'ajv interne de la lib rejette le format datetime pour
  BT-2). Corrigé par `shared-build.ts`'s `toDateOnly` (normalise via `new Date(...).toISOString()`
  avant de tronquer), et un test de régression ajouté (`providers.spec.ts`, "a REAL saved
  document's own issueDate shape"). Consigné pour le rappel de méthode : un fixture à la main ne
  remplace jamais un aller-retour contre le vrai serveur avec une vraie donnée sauvegardée.

- **Item 10, vague 2 (KSeF/SdI) — item clos, remainder nommé, pas deviné** (2026-08-31) : deux formats
  nationaux (`formats/national/fa3-provider.ts` PL, `fatturapa-provider.ts` IT, chacun jugé par son
  propre XSD OFFICIEL vendoré — `formats/vendored/{pl,it}/`, jamais le Schematron EN 16931) et deux
  transports (`transports/ksef-transport.ts`, `sdi-transport.ts`). Ce qui reste, précisément :
  1. ~~**Ni KSeF ni SdI ne suivent le statut au-delà de l'accusé de réception**~~ — **PARTIELLEMENT
     RÉSOLU** (2026-09-01, `conformity/`) : KSeF a désormais un poller câblé derrière la même
     interface que PDP (`pollers/ksef-status-poller.ts`, `invoiceStatus()` — le seul endpoint de
     statut que le client repris expose réellement), MAIS **jamais prouvé live** — `KSEF_AUTH_TOKEN`
     est absent de cet environnement (même trou que `ksef-live.spec.ts`'s own header le documentait
     déjà pour `send()`), et deux inconnues restent NOMMÉES, pas devinées : (a) le mapping
     `{code, description, details}` → terminal/rejeté REPREND la convention que
     `ksef-transport.ts#authenticate` utilise déjà pour l'endpoint AUTH, appliquée par extrapolation
     à `invoiceStatus` — jamais vérifiée pour CET endpoint précis ; (b) `send()` FERME la session
     juste après l'envoi — si `invoiceStatus` répond encore une fois la session close est, à ce jour,
     INCONNU. `ksef-status-poller.live.spec.ts` est prêt, gaté `KSEF_LIVE=1`, pour répondre aux deux
     le jour où un jeton existe. SdI, lui, reste ENTIÈREMENT ouvert : aucun poller n'est enregistré
     (push SOAP, pas de endpoint à interroger — voir `conformity/authority-status-poller.ts`'s own
     header) ; construire le ROUTEUR DE NOTIFICHE entrantes reste un chantier à part, non commencé
     ici — voir `sdi/sdi-client.ts`'s own `SdiClient.mapNotifica`, REPRISE mais jamais appelée par ce
     wave (aucun poller pour l'invoquer).
  2. **KSeF n'a de clé MF vendorée que pour l'environnement TEST** (`transports/ksef/certs/test/*.pem`,
     repris du repère à l'identique) — AUCUNE clé PROD n'a jamais existé dans ce dépôt, à aucun
     repère. `ksef-public-keys.ts#loadVendorizedKeys('prod')` échoue donc bruyamment (fail-fast, par
     design) plutôt que de retomber silencieusement sur la clé de test contre un vrai KSeF de
     production. Obtenir la clé PROD (`GET /api/v2/security/public-key-certificates` sur
     `api.ksef.mf.gov.pl`) est un aller simple mais non fait ici, faute de besoin réel avant une
     société PROD réelle.
  3. **SdI n'a AUCUNE implémentation SOAP réelle** — ni au repère, ni ici. `sdi/sdi-client.ts#UNACCREDITED_SDI_HTTP_PORT`
     est la SEULE implémentation de `SdiHttpPort` qui existe dans ce dépôt à ce jour ; elle échoue
     honnêtement, immédiatement, sans réseau — "AdE (Agenzia delle Entrate) intermediary
     accreditation... required". Tant que cette accréditation n'est pas obtenue (voir
     `LIVE_TESTING.md`'s own "SdI prerequisites (currently deferred)"), `sdi-transport.ts#send()`
     échoue TOUJOURS en production, quels que soient les identifiants saisis — ce n'est pas un bug de
     cette tâche, c'est l'état réel du produit sur ce canal.
  4. **Credentials absents aujourd'hui pour les deux live specs** — `ksef/ksef-live.spec.ts`
     (`KSEF_LIVE=1` + `KSEF_AUTH_TOKEN`/`KSEF_NIP`) et `sdi/sdi-live.spec.ts` (`SDI_LIVE=1` +
     `SDI_ID_TRASMITTENTE`/`SDI_CERTIFICATE`/`SDI_CERT_PASSWORD`) skippent proprement (le premier
     parce que le jeton KSeF prouvé au repère (2026-06-28) a expiré/tourné et n'a pas été remplacé
     dans ce checkout ni en CI ; le second parce que l'accréditation AdE, ci-dessus, n'existe pas).
     Aucun des deux n'a été forcé au vert par un serveur ou un jeton inventé.
  5. **Correction post-clearance (`faktura korygująca`, le mode KOR de FA(3))** : `fa-vat.ts` au
     repère avait un mode KOR complet (voir son en-tête, M-4) ; cette vague ne le reprend PAS — le
     descripteur `invoice.descriptor.ts` d'aujourd'hui n'a pas de lien de correction compatible avec
     la forme `correction` que ce mode attendait (une facture rectificative FA(3) enverrait donc
     aujourd'hui une facture "VAT" ordinaire, jamais "KOR"). Item 6/8 (avoirs/lettrage) ou une future
     tâche FA(3) dédiée, pas celle-ci.

- **Item 15 (mentions obligatoires) — chargement FICHIER, jamais base, choix délibéré et
  documenté** (2026-08-31) : `documents/mentions/` suit EXACTEMENT le motif de
  `transports/channel-policy/` (jamais celui de `country-policy/`, qui SEED une table) — un fichier
  JSON par pays (`data/fr.json`), lu par `fs.readFileSync` au chargement du module (jamais `import`é
  comme module TS, pour qu'éditer un taux reste un changement de DONNÉE, jamais un changement TS), et
  RE-LU à chaque résolution (aucune table `InvoiceMention`, aucun `resetAndSeed` à tenir à jour). Deux
  raisons, les mêmes que `channel-policy/registry.ts`'s own header donne déjà : (1) une mention se lit
  à CHAQUE construction de document (CII/UBL/PDF), donc autant lire le fichier directement — pas de
  cas de performance par-requête à protéger comme celui que `country-policy/`'s propre table
  (countryCode, typeId, actionId) résout ; (2) pas de trou de reseed à surveiller, l'écueil que la
  propre note de `country-policy/` sur ce sujet (ci-dessus, "`resetAndSeed` ne re-sème pas la
  politique pays") existe pour prévenir. Une mention sans `legalRef` échoue au chargement — même
  discipline que `channel-policy/schema.ts#assertValidChannelPolicyFact` pour un `mandated` sans
  provenance `legal`.

- **Item 15 — personnalisation société (taux stipulé, vrai escompte) : NON FAITE, par choix explicite
  du brief lui-même** (2026-08-31) : les trois mentions FR sont TOUTES `statutory: true` — la loi
  fournit le taux supplétif et l'indemnité de 40 €, et la formulation "néant" de l'escompte est celle
  de la doctrine administrative (F31808), donc rien à demander à l'utilisateur pour ÉMETTRE ces trois
  mentions d'office (le cœur de l'item). Offrir un champ société explicite qui REMPLACERAIT une valeur
  par défaut (un taux stipulé différent du supplétif, un escompte réel) est resté hors de cette tâche
  : cela toucherait le schéma Prisma de `Company` (un ou deux champs de plus), le formulaire de
  réglages société, sa traduction i18n, ET la logique de résolution (une valeur société doit primer
  sur le texte par défaut à la RÉSOLUTION, jamais à l'affichage seul) — plus d'une heure de travail
  honnête pour un besoin qui n'a encore été exprimé par personne. Le mécanisme actuel (interpolation
  par `{placeholder}`, valeurs temporelles) est déjà prêt à recevoir une TROISIÈME source de valeur
  (société, prioritaire sur le tableau daté) le jour où ce besoin existe — voir `invoice-notes.ts`'s
  own `resolveInvoiceNotes`, qui n'aurait qu'un paramètre de plus à accepter, jamais une réécriture.

- **Un troisième bug réel trouvé EN FAISANT l'item 15, jamais anticipé par `TODO_ISSUES.md`
  lui-même** (2026-08-31) : `facturx-provider.ts`'s propre en-tête documentait déjà, à l'item 10, un
  "gap réel mais jamais atteint" — le correctif texte `splitCiiIncludedNotes` (`cii-provider.ts`) ne
  s'applique jamais à la régénération CII INTERNE que `@e-invoice-eu/core` fait pour l'embarquage
  Factur-X, invisible tant qu'aucun vendeur n'émettait plus d'une note BG-1. L'item 15 en émet
  jusqu'à quatre pour un vendeur français (trois mentions + la note utilisateur) — le gap est devenu
  RÉEL, prouvé par un vrai rejet superpdp (`fr:213`, les trois mentions citées "absentes" alors
  qu'elles étaient bien dans l'`EuInvoice`) avant d'être trouvé par un test. Corrigé par
  `splitCiiIncludedNotesInObject` (`semantic/cii-post-process.ts`), câblé via
  `InvoiceServiceOptions.postProcessor` — le point d'extension PUBLIC de `@e-invoice-eu/core` (appelé
  sur l'objet JS intermédiaire juste avant le rendu XML, vérifié directement contre la dépendance
  vendorée, jamais supposé depuis sa documentation). Preuve OFFLINE ajoutée
  (`facturx-provider.spec.ts`, extraction du CII embarqué via `pdf-lib`'s propre
  `decodePDFRawStream` + le VRAI gate structurel+Schematron) : retirer le `postProcessor` fait tomber
  ce test (vérifié en le retirant, puis en le restaurant) — un futur régression sur ce point échouerait
  donc ici, offline, avant d'atteindre un vrai dépôt.

- **Item 14 — WORM/S3 régional : NON FAIT, aucun credential AWS dans cet environnement** (2026-08-31) :
  le repère `avant-refonte-documents` portait déjà `WormS3ArchiveProvider`, avec sa propre NOTE
  D'HONNÊTETÉ (`compliance/providers/archive/providers.ts`) : sans configuration S3 réelle, il
  retombait sur la MÊME persistance locale que `LocalArchiveProvider`, en le DISANT (`log.todo`),
  jamais un `s3://` fabriqué pour des octets qui n'ont jamais quitté la machine. `archive/storage.ts`
  de cette tâche reprend cette honnêteté par construction plutôt que par avertissement : il n'existe
  QU'UN provider (la persistance locale content-hash-addressed, `DOCUMENTS_ARCHIVE_DIR`), jamais un
  second provider prétendant WORM/S3 sans jamais y écrire. Ce qui rouvrirait ceci : de vrais
  credentials AWS (bucket, Object Lock activé) pour une jurisdiction à résidence de données (le
  repère listait MX/BR/SA) — alors `archive/storage.ts` gagnerait un second `ArchiveProvider`
  sélectionné par région, sans toucher au hachage encadré ni au schéma `DocumentArchive` (le champ
  `uri` porte déjà `file://` OU pourrait porter `s3://` sans migration).

- **Item 14 — le poller de conformité PDP/KSeF (item 10) n'archive PAS le VERDICT, seulement le DÉPÔT**
  (2026-08-31 ; le poller lui-même existe depuis le 2026-09-01, voir l'entrée résolue de l'item 10 —
  cette entrée-ci reste PARTIELLEMENT ouverte, précisée ci-dessous) : l'artefact archivé
  (`DocumentArchive`, WORM/content-hash) pour "pdp"/"ksef" reste le Factur-X/FA(3) au moment où le
  transport l'a DÉPOSÉ — ça n'a PAS changé. Ce qui A changé : le verdict (fr:201/202/213, ou le
  ksefNumber CLEARED) est désormais SUIVI et CONSULTABLE (`DocumentAuthorityEvent`, append-only,
  `conformity/`) — mais délibérément PAS archivé au sens WORM du terme : c'est un journal applicatif
  ordinaire (une table Postgres), jamais un second artefact haché/conservé selon la même discipline
  que `DocumentArchive`. Le raisonnement d'origine tient toujours : le verdict est un FAIT DATÉ
  DISTINCT de la livraison (celle-ci reste acquise, hashée, conservée, indépendamment de ce que
  l'administration en fait ensuite) — une SECONDE archive WORM pour le verdict (ou un enrichissement
  de la première) reste à trancher, non fait ici : ce mécanisme répond au besoin OPÉRATIONNEL (voir,
  agir sur un rejet), pas encore au besoin PROBATOIRE (prouver après coup, de façon inaltérable, quel
  verdict a été reçu et quand).

- **Item 14 — la rétention FR applique les deux durées simultanément (leur MAXIMUM) plutôt que de
  trancher FR-D9** (2026-08-31) : `docs/compliance/audit/03-LEGAL-VERIFICATION.md` (FR-D9) et
  `docs/compliance/DECISIONS.md` (D-001) signalaient déjà la confusion entre la durée fiscale (LPF
  art. L102 B, 6 ans) et commerciale (C. com. art. L123-22, 10 ans) dans l'ancien profil FR, sans la
  trancher — D-001 proposait explicitement "porter les deux plutôt que d'en choisir une".
  `archive/retention/compute-retention.ts` fait exactement ça : les deux règles sont déclarées
  (`data/fr.json`), les deux s'appliquent SIMULTANÉMENT (deux obligations légales distinctes sur la
  même société), et `retentionUntil` retient leur MAXIMUM (10 ans) — jamais un choix arbitraire entre
  elles. L'alternative honnête envisagée par la tâche elle-même (retentionUntil NUL + les deux durées
  seulement exposées) a été écartée : elle aurait réduit ce qu'un self-hosted FR voit comme échéance
  effective par rapport à ce que le repère faisait déjà (10 ans, bien que mal nommé "fiscal" par
  erreur — FR-D9). Ce qui rouvrirait ceci : une décision EXPLICITE du mandant tranchant que les deux
  obligations ne se cumulent PAS en pratique (un texte qui le dirait), ce qu'aucune source consultée
  ne dit aujourd'hui.

- **Item 18 — réception : dépôt manuel seulement, aucun canal agréé branché** (2026-09-01) : l'écran
  uploade un fichier choisi par l'utilisateur ; il ne branche AUCUNE boîte de réception automatisée
  (KSeF inbound, dépôt PDP/Peppol entrant) — ce poller reste le remainder nommé de l'item 10.
  Concrètement : en France, la RÉCEPTION de factures électroniques par une plateforme agréée est
  obligatoire pour « toutes les entreprises, quelle que soit la taille » depuis le 2026-09-01
  (recontrôlé sur economie.gouv.fr et impots.gouv.fr le 2026-08-27 — voir le repère git
  `avant-refonte-documents:docs/compliance/audit/03-LEGAL-VERIFICATION.md`, tableau « Calendrier »,
  ligne Réception ; citation reprise dans `country-policy/data/fr.json`'s own
  `received-invoice.receive` rule). Cet écran AIDE à consigner une facture reçue par n'importe quel
  moyen, mais NE SATISFAIT PAS, à lui seul, l'obligation de réception via une plateforme agréée. Ce
  qui rouvrirait ceci : le poller de l'item 10 (inbound KSeF/PDP), qui alimenterait ce même type de
  document (`received-invoice`) automatiquement plutôt que par upload manuel.
- **Item 18 — rapprochement fournisseur et OCR hors périmètre** (2026-09-01) : aucun carnet
  fournisseurs n'existe (le champ `supplier` est un texte libre, jamais une référence), et un PDF
  scanné n'est jamais passé à une reconnaissance de texte — un PDF pur donne toujours des champs
  vides à saisir à la main. Ce qui rouvrirait ceci : un module carnet fournisseurs (symétrique du
  carnet clients) pour le premier ; un service OCR (aucun credential aujourd'hui) pour le second.
- **Item 18 — pas de lignes détaillées, montants HT/TVA/TTC seuls** (2026-09-01) : contrairement à la
  facture émise (`invoice.descriptor.ts`'s own `lines`), une facture reçue ne porte que trois
  montants plats (HT/TVA/TTC), saisis ou extraits — jamais une ventilation ligne par ligne. Choix
  délibéré (v1 documente le fait qu'une facture a été reçue et pour quel montant, pas une
  re-comptabilisation ligne à ligne du document du fournisseur) plutôt qu'un oubli : voir
  `received-invoice.descriptor.ts`'s own header.

- **Le pays VENDEUR irrésolu retombe silencieusement sur FR** (constaté à la relecture de l'item 16) :
  `tax/resolve-invoice-tax.ts` et `formats/semantic/build-semantic-invoice.ts` partagent la même
  convention `?? 'FR'` quand le pays de la SOCIÉTÉ ne se résout pas (problème de qualité de données
  que la fonction ne peut pas réparer en refusant tout envoi — dixit le commentaire). L'acheteur, lui,
  bloque dur (jamais de repli — le bug du 0 % payé). Risque borné (le pays est obligatoire à
  l'onboarding) mais le repli reste un pays NOMMÉ dans le code cœur : une société DE aux données
  cassées serait traitée fiscalement comme française sans le dire. Alternative plus stricte : bloquer
  l'envoi aussi côté vendeur, avec le même genre de message nommé. À trancher.

- **`country-identifiers/seed.ts` ne purge jamais un pays entièrement retiré** (découvert à la
  tâche 19, en prouvant une mutation) : le nettoyage des schémas obsolètes ne parcourt que les pays
  encore listés dans `data/all.ts` — retirer un pays du registre laisse ses lignes en base pour
  toujours (0 deleted au lieu de 2, vérifié en direct). Sans conséquence tant qu'on n'enlève jamais
  de pays ; à corriger le jour où ça arrive (delete WHERE countryCode NOT IN (pays listés)).

- **SIRET vs SIREN sur la facture française — le champ `LEGAL_ID` de
  `country-identifiers/data/fr.json` demande peut-être le mauvais numéro** (item 21, 2026-09-01) :
  les deux textes candidats laissés en suspens par la resolutionNote d'origine ont été LUS à leur
  source (codes.droit.org, miroir Légifrance — Légifrance lui-même a continué de refuser toute
  requête automatisée), et les deux pointent vers le SIREN, pas le SIRET.
  Code de commerce **art. R.123-237** : « Toute personne immatriculée indique sur ses factures
  […] : 1° Le numéro unique d'identification de l'entreprise délivré conformément à l'article D.
  123-235 ; 2° La mention RCS suivie du nom de la ville où se trouve le greffe où elle est
  immatriculée ; […] ». L'art. **D. 123-235**, auquel il renvoie : « Le numéro unique
  d'identification […] est le numéro d'identité qui lui est attribué lors de son inscription au
  répertoire des entreprises et de leurs établissements » — le numéro de l'UNITÉ LÉGALE, pas de
  l'établissement. L'art. **R.123-221** définit les deux numéros sans ambiguïté : « Le numéro
  d'identification attribué à CHAQUE UNITÉ LÉGALE est un numéro d'ordre composé de NEUF chiffres.
  Le numéro d'identification attribué à CHAQUE ÉTABLISSEMENT est composé des neuf chiffres du
  numéro d'identification de l'unité légale […], suivis d'un numéro d'identification complémentaire
  de CINQ chiffres propre à cet établissement » — la première phrase est le SIREN, la seconde le
  SIRET. Donc R.123-237 exige le SIREN (+ la mention RCS), pas le SIRET.
  CGI ann. II **art. 242 nonies A**, I, 1° (mentions obligatoires de la facture, pris en application
  de l'art. 289 II du CGI) converge indépendamment sur la même réponse : il exige « le numéro
  d'identification mentionné au PREMIER ALINÉA de l'article R. 123-221 du code de commerce » — le
  premier alinéa de R.123-221 est précisément le numéro à neuf chiffres de l'unité légale, c'est-à-
  dire le SIREN, jamais le second alinéa (l'établissement, le SIRET).
  **Ce que ça implique** : le champ actuel (`label: "SIRET"`, `pattern: ^\d{14}$`, `required: true`
  pour les deux types de tiers) demande un numéro à 14 chiffres alors que les deux textes lus
  pointent vers un numéro à 9. Un SIRET valide CONTIENT toujours un SIREN valide (ses 9 premiers
  chiffres), donc le champ actuel n'est pas nécessairement FAUX au sens où il accepterait un mauvais
  numéro — mais il est potentiellement TROP STRICT (il refuserait un SIREN seul, à 9 chiffres, alors
  que c'est apparemment ce que la loi demande sur une facture) et son libellé (« SIRET ») induit en
  erreur sur ce qu'exige réellement le texte.
  **Comportement volontairement INCHANGÉ ici** (le champ n'a pas été retouché — `required`,
  `pattern` et `label` restent identiques) : cette tâche est un chantier de PROVENANCE, pas de
  comportement, et le choix entre resserrer sur le SIREN, élargir pour accepter les deux formats, ou
  garder le SIRET (par exemple si un autre texte, non trouvé dans cette passe, exige spécifiquement
  le SIRET pour un usage différent — facturation par établissement d'une société multi-sites) est
  une DÉCISION PRODUIT, pas une correction de bug à faire en douce. Voir
  `country-identifiers/data/fr.json`'s own LEGAL_ID `resolutionNote` (reste `unverified`, enrichie
  avec ces citations) et `country-identifiers/data/all.spec.ts`'s own describe block pour item 21.
  Ce qui trancherait pour de bon : une décision explicite sur le champ, ou un troisième texte qui
  imposerait spécifiquement le SIRET (pas trouvé ici).
