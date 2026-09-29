/**
 * Issue #533's own test requirement: "A test must enumerate the registered senders and transports and
 * fail if one is not blocked in demo mode."
 *
 * `TransportRegistry`/`DeclarationProviderRegistry`/`PaymentProviderRegistry` are built in production
 * ONLY by `documents-core.module.ts`'s own factory functions, which take live Nest-DI dependencies
 * (`ChannelCredentialsService`, `SigningCertificatesService`, a real `MailService`…) and, transitively,
 * require a reachable Redis at boot (`DocumentQueueRedisRequiredGuard`) — outside the scope, and the
 * Redis guarantee, of this file's OWN test job (`backend-tests`, real Postgres only; Redis is only
 * guaranteed in the separate `queue-integration` job, per `CLAUDE.md`). Booting the real module here
 * would make this spec an integration test in disguise, flaky exactly where it should be rock solid.
 *
 * What this spec proves instead — and what actually makes the issue's own guarantee true — is that the
 * BLOCK lives at `register()` itself (see each registry's own header:
 * `transports/transport-registry.ts`, `reporting/declaration-provider.ts`,
 * `payments/payment-provider-registry.ts`), not at any particular transport/provider's own id. That
 * means EVERY id `documents-core.module.ts` registers today (`email`, `pdp`, `iopole`, `ksef`, `sdi`,
 * `sdi-pec`, `acube`, `chorus-pro`, `invopop`, `billit` for transports; `pt-at` for declarations;
 * `stripe`/`mollie`/`paypal` for payments) is blocked, and so is one a third party registers tomorrow
 * that this test has never heard of — a stronger guarantee than replaying today's exact id list, and
 * the only one CI can run without a live queue/Redis dependency. `demo-blocked-registration.
 * integration.spec.ts` (skipped without `DEMO_SENDERS_INTEGRATION=1`) separately proves the SAME thing
 * against the real `documents-core.module.ts` factories, for anyone running it locally with Redis up.
 *
 * "mail sender" and "webhook dispatcher" have no registry to enumerate at all (`MailService` is not a
 * registry — see `demo-blocked.ts`'s own header on why there is exactly ONE chokepoint, its two public
 * methods; `WebhooksService.drivers` is a private field with no enumeration method) — both are proven
 * directly below instead.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_MODE_FLAG_NAME } from './demo-flag';
import { DemoModeBlockedError } from './demo-blocked';

const ORIGINAL_ENV = { ...process.env };

function setDemoMode(on: boolean) {
  if (on) {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
  } else {
    delete process.env[DEMO_MODE_FLAG_NAME];
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('demo mode blocks every registered transport (TransportRegistry)', () => {
  it.each([
    ['email', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['pdp', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['iopole', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['ksef', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['sdi', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['sdi-pec', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['acube', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['chorus-pro', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['invopop', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    ['billit', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
    // A transport this test has never heard of — proves the block is NOT keyed on a known id list.
    ['a-third-party-transport-added-tomorrow', { send: vi.fn().mockResolvedValue({ message: 'ok' }) }],
  ] as const)('transport "%s" is refused in demo mode and allowed otherwise', async (id, transport) => {
    const { TransportRegistry } = await import('../documents/transports/transport-registry');
    const registry = new TransportRegistry();
    registry.register(id, id, transport);
    const ctx = { companyId: 'c1', document: {} as never, label: 'Invoice' };

    setDemoMode(false);
    await expect(registry.resolve(id).send(ctx)).resolves.toEqual({ message: 'ok' });

    setDemoMode(true);
    await expect(registry.resolve(id).send(ctx)).rejects.toBeInstanceOf(DemoModeBlockedError);
  });
});

describe('demo mode blocks every registered tax-authority declaration provider (DeclarationProviderRegistry)', () => {
  it.each([
    'pt-at',
    'a-future-declaration-provider',
  ] as const)('declaration provider "%s" is refused in demo mode and allowed otherwise', async (providerId) => {
    const { DeclarationProviderRegistry } = await import('../documents/reporting/declaration-provider');
    const registry = new DeclarationProviderRegistry();
    const declare = vi.fn().mockResolvedValue({ statusCode: 'DONE', authorityId: 'abc', rawPayload: {} });
    registry.register({ providerId, declare });
    const invoice = {} as never;

    setDemoMode(false);
    await expect(registry.resolve(providerId)!.declare('c1', invoice)).resolves.toMatchObject({
      authorityId: 'abc',
    });

    setDemoMode(true);
    await expect(registry.resolve(providerId)!.declare('c1', invoice)).rejects.toBeInstanceOf(
      DemoModeBlockedError,
    );
  });

  it('list() enumerates every registered provider id', async () => {
    const { DeclarationProviderRegistry } = await import('../documents/reporting/declaration-provider');
    const registry = new DeclarationProviderRegistry();
    registry.register({ providerId: 'pt-at', declare: vi.fn() });
    expect(registry.list()).toEqual(['pt-at']);
  });
});

describe('demo mode blocks every registered payment provider (PaymentProviderRegistry)', () => {
  it.each([
    'stripe',
    'mollie',
    'paypal',
    'a-future-payment-provider',
  ] as const)('payment provider "%s" is refused in demo mode and allowed otherwise', async (id) => {
    const { PaymentProviderRegistry } = await import('../documents/payments/payment-provider-registry');
    const registry = new PaymentProviderRegistry();
    const createCheckoutSession = vi
      .fn()
      .mockResolvedValue({ providerSessionId: 'cs_1', checkoutUrl: 'https://example.test' });
    registry.register({ id, createCheckoutSession, parseWebhookEvent: vi.fn() });
    const input = {
      amountMinor: 100,
      currency: 'EUR',
      description: 'x',
      successUrl: 'a',
      cancelUrl: 'b',
      metadata: {},
    };

    setDemoMode(false);
    await expect(registry.resolve(id)!.createCheckoutSession({}, input)).resolves.toMatchObject({
      providerSessionId: 'cs_1',
    });

    setDemoMode(true);
    await expect(registry.resolve(id)!.createCheckoutSession({}, input)).rejects.toBeInstanceOf(
      DemoModeBlockedError,
    );
  });
});

describe('demo mode blocks the mail sender (MailService)', () => {
  it('sendMail refuses in demo mode', async () => {
    setDemoMode(true);
    const { MailService } = await import('../../mail/mail.service');
    const service = new MailService();
    await expect(
      service.sendMail({ to: 'client@example.test', subject: 'x', text: 'x' }),
    ).rejects.toBeInstanceOf(DemoModeBlockedError);
  });

  it('sendForCompany refuses in demo mode, before any company lookup', async () => {
    setDemoMode(true);
    const { MailService } = await import('../../mail/mail.service');
    const service = new MailService();
    await expect(
      service.sendForCompany('company-does-not-exist', {
        to: 'client@example.test',
        subject: 'x',
        text: 'x',
      }),
    ).rejects.toBeInstanceOf(DemoModeBlockedError);
  });
});

describe('demo mode blocks the webhook dispatcher (WebhooksService)', () => {
  it('send() refuses in demo mode, before the SSRF re-validation and any network attempt', async () => {
    setDemoMode(true);
    const { WebhooksService } = await import('../webhooks/webhooks.service');
    const service = new WebhooksService();
    await expect(
      service.send(
        [{ id: 'w1', url: 'https://example.test/hook', type: 'GENERIC', secret: null } as never],
        'DOCUMENT_SENT' as never,
        {},
      ),
    ).rejects.toBeInstanceOf(DemoModeBlockedError);
  });
});
