# TODO_MANDANT — ce qui est à TA main (2026-09-06)

Tout ce qui suit est **hors de portée du code** : démarches administratives, créations de comptes,
identités humaines, contrats commerciaux, ou décisions produit. Le code correspondant est prêt et
attend derrière chaque item (référence donnée à chaque fois). Rien ici ne bloque le merge : la CI
PR est verte sans aucun secret (voir `CREDENTIALS_GUIDE.md` § "Read this first").

Deux chemins distincts pour chaque credential (ne pas confondre) :
- **① App déployée** : chaque société saisit SES credentials dans l'UI (Settings → Channels /
  Signing certificates), chiffrés en base. Seule variable serveur : `CREDENTIALS_ENCRYPTION_KEY`.
- **② Tests live CI** : secrets GitHub pour `compliance-live.yml` (opt-in, ne gate jamais la PR).

---

## A. Marchés primaires (FR / PL / IT) — par ordre d'utilité

### A1. 🇫🇷 PDP production — contrat commercial
Le sandbox (superpdp) est **prouvé live** (fr:200→201→202, dépôt réel). Pour la prod :
- [ ] Choisir une PDP immatriculée (annuaire officiel : impots.gouv.fr) et signer le contrat.
- [ ] Récupérer `client_id`/`client_secret` du portail développeur de la PDP retenue.
- [ ] Les poser en ① (Settings → Channels de chaque société) et/ou ② (`PDP_*`).
→ `CREDENTIALS_GUIDE.md` §2, `LIVE_TESTING.md` (leg PDP).

### A2. 🇮🇹 SdI — accréditation Agenzia delle Entrate (le plus long, à lancer tôt)
Code : **implemented-awaiting-accreditation** (`sdicoop-client.ts`), jamais couru contre le vrai
endpoint. Démarche :
- [ ] Partita IVA inscrite sur Entratel, puis accréditation du canal (collaudo) sur fatturapa.gov.it.
- [ ] L'URL `SdIRiceviFile` accréditée + le PFX sont **délivrés pendant** l'accréditation.
- [ ] Poser `SDI_ID_TRASMITTENTE`, `SDI_ENDPOINT`, `SDI_CERTIFICATE` (b64), `SDI_CERT_PASSWORD`.
→ `CREDENTIALS_GUIDE.md` §4.

### A3. 🇵🇱 KSeF production
Le test est **prouvé live** (CLEARED réel + ksefNumber, 2026-06-28). Pour la prod :
- [ ] Générer le token prod sur ksef.mf.gov.pl (NIP + profil de confiance/signature qualifiée).
- [ ] Récupérer les clés publiques PEM prod du MF.
- [ ] ⚠️ L'auth par token **s'éteint fin 2026** → prévoir la bascule certificat (chantier code à
      commander à ce moment-là).
→ `CREDENTIALS_GUIDE.md` §1.

### A4. 🇫🇷 Chorus Pro B2G (PISTE)
- [ ] Compte PISTE (piste.gouv.fr), souscrire à l'API « Dépôt flux G2B ».
- [ ] Créer le « compte technique » Chorus Pro sandbox — nécessite une structure avec SIRET et le
      rôle « Gestionnaire principal ».
- [ ] Poser `CHORUSPRO_CLIENT_ID/SECRET/TECH_LOGIN/TECH_PASSWORD`.
→ `CREDENTIALS_GUIDE.md` §3.

### A5. 🌍 Peppol production (touche aussi DE/NL/BE/… en B2G)
peppol.sh est prouvé en test, **zéro secret**. Pour la prod :
- [ ] Choisir un Access Point commercial (Storecove, Ecosio, Pagero/Tickstar, Unimaze…) ou
      l'adhésion OpenPeppol en self-hosted ; enregistrement SMP du participant.
- [ ] Poser `PEPPOL_PARTICIPANT_ID`, `PEPPOL_AP_URL`, `PEPPOL_API_KEY`, `PEPPOL_RECEIVER_ID`.
- [ ] Reste connu (non bloquant) : le `documentTypeId` exact attendu par OZG-RE (DE) et par un
      récepteur gouvernemental NL n'a pas été vérifié contre un SMP réel — à confirmer au premier
      envoi réel avec le compte AP (`peppol-client.ts`, en-tête `PEPPOL_DOC_TYPES`).
