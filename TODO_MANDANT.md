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

- [x] Compte propriétaire créé sur l'instance — l'inscription du premier utilisateur est refermée.
- [ ] **Courriel sortant** : la clé SMTP Brevo de l'ancien déploiement `invoicerr-pr-363` était en
      clair dans son compose et doit être considérée comme compromise. Bascule vers Resend envisagée ;
      d'ici là, aucun envoi n'est configuré sur la nouvelle instance (pas d'invitation, pas de
      relance). Dis-moi quand tu tranches, le câblage du fournisseur est un chantier à moi.

---

## 2. Décisions — TRANCHÉES le 2026-09-13

- [x] **`prisma db push` sur une base legacy : FEU VERT.** Le chemin de mise à niveau de toutes les
      installs auto-hébergées (`sync-schema.ts`, qui ramène une base d'avant v1.4.4a au schéma figé
      puis rejoue les migrations) n'avait jamais été prouvé. Il va l'être, sur une base jetable —
      jamais sur des données réelles.
- [x] **Transport PEC italien : GO.** L'accréditation SdI reste fermée (Partita IVA sur Entratel),
      mais la voie PEC n'en exige aucune, et aucun transport PEC n'existe dans le code. L'écrire ne
      demande aucun credential ; le prouver en réel demandera une boîte PEC italienne, ce qui engage
      de l'argent et reste à ta main.

---

## 3. FAIT le 2026-09-14 — PISTE (Chorus Pro, qualification)

Clos. Les deux couches d'identifiants (compte PISTE OAuth + « compte technique » Chorus Pro) ont
été obtenues — la qualification Chorus Pro n'a finalement exigé aucune entreprise réelle : son
« matelas de données » fournit une structure et un SIRET fictifs. Un dépôt Factur-X réel est allé
jusqu'à l'état terminal `IN_INTEGRE` (`CPP0011117000000000425903`, `listeErreurDP=[]`,
2026-09-14T22:57:02+02:00), après deux dépôts rejetés qui ont révélé trois défauts produit corrigés
en trois vagues (commits `67a94d58`, `7de5a90c`, `ecce4d35`).

Reste ouvert, **hors du cadre de cette section** (qui ne portait que sur la qualification) : le
raccordement **production** — nouvelle candidature PISTE dédiée à la production + déclaration de
raccordement Chorus Pro production, aucun des deux tenté. Pas encore qualifié comme relevant de ta
main ou non : contrairement à la qualification, la production demande vraisemblablement un vrai
SIRET, à trancher le jour où ce chantier est repris.

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
