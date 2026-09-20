---
sidebar_position: 4
---

# Authentication

Invoicerr supports two authentication mechanisms, both enforced by a single `AuthGuard` (`backend/src/guards/auth.guard.ts`).

## Session login (JWT / OIDC)

Login is handled via the BetterAuth library (`backend/src/lib/auth.ts`), which supports:

- Email/password login
- OIDC login against an external identity provider — either ONE instance-wide provider configured from
  the environment (below), or a provider each company registers for itself from **Settings → SSO**
  (further below), or both at once

On login, a session cookie is created. `AuthGuard` reads it via `auth.api.getSession()` and attaches the resolved user to `request.user`.

### OIDC redirect URI and PKCE

The redirect URI to register at the identity provider is `/api/auth/callback/<providerId>` — `<OIDC_NAME>` (sanitized, defaulting to `oidc`) for the instance-wide provider below, or `c_<companyId>` for a per-company one. It used to be `/api/auth/oauth2/callback/<providerId>`, which no longer exists: the generic OIDC flow is served by BetterAuth's core social endpoints. An instance upgrading from an older version must update that URI at the provider, otherwise the provider rejects the redirect and OIDC login stops working.

PKCE is enabled by default and the OIDC configuration never turns it off, so the provider must accept an authorization request carrying a `code_challenge`.

### Invitation-gated signup

The first user to sign up is always allowed. Subsequent signups require a valid invitation code, validated by the `invitations` module. A user who signs up through a company's own per-company SSO provider (below) is the one exception: they need no invitation at all, and are attached directly to that company as a `MEMBER` — see `sso-policy.ts#companyForOAuthSignup`.

### Setting a password for OIDC-only accounts

Accounts created via OIDC have no local password by default. `POST /api/auth-extended/set-password` (8+ characters) lets such a user set one, enabling local login alongside OIDC.

## Instance-wide OIDC (environment variables)

One OIDC provider, shared by every company on the instance, configured entirely from environment
variables read by `createOidcConfig()` (`backend/src/lib/auth.ts`) and
`resolveOidcEndpoints()`/`resolveEnvOidcProvider()` (`backend/src/lib/sso-policy.ts`). It is registered
only when `OIDC_CLIENT_ID` is set — setting `OIDC_NAME` alone registers nothing, and the sign-in page
correctly shows no button.

| Variable | Purpose |
| --- | --- |
| `OIDC_CLIENT_ID` | Required to register the provider at all. Also gates the button on the sign-in page. |
| `OIDC_CLIENT_SECRET` | Omit for a public client authenticating via PKCE only. |
| `OIDC_NAME` | The provider id, sanitized to URL-safe characters (anything outside `[A-Za-z0-9._~-]` becomes `-`) and defaulting to `oidc` when unset or empty after sanitizing. Ends up in the callback path, `/api/auth/callback/<OIDC_NAME>`. |
| `OIDC_DISCOVERY_URL` | The IdP's discovery document (`.../.well-known/openid-configuration`). When set, the authorization/token/userinfo endpoints below are **never read** — discovery always wins. |
| `OIDC_AUTHORIZATION_ENDPOINT`, `OIDC_TOKEN_ENDPOINT`, `OIDC_USERINFO_ENDPOINT` | Manual endpoints, read only when `OIDC_DISCOVERY_URL` (and its legacy alias below) are both unset. Pick discovery OR the three manual endpoints — never both; `.env.example` ships only one uncommented at a time so a copy-paste cannot silently set endpoints that get ignored. |
| `OIDC_END_SESSION_ENDPOINT` | Optional. Powers RP-Initiated Logout: without it, signing out of Invoicerr only clears the local session and never logs the user out at the IdP. |
| `OIDC_ONLY` | `"1"`/`"true"` (case-insensitive) disables email/password sign-in and sign-up instance-wide, and `POST /api/auth-extended/set-password` is refused. Default off. The backend **refuses to boot** if this is set while no OIDC provider exists at all — neither the environment one nor any company-registered one (`assertOidcOnlyHasProvider`, `sso-registrar.service.ts`) — since nobody could then sign in, and configuring the first provider itself requires being signed in. |

:::info Legacy `OIDC_JWKS_URI` alias
`OIDC_DISCOVERY_URL` used to be named `OIDC_JWKS_URI` — a misleading name, since this value is always
fetched as an OpenID **discovery document**, never a bare JWKS. The old name is still read as a
functional alias (`resolveOidcEndpoints()` checks `OIDC_DISCOVERY_URL || OIDC_JWKS_URI`, current name
first) purely for backward compatibility, so an operator who already set `OIDC_JWKS_URI` does not break
on the next image pull. There is no boot-time warning when only the legacy name is set — it is honoured
silently. New configurations should use `OIDC_DISCOVERY_URL`.

Pointing `OIDC_JWKS_URI`/`OIDC_DISCOVERY_URL` at an actual JWKS endpoint (`.../jwks.json`) instead of a
discovery document was a real, historical misconfiguration: it fetches successfully (200, valid JSON),
so nothing is logged, but the document carries no `authorization_endpoint`/`token_endpoint`, and
better-auth's generic-OAuth plugin then either silently drops the provider or fails the sign-in with a
generic `400 INVALID_OAUTH_CONFIGURATION`. Use the discovery document URL, not the JWKS one.
:::

