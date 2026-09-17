/**
 * `POST /api/webhooks/:uuid` is `@AllowAnonymous()`: whoever calls it is an unauthenticated
 * third party, not a signed-in tenant. The catch block in `handleWebhook` must never echo
 * `error.message` straight back in the response body — that message would differ by failure branch
 * ("Active plugin with UUID X not found or has no webhook configured" vs. any other error), letting
 * a caller enumerate valid plugin UUIDs by watching which message came back. This file proves the
 * response body is IDENTICAL regardless of which internal error caused the failure, while the
 * real detail still reaches the server-side logger for whoever operates the instance.
 */
// `@thallesp/nestjs-better-auth` and `@/guards/auth.guard`'s own `@/lib/auth`/`better-auth/node`
// imports all ship or pull in an ESM-only transitive dependency (better-auth/dist/plugins/index.mjs)
// jest's ts-jest transform doesn't parse. `WebhooksController` imports `AuthGuard` for its protected
// CRUD routes (only `@Post(':uuid')` is `@AllowAnonymous()`) — the exact same barrier
// `requires-scope.controllers.spec.ts` already documents and mocks around the same way, rather than
// widening jest's transformIgnorePatterns for decorators/imports this file never exercises.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));
jest.mock('@/lib/auth', () => ({
  auth: { api: { getSession: jest.fn().mockResolvedValue(null) } },
}));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn((headers: unknown) => headers),
}));

import { NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';

import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

function makeRes(): Response {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('WebhooksController.handleWebhook — generic error response', () => {
  let controller: WebhooksController;
  let webhooksService: { handlePluginWebhook: jest.Mock };

  beforeEach(() => {
    webhooksService = { handlePluginWebhook: jest.fn() };
    controller = new WebhooksController(
      webhooksService as unknown as WebhooksService,
      {} as WebhookDispatcherService,
    );
  });

  it('never echoes a NotFoundException message that would reveal whether the plugin UUID exists', async () => {
    webhooksService.handlePluginWebhook.mockRejectedValue(
      new NotFoundException('Active plugin with UUID secret-uuid-123 not found or has no webhook configured'),
    );
    const res = makeRes();

    await controller.handleWebhook('secret-uuid-123', {}, {} as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toEqual({ success: false, message: 'Webhook processing failed' });
    expect(JSON.stringify(body)).not.toContain('secret-uuid-123');
    expect(JSON.stringify(body)).not.toContain('not found');
  });

  it('returns the exact same generic body for an unrelated internal error', async () => {
    webhooksService.handlePluginWebhook.mockRejectedValue(new Error('provider exploded: dumped stack trace'));
    const res = makeRes();

    await controller.handleWebhook('other-uuid', {}, {} as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toEqual({ success: false, message: 'Webhook processing failed' });
    expect(JSON.stringify(body)).not.toContain('dumped stack trace');
  });

  it('the two failure branches above are indistinguishable from the response alone (no enumeration oracle)', async () => {
    webhooksService.handlePluginWebhook.mockRejectedValueOnce(
      new NotFoundException('plugin does-not-exist not found'),
    );
    const resA = makeRes();
    await controller.handleWebhook('does-not-exist', {}, {} as Request, resA);

    webhooksService.handlePluginWebhook.mockRejectedValueOnce(new Error('boom'));
    const resB = makeRes();
    await controller.handleWebhook('does-exist-but-crashes', {}, {} as Request, resB);

    expect((resA.json as jest.Mock).mock.calls[0][0]).toEqual((resB.json as jest.Mock).mock.calls[0][0]);
  });

  it('still succeeds normally when the plugin call resolves', async () => {
    webhooksService.handlePluginWebhook.mockResolvedValue({ ok: true });
    const res = makeRes();

    await controller.handleWebhook('uuid-1', { some: 'body' }, {} as Request, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Webhook processed successfully',
      data: { ok: true },
    });
  });
});

/**
 * `WebhooksService.create`'s own response deliberately still carries the plaintext secret ONCE, for
 * the caller who just created it (the settings screen's "shown once" reveal). That same object must
 * never be forwarded UNCHANGED into `webhookDispatcher.dispatch(...)`, which fans it out over HTTP to
 * every OTHER webhook of the company subscribed to WEBHOOK_CREATED/UPDATED/DELETED — that would leak
 * this brand-new secret to a THIRD receiver that has no business seeing it. Encrypting the column at
 * rest would be undermined if the plaintext still traveled out through this side door, so these three
 * routes strip `secret` from the dispatch payload while leaving the direct HTTP response (the one
 * legitimate reveal) untouched.
 */
describe('WebhooksController — never forwards a secret into the dispatch payload', () => {
  let webhooksService: { create: jest.Mock; update: jest.Mock; remove: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };
  let controller: WebhooksController;

  const COMPANY = { id: 'company-1' };

  beforeEach(() => {
    webhooksService = { create: jest.fn(), update: jest.fn(), remove: jest.fn() };
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
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
