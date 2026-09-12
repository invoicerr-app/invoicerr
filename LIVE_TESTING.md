# Live Testing Guide

All live tests are **SKIPPED by default** in CI and in any offline run. They are opt-in:
only when the channel-specific flag is set to `1` **AND** the required credential env vars
are present does the suite actually run — otherwise `describe.skip` fires silently.

The shared gate helper is at:
`backend/src/modules/documents/transports/live-gate.ts`

Hard-success contract (enforced per-spec):
- A `REJECTED` or `SKIPPED` transmission result **fails** the test (not tolerates it).
- An empty or missing authority reference/id **fails** the test.
- Async portals must reach `CLEARED` within the specified poll window.

---

## Channel summary

**Status legend — three different claims, kept visually distinct:**
- ✅ **Proven live (dated)** — a real round-trip against the real authority/network/sandbox, actually
  run and verified by reading the platform's own response, not merely a green mocked test.
- 🟡 **Implemented, awaiting credentials/accreditation** — the code exists and is ready to run, but the
  full round-trip has never actually happened in this architecture (missing token, certificate, or
  account). Where a *narrower* credential-free reachability check has been proven live, that is named
  explicitly — it proves the host/path answer for real, never that the full flow would succeed.
- 🔴 **Deferred / not implemented** — no working code path for the live leg yet, or the round-trip
  requires an account this project does not have and has not attempted to obtain.

