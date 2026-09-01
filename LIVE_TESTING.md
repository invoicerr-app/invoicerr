# Live Testing Guide

All live tests are **SKIPPED by default** in CI and in any offline run. They are opt-in:
only when the channel-specific flag is set to `1` **AND** the required credential env vars
are present does the suite actually run — otherwise `describe.skip` fires silently.

The shared gate helper is at:
`backend/src/compliance/providers/transmission/live-gate.ts`

Hard-success contract (enforced per-spec):
- A `REJECTED` or `SKIPPED` transmission result **fails** the test (not tolerates it).
- An empty or missing authority reference/id **fails** the test.
- Async portals must reach `CLEARED` within the specified poll window.

---

## Channel summary

| Channel | Flag | Key creds | Spec file | Status |
|---|---|---|---|---|
| KSeF (PL) | `KSEF_LIVE=1` | `KSEF_AUTH_TOKEN`, `KSEF_NIP` | `ksef/ksef-live.spec.ts` | ✅ Proven live |
| PDP superpdp (FR) | `PDP_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp-live.spec.ts` | ✅ **Round-trip prouvé** — `fr:200 → fr:201 → fr:202`, dépôt 375037, 2026-08-29 |
| PDP AFNOR (FR) | `PDP_AFNOR_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp-afnor-live.spec.ts` | ✅ Transport proven (content TBD) |
| Email SMTP | `EMAIL_LIVE=1` | _(none — Ethereal auto-creates account)_ | `email-live.spec.ts` | ✅ Proven live |
| SdI (IT) | `SDI_LIVE=1` | `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` | `sdi/sdicoop.live.spec.ts` | 🔴 Deferred (AdE accreditation) — code implemented-awaiting-accreditation, never yet run |
| Peppol via peppol.sh | `PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh` | _(none — spec self-signs-up on the peppol.sh sandbox)_ | `peppol/peppol-sh-live.spec.ts` | 🔴 **Cassé le 2026-08-29** — `invalid_country` sur FR à la création de société (voir ci-dessous) |
| Peppol generic AP | `PEPPOL_LIVE=1` | `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | `peppol/peppol-live.spec.ts` | 🔴 Deferred (connected AP required) |
| Peppol via Storecove | _(mocked only)_ | `apProvider=storecove` config: `apiKey`, `legalEntityId` | `peppol/storecove-client.spec.ts` | 🔴 Deferred (30-day manual trial, no self-serve signup) |
| National portals | `<PREFIX>_LIVE=1` (per portal) | `<PREFIX>_*` namespaced creds | `portal-live.spec.ts` | 🟡 Parametrized (per-portal namespaced creds) |
| Chorus Pro (FR B2G) | `CHORUSPRO_LIVE=1` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET` | `europe/choruspro-live.spec.ts` | 🔴 Deferred (PISTE account required) |
| RFC 3161 TSA (-T signing) | `TSA_LIVE=1` | `TSA_URL` | `signing/tsa-live.spec.ts` | 🟡 Wired (run to prove FreeTSA) |
| Company lookup (national registers) | `COMPANY_LOOKUP_LIVE=1` | _(none — every source is keyless: 15 national registers + VIES + GLEIF + Peppol Directory)_ | `modules/company-lookup/company-lookup.live.spec.ts` | ✅ Proven live (2026-07-27) |
| ApplySignalService atomic transitions | `COMPLIANCE_LIVE_DB_TESTS=1` | `DATABASE_URL` only — **no external cred, no `CREDENTIALS_ENCRYPTION_KEY`** | `nest/apply-signal.live.spec.ts` | ✅ Proven creds-free — runs against the CI job's disposable Postgres |

---

