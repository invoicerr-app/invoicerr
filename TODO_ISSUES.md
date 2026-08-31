# TODO_ISSUES — ce qui n'a pas pu être fait, et pourquoi

> Tenu au fil de l'exécution du `TODO.md`. Chaque entrée dit ce qui bloque et ce qui le
> débloquerait — jamais un simple « échoué ».

## Rouges e2e permanents (7), connus et rattachés à des items du TODO

- **`05-clients` : 5 tests (Allemagne, Royaume-Uni)** — ces pays n'ont aucun fichier d'exigences
  d'identifiants. Le produit dit correctement qu'il n'en connaît aucune ; les tests attendent un
  champ `LEGAL_ID`. Rattaché à l'item **19** du TODO : les livrer demande de sourcer leur droit,
  pas de l'inventer.
- **`16-company-lookup` : 1 test (`expected 40 to be above 100`)** — la couverture de la recherche
  d'entreprise est tombée de 118 à ~40 pays à la démolition (la liste venait des profils
  supprimés). Rattaché à l'item **20** : décider de la nouvelle source de la liste.
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

  Reste NOMMÉ de cette vague : le dépôt réussit sur l'ACCUSÉ (`api:uploaded`, identifiant non vide,
  prouvé en réel — `transports/pdp/pdp.live.spec.ts`), jamais suivi au-delà. Un poll manuel effectué
  pendant cette tâche (hors contrat, informationnel) a montré un `fr:213 Rejetée` quelques centaines
  de ms après le dépôt, pour des raisons DÉJÀ documentées à l'ancien repère (mentions obligatoires
  BG-1 : frais de recouvrement/pénalités de retard/escompte — items 15 ; BT-23 cadre de facturation
  français, logique déjà écrite dans `business-process.ts` mais jamais branchée par pays — items
  11/12) : ni une régression de cette tâche, ni quelque chose que le contrat de la vague 1 promettait
  de résoudre. Construire le POLLER lui-même (l'ancien moteur avait un `InboxPoller`) est un chantier
  à part, non commencé ici.

- **BT-151 (catégorie de TVA) : seules S et Z sont atteignables aujourd'hui** (item 12) : EN 16931
  distingue six catégories (S, Z, E, AE, K, G, O), chacune avec des exigences contradictoires (voir
  `formats/semantic/build-semantic-invoice.ts`'s own header, "VAT category"). Le descripteur
  d'aujourd'hui n'a qu'un `vatRate` (pourcentage) par ligne, sans catégorie — dériver E (exonéré), O
  (hors champ), AE (autoliquidation), K (livraison intra-UE) ou G (export) exigerait un fait que ce
  pont, volontairement sans nom de pays, n'a pas (l'ancien moteur fiscal transfrontalier, supprimé —
  item 16, "transfrontalier", jamais reconstruit). `formats/pitfalls.spec.ts` prouve que le GATE
  (le Schematron vendoré) réagit correctement à E et O quand on les lui présente directement
  (BR-E-02/BR-E-10, BR-O-02/BR-O-10/BR-O-11..14) — c'est le pont lui-même qui ne peut pas encore les
  produire. Combler ce trou est le vrai contenu de l'item 16, pas une extension de cette tâche-ci.

- **BT-23 (cadre de facturation français) : logique reprise et testée, jamais branchée** (item 12) :
  `formats/semantic/business-process.ts` reprend `frenchBusinessProcessCode`/
  `applyFrenchBusinessProcess` VERBATIM du repère (seul l'import a changé), avec son propre spec
  repris quasi verbatim (`business-process.spec.ts`) — mais rien dans le pont générique
  (`build-semantic-invoice.ts`) ne l'appelle : les valeurs limitatives qu'elle dérive (`B1 S1 M1...`)
  sont une exigence FRANÇAISE (CGI ann. II art. 242 nonies A 8° bis), et le brancher sans condition
  de pays affirmerait une règle française sur une facture américaine. Décider QUELS pays l'exigent,
  avec quelles valeurs, est l'item 11 (« canal imposé par pays ») ou 15 (« mentions obligatoires »),
  pas celui-ci — le descripteur `invoice.descriptor.ts` est délibérément sans pays, il n'a rien sur
  quoi conditionner ce branchement aujourd'hui.

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
  1. **Ni KSeF ni SdI ne suivent le statut au-delà de l'accusé de réception** — même gap que PDP
     (vague 1, entrée ci-dessus). `ksef-transport.ts#send()` s'arrête à "session+facture acceptées
     par KSeF" (référence non vide, jamais un succès à référence vide — mutation #2 de cette tâche),
     jamais à CLEARED/ksefNumber ; `sdi-transport.ts#send()` s'arrête à "idSdI accepté", jamais à une
     notifica RC/NS/NE/DT/AT. Construire le POLLER (KSeF) ou le ROUTEUR DE NOTIFICHE entrantes (SdI)
     est un chantier à part, non commencé ici — voir `sdi/sdi-client.ts`'s own `SdiClient.mapNotifica`,
     REPRISE mais jamais appelée par ce wave (aucun poller pour l'invoquer).
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
