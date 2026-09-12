---
sidebar_position: 4
---

# Authentication

Invoicerr supports two authentication mechanisms, both enforced by a single `AuthGuard` (`backend/src/guards/auth.guard.ts`).

## Session login (JWT / OIDC)

Login is handled via the BetterAuth library (`backend/src/lib/auth.ts`), which supports:

- Email/password login
- OIDC login against an external identity provider, configured via environment variables: `OIDC_NAME`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT`, `OIDC_JWKS_URI`

On login, a session cookie is created. `AuthGuard` reads it via `auth.api.getSession()` and attaches the resolved user to `request.user`.

### OIDC redirect URI and PKCE

The redirect URI to register at the identity provider is `/api/auth/callback/<OIDC_NAME>`. It used to be `/api/auth/oauth2/callback/<OIDC_NAME>`, which no longer exists: the generic OIDC flow is served by BetterAuth's core social endpoints. An instance upgrading from an older version must update that URI at the provider, otherwise the provider rejects the redirect and OIDC login stops working.

PKCE is enabled by default and the OIDC configuration never turns it off, so the provider must accept an authorization request carrying a `code_challenge`.

### Invitation-gated signup

The first user to sign up is always allowed. Subsequent signups require a valid invitation code, validated by the `invitations` module.

### Setting a password for OIDC-only accounts

Accounts created via OIDC have no local password by default. `POST /api/auth-extended/set-password` (8+ characters) lets such a user set one, enabling local login alongside OIDC.

## API key authentication

For programmatic access (integrations, scripts), clients send `Authorization: Bearer <raw-key>`. `AuthGuard` extracts the key, hashes it, and looks up a matching `apiKey` row. On match, it updates `lastUsedAt` and attaches the associated user and company to `request.user`/`request.companyId`. Keys are scoped to a single user and a single company, and are never returned again after creation.

Keys can also carry a `scopes` array narrowing what they're allowed to do (e.g. `clients:write`, `articles:read`) — see [MCP server](./mcp-server.md#api-key-scopes) for where this is enforced today.

## Public routes

Routes marked with the `@Public()` decorator (or `IS_PUBLIC_KEY` metadata) bypass the guard entirely — used for things like anonymous quote-signing pages. Any other route without a valid session or API key gets a `401 Unauthorized`.