### Example (Authentik)

```bash
OIDC_NAME="Authentik"
OIDC_CLIENT_ID="your-client-id"
OIDC_CLIENT_SECRET="your-client-secret"
OIDC_DISCOVERY_URL="https://auth.example.com/application/o/invoicerr/.well-known/openid-configuration"
OIDC_END_SESSION_ENDPOINT="https://auth.example.com/application/o/invoicerr/end-session/"
```

Register `https://<your-instance>/api/auth/callback/Authentik` as the redirect URI at the identity
provider (the sanitized form of `OIDC_NAME`).

## Per-company SSO (Settings → SSO)

Instead of (or alongside) the instance-wide provider above, any company can register **its own** OIDC
provider from **Settings → SSO** (`frontend/src/pages/(app)/settings/_components/sso.settings.tsx`),
without an operator touching the instance's environment. This is the `CompanySsoProvider` table,
managed by `SsoService`/`SsoController` (`backend/src/modules/company/sso/`) — `OWNER`/`ADMIN` only.

The form fields (`PUT /api/company/sso`):

| Field | Purpose |
| --- | --- |
| Display name (`label`) | What the sign-in button/lookup result shows. Defaults to "SSO". |
| Discovery URL (`discoveryUrl`) | Recommended. `.../.well-known/openid-configuration` — when set, the endpoints below are discovered automatically. |
| Authorization URL / Token URL (`authorizationUrl` / `tokenUrl`) | Manual endpoints for an IdP with no discovery document. Both are required together when no discovery URL is set — the backend rejects a request satisfying neither combination. |
| User info URL (`userInfoUrl`) | Optional even in the manual case: an id_token carrying `sub`/`email` is enough. |
| Client ID / Client secret (`clientId` / `clientSecret`) | `clientId` is required; leave the secret blank only for a public client using PKCE. Encrypted at rest (`CREDENTIALS_ENCRYPTION_KEY` must be configured — the request is refused with `503` otherwise) and never returned by any response, including a later `GET`. |

All four endpoint URLs must resolve to a public `https://` host on port 443 — a private/loopback/
internal address is rejected (`assertEndpointsArePublic`, re-checked again immediately before
better-auth actually dials one of them).

Saving assigns the company a fixed provider id, **`c_<companyId>`**, and a fixed redirect URI,
**`/api/auth/callback/c_<companyId>`** — both shown on the screen. The provider is registered with the
live better-auth instance immediately (`SsoRegistrarService`), no restart required, and de-registered
immediately on removal or deactivation.

### Reaching a company's own provider

A company's provider is never offered generically on the sign-in page the way the instance-wide button
is — it is reached one of two ways:

- **Direct link** — `/auth/sign-in?sso=c_<companyId>`, shown on the settings screen, ready to hand to
  the company's own users. Works the moment the provider is saved, with no further setup.
- **Email-domain lookup** — `GET /api/sso/lookup?email=...` (public, rate-limited, `SsoLookupController`).
  Typing an email on the sign-in page triggers this on blur; when the address's domain has been
  **claimed and DNS-verified** for an **active** provider, the SSO button appears automatically. Domains
  are managed from the same settings screen (`POST /api/company/sso/domains`, then `POST
  .../domains/:id/verify`): claiming a domain mints a DNS TXT record (name
  `_invoicerr-sso.<domain>`, value `invoicerr-sso-verification=<token>`) that must be published before
  verification succeeds — an unverified claim routes no one, by design, so a company cannot silently
  hijack sign-ins for a domain it does not control.

### Relationship to the instance-wide provider

There is no override between the two — they live in **separate provider-id namespaces** (`oidc`/
`OIDC_NAME` for the instance-wide one, `c_<companyId>` for a company's own) and neither takes priority
over the other. Both can be configured at once, and the sign-in page offers whichever apply
simultaneously: the instance-wide button whenever `OIDC_CLIENT_ID` is set, and a company's own button
whenever the `sso` link parameter or the email-domain lookup names one. `OIDC_ONLY` (above) counts
either kind — the environment provider **or** at least one company-registered provider — as satisfying
"an OIDC provider exists" for its boot check.

## API key authentication

For programmatic access (integrations, scripts), clients send `Authorization: Bearer <raw-key>`. `AuthGuard` extracts the key, hashes it, and looks up a matching `apiKey` row. On match, it updates `lastUsedAt` and attaches the associated user and company to `request.user`/`request.companyId`. Keys are scoped to a single user and a single company, and are never returned again after creation.

Keys can also carry a `scopes` array narrowing what they're allowed to do (e.g. `clients:write`, `articles:read`) — see [MCP server](./mcp-server.md#how-scopes-gate-the-tools) for where this is enforced today.

## Public routes

Routes marked with the `@Public()` decorator (or `IS_PUBLIC_KEY` metadata) bypass the guard entirely — used for things like anonymous quote-signing pages. Any other route without a valid session or API key gets a `401 Unauthorized`.
