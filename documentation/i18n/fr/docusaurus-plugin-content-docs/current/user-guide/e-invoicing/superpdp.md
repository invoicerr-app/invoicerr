---
sidebar_position: 1
---

# Guide de configuration SuperPDP

SuperPDP est une **Plateforme de Dématérialisation Partenaire (PDP)** certifiée par l'administration fiscale française. Elle permet à votre entreprise d'émettre et de recevoir des factures électroniques conformément à la réforme de la facture électronique en France.

Suivez les étapes ci-dessous pour créer votre compte SuperPDP, vérifier votre identité, vous inscrire à l'annuaire et créer une application API.

---

## 1. Créer un compte SuperPDP

<img src="/img/super-pdp-inscription.png" alt="Formulaire d'inscription SuperPDP" width="400" />

1. Rendez-vous sur [https://app.superpdp.com](https://app.superpdp.com).
2. Cliquez sur **S'inscrire**.
3. Renseignez votre **adresse e-mail** et choisissez un **mot de passe** sécurisé.
4. Complétez les **informations de votre entreprise** :
   - Raison sociale
   - Numéro SIRET
   - Numéro de TVA intracommunautaire
   - Adresse de l'entreprise
5. Acceptez les conditions d'utilisation et cliquez sur **Créer un compte**.
6. Consultez votre boîte de réception et cliquez sur le lien de confirmation pour activer votre compte.

Une fois confirmé, vous pouvez vous connecter au tableau de bord SuperPDP.

---

## 2. Vérification KYB avec pièce d'identité

SuperPDP exige une vérification **Know Your Business (KYB)** avant de pouvoir utiliser la plateforme.

1. Connectez-vous à votre compte SuperPDP.
2. Allez dans **Paramètres → Vérification KYB**.
3. Téléchargez les documents suivants :
   - **Pièce d'identité** du représentant légal (passeport ou carte d'identité nationale)
   - **Extrait K-bis** de moins de 3 mois
   - **Justificatif de domicile** de l'entreprise
4. Remplissez la déclaration de bénéficiaires effectifs si nécessaire.
5. Soumettez les documents pour examen.

La vérification prend généralement **24 à 72 heures**. Vous recevrez un e-mail dès que votre KYB sera approuvé.

---

## 3. Inscription dans l'annuaire pour recevoir des factures

Pour recevoir des factures électroniques d'autres entreprises, votre société doit être inscrite à l'**Annuaire Général**.

:::info[Définition]
L'**Annuaire Général** est le registre central français des entreprises habilitées à émettre et recevoir des factures électroniques. Toutes les PDP y sont synchronisées pour permettre l'acheminement des flux.
:::


1. Depuis le tableau de bord SuperPDP, naviguez vers **Annuaire → S'inscrire**.
2. Votre SIRET et les informations de l'entreprise seront pré-remplis.
3. Sélectionnez l'**adresse de facturation électronique** où les factures doivent être acheminées (il s'agira de votre boîte de réception SuperPDP).
4. Configurez vos **préférences de réception des factures** :
   - Intégration Chorus Pro (pour les factures B2G du secteur public)
   - Réception directe PDP-à-PDP
5. Confirmez et soumettez l'inscription.

SuperPDP se charge de la synchronisation avec l'annuaire central français. Une fois inscrit, les autres PDP et plateformes pourront vous livrer des factures via SuperPDP.

---

## 4. Créer une Application pour utiliser l'API

Pour connecter Invoicerr (ou tout autre outil) à SuperPDP, vous devez créer une application API.

1. Dans le tableau de bord SuperPDP, allez dans **Développeurs → Applications**.
2. Cliquez sur **Créer une application**.
3. Renseignez :
   - **Nom de l'application** (ex : "Invoicerr")
   - **Description** (facultative)
   - **URI de redirection** (si vous utilisez OAuth 2.0)
   - **Scopes** — sélectionnez au minimum :
     - `invoice:read` — lire les factures entrantes
     - `invoice:write` — émettre des factures
     - `company:read` — lire les informations de l'entreprise
4. Cliquez sur **Créer**.

Après la création, vous recevrez :
- **Client ID**
- **Client Secret** (conservez-le précieusement — il ne sera plus affiché par la suite)

Vous pouvez désormais utiliser ces identifiants pour vous authentifier et appeler l'API SuperPDP depuis Invoicerr ou vos propres intégrations.

---

## 5. Configurer le canal PDP dans Invoicerr

Une fois votre Application SuperPDP créée, ouvrez **Paramètres → Facturation électronique → Canaux** dans Invoicerr et configurez le canal **PDP** à l'aide des identifiants que vous venez de créer.

Renseignez le formulaire du canal :

1. **URL de base de l'API** (obligatoire) — la racine de l'API de votre PDP. Valeur par défaut : `https://api.superpdp.tech`.
2. **Client ID** (obligatoire) — le **Client ID** de l'Application SuperPDP créée à l'étape *Créer une Application* ci-dessus.
3. **Client secret** (obligatoire) — le **Client Secret** de cette même Application. Il est stocké chiffré au repos.
4. **Environnement** (obligatoire) — choisissez **Test (sandbox)** ou **Production**. Valeur par défaut : **Test**.
5. **Style d'API** (facultatif) — par défaut **SuperPDP (propriétaire)** ; l'autre option est **AFNOR Flow (XP Z12-013)**.
   - Le même canal peut communiquer avec l'API propriétaire v1.beta de SuperPDP (l'option par défaut) **ou** avec toute PDP compatible AFNOR Flow.
   - Conservez **SuperPDP (propriétaire)** si vous vous êtes inscrit sur SuperPDP. Ne choisissez **AFNOR Flow** que si votre PDP n'est pas SuperPDP.
6. **Votre identifiant de routage PDP** (facultatif) — l'adresse de routage de votre propre entreprise sur votre PDP, au format `{pdp_siren}_{account_id}` (par exemple `315143296_1422`).

:::info
Votre identifiant de routage PDP est **le vôtre**. L'adresse de l'acheteur est résolue automatiquement pour chaque facture à partir du client / de l'annuaire — vous ne la renseignez pas ici.
:::

:::note
Les secrets sont chiffrés au repos. Le serveur doit disposer de la variable `CREDENTIALS_ENCRYPTION_KEY`, sans quoi l'enregistrement du canal échoue avec une erreur `503 — Encryption key not configured — channel credentials cannot be saved`.
:::

Enregistrez le canal. Invoicerr utilisera alors ces identifiants pour émettre et suivre vos factures électroniques via la PDP.
