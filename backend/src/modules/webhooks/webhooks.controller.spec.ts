/**
 * `create` returns the plaintext secret once, for the caller who just created it. That same object must
 * never reach `dispatch`, which would fan it out to every other webhook of the company: the three routes
 * strip `secret` from the dispatch payload while leaving the direct HTTP response untouched.
 */

import { vi, type Mock } from 'vitest';

// The auth imports pull in an ESM-only transitive dependency ts-jest does not parse; mocking them here
// avoids widening transformIgnorePatterns for decorators this file never exercises.
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
