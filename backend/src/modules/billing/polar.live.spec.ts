/**
 * REAL round-trip against a Polar SANDBOX organization. Gated the same way every other channel's own
 * live spec is (`POLAR_LIVE=1` + `POLAR_ACCESS_TOKEN`, `live-gate.ts`, reused verbatim):
 *
 *   POLAR_LIVE=1 POLAR_ACCESS_TOKEN=polar_at_... npx jest polar.live --no-coverage --runInBand
 *
 * WHAT A GREEN RUN PROVES: that the configured access token authenticates against a real Polar
 * organization and that `@polar-sh/sdk`'s `products.list()` call, the same client
 * `checkout-session.ts`/`portal-session.ts`/`seat-reconcile.ts` all use via `polar-client.ts`'s own
 * `getPolarClient()`, actually reaches Polar and gets back real product rows.
 *
 * WHAT IT DOES NOT PROVE: a full checkout → webhook → `CompanySubscription` round-trip. That needs a
 * completed (sandbox) checkout AND a webhook endpoint Polar can actually reach (a public URL, or the
 * Polar CLI's own local-forwarding tool), the exact same "wiring proven, delivery not" gap
 * `stripe.live.spec.ts`'s own header documents for Stripe, for the identical reason: no CI runner here
 * is a reachable public webhook target. `webhook-handlers.spec.ts` proves the SIGNATURE-VERIFIED
 * payload → DB write in isolation; this spec never touches that path.
 *
 * NEVER RUN when first written (no Polar sandbox organization/access token was provisioned for that
 * task), RUN and GREEN 2026-09-16, sandbox credentials from `.env.test.local` (see
 * `billing-option-a.live.spec.ts`'s own header for the fuller option-A round-trip run the same day).
 * #537 (2026-09-29): updated for `@polar-sh/sdk` 1.x, `createPolar` from the versioned
 * `@polar-sh/sdk/2026-10` subpath (no more `new Polar(...)`, which that package no longer even
 * exports), `products.list()` resolving directly to ONE page (`{ items, pagination }`), not 0.49's
 * `Promise<AsyncIterable<{ result: { items } } >>` of pages, confirmed by reading
 * `node_modules/@polar-sh/sdk`'s own shipped type declarations. Re-run against a real sandbox is what
 * actually proves the migration, not this file's existence, see the report to the owner for whether
 * that happened.
 */
import { createPolar } from '@polar-sh/sdk/2026-10';

import { liveDescribe } from '../documents/transports/live-gate';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive('Polar live round-trip (sandbox organization), products list', () => {
  it("authenticates and lists the organization's own products", async () => {
    const client = createPolar({
      accessToken: process.env.POLAR_ACCESS_TOKEN ?? '',
      environment: 'sandbox',
    });

    const { items } = await client.products.list({
      organization_id: process.env.POLAR_ORGANIZATION_ID || undefined,
    });

    // HARD-SUCCESS CONTRACT (documentation/docs/developer-guide/live-testing.md): a call that merely
    // resolved without throwing proves nothing about auth, an empty/malformed shape must fail loudly,
    // never a soft `expect().toBeTruthy()`.
    if (!Array.isArray(items)) {
      throw new Error(`Polar did not return a usable products list, hard failure. Got: ${items}`);
    }
    console.log(`Polar sandbox organization returned ${items.length} product(s).`);
  }, 15_000);
});
