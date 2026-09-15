/**
 * Builds the better-auth PLUGIN ARRAY for Polar — `[]` when billing is disabled, so
 * `lib/auth.ts` can just splat `...buildPolarAuthPlugins()` into its own `plugins` array exactly the
 * way it already does for `genericOAuth()` (`...(envOidcProvider.registered ? [genericOAuth(...)] : [])`).
 *
 * ## What `@polar-sh/better-auth` (v1.8.4, this repo's exact installed version — peer-compatible with
 * `better-auth ^1.4.12`, this repo runs `^1.7.4`) actually covers, established by READING the
 * package (`node_modules/@polar-sh/better-auth/dist/index.cjs`), never guessed:
 *  - `checkout()` mounts `POST /api/auth/checkout` — creates a Polar checkout session for the
 *    CALLER's own session user (`externalCustomerId: session.user.id`); `referenceId` in the request
 *    body is stamped onto the checkout's `metadata.referenceId`, which is what lets a webhook later
 *    resolve WHICH COMPANY a subscription belongs to (this product bills per company, never per
 *    user — see this file's own `use:[checkout(...)]` below for how the frontend supplies it).
 *  - `portal()` mounts `GET/POST /api/auth/customer/portal` (redirects to Polar's customer portal)
 *    plus `/customer/state`, `/customer/benefits/list`, `/customer/subscriptions/list`,
 *    `/customer/orders/list` — all read-only, all scoped to the CALLER's own Polar customer.
 *    **`/customer/portal` itself is NOT what the frontend's "Manage subscription" button calls** —
 *    kept mounted here only for its sibling read-only routes (unused today, but harmless) — because
 *    its own `customerSessions.create({ externalCustomerId })` call has no way to supply `memberId`,
 *    which Polar requires for a TEAM customer (this product's seat-based plan promotes a paying
 *    company's customer to `type: "team"` — see `portal-session.ts`'s header for the full chain).
 *    `billing.controller.ts`'s own `POST /billing/portal` calls the raw SDK instead.
 *  - `usage()` mounts `/usage/meters/list` + `/usage/ingest` — NOT used by this feature (seat-based
 *    billing, not metered usage); included nowhere below.
 *  - `webhooks()` USED TO mount `POST /api/auth/polar/webhooks` here, verifying the Polar signature
 *    via `@polar-sh/sdk/webhooks`'s `validateEvent` before dispatching to a named handler. REMOVED
 *    2026-09-15: per Polar's OWN documentation (polar.sh/docs/integrate/webhooks/delivery, "Custom
 *    validation"), Polar switched its webhook signing scheme on 8 September 2026, 00:00 UTC — secrets
 *    from before that instant are signed with the literal UTF-8 bytes of the `whsec_…` string as the
 *    HMAC key, secrets from on/after it with genuine Standard Webhooks (strip `whsec_`, base64-decode
 *    the remainder). `validateEvent` (`@polar-sh/sdk@0.49`) only ever computes the FIRST (pre-cutover)
 *    derivation — so it is a guaranteed 400 for any endpoint created after the cutover, which every
 *    hosted-billing instance stood up from here on necessarily has. Confirmed against a real captured
 *    delivery to this app's own sandbox endpoint (created 2026-09-15) — see
 *    `status-reconcile.ts`'s own header for the production incident this caused, and
 *    `polar-webhook.controller.ts`'s own header for the full account and the fix (Polar's own SDK
 *    fixes this properly in 1.0.0-alpha.19+, trying both keys — this repo pins `^0.49.0`). `@polar-sh/
 *    better-auth`'s `webhooks()` calls `validateEvent` internally with no way to inject a different
 *    verifier, so the only fix was to stop using it: the real receiver is now
 *    `POST /api/billing/webhooks/polar` (`PolarWebhookController`, `BillingModule`'s own controller,
 *    trying both key derivations itself via `standardwebhooks` directly), never
 *    `/api/auth/polar/webhooks`, which no longer exists as a route at all. `checkout`/`portal` above
 *    are unaffected — neither ever went through `validateEvent`.
 *  - Seat-QUANTITY sync (`PATCH subscriptions/{id}` with `{ seats }`) is NOT one of these
 *    routes — it is a privileged, server-to-server-only call, made directly against the raw
 *    `@polar-sh/sdk` client (`polar-client.ts`) from `seat-sync.ts`, never through this plugin.
 *
 * ## Relationship to `AuthGuard`/`RolesGuard` (established by reading `@thallesp/nestjs-better-auth`,
 * not assumed): `AuthModule.forRoot` mounts the WHOLE better-auth handler (`toNodeHandler`, including
 * every plugin route above) as plain EXPRESS MIDDLEWARE on `/api/auth/*`
 * (`node_modules/@thallesp/nestjs-better-auth/dist/index.mjs`'s own `configure()`), registered via
 * `MiddlewareConsumer.forRoutes(this.basePath)` — middleware runs and RESPONDS before Nest's routing
 * layer ever dispatches to a controller, so these routes never reach our global `AuthGuard`/
 * `RolesGuard` `APP_GUARD`s at all. Each route is gated ENTIRELY by better-auth's OWN mechanism
 * instead: `checkout`/`portal` check `getSessionFromCtx(ctx)` themselves (`authenticatedUsersOnly:
 * true` below makes checkout 401 without a session). The webhook route USED to be a third example of
 * this same shape (public, but signature-verified by better-auth's own mechanism) — see this file's
 * own header for why it was removed and moved to a plain `@Public()` Nest controller instead, gated
 * the ordinary way (that decorator, read by OUR OWN `AuthGuard` — see `polar-webhook.controller.ts`'s
 * own header).
 */
