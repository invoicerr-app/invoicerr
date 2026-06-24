---
sidebar_position: 4
---

# Authentification

Invoicerr prend en charge deux mécanismes d'authentification, tous deux appliqués par un unique `AuthGuard` (`backend/src/guards/auth.guard.ts`).

## Connexion par session (JWT / OIDC)

La connexion est gérée via la bibliothèque BetterAuth (`backend/src/lib/auth.ts`), qui prend en charge :

- La connexion par e-mail/mot de passe
- La connexion OIDC auprès d'un fournisseur d'identité externe, configurée via les variables d'environnement : `OIDC_NAME`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_URI`

À la connexion, un cookie de session est créé. `AuthGuard` le lit via `auth.api.getSession()` et attache l'utilisateur résolu à `request.user`.

### Inscription protégée par invitation

Le premier utilisateur à s'inscrire est toujours autorisé. Les inscriptions suivantes nécessitent un code d'invitation valide, validé par le module `invitations`.

### Définir un mot de passe pour les comptes OIDC uniquement

Les comptes créés via OIDC n'ont pas de mot de passe local par défaut. `POST /api/auth-extended/set-password` (8 caractères ou plus) permet à un tel utilisateur d'en définir un, activant la connexion locale en plus de l'OIDC.

## Authentification par clé API

Pour l'accès programmatique (intégrations, scripts), les clients envoient `Authorization: Bearer <raw-key>`. `AuthGuard` extrait la clé, la hache et recherche une ligne `apiKey` correspondante. En cas de correspondance, il met à jour `lastUsedAt` et attache l'utilisateur associé à `request.user`. Les clés sont rattachées à un seul utilisateur et ne sont plus jamais renvoyées après leur création.

## Routes publiques

Les routes marquées du décorateur `@Public()` (ou des métadonnées `IS_PUBLIC_KEY`) contournent entièrement le guard — utilisé par exemple pour les pages anonymes de signature de devis. Toute autre route sans session valide ou clé API reçoit une réponse `401 Unauthorized`.
