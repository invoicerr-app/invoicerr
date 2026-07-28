# Invoicerr — PLAN DE NETTOYAGE & RACCORDEMENT COMPLET

> ✅ **EXÉCUTÉ — Lots 1 à 5 terminés le 2026‑07‑06** (commits `d8af9abc`…`63bec955`).
> Lot 1 : erreurs de mutation surfacées (bug racine `trigger` ne rejetait jamais) + loading + layering webhooks + 53→0 `as any` persistence.
> Lot 2 : §2.1→§2.6 complets (quote‑pdf dédupliqué, enrichment×4→1, drivers webhook unifiés, TokenCache×6→1, handlers reporting factory, `providers.ts` 1709→15 l. éclaté par provider, helpers invoices extraits).
> Lot 3 : §3.1→§3.4 (createLineItemSchema, useDocumentUpsert, champs partagés, useTableExport+TableFilterBar, useDocumentListDialogs, hotspots `any` typés).
> Lot 4 : export audit câblé, actions pilotées backend dans invoice‑list, **page /compliance** (pipeline + reporting, nouveaux endpoints paginés + 7 tests), receipts déprécié supprimé. (§4.2 routes : constat obsolète, redirect déjà en place.)
> Lot 5 : EN+120 clés, −165 clés mortes, **FR/PL/IT 100%** (PL/IT beta), sélecteur de langue créé (9 stubs masqués), `i18n:check` en CI.
> Restes assumés : fusion des ~134 clés à valeur dupliquée (risque sémantique, reportée) ; **Lot 6 (hygiène) non exécuté** — opportuniste.
> Vérifié : build back+front clean · suite **1380/0** · boot OK · i18n‑check vert · YAML CI valide.

> Établi le 2026‑07‑04 sur la base : détecteur de copier‑coller **jscpd** (backend : 152 clones / 2 488 lignes ; frontend : 87 clones / 2 627 lignes) + 5 audits de zone parallèles (modules backend, compliance, frontend, raccordement API exhaustif routes×appels, i18n). Chaque affirmation ci‑dessous a été vérifiée (les faux positifs des audits ont été écartés — voir §8).
>
> **Périmètre déjà nettoyé (ne pas refaire)** : les 5 factories portails → `generic-portal.ts` (−906 l.) ; `invoice-rendering.service.ts` 3861→743 l. (builders extraits sous `national/`, sortie byte‑identique) ; sweep code mort (−277 l., 4 fichiers, 6 exports) ; 15 deps npm retirées + 6 transitives déclarées.
>
> **Protocole d'exécution** (chaque lot) : `npm run build` back+front réels · suite jest complète verte (baseline **1373 passed / 0 failed** — cible : inchangée sauf justification) · boot de l'app (DI) · pour tout refactor de rendu/format : garde **byte‑identique** (diff des sorties fixtures avant/après) · commit par lot · pull --rebase avant push.
>
> **Zones interdites au refactor risqué** : chemins prouvés live (EN16931_CII→PDP, FA_VAT→KSeF, Email, TSA, ChorusPro client), signature XAdES/CAdES/PAdES, taxonomie des canaux, migrations Prisma.

---

## LOT 1 — P1 Correctness & règles d'archi (≈ 1 jour)

