/**
 * `WebhooksService.create`'s own response deliberately still carries the plaintext HMAC secret ONCE,
 * for the caller who just created it (the settings screen's "shown once" reveal). That same object
 * must never be forwarded UNCHANGED into `webhookDispatcher.dispatch(...)`, which fans it out over
 * HTTP to every OTHER webhook of the company subscribed to WEBHOOK_CREATED/UPDATED/DELETED — that
 * would leak this brand-new secret to a THIRD receiver that has no business seeing it. Encrypting the
 * column at rest would be undermined if the plaintext still traveled out through this side door, so
 * these three routes strip `secret` from the dispatch payload while leaving the direct HTTP response
 * (the one legitimate reveal) untouched.
 */

import { vi, type Mock } from 'vitest';

// `@thallesp/nestjs-better-auth` and `@/guards/auth.guard`'s own `@/lib/auth`/`better-auth/node`
// imports all ship or pull in an ESM-only transitive dependency (better-auth/dist/plugins/index.mjs)
// jest's ts-jest transform doesn't parse. `WebhooksController` imports `AuthGuard` for every one of
// its routes — the exact same barrier `requires-scope.controllers.spec.ts` already documents and
// mocks around the same way, rather than widening jest's transformIgnorePatterns for decorators this
// file never exercises.
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));
vi.mock('better-auth/node', () => ({
  fromNodeHeaders: vi.fn((headers: unknown) => headers),
}));

import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

describe('WebhooksController — never forwards a secret into the dispatch payload', () => {
  let webhooksService: { create: Mock; update: Mock; remove: Mock };
  let dispatcher: { dispatch: Mock };
  let controller: WebhooksController;

  const COMPANY = { id: 'company-1' };

  beforeEach(() => {
    webhooksService = { create: vi.fn(), update: vi.fn(), remove: vi.fn() };
    dispatcher = { dispatch: vi.fn().mockResolvedValue(undefined) };
    controller = new WebhooksController(
      webhooksService as unknown as WebhooksService,
      dispatcher as unknown as WebhookDispatcherService,
    );
  });

  it('create: strips the secret from the WEBHOOK_CREATED dispatch payload, but not from the HTTP response', async () => {
    const webhook = { id: 'wh-1', url: 'https://example.com/hook', secret: 'plain-secret' };
    webhooksService.create.mockResolvedValue({ webhook, company: COMPANY });

    const response = await controller.create('company-1', { url: webhook.url });

    const dispatchedPayload = dispatcher.dispatch.mock.calls[0][1];
    expect(dispatchedPayload.webhook.secret).toBeUndefined();
    expect((response as { data: { secret: string } }).data.secret).toBe('plain-secret');
  });

  it('update: strips the secret from the WEBHOOK_UPDATED dispatch payload', async () => {
    const webhook = { id: 'wh-1', url: 'https://example.com/hook', secret: 'plain-secret' };
    webhooksService.update.mockResolvedValue({ webhook, company: COMPANY });

    await controller.update('company-1', 'wh-1', { url: webhook.url });

    const dispatchedPayload = dispatcher.dispatch.mock.calls[0][1];
    expect(dispatchedPayload.webhook.secret).toBeUndefined();
  });

  it('remove: strips the secret from the WEBHOOK_DELETED dispatch payload', async () => {
    const webhook = { id: 'wh-1', url: 'https://example.com/hook', secret: 'plain-secret' };
    webhooksService.remove.mockResolvedValue({ webhook, company: COMPANY });

    await controller.remove('company-1', 'wh-1');

    const dispatchedPayload = dispatcher.dispatch.mock.calls[0][1];
    expect(dispatchedPayload.webhook.secret).toBeUndefined();
  });
});