> ### ✅ Round-trip prouvé le 2026-08-29 — après deux faux verts corrigés le même jour
>
> **Le résultat**, vérifié en interrogeant la plateforme et non en croyant le spec :
> `api:uploaded → fr:200 Déposée (validée) → fr:201 Émise par la plateforme → fr:202 Reçue par la
> plateforme`. Dépôt **375037** pour la facture, **375061** pour l'AVOIR. Le contrôle de conformité
> française passe pour les deux.
>
> **L'avoir a demandé deux correctifs de plus**, chacun nommé par la plateforme :
> 1. `BR-FR-CO-05/BT-3` — « Si le type de facture est un avoir […] au moins une référence à une
>    facture antérieure (BT-25) avec sa date (BT-26) doit être présente au niveau entête.
>    Références entête trouvées : 0. » Le lien était en base depuis toujours
>    (`Invoice.correctsInvoiceId`) ; rien ne le portait dans le document.
> 2. `Element 'qdt:DateTimeString': This element is not expected` — le normaliseur d'espaces de noms
>    SUPPRIMAIT la déclaration `xmlns:qdt` sans jamais réécrire les éléments, qui partaient donc avec
>    un préfixe non déclaré. Invisible tant qu'aucun document n'en utilisait : BT-26 est le premier.
>
> **Ce qui manquait** : les trois mentions de C. com. art. L441-9 I al. 5. Une fois ajoutées, le
> rejet `BR-FR-05` a disparu — remplacé par un défaut purement structurel que la plateforme a
> nommé pour nous : « Element 'ram:Content' must occur exactly 1 times ». Le générateur empilait
> trois `ram:Content` dans une seule `IncludedNote`, ce qui est invalide en CII. Corrigé dans le
> post-traitement, qui répartit une note par mention et récupère BT-21 depuis le préfixe `#CODE#`.
>
> **DEUX faux verts, pas un.** Le premier : le spec assertait `PENDING` juste après le dépôt, avant
> que le verdict existe — asserter un état transitoire, c'est asserter que la requête est partie,
> pas qu'elle a abouti. Le second, plus profond : **`poll()` ne pouvait rien renvoyer d'autre que
> `PENDING`**. Il lisait `invoice.status_code`, un champ que l'API ne renvoie pas ; le cycle de vie
> arrive dans `events[]`. Le poll répondait donc « no status codes » à chaque appel, depuis toujours.
> Et le mappage écrasait `fr:200`, `fr:201` et `fr:202` sur `PENDING`, confondant « pas encore
> jugée » avec « validée et reçue par le destinataire ».
>
> Le spec **échoue désormais si le document reste `PENDING`** : un état transitoire n'est plus un
> succès.
>
> **Deux contraintes du bac à sable**, vérifiées le même jour. superpdp refuse tout dépôt dont la
> BT-2 dépasse le jour courant — mais cela n'empêche PAS de tester : il suffit de dater la facture
> du jour. Et le bac à sable contient déjà Burger Queen (`000000002`) et Tricatel (`000000001`).
>
> ### Note historique — le diagnostic intermédiaire, conservé
>
> Le transport marche : OAuth, XSD, espaces de noms, routage, et superpdp **accepte le dépôt**. Puis
> il **rejette le document**. Vérifié en interrogeant la plateforme, `GET /v1.beta/invoices/374891` :
>
> > événement `fr:213 Rejetée` — « BR-FR-05/BT-22 : La mention relative aux frais de recouvrement
> > (code PMT) est absente. Elle est obligatoire dans les notes (BG-1). »
>
> Idem pour **PMD** (pénalités de retard) et **AAB** (escompte). Invoicerr n'émet aucune des trois :
> **toute facture française qu'il produit est refusée par le contrôle de conformité.** C'est un
> manque produit, pas un problème d'identifiants — et le libellé de ces mentions relève des
> conditions commerciales du vendeur, donc il ne s'invente pas.
>
> **Pourquoi personne ne l'a vu**, et c'est la leçon transposable : le spec assertait `PENDING` juste
> après le dépôt et ne sondait qu'une fois, avant que le verdict existe. `PENDING` est un état réel,
> mais transitoire — asserter un état transitoire, c'est asserter que la requête est partie, pas
> qu'elle a abouti. Et le spec avait en outre cessé de compiler (fixture sans `vatCategory`, devenu
> obligatoire quand BT-151 est passé sous la résolution du moteur) : il levait avant d'atteindre le
> réseau, et le gate live gardait le silence.
>
> **Deux contraintes du bac à sable**, vérifiées le même jour. superpdp refuse tout dépôt dont la
> BT-2 dépasse le jour courant, donc décaler l'horloge ne sert à rien : la France ne route vers un
> PDP qu'à partir du 2026-09-01, et les deux fenêtres ne se recouvrent que ce jour-là. Et le bac à
> sable contient déjà Burger Queen (`000000002`) et Tricatel (`000000001`) — utiliser un autre SIREN
> suppose de créer l'entreprise côté superpdp.

