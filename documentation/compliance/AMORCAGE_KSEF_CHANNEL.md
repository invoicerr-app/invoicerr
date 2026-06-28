# Amorçage — Canal KSeF (PL) + clôture punch-list fondation

> Premier canal réel (issue #264, users PL hard-bloqués). Consomme la fondation
> `ChannelCredentialsPort` (zéro credential hardcodé). **Source de vérité API = doc officielle MF
> `CIRFMF/ksef-docs` (GitHub)** — confirmer chaque endpoint/payload contre elle, ne PAS halluciner.

## Credentials de test (live opt-in)
- **NE PAS committer de credential.** Token test fourni par l'utilisateur → dans le scratchpad de
  session : `…/scratchpad/ksef-test-creds.local.env` (NIP `1234567802`, env `test`,
  `ksef-test.mf.gov.pl`). À charger via env pour le test `KSEF_LIVE=1` uniquement.
- Vraie place persistante = config entreprise **chiffrée** (Settings → Canaux).

## Contexte version
KSeF 2.0, mandat 2026. Auth **en transition** : **token** (transitoire 2026) → **certificat KSeF**
(dès fév. 2026). Commencer par le **token**, auth **modulaire** (certificat ensuite). Environnements :
test `ksef-test.mf.gov.pl`, prod `ksef.mf.gov.pl`.

## Déjà en place (fondation)
`KsefTransmissionProvider` (GOV_PORTAL_API, ASYNC_POLL, pollPolicy) + `configSchema` ·
`ChannelCredentialsPort.resolve(companyId,'ksef',env)` · `buildFaVat` FA(2) XSD-validé · poll scheduler.

## Phase 0 — clôture punch-list fondation (commit séparé)
1. **Test anti-fuite secret** (spec NestJS controller) : GET configs → un champ `secret` n'est JAMAIS
   renvoyé en clair (config chiffrée mockée → masque vérifié).
2. **Durcir `maskSecrets`** : schéma/provider inconnu → masquer TOUT (plus de `return config`).
3. **Environnement non hardcodé** : `registry.transmitAll` (~ligne 101) passe `'TEST'` en dur →
   résoudre l'environnement **configuré** (configs PROD doivent être atteignables).
4. (cosmétique) `"•••• se"` → `"•••• set"`.
→ `fix(compliance): channel-config punch-list (secret-mask test, no-schema hardening, env)`

## Phase 1 — client KSeF modulaire (cycle-safe)
- `ksef-client.ts` : base URL **par environnement**, méthodes typées (`authorisationChallenge` /
  `initSession` / `sendInvoice` / `invoiceStatus` / `sessionUpo` / `terminate`). HTTP + timeouts +
  retries bornés. **Endpoints/payloads confirmés contre `CIRFMF/ksef-docs`.**
- Crypto auth : MF public key vendorée **par env** ; RSA-encrypt du token selon la spec. Modulaire
  (certificat plus tard).

## Phase 2 — `transmit()` + `poll()` réels
- `transmit()` : resolve creds (NIP/token/env) → SKIPPED si absent ; FA(2) → SHA-256 + taille →
  session → `Invoice/Send` → `{status:'PENDING', ref: elementReferenceNumber}` ; idempotence via `key`.
- `poll(ref)` : `Invoice/Status/{ref}` → en cours→PENDING ; accepté→**CLEARED** (+ numéro KSeF + **UPO**) ;
  rejeté→**REJECTED** (+ motif). UPO stockée (preuve). Brancher sur `applyResponse` (poll scheduler).

## Phase 3 — tests honnêtes
- **Unit (CI, HTTP mocké, zéro réseau)** : construction requêtes, SHA-256, RSA-encrypt (vecteurs
  connus), mapping statut→lifecycle, SKIPPED sans creds.
- **Live opt-in** (`KSEF_LIVE=1` + creds scratchpad) : round-trip réel vs `ksef-test.mf.gov.pl`.
  **Jamais en CI.** Ne jamais prétendre « envoyé à KSeF » sans round-trip réel.

## Vérif
build back+front, jest (dont le test anti-fuite secret), `git` avant « fait ».

## Honnêteté / pièges
- Confirmer la surface API **contre la doc officielle**, pas de mémoire.
- FA(2) validé côté serveur KSeF → écarts en REJECTED, à traiter.
- Token chiffré au repos + **jamais loggé en clair**.
