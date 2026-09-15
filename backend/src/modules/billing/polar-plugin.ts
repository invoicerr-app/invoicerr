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
 *  - `usage()` mounts `/usage/meters/list` + `/usage/ingest` — NOT used by this feature (seat-based
 *    billing, not metered usage); included nowhere below.
 *  - `webhooks()` mounts `POST /api/auth/polar/webhooks` — verifies the Polar signature itself
 *    (`@polar-sh/sdk/webhooks`'s `validateEvent`, called BEFORE any handler here ever runs — an
 *    invalid/missing signature is a 400 from the plugin itself, never reaching `webhook-handlers.ts`)
 *    then dispatches to whichever named handler below matches the event type.
 *  - Seat-QUANTITY sync (`PATCH subscriptions/{id}` with `{ seats }`) is NOT one of these four
 *    routes — it is a privileged, server-to-server-only call, made directly against the raw
 *    `@polar-sh/sdk` client (`polar-client.ts`) from `seat-sync.ts`, never through this plugin.
 *
 * ## Relationship to `AuthGuard`/`RolesGuard` (established by reading `@thallesp/nestjs-better-auth`,
 * not assumed): `AuthModule.forRoot` mounts the WHOLE better-auth handler (`toNodeHandler`, including
 * every plugin route above) as plain EXPRESS MIDDLEWARE on `/api/auth/*`
 * (`node_modules/@thallesp/nestjs-better-auth/dist/index.mjs`'s own `configure()`), registered via
 * `MiddlewareConsumer.forRoutes(this.basePath)` — middleware runs and RESPONDS before Nest's routing
 * layer ever dispatches to a controller, so these four routes never reach our global `AuthGuard`/
 * `RolesGuard` `APP_GUARD`s at all. Each route is gated ENTIRELY by better-auth's OWN mechanism
 * instead: `checkout`/`portal` check `getSessionFromCtx(ctx)` themselves (`authenticatedUsersOnly:
 * true` below makes checkout 401 without a session), and `webhooks` checks the Polar signature. This
 * is a real, load-bearing fact, not a nicety — it is WHY the webhook route can be public (no session)
 * while still being safe (signature-verified) using a mechanism entirely outside this app's own
 * guards.
 */
import { Polar } from '@polar-sh/sdk';
import { checkout, polar, portal, webhooks } from '@polar-sh/better-auth';

import { isBillingEnabled } from './billing-flag';
import { resolvePolarServerEnvironment } from './polar-env';
import { applySubscriptionWebhook } from './webhook-handlers';

/** `polar()`'s own return type, structurally — never exported by `@polar-sh/better-auth` itself, so
 *  `ReturnType<typeof polar>` is how `lib/auth.ts`'s `plugins: [...buildPolarAuthPlugins()]` array
 *  stays type-safe without hand-duplicating the shape. */
type PolarBetterAuthPlugin = ReturnType<typeof polar>;

const FALLBACK_RETURN_URL = () => `${process.env.APP_URL ?? 'http://localhost:5173'}/settings/billing`;

/**
 * `[]` when billing is disabled. When enabled, the ONE `polar()` plugin, carrying `checkout` +
 * `portal` + `webhooks` (never `usage` — see this file's own header). Called from `lib/auth.ts`,
 * itself gated the same way (`isBillingEnabled()` checked again there before even importing this at
 * all is unnecessary — this function is already the single source of truth for the gate).
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
        webhooks({
          // Non-null: `assertPolarEnvConfiguredForBoot` (called from `main.ts`, and from `lib/auth.ts`
          // itself right before this function runs) already refuses to boot at all when billing is
          // enabled and this var is blank — by the time this line executes for real, it is set.
          secret: process.env.POLAR_WEBHOOK_SECRET!,
          // ONE shared handler for every subscription event — see `webhook-handlers.ts`'s own header
          // for why the subscription object's own `status`/`recurringInterval` fields are
          // authoritative regardless of which specific event name fired. `metadata.referenceId` is
          // the companyId `checkout()`'s own `referenceId` body param stamped on at checkout time
          // (this file's own header) — a payload with no `referenceId` at all (a checkout that never
          // went through THIS app, or a stale/malformed test event) is logged and dropped, never
          // guessed at.
          onSubscriptionCreated: (payload) => handleSubscriptionPayload(payload),
          onSubscriptionActive: (payload) => handleSubscriptionPayload(payload),
          onSubscriptionUpdated: (payload) => handleSubscriptionPayload(payload),
          onSubscriptionCanceled: (payload) => handleSubscriptionPayload(payload),
          onSubscriptionUncanceled: (payload) => handleSubscriptionPayload(payload),
          onSubscriptionRevoked: (payload) => handleSubscriptionPayload(payload),
        }),
      ],
    }),
  ];
}

/** Structurally typed from whatever `webhooks()`'s own `onSubscription*` options accept — every one
 *  of them carries `{ data: Subscription }`, so one narrow local shape (just the fields
 *  `applySubscriptionWebhook` actually reads) covers all six without importing the SDK's full
 *  `Subscription` model. */
interface SubscriptionWebhookPayload {
  data: {
    id: string;
    customerId: string;
    status: string;
    recurringInterval: string;
    metadata: Record<string, string | number | boolean>;
  };
}

export async function handleSubscriptionPayload(payload: SubscriptionWebhookPayload): Promise<void> {
  const referenceId = payload.data.metadata?.referenceId;
  if (referenceId === undefined) {
    // No companyId to resolve to — see this file's own header. Never thrown: a malformed/foreign
    // event must not fail the whole webhook delivery (Polar retries a non-2xx response), it simply
    // has nothing for this app to do.
    return;
  }

  await applySubscriptionWebhook({
    companyId: String(referenceId),
    polarSubscriptionId: payload.data.id,
    polarCustomerId: payload.data.customerId,
    status: payload.data.status,
    recurringInterval: payload.data.recurringInterval,
  });
}