> ### 🔴 Peppol via peppol.sh — cassé le 2026-08-29, et c'est un rappel utile
>
> Le spec échoue AVANT toute transmission, à la création de la société :
>
> > `HTTP 400 — {"error":{"code":"invalid_country","message":"country must be an active Peppol
> > country code","param":"country"}}`
>
> Il envoie `country: 'FR'`. La plateforme ne l'accepte plus — hypothèse plausible, NON vérifiée :
> la France est passée au mandat PDP et peppol.sh l'aurait retirée de ses destinations actives.
> **Ce qui le trancherait** : la liste des pays actifs publiée par peppol.sh, ou leur support.
>
> Le spec lui-même est bien construit — il exige `CLEARED` et dit explicitement que `PENDING` est
> un échec, ce qui est exactement la discipline qui manquait au PDP. Ce n'est donc pas un faux vert
> mais une **preuve périmée** : « Proven live (2026-07-11) » décrivait un monde qui a changé
> depuis, sans que personne ne rejoue le test. Un canal live non rejoué n'est pas un canal prouvé.
>
> Non corrigé : changer le pays de la fixture ferait repasser le test, mais prouverait autre chose
> que ce qu'il prétend prouver. La question à trancher d'abord est de savoir si la France est
> encore une destination Peppol.

## Running a single live spec

```bash
# KSeF (PL) — proven live against ksef-test.mf.gov.pl
KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> [KSEF_NIP=<nip>] \
  npx jest ksef-live --no-coverage --runInBand

# PDP superpdp (FR) — round-trip prouvé : déposée, validée, émise, reçue (voir l'encadré)
set -a; . .env.pdp.local; set +a
PDP_LIVE=1 npx jest pdp-live --no-coverage --runInBand

# PDP AFNOR (FR) — transport proven live (content validation TBD)
PDP_AFNOR_LIVE=1 PDP_BASE_URL=<url> PDP_CLIENT_ID=<id> PDP_CLIENT_SECRET=<secret> \
  npx jest pdp-afnor-live --no-coverage --runInBand

# Email (Ethereal SMTP — no creds needed)
EMAIL_LIVE=1 npx jest email-live --no-coverage

# SdI (IT) — requires AdE accreditation + qualified PFX certificate (code implemented-awaiting-accreditation)
SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 SDI_ENDPOINT=<accredited-SdIRiceviFile-url> \
  SDI_CERTIFICATE=<base64-pfx> SDI_CERT_PASSWORD=<pass> \
  npx jest sdicoop.live --no-coverage --runInBand

# Peppol via peppol.sh — ZERO SECRETS (self-signup, like Ethereal email)
PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh \
  npx jest peppol-sh-live --no-coverage --runInBand
# Optional: reuse an existing sandbox account instead of self-signup
#   PEPPOL_SH_API_KEY=ps_test_… PEPPOL_SH_COMPANY_ID=com_… [PEPPOL_RECEIVER_ID=<scheme:id>]

# Peppol generic AP — requires a connected Access Point
PEPPOL_LIVE=1 PEPPOL_PARTICIPANT_ID=0009:12345678900011 PEPPOL_AP_URL=https://ap.example.com \
  PEPPOL_API_KEY=<key> PEPPOL_RECEIVER_ID=0009:98765432100022 [PEPPOL_ENV=TEST] \
  npx jest peppol-live --no-coverage --runInBand

# National portal — namespaced per-provider (see "National portals" section below)
# Example: ANAF (RO)
ANAF_LIVE=1 ANAF_AUTH_TOKEN=<token> ANAF_TAXPAYER_ID=<cui> \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=anaf

# RFC 3161 TSA — level-T signing via real TSA (e.g. FreeTSA)
TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr \
  npx jest tsa-live --no-coverage --runInBand

# ApplySignalService atomic transitions — DB-only, no external cred/encryption key.
# NEVER point DATABASE_URL at a database you care about: it truncates the compliance
# tables before/after every test (safe only on a disposable local/CI Postgres).
COMPLIANCE_LIVE_DB_TESTS=1 DATABASE_URL=postgresql://user:pass@localhost:PORT/db \
  npx jest src/compliance/nest/apply-signal.live.spec.ts --runInBand
```