### 1.1 Erreurs de mutation avalées en silence (frontend) — LE plus grave côté UX
Le pattern `.catch((err) => console.error(err))` laisse l'utilisateur sans aucun feedback (la modal ne se ferme pas, rien ne s'affiche). Déjà à l'origine du bug « Submit reset les champs » des réglages canaux.
- [ ] Créer un wrapper `useMutationWithToast()` autour de `usePost/usePatch/useDelete` (toast.error + propagation du loading).
- [ ] Migrer les ~15 call‑sites : `invoice-upsert.tsx` (4 handlers, l.234/244/254/265), `quote-upsert.tsx` (2), `recurring-invoices-upsert.tsx` (2), `client-upsert.tsx`, `company.settings.tsx`, `webhooks.settings.tsx` (3), `recurring-invoices-list.tsx`, dialogs de suppression (~8).
- [ ] **États loading** : `disabled={loading}` + spinner sur tous les submits de modals (aujourd'hui double‑soumission possible).

### 1.2 Violation layering : `webhooks.controller.ts` (backend)
8 accès Prisma directs dans le controller (l.39, 42‑43, 85‑88, 100‑112, 133‑147, 165‑169) — violation de la règle **controller→service→prisma**.
- [ ] Déplacer les 8 opérations dans `WebhooksService`, controller = wrapper HTTP pur. Vérifier DI au boot.

### 1.3 `any` sur les stores Prisma (backend compliance) — règle « jamais de any »
~27 casts `as any` dans `prisma-scheduled-job-store.ts` (14), `prisma-callback-store.ts` (6), `prisma-document-store.ts` (5), `prisma-reporting-store.ts` (2) + 10 dans `persistence/mappers.ts`.
- [ ] Typer les conversions row↔domain avec des types Prisma générés + mappers explicites (pas de cast). C'est mécanique : les shapes sont connues.

### 1.4 `fetch()` bruts contournant les hooks (frontend)
- [ ] `recurring-invoices-list.tsx` : 4 appels `fetch(..., {method:'POST'})` (pause/resume/skip/end-now) sans auth centralisée ni gestion d'erreur → `usePost`/`authenticatedFetch`.

---

## LOT 2 — P2 Duplication backend (≈ 1,5 jour)

### 2.1 Quick wins (≈ 1 h)
- [ ] **Deux utils quote‑PDF identiques** : supprimer `utils/generate-quote-pdf.ts` (143 l.), pointer les 2 imports (documenso.ts, signing.ts) sur `utils/quote-pdf.ts`.
- [ ] **Enrichissement paymentMethod copié ×4** (~30 l. chacun : `invoices.service.ts:108`, `quotes.service.ts:62`, `payments.service.ts:85`, `recurring-invoices.service.ts:40`) → un helper partagé `utils/enrich-payment-methods.ts`.

### 2.2 Drivers webhook triplés (~480 l. → ~200 l.)
`slack.driver.ts` / `mattermost.driver.ts` / `rocketchat.driver.ts` : 3 classes builder structurellement identiques (setTitle/setColor/addField/build) + même logique `EVENT_STYLES`.
- [ ] Builder générique partagé + un adaptateur mince par driver (structure de payload finale différente — c'est la seule vraie variance).

### 2.3 Cache de token OAuth réimplémenté ×6 (compliance)
AFIP, SII, UY‑DGI, GIB, Coretax, IN‑IRP : ~40 lignes identiques de cache token chacun.
- [ ] Extraire un `TokenCache` (get/refresh/expiry) injecté dans les 6 clients. ⚠️ Sémantiques d'expiry légèrement différentes relevées — les paramétrer, ne pas les écraser.

### 2.4 Boilerplate handlers reporting (×8)
`reporting/handlers.ts` : 8 classes identiques à ~15 l. (~120 l. de boilerplate).
- [ ] Factory `makeReportingHandler(kind, generator)` → ~10 lignes totales. Comportement identique (les générateurs purs ne bougent pas).

### 2.5 God‑file `providers/transmission/providers.ts` (1 709 l., 9 classes)
- [ ] Éclater en un fichier par provider (`email-`, `pdp-`, `ksef-`, `sdi-`, `peppol-`, `pac-`, `ose-`, `print-transmission.ts`) + `providers.ts` réduit à l'assemblage/exports. **Refactor de déplacement pur** (zéro changement de comportement — chemins prouvés dedans, garde jscpd + suite complète).

### 2.6 Fonctions géantes `invoices.service.ts` (5 × >135 l.)
`editInvoice` 187 l., `correctInvoice` 177 l., `createFinalInvoice` 159 l., `createInvoice` 137 l., `createDepositInvoice` 137 l. — chacune mélange Prisma + résolution taxe + contexte compliance + transformation d'items.
- [ ] Extraire 3 helpers communs : `resolveTax()`, `buildComplianceContext()`, `createInvoiceItems()`. (Les 5 fonctions partagent ces blocs — c'est la source des 658 lignes clonées jscpd.)

---

## LOT 3 — P2 Duplication frontend (≈ 1,5 jour)

### 3.1 Upserts invoice/quote/recurring (927 + 616 + 688 l., ~260 l. clonées)
Schéma d'items, recherche client, champs currency/discount, setup form/mutations, reset, submit : quasi identiques.
- [ ] `useDocumentUpsert()` (form + mutations + reset + invalidation) + `createLineItemSchema(t, …)` partagé + sous‑composants champ (`<CurrencyField/>`, `<DiscountField/>`, `<ClientSearchField/>`).
- [ ] NE PAS forcer un `<DocumentUpsert>` unique tout de suite : extraire les briques d'abord, fusionner ensuite si naturel.

### 3.2 Tables invoice/quote/payment (export CSV 100% identique ×3)
- [ ] `csvEscape` + génération headers/rows → `useTableExport<T>(columns)` ; filtres client/année/mois/tri (95% identiques) → composant de barre de filtres partagé.

### 3.3 Dialogs de liste (invoice-list 557 l. / quote-list 425 l.)
États create/edit/view/delete/send + handlers identiques.
- [ ] Hook `useDocumentListDialogs<T>()`.

### 3.4 `any` frontend (22) + composants >600 l.
- [ ] Typer : doubles casts `const inv: any = invoice as any` (invoice‑upsert:175, client‑upsert:175), `DragEndEvent` (@dnd-kit), `partyIdentifiers` (company.settings ×3), tooltip dashboard.
- [ ] Découper (après 3.1, ça tombera en partie tout seul) : `invoice-upsert` 927 l. (4 modes → sous‑formulaires), `pdf.settings` 1 215 l., `company.settings` 1 203 l. (base/identifiants/Peppol), `client-upsert` 628 l.

---

## LOT 4 — Raccordement frontend (le « pas à 100% ») (≈ 1–2 jours)

Constat d'audit exhaustif : **0 appel cassé** ; **~27 endpoints backend sans UI** (dont une majorité légitimement machine‑only : webhooks entrants, inbound compliance). Les vrais gaps :

### 4.1 Gaps à câbler
- [ ] **`GET /api/compliance/audit-export`** : aucun consommateur → bouton « Exporter l'audit » dans réglages compliance (vérifié non câblé).
- [ ] **`invoice-list.tsx` duplique la logique d'actions en dur** (~l.120‑160) alors que le hook `useAvailableActions` existe et est déjà utilisé par `invoice-view.tsx` → aligner la liste sur le hook (une seule source de vérité : le backend).
- [ ] **Vue « pipeline compliance »** : il n'existe aucune vue transverse des soumissions (en attente / soumis / accepté / rejeté par canal). Les données existent (`ComplianceDocument`, events, statuts). → page/section « Compliance » : file des soumissions + statut par canal + erreurs récentes. C'est le plus gros manque produit.
- [ ] **Reporting** : les `ComplianceReport` (période, statut PENDING/SUBMITTED, ref) n'ont aucune UI → section lecture seule dans réglages (liste par période/kind).

### 4.2 Nettoyage backend révélé par l'audit
- [ ] **`receipts-deprecated.controller.ts`** (6 endpoints, remplacés par Payments) : supprimer ou documenter l'échéance de retrait.
- [ ] Routes `/` vs `/dashboard` dupliquées → rediriger l'une vers l'autre.
- [ ] Endpoints détail jamais appelés (`GET /api/{articles,quotes,recurring-invoices,webhooks}/:id`) : décision — supprimer (UI = liste+modal par design) ou garder documenté.

---

## LOT 5 — i18n (≈ 1 jour + décision produit)

Constat : **1 428 clés EN définies / 1 164 utilisées** ; **95 clés utilisées jamais définies** (tout le compliance UI tourne sur les fallbacks anglais) ; **359 clés mortes** ; 10 locales = stubs de 53 clés copiées d'EN.

- [ ] **P1 — FR d'abord** (marché principal) : définir les ~95 clés manquantes (`settings.channels.*` 20, `settings.signing.*` 18, `receivedInvoices.*` 38, Peppol 5, divers) en FR + EN. Aujourd'hui un utilisateur français voit les écrans compliance en anglais.
- [ ] **Décision requise (toi)** : **PL (3,7%) et IT (5,1%)** — marchés primaires quasi non traduits. Options : (a) traduction complète, (b) machine‑translate + badge « beta », (c) retirer du sélecteur en attendant. Reco : (b) pour PL/IT, (c) pour les 10 stubs (da/ja/ko/ru/sv/uk/zh…).
- [ ] Purger les 359 clés mortes (grep‑vérifiées) + consolider les ~134 valeurs dupliquées EN (−13% de charge de traduction).
- [ ] Ajouter **i18next-parser** en CI : échec si clé utilisée non définie (empêche le retour du problème).

---

## LOT 6 — P3 Hygiène & cohérence (≈ 1 jour, opportuniste)

- [ ] `any` restants backend modules (~40 : stats, plugins, payments, webhook‑dispatcher) — typage progressif.
- [x] Cohérence nommage compliance (2026-07-27) : plus aucun fichier multi-pays. Un fichier par pays (`profiles/data/xx.ts`, `providers/transmission/portals/<cc>-*.ts`, `providers/format/national/<cc>-*.ts`)  ; plus aucun dossier régional non plus, un seul `portal-registry.ts` assemble les 37 portails. Reste à documenter la relation `*-client.ts` ↔ `*-transmission.ts` (23 clients / 14 providers) dans un README court.
- [ ] Bruit de commentaires compliance : densité 25‑37% dans les clients régionaux (headers boilerplate d'agents) → dégraisser vers le standard du repo ; traduire les commentaires FR isolés (`mapStatusToPdpCode`) en EN.
- [ ] **eslint à moitié migré** (deps flat‑config + `.eslintrc.js` legacy) : finir la migration flat config, brancher `npm run lint` en CI.
- [ ] Clés i18n calculées fragiles (`t(\`...${pm.type?.toLowerCase()}\`)`) → maps explicites.
- [ ] `identifier-validator.ts` (502 l.) : passer le switch géant en registre par scheme **seulement si** on doit y retoucher (sinon laisser).

---

## §7 Ordre d'exécution recommandé

| Ordre | Lot | Pourquoi d'abord | Effort |
|---|---|---|---|
| 1 | **Lot 1** (P1 correctness) | Bugs UX réels + violations de règles ; petit et sûr | ~1 j |
| 2 | **Lot 2** (dup backend) | Quick wins massifs, réduit la surface avant le reste | ~1,5 j |
| 3 | **Lot 4** (raccordement) | C'est la demande produit (« pas à 100% ») ; débloqué par 1 | ~1,5 j |
| 4 | **Lot 3** (dup frontend) | Plus gros, bénéficie du wrapper mutations du Lot 1 | ~1,5 j |
| 5 | **Lot 5** (i18n) | FR immédiat ; PL/IT = ta décision | ~1 j |
| 6 | **Lot 6** (hygiène) | Opportuniste, par petites touches | ~1 j |

**Total estimé : ~7 jours‑agent**, découpables en subagents parallèles par lot (zones étanches : Lot 1.1/1.4 frontend ‖ 1.2/1.3 backend ; Lot 2 ‖ Lot 3 ; etc.).

## §8 Faux positifs écartés (ne pas « re‑corriger »)
- Suppression de canal : **déjà câblée** (`channels.settings.tsx` `handleDelete` l.83 + bouton l.228).
- `available-actions` : **déjà consommé** par `invoice-view.tsx` via `useAvailableActions` — le gap est uniquement la duplication dans `invoice-list`.
- Payment‑methods « raw fetch » : introuvable — pattern hooks respecté.
- `log.todo` compliance (131) : **intentionnels** (points d'intégration creds‑gated), pas de la dette — ne pas les « nettoyer ».
- Fixtures format (2 663 l.) : toutes référencées — ne pas élaguer.
- Commentaires « roadmap » dans invoices.service : légitimes (en‑têtes de sections), pas du code mort.