→ `PEPPOL_AP_RESEARCH.md`, `CREDENTIALS_GUIDE.md` §6.

---

> **Clarification credentials (2026-09-11, mandant) :** aucun identifiant PAR-PAYS n'est une démarche
> à TA main pour « implémenter » une feature. L'app est multi-tenant → chaque CLIENT saisit SES
> credentials dans Settings → Channels. À ta main il ne reste QUE les 3 secrets de déploiement (§C/§E,
> triviaux, pas par-pays). Les identifiants par-pays du tuto = soit les clients eux-mêmes, soit les
> tests live CI (opt-in). Seule nuance : **SdI (IT) et PT-AT (PT)** sont `awaiting-accreditation` — le
> code est au contrat officiel mais jamais éprouvé en réel ; ils seront prouvés (et éventuellement
> retouchés) au premier vrai client. Tu n'as PAS à créer d'entité de test par pays.

## B. Décisions produit — TRANCHÉES (2026-09-11)

- ✅ **OCR : full local, pas de cloud** (décision mandant) — **LIVRÉ (2026-09-11)**. Notre image +
      serveur (the `ocr-image` repo : `FROM jbarlow83/ocrmypdf:latest` + fra/deu/ita/spa/por/nld/pol/
      rus/ara/chi-sim/jpn + `equ` via tessdata, serveur Python stdlib `--sidecar`, `--force-ocr`
      choisi après un round-trip réel ayant montré que `--skip-text` renvoie un placeholder au lieu
      du texte réel) remplace Tika (langues figées) — `local-client.ts`/`ocr-server.spec.ts` alignés
      sur le nouveau contrat `POST /ocr`. Round-trip réel prouvé (build + run + OCR FR et PL sur PDF
      image pur, + spec jest live automatisée) — voir `LIVE_TESTING.md`. La clé Mistral cloud est
      ABANDONNÉE ; l'item « langues Tika pol/nld » est SANS OBJET (superseded par notre image
      multilingue).
- ✅ **`e2e/demo-videos/run-complet/`** : SUPPRIMÉ (2026-09-11, 64 Mo de vidéos non versionnées).
- ✅ **Doctrine voies de correction `unverified`** : vague de lectures légales COMMANDÉE (sous-agents,
      sources primaires, discipline ⚖ texte brut) — chantier en file.
- ⏸️ **Ouvrir la PR vers main** : PAS maintenant. On fera la PR + une revue de code d'ensemble quand
      toutes les features et tous les tests seront bons.
- ⏸️ **Seconde vague de purge des WebhookEventType** : reportée (nettoyage interne, faible urgence).
- ◦ **it-it, Check #1 d'assertCompliance** : se résout dès que des creds SdI existent — rien à
      trancher maintenant. → TODO_ISSUES.md.

---

## C. Déploiement / infra

- [ ] `CREDENTIALS_ENCRYPTION_KEY` : `openssl rand -hex 32` — obligatoire en prod pour le
      chiffrement des credentials par société.
- [ ] (Optionnel, recommandé) Environnement GitHub `live-tests` avec *required reviewer* pour
      gater chaque run live avant de dépenser un appel d'autorité réelle.
- [ ] Weblate : les nouvelles clés i18n de la vague (écrans correction/annulation, hints B2G,
      réception) attendent leurs traductions hors-anglais — vérifier que Weblate a bien ramassé.

---

## D. Longue traîne — identités humaines requises (aucune urgence, aucun marché primaire)

Chacun exige une identité/entité locale réelle, sans chemin automatisable (détail :
`CREDENTIALS_GUIDE.md`, tableau §"Summary" et sections dédiées) :

