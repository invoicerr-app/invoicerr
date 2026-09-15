import { BILLING_FLAG_NAME } from './billing-flag';

// `@polar-sh/better-auth`'s own `dist/index.cjs` unconditionally `require`s
// `@polar-sh/checkout/embed` — a BROWSER-ONLY bundle (references `window`/`document`, genuine ESM
// with no CJS build at all — confirmed directly in the installed `@polar-sh/checkout` package's own
// `package.json`: its `exports["./embed"]` has no "require" condition, only "default"). Plain Node (this repo's runtime,
// v24) transparently `require()`s ESM since Node 22+ and loads it fine; Jest's OWN module loader does
// not support that yet, and fails with "Unexpected token 'export'" — a TEST-ENVIRONMENT artifact only,
// reproduced and confirmed while writing this file (a bare `import { polar } from
// '@polar-sh/better-auth'` in a throwaway spec fails identically, with no `polar-plugin.ts` code
// involved at all). Mocking the package here is what isolates OUR OWN gating/wiring logic
// (`buildPolarAuthPlugins`) from that unrelated, browser-only dependency — real construction of the
// actual better-auth plugin is exercised at boot (see `lib/auth.ts`, never imported by any spec per
// this codebase's own convention) and by `polar.live.spec.ts`. No `webhooks` entry here any more — see
// `polar-plugin.ts`'s own header for why that sub-plugin was removed 2026-09-15 (its own coverage,
// including what used to be `handleSubscriptionPayload`, moved to `webhook-handlers.spec.ts` and
// `polar-webhook.controller.spec.ts`).
jest.mock('@polar-sh/better-auth', () => ({
  polar: jest.fn((opts: unknown) => ({ id: 'polar', __opts: opts })),
  checkout: jest.fn((opts: unknown) => ({ __plugin: 'checkout', __opts: opts })),
  portal: jest.fn((opts: unknown) => ({ __plugin: 'portal', __opts: opts })),
}));

import { buildPolarAuthPlugins } from './polar-plugin';

const ORIGINAL_ENV = { ...process.env };

describe('buildPolarAuthPlugins', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is [] when billing is disabled', () => {
    delete process.env[BILLING_FLAG_NAME];
    expect(buildPolarAuthPlugins()).toEqual([]);
  });

  it('returns exactly one polar() plugin, carrying checkout + portal only (no webhooks), when enabled', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    process.env.POLAR_ACCESS_TOKEN = 'polar_at_x';
    process.env.POLAR_WEBHOOK_SECRET = 'whsec_x';
    process.env.POLAR_PRODUCT_ID_MONTHLY = 'prod_month';
    process.env.POLAR_PRODUCT_ID_YEARLY = 'prod_year';

    const plugins = buildPolarAuthPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe('polar');
    // Locks in the 2026-09-15 removal: `webhooks()` is no longer part of `use`, only checkout+portal
    // — the real Polar webhook receiver is `PolarWebhookController`, not this plugin any more.
    const use = (plugins[0] as unknown as { __opts: { use: { __plugin: string }[] } }).__opts.use;
    expect(use.map((p) => p.__plugin)).toEqual(['checkout', 'portal']);
  });
});