| Channel | Flag | Key creds | Spec file | Status |
|---|---|---|---|---|
| KSeF (PL) | `KSEF_LIVE=1` | `KSEF_AUTH_TOKEN`, `KSEF_NIP` | `ksef/ksef-live.spec.ts` | 🟡 Implemented, awaiting credentials — **no `KSEF_AUTH_TOKEN`/`KSEF_NIP` exist in this checkout or in CI secrets today.** The spec's own header records that the one historical proof of this flow used a token that has since expired/rotated, and this round-trip has not been re-run since — a real proof needs a fresh sandbox token before it can be claimed again. |
| PDP superpdp (FR) | `PDP_LIVE=1` | `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` | `pdp/pdp.live.spec.ts` | ✅ **Round-trip prouvé** — `fr:200 → fr:201 → fr:202`, dépôt 375037, 2026-08-29 |
| Email (document "send" SMTP delivery) | `DOCUMENTS_MAIL_LIVE=1` | _(none — hits the local Mailpit container the dev/test stack already runs, SMTP `:1025` / API `:8025`; needs `DATABASE_URL` for one throwaway `Company` row)_ | `actions/send-quote.live.spec.ts` | ✅ Proven live (2026-08-31) — a real message read back from Mailpit's own API, with the PDF attachment actually present and the subject genuinely interpolated |
| SdI (IT) | `SDI_LIVE=1` | `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE`, `SDI_CERT_PASSWORD` | `sdi/sdicoop.live.spec.ts` | 🔴 Deferred (AdE accreditation) — code implemented-awaiting-accreditation, never yet run |
| Peppol via peppol.sh | `PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh` | _(none — spec self-signs-up on the peppol.sh sandbox)_ | `peppol/peppol-sh-live.spec.ts` | ✅ **Round-trip prouvé le 2026-09-02** — `FR` reste cassé (`invalid_country`), mais `BE` (+ `peppol_id` explicite) marche : `doc_…` → `DELIVERED` en ~10 s, reproduit deux fois (voir ci-dessous) |
| Peppol via peppol.sh — XRechnung content (DE B2G format override) | `PEPPOL_LIVE=1` + `PEPPOL_AP_PROVIDER=peppol-sh` | _(none — same zero-secret sandbox)_ | `peppol/peppol-sh-xrechnung-live.spec.ts` | ✅ **Round-trip prouvé le 2026-09-02** — `doc_v37PTxYOQGn78bPAnMiI0` → `DELIVERED` en ~10 s ; voir l'encadré ci-dessous pour la LIMITE HONNÊTE de ce que ça prouve (peppol.sh n'accepte jamais de bytes UBL bruts — voir ce spec's own header) |
| Peppol generic AP | `PEPPOL_LIVE=1` | `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | _(no live spec exists yet — mocked coverage only, `peppol/peppol-client.spec.ts`)_ | 🔴 Deferred (connected AP required) |
| Chorus Pro (FR B2G) | `CHORUSPRO_LIVE=1` | `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET` | `chorus-pro/choruspro-live.spec.ts` | 🟡 Implemented, awaiting a PISTE account — **skipped, always, today** (no PISTE account in this checkout). Credential-free reachability **proven live 2026-09-02**: `sandbox-oauth.piste.gouv.fr` answers a genuine `400 {"error":"invalid_client"}` to a garbage client id/secret — the host/path are real, the deposit itself has never been attempted. |
| RFC 3161 TSA (-T signing) | `TSA_LIVE=1` | `TSA_URL` | `signing/tsa-live.spec.ts` | 🟡 Wired (run to prove FreeTSA) |
| Company lookup (national registers) | `COMPANY_LOOKUP_LIVE=1` | _(none — every source is keyless: 15 national registers + VIES + GLEIF + Peppol Directory)_ | `modules/company-lookup/company-lookup.live.spec.ts` | ✅ Proven live (2026-07-27) |
| Mistral OCR (received-invoice PDF extraction, T5(c)) ⚙ *not a channel — the dedicated `ROLE=ocr` service's own CLOUD engine, never the main backend* | `MISTRAL_OCR_LIVE=1` | `MISTRAL_API_KEY` | `ocr-service/mistral-client.live.spec.ts` | 🟡 Credential-free reachability block **proven live 2026-09-03** (`api.mistral.ai/v1/ocr`, no/garbage auth → real `401 {"detail":"Invalid API Key"}`) — full round-trip 🔴 deferred, no Mistral API key provisioned for this task |
| Local OCR engine (the `ocr-image` repo, our own `ocrmypdf`-based image) ⚙ *not a channel — the SAME `ROLE=ocr` service's LOCAL engine, `OCR_ENGINE=local`, running our own Docker image and server rather than depending on a third-party OCR provider* | `LOCAL_OCR_LIVE=1` | _(none — no cloud key, that is the entire point; the spec `docker pull`s + runs the published image (ghcr.io/invoicerr-app/ocr-image) via `docker`, gated on a usable local Docker daemon — `docker info` — checked at load time)_ | `ocr-service/local-client.live.spec.ts` | ✅ **Round-trip prouvé le 2026-09-11** (engine switched from `apache/tika:latest-full` to our own image, same day) — the spec pulls and launches the real container, `POST`s a real `pdf-lib`-built invoice PDF to it, and the heuristic mapping correctly reads HT/TVA/TTC and the VAT id back; because this server force-OCRs every page (see `server.py`'s own header), this jest run now exercises REAL Tesseract recognition automatically, unlike the Tika era which needed a separate manual proof for that. A SEPARATE, MANUAL round-trip the same day against genuinely RASTERIZED (image-only) invoice PDFs — one French, one Polish (the new language pack Tika's own stock image never had) — proved the broader language coverage too; see `local-client.ts`'s own header for that citation |

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

> ### ✅ Peppol via peppol.sh — RETENTÉ le 2026-09-02, round-trip réel obtenu (transport `peppol`
> reconstruit dans `documents/transports/`)
>
> Le nouveau transport (`transports/peppol-transport.ts` + `transports/peppol/peppol-client.ts`,
> l'adaptateur AP générique) est câblé et testé (jest, `peppol-transport.spec.ts`). Pour la tentative
> live elle-même, le spec `peppol/peppol-sh-live.spec.ts` a été repris quasi verbatim du repère, puis
> RE-EXÉCUTÉ en vrai (`PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh`), avec trois résultats bruts,
> aucun deviné :
>
> 1. **`country: 'FR'` — TOUJOURS cassé.** Réponse brute, identique à celle du 29/08 :
>    `HTTP 400 — {"error":{"code":"invalid_country","message":"country must be an active Peppol
>    country code","param":"country"}}`. Ni corrigé côté peppol.sh, ni une panne passagère — reproduit
>    à l'identique quatre jours plus tard.
> 2. **`country: 'BE'` — une NOUVELLE panne d'abord, différente, puis un succès.** Le premier essai
>    (sans `peppol_id` explicite, exactement le payload du repère de 2026-07-11) échoue avec
>    `HTTP 400 — {"error":{"code":"missing_peppol_id","message":"peppol_id is required and must be a
>    valid <scheme>:<value> Peppol participant identifier"}}` — l'API a donc changé depuis la preuve
>    du repère : `tax_id` seul ne suffit plus à créer une société sandbox. Une fois un `peppol_id`
>    explicite fourni (`createCompany` a gagné ce paramètre optionnel), la création réussit :
>    `com_IO3upwIDxk45Daf8y41h7` (puis `com_…` à nouveau au second run).
> 3. **Le round-trip complet, jusqu'au bout, RÉUSSIT — deux fois.** Un vendeur ALLEMAND (jamais
>    français, exprès — un vendeur français aurait trébuché sur PEPPOL-EN16931-R002, la limitation
>    déjà documentée de `peppol-bis-provider.ts`, avant même d'atteindre le réseau) construit un
>    Peppol BIS UBL réel et VALIDE (le vrai Schematron vendu, base + delta), envoyé via
>    `PeppolShApClient.send()` :
>    - Run 1 : `{"messageId":"doc_tSynOlxg9LaKv4mTJVnxI","status":"QUEUED"}` → poll 2/24 →
>      `DELIVERED` (~10 s).
>    - Run 2 : `{"messageId":"doc_t477L6zcVzFbp7IguAIi7","status":"QUEUED"}` → poll 2/24 →
>      `DELIVERED` (~10 s).
>
> **Conclusion, honnête** : peppol.sh lui-même fonctionne bien aujourd'hui (signup, société, envoi,
> statut, tout est réel) — l'hypothèse du 29/08 ("la France est passée au mandat PDP et peppol.sh
> l'aurait retirée") reste NON tranchée à sa cause exacte (la BELGIQUE, elle, est acceptée — ce
> n'est donc pas un retrait total du sandbox), mais l'observation elle-même (FR rejeté) est
> confirmée, reproduite, et contournée avec un pays alternatif comme demandé. C'est le PREMIER envoi
> Peppol réel de cette nouvelle architecture `documents/` — voir `peppol-sh-live.spec.ts`'s own
> header pour le détail et le knob `PEPPOL_SH_FALLBACK_COUNTRY` qui automatise ce contournement pour
> une future ré-exécution.

> ### ✅ Peppol via peppol.sh — XRechnung (le trou allemand du B2G), tenté et RÉUSSI le 2026-09-02
>
> "Le trou allemand du B2G" : `b2g-routing/data/de.json` route désormais vers
> `transportId: "peppol"` avec `formatSyntax: "xrechnung"` (voir `peppol-transport.ts`'s own header,
> "THE FORMAT OVERRIDE") — la question live posée par cette tâche était "la sandbox peppol.sh
> accepte-t-elle un envoi construit avec `formats/xrechnung-provider.ts` (au lieu de
> `peppol-bis-provider.ts`) vers son propre receiver de test ?". Même motif EXACT que le round-trip
> ci-dessus (société BE + `peppol_id` explicite, vendeur allemand, receveur `sandbox.peppol.sh`) —
> voir `peppol/peppol-sh-xrechnung-live.spec.ts`.
>
> **Résultat brut, un seul run, non deviné** :
> 1. Signup : `acc_qz9uV6XuSnda0fpFOIa1s`.
> 2. `country: 'FR'` : rejeté, `invalid_country` — même panne que le round-trip Peppol BIS. Fallback
>    `country: 'BE'` (+ `peppol_id: '9925:BE999999999'`) : `com_h0t5I7orCSKUrK48C2770`.
> 3. `xrechnungFormatProvider.build()` (vendeur allemand AVEC IBAN — `formats/xrechnung-provider.ts`'s
>    own BR-DE-1) : `validation.valid: true`, 0 erreur, UBL de 4012 octets. Vérifié LOCALEMENT, avant
>    tout envoi : `urn:xeinkauf.de:kosit:xrechnung_3.0` présent dans le XML, `urn:fdc:peppol.eu:2017:
>    poacc:billing:3.0` ABSENT — c'est bien un XRechnung, jamais un Peppol BIS, qui part sur le réseau.
> 4. `PeppolShApClient.send()` : `{"messageId":"doc_v37PTxYOQGn78bPAnMiI0","status":"QUEUED"}`.
> 5. Poll 1/24 : `QUEUED`. Poll 2/24 : `DELIVERED` (~10 s, un seul palier d'attente — identique au
>    timing du round-trip Peppol BIS).
>
> **Conclusion, honnête, avec sa propre limite nommée** : le canal ACCEPTE et LIVRE un document
> construit par `xrechnung-provider.ts` exactement comme il accepte et livre un document construit
> par `peppol-bis-provider.ts` — aucune régression, aucun comportement différent côté transport. Mais
> lire `peppol-sh-xrechnung-live.spec.ts`'s own header avant de sur-interpréter ce vert :
> `PeppolShApClient#send()` (`peppol-sh-client.ts#ublToPeppolShDocument`) n'accepte JAMAIS de bytes
> UBL bruts — il EXTRAIT une poignée de champs génériques EN 16931 (nom de partie, VAT, devise, dates,
> lignes) et peppol.sh RE-SÉRIALISE son propre document côté serveur pour la livraison réelle ; cette
> extraction ne lit ni `cbc:CustomizationID` ni aucun élément spécifique à XRechnung
> (BuyerReference/Contact/PaymentMeans). Un `DELIVERED` ici prouve donc que l'artefact XRechnung de ce
> dépôt (déjà jugé valide par le VRAI Schematron KoSIT vendored, base + delta, avant même l'envoi) est
> structurellement compatible avec le MÊME chemin d'extraction UBL générique que Peppol BIS — pas que
> peppol.sh transmet, juge ou conserve le contenu comme étant spécifiquement du XRechnung. La preuve
> proprement XRechnung — le CustomizationID réellement dans les octets envoyés — est celle jugée
> LOCALEMENT au point 3 ci-dessus, avant le réseau, jamais celle du réseau lui-même.

## Running a single live spec

```bash
# KSeF (PL) — implemented, awaiting credentials: no KSEF_AUTH_TOKEN/KSEF_NIP exist today (see the
# summary table above for why the one historical proof no longer counts)
KSEF_LIVE=1 KSEF_AUTH_TOKEN=<token> [KSEF_NIP=<nip>] \
  npx jest ksef-live --no-coverage --runInBand

# PDP superpdp (FR) — round-trip prouvé : déposée, validée, émise, reçue (voir l'encadré)
set -a; . .env.pdp.local; set +a
PDP_LIVE=1 npx jest pdp.live --no-coverage --runInBand

# Email (document "send" SMTP delivery to the local Mailpit container — no external creds needed,
# but needs Mailpit running on :1025/:8025 and a DATABASE_URL for one throwaway Company row)
DOCUMENTS_MAIL_LIVE=1 SMTP_HOST=localhost SMTP_PORT=1025 \
  DATABASE_URL=postgresql://invoicerr:invoicerr@localhost:5433/invoicerr_db \
  npx jest send-quote.live --no-coverage

# SdI (IT) — requires AdE accreditation + qualified PFX certificate (code implemented-awaiting-accreditation)
SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 SDI_ENDPOINT=<accredited-SdIRiceviFile-url> \
  SDI_CERTIFICATE=<base64-pfx> SDI_CERT_PASSWORD=<pass> \
  npx jest sdicoop.live --no-coverage --runInBand

# Peppol via peppol.sh — ZERO SECRETS (self-signup, like the Email leg above)
PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh \
  npx jest peppol-sh-live --no-coverage --runInBand
# Optional: reuse an existing sandbox account instead of self-signup
#   PEPPOL_SH_API_KEY=ps_test_… PEPPOL_SH_COMPANY_ID=com_… [PEPPOL_RECEIVER_ID=<scheme:id>]

# Peppol via peppol.sh — XRechnung content (DE B2G format override) — same zero-secret sandbox
PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh \
  npx jest peppol-sh-xrechnung-live --no-coverage --runInBand

# Peppol generic AP — deferred: no live spec exists yet (needs a connected Access Point first);
# only mocked coverage exists today, in peppol/peppol-client.spec.ts

# Chorus Pro (FR B2G) — implemented, awaiting a PISTE account (skipped, always, in this checkout)
CHORUSPRO_LIVE=1 CHORUSPRO_CLIENT_ID=<id> CHORUSPRO_CLIENT_SECRET=<secret> \
  npx jest choruspro-live --no-coverage --runInBand

# RFC 3161 TSA — level-T signing via real TSA (e.g. FreeTSA)
TSA_LIVE=1 TSA_URL=https://freetsa.org/tsr \
  npx jest tsa-live --no-coverage --runInBand

# Mistral OCR (cloud engine, ROLE=ocr's OWN client — real API key required)
MISTRAL_OCR_LIVE=1 MISTRAL_API_KEY=<key> \
  npx jest mistral-client.live --no-coverage --forceExit

# Local OCR engine (the ocr-image repo, our own ocrmypdf-based image — ROLE=ocr's OTHER client, NO
# cloud key at all). Requires a usable local Docker daemon (`docker info`) — the spec pulls, runs,
# uses, and tears down the published container itself; nothing needs to be started manually first
# (the first run pulls ghcr.io/invoicerr-app/ocr-image; every run after reuses Docker's layer cache).
LOCAL_OCR_LIVE=1 npx jest local-client.live --no-coverage --forceExit
```

---

## Verifying the gate works (no flag = skipped)

```bash
# Run the gated spec without the flag → must show as skipped
cd backend
npx jest ksef-live --no-coverage
# Expected: Test Suites: 1 skipped | Tests: 0 (suite skipped)

npx jest pdp.live send-quote.live sdicoop.live tsa-live choruspro-live --no-coverage
# Expected: all suites skipped
```

---

## Running the full offline suite (gate must not fire)

```bash
cd backend
npx jest --no-coverage
# Live specs appear in "skipped suites" count — no live call is made.
# Baseline (2026-09-13): 2740 passed / 58 skipped, 254 of 278 suites run — this number drifts as the
# codebase grows; treat it as a sanity check, not a pinned target.
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
  [CHORUSPRO_ENVIRONMENT=SANDBOX] \
  npx jest choruspro-live --no-coverage --runInBand
```

| Env var | Purpose |
|---|---|
| `CHORUSPRO_CLIENT_ID` | PISTE OAuth2 `client_id` (from PISTE developer portal) — required by the gate |
| `CHORUSPRO_CLIENT_SECRET` | PISTE OAuth2 `client_secret` — required by the gate |
| `CHORUSPRO_TECH_LOGIN` | Chorus Pro "compte technique" login (optional — the OAuth half runs without it; the deposit half is skipped when absent) |
| `CHORUSPRO_TECH_PASSWORD` | Chorus Pro "compte technique" password (same optionality as above) |
| `CHORUSPRO_ENVIRONMENT` | `SANDBOX` (default) or `PROD` |

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
- With no compte technique set, only step 1 runs — this is the "skipped, always" state this checkout
  is actually in today (see the summary table above).

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

## Peppol

Production sends only through the **generic** Access Point adapter (`peppol/peppol-client.ts`) — this
architecture has no per-company `apProvider` selector. The multi-vendor switch the compliance engine
used to have (`ap-adapters.ts`), and the Storecove adapter it could dispatch to, were not carried over
when that engine was deleted (`peppol-transport.ts`'s own header names this explicitly). `peppol-sh`
(`peppol/peppol-sh-client.ts`) exists only as a separate, DB-free live-proof harness — it is never
selectable in production and never called from `peppol-transport.ts`.

### peppol.sh — ✅ PROVEN, zero secrets (the live-proof harness)

The `peppol-sh-live.spec.ts` flow is fully self-bootstrapping (no pre-provisioned account needed):

1. `POST https://api.peppol.sh/v1/signup {email}` → instant `ps_test_` API key (no KYC, no card).
2. `POST https://sandbox.peppol.sh/v1/companies` → sending company (`com_…`).
   ⚠ Verified live: `ps_test_` keys are **rejected on api.peppol.sh** (403 `wrong_environment`) —
   all authed sandbox calls go to `sandbox.peppol.sh`.
3. `POST /v1/documents` (JSON document extracted from our builder-generated UBL) → `doc_…` id.
4. `GET /v1/documents/{id}?company_id=com_…` (the query param is required — verified live) →
   `queued → sending → delivered` (sandbox delivers by email; statuses are real).

Run: `PEPPOL_LIVE=1 PEPPOL_AP_PROVIDER=peppol-sh npx jest peppol-sh-live --no-coverage --runInBand`
Proven live 2026-09-02 in this architecture (see the encadré earlier in this file for the full,
raw result): `BE` sending companies round-trip to `DELIVERED`; `FR` still fails at signup with
`invalid_country`. An older 2026-07-11 proof (document `doc_2yb9TJka7US3hBwz4rnDW` → CLEARED in
~13 s) predates this architecture and used a different sandbox behavior (`tax_id` alone was then
enough to create a company) — superseded, kept here only as history.
Production later: pass KYC → `ps_live_` key → `environment: PROD` (routes via their certified AP).

### Generic AP gateway (deferred)

1. Connect to a Peppol Access Point provider (e.g. Basware, Pagero, Qvalia, or self-hosted phase4/oxalis-ng).
2. Obtain an AP certificate (C1/C2) registered with OpenPeppol or the national Peppol Authority.
3. The receiver (`PEPPOL_RECEIVER_ID`) must be registered in the SMP/SML.
4. No live spec exists yet for this path — only mocked coverage (`peppol/peppol-client.spec.ts`).
   Set `PEPPOL_LIVE=1` + the four creds above once a live spec is written against a real connected AP.

---

## Running in GitHub Actions

Workflow: **`.github/workflows/compliance-live.yml`** (manual `workflow_dispatch` + nightly cron).
- The `live` job runs `npx jest live` against a disposable Postgres + Redis, which sweeps in every
  `*.live.spec.ts` / `*-live.spec.ts` file matched above (KSeF, PDP, SdI, Peppol via peppol.sh, TSA,
  Chorus Pro), each self-gating on its own flag and credentials.
- **Not yet reconciled with this architecture, named honestly rather than fixed silently**: the
  workflow file's own env block still sets flags this codebase no longer reads (`EMAIL_LIVE`,
  `PDP_AFNOR_LIVE`, `COMPLIANCE_LIVE_DB_TESTS`) — harmless (nothing consumes them) rather than
  wrong. Its separate `national-portals-live` job still runs `npx jest portal-live`, a pattern that
  matches no file in this repository (`portal-live.spec.ts` no longer exists) — that job runs and
  currently finds nothing to execute. This is a defect in the workflow file itself, out of scope for
  this guide to fix.

> **Cron caveat:** GitHub only fires the `schedule` trigger from the repository's **default branch**
> (typically `main`). On a feature branch, the nightly `cron: '0 3 * * *'` entry above is inert —
> use the **"Run workflow"** button (`workflow_dispatch`) targeting that branch instead; the cron
> starts firing automatically once the workflow file is merged to the default branch.
>
> **What "green" means with zero secrets configured:** every creds-gated spec (KSeF, PDP, SdI,
> generic-AP Peppol, TSA, Chorus Pro) self-skips via `liveDescribe` — see the hard-success contract
> at the top of this file, enforced by each spec, not by the gate. Only the genuinely creds-free
> specs actually run and must pass: Email/Mailpit (`DOCUMENTS_MAIL_LIVE`, though the workflow does
> not currently set this flag — see the caveat above) and Peppol via `peppol-sh` (zero-secret sandbox
> self-signup). A fully green *real-round-trip* matrix (KSeF CLEARED, PDP PENDING/CLEARED, SdI
> CLEARED, …) additionally needs the repo secrets listed in the table below — see also
> `CREDENTIALS_GUIDE.md` for the per-platform setup walkthrough.

> **`*_LIVE` and `*_ENVIRONMENT` are constants in the workflow — do NOT add them as GitHub secrets.**
> They are set as literal values directly in the YAML (`SDI_LIVE: '1'`, `CHORUSPRO_ENVIRONMENT:
> 'SANDBOX'`, etc.). Only real credentials (`*_CLIENT_ID`, `*_CLIENT_SECRET`, `*_API_KEY`,
> `*_AUTH_TOKEN`, `*_CERTIFICATE`, `*_CERT_PASSWORD`, `*_TAXPAYER_ID`, `*_BASE_URL`) belong in secrets.

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
| `PDP_BASE_URL`, `PDP_CLIENT_ID`, `PDP_CLIENT_SECRET` (+ optional `PDP_SELLER_ROUTING`, `PDP_BUYER_ROUTING`) | FR PDP | PDP developer portal. Sandbox = **superpdp**. Real PDP list (annuaire): **impots.gouv.fr**. |
| `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE` (b64 PFX), `SDI_CERT_PASSWORD` | IT SdI | **Agenzia delle Entrate** intermediary accreditation (fatturapa.gov.it) — `SDI_ENDPOINT` (the accredited `SdIRiceviFile` URL) and the PFX are both assigned/issued during that accreditation, never a fixed constant (see `CREDENTIALS_GUIDE.md` §4). Code side: implemented-awaiting-accreditation (`sdicoop-client.ts`), never yet run against the real endpoint. |
| _(none)_ | Peppol via peppol.sh | Self-signup in the spec — no secret needed. `PEPPOL_AP_PROVIDER` is a constant (`'peppol-sh'`) in the workflow — not a secret. ✅ proven. |
| `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID` | Peppol generic AP | A connected **Access Point** (Ecosio, Pagero/Tickstar, Unimaze…) or self-hosted; membership via **OpenPeppol** (peppol.org). `PEPPOL_ENV` is a constant (`'TEST'`) in the workflow — not a secret. No live spec exists yet for this path (see "Peppol" above). |
| `CHORUSPRO_CLIENT_ID`, `CHORUSPRO_CLIENT_SECRET`, `CHORUSPRO_TECH_LOGIN`, `CHORUSPRO_TECH_PASSWORD` | FR Chorus Pro B2G | **PISTE developer portal** (piste.gouv.fr) — subscribe to "API Dépôt flux G2B", then create a Chorus Pro "compte technique" in the sandbox. |
| `CREDENTIALS_ENCRYPTION_KEY` | (shared) | `openssl rand -hex 32` — same value used by the app's credential store. |
| _(none)_ | Email (document "send" SMTP) | The local Mailpit container the dev/test stack already runs — no secret needed. ✅ proven (see the summary table above). |

> National **XSD** files (not secrets, e.g. PL FA(3)/IT FatturaPA) come from each authority directly.
