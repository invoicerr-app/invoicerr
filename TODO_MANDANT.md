# TODO_MANDANT — ce qui est à ta main (2026-09-13)

Réécrit pour ne contenir **que ce que tu peux réellement faire**, compte tenu de ta contrainte :
pas de credentials de production, recette possible sur les plateformes gouvernementales, et
impossible dès qu'il faut une entreprise t'appartenant dans le pays visé.

Tout ce qui ne tient pas dans ce cadre est listé en §4, sans cases à cocher, pour que tu n'y
reviennes pas. Rien ici ne bloque le merge : la CI de PR est verte sans aucun secret.

**Le point qui vide les trois quarts de l'ancienne liste** (ta clarification du 2026-09-11) :
aucun identifiant par pays n'est une démarche à ta main. L'app est multi-tenant — **chaque client
saisit SES propres credentials** dans Settings → Channels, chiffrés en base. Les identifiants par
pays sont l'affaire des clients, ou des tests live CI qui sont opt-in.

---

## 1. Secrets de déploiement — FAITS le 2026-09-13 sur `invoicerr.chevrier.dev`

Générés sur esteban même (`openssl rand -hex 32` écrit directement dans `/DATA/AppData/invoicerr/.env`,
mode 600) : ils n'ont transité par aucun log ni par aucune conversation. Le compose ne porte que des
`${...}`.

- [x] `BETTER_AUTH_SECRET` — posé, 64 caractères. **Un seul secret de session suffit** : la garde
      vérifie la valeur effective `BETTER_AUTH_SECRET || JWT_SECRET` (`src/lib/secret-guard.ts`), pas
      chaque variable. `JWT_SECRET` n'est qu'un alias pour les déploiements qui l'avaient déjà.
- [x] `CREDENTIALS_ENCRYPTION_KEY` — posée, 64 caractères. Sans elle, aucun client n'enregistre les
      credentials de son canal, **en silence** : pas d'erreur, pas de log, rien à l'écran. La changer
      plus tard rend indéchiffrable tout ce qui est déjà stocké : sauvegarde-la comme un mot de passe
      de base.
- [x] TLS et `APP_URL` en `https://` — servi par ton tunnel Cloudflare, `APP_URL:
      https://invoicerr.chevrier.dev` confirmé dans la configuration résolue du conteneur. Le backend
      fait confiance à 1 hop de proxy ; si tu en ajoutes un deuxième devant, dis-le-moi, le nombre est
      à ajuster côté code.

Ces trois cases ne valent **que pour cette instance-là**. Un autre déploiement repart de zéro.

---

## 2. Des décisions — gratuites, immédiates, et ce sont elles qui débloquent le plus

- [ ] **M'autoriser explicitement à jouer `prisma db push` sur une base legacy.** C'est le plus
      important de cette page et ça ne coûte rien. Les installs auto-hébergées ont tourné sous
      `db push` jusqu'à v1.4.4a ; `sync-schema.ts` est censé les remettre à niveau au démarrage, et
      **ce chemin n'a jamais été prouvé**. Prisma refuse cette commande quand c'est un agent qui
      l'invoque, et je ne contourne pas ce refus. Sans ton feu vert, chaque release fait courir aux
      installs existantes un risque que personne n'a mesuré.
- [ ] **Go / no-go sur un transport PEC italien.** L'accréditation SdI t'est fermée (elle exige une
      Partita IVA inscrite sur Entratel). La voie PEC, elle, n'exige **aucune accréditation** — et il
      n'existe aucun transport PEC dans le code. L'écrire ne demande aucun credential ; le prouver
      demande une boîte PEC italienne, ce qui engage de l'argent. Donc : à toi.

---

## 3. En cours de ton côté — PISTE (Chorus Pro, recette)

C'est le meilleur rapport de toute la liste, et le seul canal gouvernemental que ta contrainte
laisse ouvert.

- [ ] Compte PISTE sur piste.gouv.fr, souscrire à l'API « Dépôt flux G2B ».
- [ ] Me poser `CHORUSPRO_CLIENT_ID` et `CHORUSPRO_CLIENT_SECRET` dans `backend/.env.test.local`.

Ces deux-là suffisent : j'ai vérifié la porte du test, le gate n'exige qu'eux. Le **compte
technique** Chorus Pro — celui qui réclame une structure avec SIRET et le rôle « gestionnaire
principal » — n'est **pas** requis : sans lui la spec joue quand même la moitié OAuth et ne saute
que la moitié dépôt. Ton blocage SIRET ne t'empêche donc pas de livrer la moitié prouvable.

Établi sans compte à ce jour : l'endpoint OAuth répond un vrai `HTTP 400 invalid_client` sur des
identifiants bidons — ce qui prouve l'hôte et le chemin, rien de plus.

---

## 4. Hors de ta portée — constaté, pas à retenter

Chacun exige une identité ou une entité locale réelle, sans chemin automatisable. Aucun ne casse
quoi que ce soit en son absence : tout est proprement gated.

| Canal | Ce qui bloque |
|---|---|
| 🇮🇹 SdI | Partita IVA inscrite sur Entratel + certificats délivrés par l'AdE |
| 🇵🇱 KSeF **prod** | NIP polonais + profil de confiance ou signature qualifiée |
| 🇵🇹 AT | NIF portugais, subutilizador, certificat X.509 signé par l'AT |
| 🇫🇷 PDP **prod** | contrat commercial avec une PDP immatriculée |
| 🌍 Peppol **prod** | contrat avec un Access Point, ou adhésion OpenPeppol |
| 🇪🇸 FACe | certificat FNMT, vérification d'identité en présentiel |
| 🇭🇺 NAV · 🇬🇷 myDATA · 🇷🇴 ANAF · 🇲🇽 CFDI | contribuable local + identité fiscale nationale |

Deux de ces canaux sont **déjà prouvés en réel** là où c'était possible, et leur code est éprouvé :
**KSeF** (CLEARED réel + ksefNumber, 2026-06-28) et **PDP** (fr:200→201→202, dépôt 375037,
2026-08-29). Seule leur version production reste hors de portée.

---

## 5. Petit, sans credentials

- [ ] Weblate : vérifier qu'il a bien ramassé les nouvelles clés i18n.
- [ ] (Optionnel) Environnement GitHub `live-tests` avec *required reviewer*, pour qu'aucun run live
      ne parte sans validation.

---

*`TODO_ISSUES.md` n'est pas pour toi : c'est mon carnet de bord technique. Tu n'as rien à en faire.*