---

## Verifying the gate works (no flag = skipped)

```bash
# Run the gated spec without the flag → must show as skipped
cd backend
npx jest ksef-live --no-coverage
# Expected: Test Suites: 1 skipped | Tests: 0 (suite skipped)

npx jest pdp-live pdp-afnor-live email-live sdicoop.live peppol-live portal-live tsa-live choruspro-live --no-coverage
# Expected: all suites skipped
```

---

## Running the full offline suite (gate must not fire)

```bash
cd backend
npx jest --no-coverage
# Live specs appear in "skipped suites" count — no live call is made.
# Baseline: ~1330 passed, live suites skipped.
```

---

## CI

Live specs are **excluded from CI by default**. The CI workflow (`Tests`) runs:
```
cd backend && npx jest --no-coverage
```
No `*_LIVE=1` flag is set in CI. All gated suites remain skipped.

---

## Credential storage

- Credentials are loaded exclusively from env vars or `.env*.local` files (gitignored).
- Never commit secrets to the repository.
- Suggested local file layout:
  - `.env.ksef.local` — `KSEF_AUTH_TOKEN`, `KSEF_NIP`
  - `.env.pdp.local` — `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET`
  - `.env.sdi.local` — `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD`
  - `.env.peppol.local` — `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID`
    (generic AP only — the peppol.sh path needs no local secrets at all)
- Load with: `set -a; . .env.<channel>.local; set +a`

---

### Chorus Pro (FR B2G) — PISTE gateway

```bash
# Chorus Pro PISTE sandbox
CHORUSPRO_LIVE=1 \
  CHORUSPRO_CLIENT_ID=<piste_client_id> \
  CHORUSPRO_CLIENT_SECRET=<piste_client_secret> \
  CHORUSPRO_TECH_LOGIN=<compte_technique_login> \
  CHORUSPRO_TECH_PASSWORD=<compte_technique_password> \
  [CHORUSPRO_ENV=SANDBOX] \
  [CHORUSPRO_XML_PATH=/path/to/invoice.xml] \
  npx jest choruspro-live --no-coverage --runInBand
```

| Env var | Purpose |
|---|---|
| `CHORUSPRO_CLIENT_ID` | PISTE OAuth2 `client_id` (from PISTE developer portal) |
| `CHORUSPRO_CLIENT_SECRET` | PISTE OAuth2 `client_secret` |
| `CHORUSPRO_TECH_LOGIN` | Chorus Pro "compte technique" login (required for deposerFlux) |
| `CHORUSPRO_TECH_PASSWORD` | Chorus Pro "compte technique" password |
| `CHORUSPRO_ENV` | `SANDBOX` (default) or `PROD` |
| `CHORUSPRO_XML_PATH` | Path to a pre-built Factur-X/UBL XML file (skips auto-generation) |