import { Polar } from '@polar-sh/sdk';
import { checkout, polar, portal } from '@polar-sh/better-auth';

import { isBillingEnabled } from './billing-flag';
import { resolvePolarServerEnvironment } from './polar-env';
import { FALLBACK_RETURN_URL } from './portal-return-url';

/** `polar()`'s own return type, structurally — never exported by `@polar-sh/better-auth` itself, so
 *  `ReturnType<typeof polar>` is how `lib/auth.ts`'s `plugins: [...buildPolarAuthPlugins()]` array
 *  stays type-safe without hand-duplicating the shape. */
type PolarBetterAuthPlugin = ReturnType<typeof polar>;

/**
 * `[]` when billing is disabled. When enabled, the ONE `polar()` plugin, carrying `checkout` +
 * `portal` (never `webhooks` or `usage` — see this file's own header for why each is absent). Called
 * from `lib/auth.ts`, itself gated the same way (`isBillingEnabled()` checked again there before even
 * importing this at all is unnecessary — this function is already the single source of truth for the
 * gate).
 */
export function buildPolarAuthPlugins(): PolarBetterAuthPlugin[] {
  if (!isBillingEnabled()) return [];

  const client = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN,
    server: resolvePolarServerEnvironment(),
  });

  return [
    polar({
      // Cast: `@polar-sh/better-auth` (a `"type": "module"` package) resolves `@polar-sh/sdk`'s own
      // `Polar` class via the ESM condition; this backend package (CJS) resolves the SAME specifier
      // via the `require` condition — nodenext's dual-package hazard, two structurally-identical but
      // nominally-distinct classes (their private `#private` brand differs), confirmed directly by
      // `tsc` (`TS2741: Property '#private' is missing`) while writing this file. The RUNTIME object
      // is the exact same `Polar` implementation either way (one npm package, one `dist/commonjs`
      // actually loaded at require-time) — only the TYPE CHECKER sees two identities.
      client: client as unknown as Parameters<typeof polar>[0]['client'],
      // A Polar customer per USER (never per company — see this file's own header on why
      // `referenceId` is what carries the COMPANY at checkout time instead). Harmless for a user who
      // never pays anything: Polar customers are free to create.
      createCustomerOnSignUp: true,
      use: [
        checkout({
          products: [
            ...(process.env.POLAR_PRODUCT_ID_MONTHLY
              ? [{ productId: process.env.POLAR_PRODUCT_ID_MONTHLY, slug: 'monthly' }]
              : []),
            ...(process.env.POLAR_PRODUCT_ID_YEARLY
              ? [{ productId: process.env.POLAR_PRODUCT_ID_YEARLY, slug: 'yearly' }]
              : []),
          ],
          // The FRONTEND is expected to pass its own absolute `successUrl`/`returnUrl` in the
          // checkout request body (`window.location.origin`-based) — a relative path here would
          // resolve against the BACKEND's own request URL (`checkout.ts`'s own
          // `new URL(successUrl, ctx.request?.url ?? ctx.context.baseURL)`), never the frontend's
          // origin, since `/api/auth/checkout` is a backend route. This is only the FALLBACK for a
          // caller that omits it.
          returnUrl: FALLBACK_RETURN_URL(),
          authenticatedUsersOnly: true,
        }),
        portal({ returnUrl: FALLBACK_RETURN_URL() }),
        // `webhooks(...)` used to be here — see this file's own header for why it was removed
        // 2026-09-15 and replaced by `polar-webhook.controller.ts`'s own `POST
        // /api/billing/webhooks/polar`, which reuses `handleSubscriptionPayload`
        // (`webhook-handlers.ts`) for the exact same six subscription event types.
      ],
    }),
  ];
}
