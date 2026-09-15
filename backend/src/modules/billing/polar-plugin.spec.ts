import { BILLING_FLAG_NAME } from './billing-flag';
import { applySubscriptionWebhook } from './webhook-handlers';

jest.mock('./webhook-handlers');

// `@polar-sh/better-auth`'s own `dist/index.cjs` unconditionally `require`s
// `@polar-sh/checkout/embed` — a BROWSER-ONLY bundle (references `window`/`document`, genuine ESM
// with no CJS build at all — confirmed directly in the installed `@polar-sh/checkout` package's own
// `package.json`: its `exports["./embed"]` has no "require" condition, only "default"). Plain Node (this repo's runtime,
// v24) transparently `require()`s ESM since Node 22+ and loads it fine; Jest's OWN module loader does
// not support that yet, and fails with "Unexpected token 'export'" — a TEST-ENVIRONMENT artifact only,
// reproduced and confirmed while writing this file (a bare `import { polar } from
// '@polar-sh/better-auth'` in a throwaway spec fails identically, with no `polar-plugin.ts` code
// involved at all). Mocking the package here is what isolates OUR OWN gating/wiring logic
// (`buildPolarAuthPlugins`, `handleSubscriptionPayload`) from that unrelated, browser-only dependency
// — real construction of the actual better-auth plugin is exercised at boot (see `lib/auth.ts`, never
// imported by any spec per this codebase's own convention) and by `polar.live.spec.ts`.
jest.mock('@polar-sh/better-auth', () => ({
  polar: jest.fn((opts: unknown) => ({ id: 'polar', __opts: opts })),
  checkout: jest.fn((opts: unknown) => ({ __plugin: 'checkout', __opts: opts })),
  portal: jest.fn((opts: unknown) => ({ __plugin: 'portal', __opts: opts })),
  webhooks: jest.fn((opts: unknown) => ({ __plugin: 'webhooks', __opts: opts })),
}));

import { buildPolarAuthPlugins, handleSubscriptionPayload } from './polar-plugin';

const applyMock = applySubscriptionWebhook as jest.Mock;
const ORIGINAL_ENV = { ...process.env };

describe('buildPolarAuthPlugins', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is [] when billing is disabled', () => {
    delete process.env[BILLING_FLAG_NAME];
    expect(buildPolarAuthPlugins()).toEqual([]);
  });

  it('returns exactly one polar() plugin when enabled and configured', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    process.env.POLAR_ACCESS_TOKEN = 'polar_at_x';
    process.env.POLAR_WEBHOOK_SECRET = 'whsec_x';
    process.env.POLAR_PRODUCT_ID_MONTHLY = 'prod_month';
    process.env.POLAR_PRODUCT_ID_YEARLY = 'prod_year';

    const plugins = buildPolarAuthPlugins();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe('polar');
  });
});

describe('handleSubscriptionPayload', () => {
  afterEach(() => jest.resetAllMocks());

  it('applies the webhook when metadata.referenceId is present', async () => {
    await handleSubscriptionPayload({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { referenceId: 'company-1' },
      },
    });

    expect(applyMock).toHaveBeenCalledWith({
      companyId: 'company-1',
      polarSubscriptionId: 'sub_1',
      polarCustomerId: 'cus_1',
      status: 'active',
      recurringInterval: 'month',
    });
  });

  it('drops a payload with no referenceId in its metadata, without throwing', async () => {
    await expect(
      handleSubscriptionPayload({
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'active',
          recurringInterval: 'month',
          metadata: {},
        },
      }),
    ).resolves.toBeUndefined();

    expect(applyMock).not.toHaveBeenCalled();
  });
});