**How to obtain credentials:**
1. Create an account on **[piste.gouv.fr](https://piste.gouv.fr)**.
2. Subscribe to the API "Factures" (or "API Dépôt flux G2B" v5.2.0) in the PISTE sandbox catalog.
3. Obtain `client_id` + `client_secret` from the PISTE API key manager.
4. In the Chorus Pro sandbox, create a "compte technique" (technical account) linked to your SIRET.
5. Use the sandbox hosts: `sandbox-oauth.piste.gouv.fr` / `sandbox-api.piste.gouv.fr`.

**What the test verifies:**
- Step 1: OAuth2 client_credentials → Bearer token reachable.
- Step 2 (if compte technique provided): `POST /cpro/factures/v1/deposer/flux` → real `numeroFluxDepot` returned.
- Step 3: `POST /cpro/factures/v1/consulter/cr` → statutFlux = DEPOSE/EN_COURS_DE_TRAITEMENT/VALIDE.

---

# National portals (namespaced per-provider convention)

## `portalPrefix` — how the prefix is derived

```
prefix = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
```

| Provider id | Derived prefix |
|---|---|
| `choruspro` | `CHORUSPRO` |
| `anaf` | `ANAF` |
| `zatca` | `ZATCA` |
| `gib` | `GIB` |
| `eg-eta` | `EG_ETA` |
| `in-irp` | `IN_IRP` |
| `myinvois` | `MYINVOIS` |
| `id-coretax` | `ID_CORETAX` |
| `firs` | `FIRS` |
| `ke-kra` | `KE_KRA` |
| `afip` | `AFIP` |
| `sefaz` | `SEFAZ` |
| `sii` | `SII` |
| `sri` | `SRI` |
| `uy-dgi` | `UY_DGI` |

## Standard `<PREFIX>_*` variables

Each portal self-gates on `<PREFIX>_LIVE=1` and reads its own namespaced creds.
Empty vars are ignored — only those with values are passed to the provider.

| Suffix | Full example | Purpose |
|---|---|---|
| `_LIVE` | `ANAF_LIVE=1` | Opt-in gate — must be exactly `1` |
| `_BASE_URL` | `ANAF_BASE_URL=https://api.anaf.ro` | Portal API base URL |
| `_ENVIRONMENT` | `ANAF_ENVIRONMENT=TEST` | `TEST` or `PROD` (default: `TEST`) |
| `_API_KEY` | `ZATCA_API_KEY=<key>` | API key |
| `_AUTH_TOKEN` | `ANAF_AUTH_TOKEN=<token>` | Bearer / session token |
| `_CLIENT_ID` | `CHORUSPRO_CLIENT_ID=<id>` | OAuth2 client ID |
| `_CLIENT_SECRET` | `CHORUSPRO_CLIENT_SECRET=<sec>` | OAuth2 client secret |
| `_CERTIFICATE` | `SEFAZ_CERTIFICATE=<b64-pfx>` | PFX certificate, base64-encoded |
| `_CERT_PASSWORD` | `SEFAZ_CERT_PASSWORD=<pass>` | Certificate password |
| `_TAXPAYER_ID` | `ANAF_TAXPAYER_ID=<cui>` | Taxpayer / company identifier |
| `_SELLER_VAT` | `ANAF_SELLER_VAT=RO12345678` | Seller VAT (fixture) |
| `_BUYER_VAT` | `ANAF_BUYER_VAT=RO00000001` | Buyer VAT (fixture) |
| `_SELLER_NAME` | `CHORUSPRO_SELLER_NAME=…` | Seller company name (fixture) |
| `_BUYER_NAME` | `CHORUSPRO_BUYER_NAME=…` | Buyer company name (fixture) |
| `_COUNTRY` | `ZATCA_COUNTRY=SA` | Seller country 2-letter ISO (fixture) |
| `_BUYER_COUNTRY` | `ZATCA_BUYER_COUNTRY=SA` | Buyer country (fixture) |
| `_CURRENCY` | `ZATCA_CURRENCY=SAR` | Invoice currency (default: `EUR`) |
| `_XML_PATH` | `ANAF_XML_PATH=/path/to/invoice.xml` | Pre-built XML (skips auto-generation) |
| `_SYNTAX` | `ZATCA_SYNTAX=EN16931_UBL` | Artifact syntax (default: `EN16931_UBL`) |

Provider-specific extras (e.g. `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD`) are picked up
automatically — any `<PREFIX>_*` key not listed above is also camelCased and forwarded.

## Per-portal examples

### Chorus Pro (FR B2G)

```bash
CHORUSPRO_LIVE=1 \
  CHORUSPRO_CLIENT_ID=<piste_client_id> \
  CHORUSPRO_CLIENT_SECRET=<piste_client_secret> \
  CHORUSPRO_TECH_LOGIN=<compte_technique_login> \
  CHORUSPRO_TECH_PASSWORD=<compte_technique_password> \
  CHORUSPRO_ENVIRONMENT=SANDBOX \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=choruspro
```

### ZATCA (SA — FATOORA)

```bash
ZATCA_LIVE=1 \
  ZATCA_API_KEY=<key> \
  ZATCA_CERTIFICATE=<base64-pfx> \
  ZATCA_CERT_PASSWORD=<pass> \
  ZATCA_TAXPAYER_ID=<tin> \
  ZATCA_ENVIRONMENT=TEST \
  ZATCA_COUNTRY=SA \
  ZATCA_CURRENCY=SAR \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=zatca
```

### ANAF (RO — SPV e-factura)

```bash
ANAF_LIVE=1 \
  ANAF_AUTH_TOKEN=<token> \
  ANAF_TAXPAYER_ID=<cui> \
  ANAF_ENVIRONMENT=TEST \
  ANAF_COUNTRY=RO \
  ANAF_SELLER_VAT=RO12345678 \
  ANAF_BUYER_VAT=RO00000001 \
  npx jest portal-live --no-coverage --runInBand --testNamePattern=anaf
```

### Running multiple portals in one invocation

```bash
ZATCA_LIVE=1 ZATCA_API_KEY=<key> ZATCA_TAXPAYER_ID=<tin> \
ANAF_LIVE=1  ANAF_AUTH_TOKEN=<tok> ANAF_TAXPAYER_ID=<cui> \
  npx jest portal-live --no-coverage --runInBand
```

---

## SdI prerequisites (currently deferred — code is implemented-awaiting-accreditation)

Status (2026-09-01): step 3 below is DONE — a real `SdiHttpPort` (`SdiCoopClient`,
`backend/src/modules/documents/transports/sdi/sdicoop-client.ts`) exists, built from the published
SdICoop WSDL/XSD/instructions (see `CREDENTIALS_GUIDE.md` §4's own citation list), and
`sdi-transport.ts` already uses it whenever a company's "sdi" channel credentials are complete. What
remains is entirely OUTSIDE this codebase's control:

1. Register as an intermediary (*intermediario*) with AdE.
2. Obtain a qualified digital certificate (PFX/P12) from an accredited CA (client cert; a distinct-key
   server cert too, if the notifiche receiver is to be mTLS-authenticated server-side — see
   `sdi-notifiche.service.ts`'s own header on what that endpoint still lacks).
3. ~~Implement `SdiHttpPort` for SDICoop SOAP~~ — done (`sdicoop-client.ts`).
4. Declare the accredited `SDI_ENDPOINT` (the `SdIRiceviFile` URL AdE assigns) as this company's "sdi"
   channel credential, alongside `SDI_ID_TRASMITTENTE`/`SDI_CERTIFICATE`/`SDI_CERT_PASSWORD`.
5. Set `SDI_LIVE=1` + all four creds and run `sdicoop.live.spec.ts` — the first real run against
   collaudo may reveal envelope discrepancies reading the spec alone could not anticipate (see that
   spec's own header).

## Peppol — multi-provider Access Point support

One port (`PeppolApPort`), several adapters, chosen per company via the `apProvider` channel
config field (`peppol/ap-adapters.ts`): `generic` (default, backward-compatible REST gateway),
`peppol-sh`, `storecove`.

### peppol.sh — ✅ PROVEN, zero secrets (the recommended sandbox path)

The `peppol-sh-live.spec.ts` flow is fully self-bootstrapping (Ethereal pattern):

1. `POST https://api.peppol.sh/v1/signup {email}` → instant `ps_test_` API key (no KYC, no card).
2. `POST https://sandbox.peppol.sh/v1/companies` → sending company (`com_…`).
   ⚠ Verified live: `ps_test_` keys are **rejected on api.peppol.sh** (403 `wrong_environment`) —
   all authed sandbox calls go to `sandbox.peppol.sh`.
3. `POST /v1/documents` (JSON document extracted from our builder-generated UBL) → `doc_…` id.
4. `GET /v1/documents/{id}?company_id=com_…` (the query param is required — verified live) →
   `queued → sending → delivered` (sandbox delivers by email; statuses are real).

Run: `PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh npx jest peppol-sh-live --no-coverage --runInBand`
Proven 2026-07-11: document `doc_2yb9TJka7US3hBwz4rnDW` → CLEARED in ~13 s.
Production later: pass KYC → `ps_live_` key → `environment: PROD` (routes via their certified AP).

### Generic AP gateway (deferred)

1. Connect to a Peppol Access Point provider (e.g. Basware, Pagero, Qvalia, or self-hosted phase4/oxalis-ng).
2. Obtain an AP certificate (C1/C2) registered with OpenPeppol or the national Peppol Authority.
3. The receiver (`PEPPOL_RECEIVER_ID`) must be registered in the SMP/SML.
4. Set `PEPPOL_LIVE=1` + creds and run `peppol-live.spec.ts`.

### Storecove (deferred)

Adapter implemented against the public API reference (`POST /api/v2/document_submissions` with
base64 raw UBL + `parseStrategy: 'ubl'`; evidence endpoint for status) — mocked tests only.
Live proof needs a trial account (manual request, 30-day sandbox; no self-serve signup API).

---

## Running in GitHub Actions

Workflow: **`.github/workflows/compliance-live.yml`** (manual `workflow_dispatch` + nightly cron).
- The `live` job handles KSeF/PDP/Peppol/email/TSA (proven or gated) and SdI (implemented-awaiting-
  accreditation, still deferred — see "SdI prerequisites" above) plus the
  creds-free `apply-signal.live.spec.ts` DB test (`COMPLIANCE_LIVE_DB_TESTS=1`, set as a workflow
  constant — needs only the job's own disposable Postgres, no secret).
- The `national-portals-live` job runs `portal-live.spec.ts` with all namespaced `<PREFIX>_*`
  secrets mapped. Each portal self-skips unless at least one real credential is present
  (checked: `_CLIENT_ID`, `_CLIENT_SECRET`, `_API_KEY`, `_AUTH_TOKEN`, `_CERTIFICATE`, `_TOKEN`).
  You can fill in one portal's credentials at a time.

> **Cron caveat:** GitHub only fires the `schedule` trigger from the repository's **default branch**
> (typically `main`). On a feature branch, the nightly `cron: '0 3 * * *'` entry above is inert —
> use the **"Run workflow"** button (`workflow_dispatch`) targeting that branch instead; the cron
> starts firing automatically once the workflow file is merged to the default branch.
>
> **What "green" means with zero secrets configured:** every creds-gated spec (KSeF, PDP, SdI,
> generic-AP Peppol, TSA, Chorus Pro, all national portals) self-skips via `liveDescribe`/the
> two-tier portal gate — see the hard-success contract at the top of this file, enforced by each
> spec, not by the gate. Only the genuinely creds-free specs actually run and must pass: Email
> (Ethereal), Peppol via `peppol-sh` (zero-secret sandbox self-signup), and the
> `apply-signal.live.spec.ts` DB test. A fully green *real-round-trip* matrix (KSeF CLEARED, PDP
> PENDING/CLEARED, SdI CLEARED, national portals, …) additionally needs the repo secrets listed in
> the table below — see also `CREDENTIALS_GUIDE.md` for the per-platform setup walkthrough.

> **`*_LIVE` and `*_ENVIRONMENT` are constants in the workflow — do NOT add them as GitHub secrets.**
> They are set as literal values directly in the YAML (`ANAF_LIVE: '1'`, `ANAF_ENVIRONMENT: 'SANDBOX'`, etc.).
> Only real credentials (`*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_API_KEY`, `*_AUTH_TOKEN`,
> `*_CERTIFICATE`, `*_CERT_PASSWORD`, `*_TAXPAYER_ID`, `*_BASE_URL`,
> `*_SELLER_VAT`, `*_BUYER_VAT`, `*_COUNTRY`) belong in secrets.

**Where to add the secrets:** repo → **Settings → Secrets and variables → Actions → New repository secret**.
- GitLab equivalent: *Settings → CI/CD → Variables*.
- Forgejo/Gitea equivalent: *Settings → Actions → Secrets* (same `${{ secrets.X }}` syntax).

**3 GitHub-specific gotchas:**
1. **Never run live tests `on: pull_request`** — GitHub does not expose repository secrets to workflows
   triggered by PRs from forks, so the secrets would be empty. Use `workflow_dispatch` / `schedule`
   (as the provided workflow does).
2. **PFX certificates** (`SDI_CERTIFICATE`, `PORTAL_CERTIFICATE`) are passed **base64-encoded, directly**
   as the secret value (the specs read the base64 string — no file decode needed). Generate with
   `base64 -w0 cert.pfx | pbcopy` (or `| xclip`).
3. Optional: create a GitHub **Environment** named `live-tests` (Settings → Environments) with a
   *required reviewer* to gate each run before spending an authority call.

**Secret names + where each credential comes from:**

| Secret(s) | Channel | Where to obtain |
|---|---|---|
| `KSEF_AUTH_TOKEN`, `KSEF_NIP` | PL KSeF | KSeF app **ksef.mf.gov.pl** (test: ksef-test.mf.gov.pl) → log in (NIP + trusted profile/qualified sig) → *Tokens*. Prod also needs the MF prod public PEM keys. |
| `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` (+ `PDP_API_STYLE`, `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING`) | FR PDP + AFNOR | PDP developer portal. Sandbox = **superpdp**. Real PDP list (annuaire): **impots.gouv.fr**. AFNOR uses the same creds + `PDP_API_STYLE=afnor`. |
| `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE` (b64 PFX), `SDI_CERT_PASSWORD` | IT SdI | **Agenzia delle Entrate** intermediary accreditation (fatturapa.gov.it) — `SDI_ENDPOINT` (the accredited `SdIRiceviFile` URL) and the PFX are both assigned/issued during that accreditation, never a fixed constant (see `CREDENTIALS_GUIDE.md` §4). Code side: implemented-awaiting-accreditation (`sdicoop-client.ts`), never yet run against the real endpoint. |
| _(none)_ | Peppol via peppol.sh | Self-signup in the spec — no secret needed. `PEPPOL_AP_PROVIDER` is a constant (`'peppol-sh'`) in the workflow — not a secret. ✅ proven. |
| `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | Peppol generic AP | A connected **Access Point** (Storecove, Ecosio, Pagero/Tickstar, Unimaze…) or self-hosted; membership via **OpenPeppol** (peppol.org). `PEPPOL_ENV` is a constant (`'TEST'`) in the workflow — not a secret. |
| `<PREFIX>_CLIENT_ID`, `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_API_KEY`, `<PREFIX>_AUTH_TOKEN`, `<PREFIX>_CERTIFICATE`, `<PREFIX>_CERT_PASSWORD`, `<PREFIX>_TAXPAYER_ID`, `<PREFIX>_BASE_URL`, `<PREFIX>_SELLER_VAT`, `<PREFIX>_BUYER_VAT`, `<PREFIX>_COUNTRY` (per portal) | National portals | Each authority's dev portal: AFIP (afip.gob.ar), SEFAZ (BR), SII (sii.cl), DIAN (dian.gov.co), **ZATCA Fatoora** (zatca.gov.sa), ANAF SPV (anaf.ro), **MyInvois** (myinvois.hasil.gov.my), India IRP (einvoice1.gst.gov.in)… `<PREFIX>_LIVE` and `<PREFIX>_ENVIRONMENT` are constants in the workflow YAML — **not secrets**. |
| `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | FR Chorus Pro B2G | **PISTE developer portal** (piste.gouv.fr) — subscribe to "API Dépôt flux G2B", then create a Chorus Pro "compte technique" in the sandbox. |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email | Ethereal auto-creates a throwaway account — no secret needed. ✅ proven. |

> CFDI/MX needs a **PAC** account (SAT-certified: Finkok, Facturama, SW Sapien…) + a **CSD** cert from
> **sat.gob.mx** — wired through the `pac` provider, not the gated portal harness.
> Facturae / national **XSD** files (not secrets) come from **facturae.gob.es** + each authority.
