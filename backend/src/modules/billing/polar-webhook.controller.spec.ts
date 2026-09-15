/**
 * `PolarWebhookController` in isolation. Signature verification is proven against REAL
 * `standardwebhooks#Webhook.sign()` output (never a stub) — the same primitive Polar itself signs
 * with, and the same one `polar-webhook-verify.ts` verifies with; this is what actually proves the
 * `@polar-sh/sdk#validateEvent` gap this controller exists to route around (see that file's and the
 * controller's own headers, citing Polar's own docs on the 8-September-2026 signing-scheme cutover) is
 * fixed, not merely mocked away. `handleSubscriptionPayload` is mocked wholesale — its own coverage is
 * `webhook-handlers.spec.ts`'s job, this file only proves it is called (or not) with the right,
 * remapped shape.
 *
 * Both test secrets below use the REAL Polar shape (`whsec_` + 44 base64 chars, 50 total) — the two
 * signing eras share that exact string shape (see `polar-webhook-verify.ts`'s own header), so nothing
 * here needs a differently-shaped secret to exercise either derivation.
 *
 * `@thallesp/nestjs-better-auth`'s `Public` is mocked to a no-op decorator, same discipline
 * `public-documents.controller.spec.ts`/`sdi-notifiche.controller.spec.ts` already hold (that
 * package's own ESM-only transitive dependency doesn't parse under ts-jest) — `lib/auth.ts` itself is
 * never imported, directly or transitively, anywhere in this file.
 */
import { BadRequestException } from '@nestjs/common';
import { Webhook } from 'standardwebhooks';

jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));
jest.mock('./webhook-handlers', () => ({
  handleSubscriptionPayload: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { PolarWebhookController } from './polar-webhook.controller';
import { handleSubscriptionPayload } from './webhook-handlers';

const handleMock = handleSubscriptionPayload as jest.Mock;

const CURRENT_ERA_SECRET = 'whsec_BvK1GJTtxRCjrPFTQ9F0vWYiVWJGsquV7uaHOsDwgHc=';
const PRE_CUTOVER_SECRET = 'whsec_kqzP3nJdV1sYcQmR8wXeH0fLtNbG6aE9pUxWyDoSjKl=';

const SUBSCRIPTION_ACTIVE_BODY = JSON.stringify({
  type: 'subscription.active',
  data: {
    id: 'sub_1',
    customer_id: 'cus_1',
    status: 'active',
    recurring_interval: 'month',
    metadata: { referenceId: 'company-1' },
  },
});

/** Standard Webhooks derivation, the CURRENT Polar era (secrets from 8 September 2026, 00:00 UTC
 *  onward — `polar-webhook-verify.ts`'s own header) — `new Webhook(secret)` strips `whsec_` and
 *  base64-decodes the rest, exactly what Polar itself signs with today. */
function signCurrentEra(body: string, secret: string, webhookId = 'msg_1', timestamp = new Date()) {
  const signature = new Webhook(secret).sign(webhookId, timestamp, body);
  return {
    'webhook-id': webhookId,
    'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'webhook-signature': signature,
  };
}

/** Polar HMAC derivation, the LEGACY pre-cutover era — key is the literal UTF-8 bytes of the full
 *  `whsec_…` string, i.e. base64-encode the secret first, then hand THAT to a non-raw `Webhook`
 *  (base64-decoding what was just base64-encoded returns the original bytes) — exactly what
 *  `@polar-sh/sdk#validateEvent` computes unconditionally, and exactly what `polar-webhook-verify.ts`
 *  tries as its fallback. */
function signPreCutoverEra(body: string, secret: string, webhookId = 'msg_1', timestamp = new Date()) {
  const legacyHmacKey = Buffer.from(secret, 'utf-8').toString('base64');
  const signature = new Webhook(legacyHmacKey).sign(webhookId, timestamp, body);
  return {
    'webhook-id': webhookId,
    'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'webhook-signature': signature,
  };
}

function fakeRequest(body: string, headers: Record<string, string>) {
  return {
    rawBody: Buffer.from(body, 'utf-8'),
    headers,
  } as unknown as Parameters<PolarWebhookController['handleWebhook']>[0];
}

describe('PolarWebhookController.handleWebhook', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.POLAR_WEBHOOK_SECRET = CURRENT_ERA_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
  });

  it('200s and dispatches, remapping the wire snake_case fields, for a current-era (Standard Webhooks) signature', async () => {
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET);

    const result = await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(result).toEqual({ received: true });
    expect(handleMock).toHaveBeenCalledTimes(1);
    expect(handleMock).toHaveBeenCalledWith({
      data: {
        id: 'sub_1',
        customerId: 'cus_1',
        status: 'active',
        recurringInterval: 'month',
        metadata: { referenceId: 'company-1' },
      },
    });
  });

  it('200s and dispatches for a pre-cutover (Polar HMAC) signature — the @polar-sh/sdk#validateEvent derivation', async () => {
    process.env.POLAR_WEBHOOK_SECRET = PRE_CUTOVER_SECRET;
    const controller = new PolarWebhookController();
    const headers = signPreCutoverEra(SUBSCRIPTION_ACTIVE_BODY, PRE_CUTOVER_SECRET);

    const result = await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(result).toEqual({ received: true });
    expect(handleMock).toHaveBeenCalledTimes(1);
  });

  it('refuses (400) a payload signed with the wrong secret, and never dispatches', async () => {
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(
      SUBSCRIPTION_ACTIVE_BODY,
      'whsec_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V=',
    );

    await expect(controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers))).rejects.toThrow(
      BadRequestException,
    );
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('refuses (400) a delivery whose timestamp is outside the 5-minute tolerance, and never dispatches', async () => {
    const controller = new PolarWebhookController();
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 1000);
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_1', staleTimestamp);

    await expect(controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers))).rejects.toThrow(
      BadRequestException,
    );
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('200s WITHOUT dispatching for a genuinely-signed but unhandled event type', async () => {
    const body = JSON.stringify({ type: 'order.paid', data: { id: 'order_1' } });
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(body, CURRENT_ERA_SECRET);

    const result = await controller.handleWebhook(fakeRequest(body, headers));

    expect(result).toEqual({ received: true });
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('refuses (400) a request with no captured raw body', async () => {
    const controller = new PolarWebhookController();
    const req = { rawBody: undefined, headers: {} } as unknown as Parameters<
      PolarWebhookController['handleWebhook']
    >[0];

    await expect(controller.handleWebhook(req)).rejects.toThrow(BadRequestException);
    expect(handleMock).not.toHaveBeenCalled();
  });
});
