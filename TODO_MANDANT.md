# TODO_MANDANT — ce qui est à ta main (2026-09-14)

Ne contient que ce qui reste à faire, classé par ce que ça débloque. Tout ce qui était ici et est fait
a été retiré — l'historique vit dans les commits, pas dans ce fichier. Rien ici ne bloque le merge :
la CI de PR ne dépend d'aucun secret.

**Rappel qui vide encore les trois quarts d'une liste imaginaire** : aucun identifiant PAR CLIENT
n'est une démarche à ta main. L'app est multi-tenant — chaque client saisit SES propres credentials
dans Settings → Channels, chiffrés en base. Ce qui suit, ce sont les identifiants de LA SOCIÉTÉ QUI
FAIT TOURNER `invoicerr.chevrier.dev`, ou des comptes de recette pour prouver un canal en réel.

---

## 1. Urgent — aucun email ne part en production

Établi le 2026-09-14 : `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` sont tous **vides**
dans le conteneur de `invoicerr.chevrier.dev`, depuis des semaines. L'app démarre et répond
normalement — rien ne le signalait avant ce jour, un correctif fait maintenant échouer bruyamment au
démarrage plutôt qu'au premier envoi. Tant que c'est vide : aucune invitation, aucune relance,
aucune notification de document envoyé.

- [ ] Ajouter dans `/DATA/AppData/invoicerr/.env` sur l'hôte, puis `docker compose up -d` :
      `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` (cinq lignes ;
      `SMTP_SECURE` peut rester à sa valeur par défaut).
- [ ] **La clé Brevo de l'ancien déploiement `invoicerr-pr-363` était en clair dans son compose** —
      à traiter comme compromise : la régénérer (ou changer de fournisseur, Resend a été envisagé).
      C'est cette clé, ou sa remplaçante, qui va dans `SMTP_PASSWORD` (ou dans `MAIL_PROVIDER=brevo`
      selon l'option choisie).

## 2. Chorus Pro (B2G français) — qualification prouvée, production restante

Clos pour la qualification : les deux couches d'identifiants (compte PISTE OAuth + compte technique
Chorus Pro) ont été obtenues, et un dépôt Factur-X réel est allé jusqu'à l'état terminal
`IN_INTEGRE` (`CPP0011117000000000425903`, 2026-09-14). **À retenir pour la suite** : la
qualification Chorus Pro n'exige aucune entreprise française réelle — son « matelas de données »
fournit une structure et un SIRET fictifs ; seule la PRODUCTION en demande un vrai.

- [ ] **Raccordement production** : nouvelle candidature PISTE dédiée à la production + déclaration
      de raccordement Chorus Pro production. Rien tenté encore. Pas déterminé si ça relève de toi
      (ça demandera vraisemblablement un vrai SIRET, contrairement à la qualification) — à trancher
      quand ce chantier est repris.

## 3. Canaux et comptes encore à ouvrir

Chacun débloque une preuve en réel pour un canal déjà écrit. Aucun ne casse quoi que ce soit en son
absence : tout est proprement gated.

| Compte / démarche | Débloque | Ce qui bloque |
|---|---|---|
| 🇮🇹 Boîte PEC italienne | SdI-par-PEC (déjà écrit, jamais prouvé en réel) | Purement administratif — un abonnement chez un fournisseur (Aruba, Legalmail…), aucune accréditation ni contrat commercial requis. Le seul canal dans ce cas. |
| 💳 Compte Stripe | Paiement en ligne depuis le portail client (livré aujourd'hui) | Aucun compte prestataire n'existe pour ce projet ; le canal est écrit et testé à blanc, jamais prouvé sans lui. |
| 🇵🇹 Identifiants AT portugais | Déclaration fiscale portugaise en réel | NIF portugais, subutilizador, certificat X.509 signé par l'AT |
| 🌍 Compte chez un Access Point Peppol commercial | Peppol en production | Contrat avec un Access Point, ou adhésion OpenPeppol |
| 🇮🇹 SdI direct (hors PEC) | Le canal SdI officiel (indépendamment de la voie PEC ci-dessus) | Partita IVA inscrite sur Entratel + certificats délivrés par l'AdE |
| 🇵🇱 KSeF **prod** | KSeF en production (déjà prouvé en environnement de test, 2026-06-28) | NIP polonais + profil de confiance ou signature qualifiée |
| 🇫🇷 PDP **prod** | PDP en production (déjà prouvé en réel, 2026-08-29) | Contrat commercial avec une PDP immatriculée |
| 🇪🇸 FACe | Canal espagnol | Certificat FNMT, vérification d'identité en présentiel |
| 🇭🇺 NAV · 🇬🇷 myDATA · 🇷🇴 ANAF · 🇲🇽 CFDI | Ces quatre canaux | Contribuable local + identité fiscale nationale dans chaque pays |

## 4. Administratif

- [ ] **Ouvrir la PR vers `main`** — la branche a ~870 commits d'avance. Pas de secret requis pour
      que la CI de PR passe.

## 5. Petit, sans credentials

- [ ] Weblate : vérifier qu'il a bien ramassé les nouvelles clés i18n.
- [ ] (Optionnel) Environnement GitHub `live-tests` avec *required reviewer*, pour qu'aucun run live
      ne parte sans validation.

---

*`TODO_ISSUES.md` n'est pas pour toi : c'est le carnet de bord technique. Tu n'as rien à en faire.*