- [ ] 🇪🇸 FACe B2G : certificat qualifié **FNMT** (vérification d'identité en personne/visio),
      puis enregistrement du cert comme « aplicación » FACe. Le WS-Security est déjà implémenté
      et live-prouvé — seul le cert FACe-enregistré manque.
- [ ] 🇭🇺 NAV Online Számla (déclaration ⚖) : inscription contribuable hongrois + Primary User
      pour créer l'utilisateur technique.
- [ ] 🇬🇷 AADE myDATA (déclaration ⚖) : identité TaxisNet grecque (aade.gr refuse les accès
      automatisés — citation légale restée unverified).
- [ ] 🇵🇹 AT « comunicação de faturas » (déclaration ⚖ — **marché GARDÉ, un des 5**, donc plus
      prioritaire que le reste de cette section) : canal temps réel implémenté au contrat documenté,
      **jamais éprouvé en réel** (`pt-declaration-provider.ts`/`pt-at-client.ts`, providerId `pt-at`).
      Démarche :
      - [ ] Adhésion « envio de dados » au Portal das Finanças → créer un **subutilizador** avec le
            droit WebService (identifiant `NIF/UserId` + senha).
      - [ ] Demander à l'AT la **clé publique RSA** de chaque environnement (test puis prod), par
            email (manuel AT §2.1.1) — à poser en `authPublicKeyPem`.
      - [ ] Générer un **CSR** et obtenir le **certificat client X.509 signé AT** (mTLS obligatoire,
            §2.3). ⚠ Le transport mTLS n'est **pas encore câblé** côté code (gap nommé dans
            `pt-at-client.ts` — un vrai appel prod échouerait au handshake TLS) : à câbler quand un
            vrai PKCS#12 existe pour le tester (même forme `pfx`/`passphrase` que SdI). Poser ensuite
            `clientCertificateBase64` + `clientCertificatePassword`.
      - [ ] Les poser dans Settings → Channels (providerId `pt-at`), puis rejouer `PT_AT_LIVE=1`.
      → 2 réserves de conception (cf. `reporting/data/pt.json` `notes`) : (a) ce webservice n'est
      qu'**UNE des 3 voies légales** (l'autre = SAF-T mensuel / saisie portail) ; (b) `authorityId`
      est **synthétisé** (l'AT ne renvoie aucune référence par facture). Le padding RSA exact
      (PKCS#1 v1.5 supposé, OAEP écarté) se confirmera au 1er round-trip réel.
- [ ] 🇷🇴 ANAF e-Factura : OAuth interactif avec certificat qualifié (seul le refresh token 365 j
      s'automatise ensuite).
- [ ] 🇲🇽 CFDI : compte **PAC** certifié SAT (Finkok, Facturama…) + certificat **CSD** de
      sat.gob.mx.
- [ ] Hors-UE restants (AR/BR/CL/EC/UY/SA/TR/EG/NG/KE/IN/MY/ID) : voir le tableau — tous rouges,
      tous gated proprement, aucun ne casse rien en leur absence.

---

## E. Sécurité — actions de déploiement (suite à l'audit SECURITY_AUDIT.md, 2026-09-10)

- [ ] **Générer de VRAIS secrets de session en production** : `JWT_SECRET` et `BETTER_AUTH_SECRET`
      (chacun `openssl rand -hex 32`). Le correctif ajoute une garde au boot qui REFUSE de démarrer
      avec les valeurs d'exemple ou vides — donc l'appli te forcera à le faire, mais c'est TON action :
      poser deux vrais secrets dans l'environnement de déploiement (jamais committés). (Finding #3.)
- [ ] **Déploiement derrière un proxy TLS** : servir en `https`, poser `APP_URL` en `https://…`, et
      s'assurer que le proxy de tête (ou l'nginx embarqué, désormais corrigé pour écraser
      `X-Forwarded-For` avec l'IP réelle) est bien la seule entrée — le backend fait maintenant
      confiance à 1 hop de proxy. Si tu ajoutes un proxy SUPPLÉMENTAIRE devant, ajuste le nombre de
      hops de confiance. (Finding #1.)
- **Montées de dépendances majeures** — TRANCHÉ (2026-09-11) : **`better-auth` + `nodemailer` OUI**
      (un chantier par dépendance, sous-agent + batterie, commit séparé — en file). **`prisma` NON**
      (pas de Prisma 8 pour l'instant, trop de changements — reporté). `@xmldom/xmldom` : correctif de
      mon côté. Les ~31 autres alertes `npm audit` sont transitives non atteignables
      (multer/mysql2/puppeteer) — voir SECURITY_AUDIT.md § dépendances.

---

*Généré à la clôture des chantiers NLCIUS + OCR local (commits `edd6b5c2`, `fe3f7e11`), section E
ajoutée après l'audit sécurité. Les items cochables sont à ta main exclusivement ; quand l'un d'eux
est fait, dis-le-moi et je rejoue le live correspondant (`LIVE_TESTING.md` donne la commande exacte
par canal).*
