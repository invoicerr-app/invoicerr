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
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    polarWebhookEvent: {
      create: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
  },
}));

import prisma from '@/prisma/prisma.service';

import { PolarWebhookController } from './polar-webhook.controller';
import { handleSubscriptionPayload } from './webhook-handlers';

const handleMock = handleSubscriptionPayload as jest.Mock;
const createDedupRow = prisma.polarWebhookEvent.create as jest.Mock;
const deleteDedupRow = prisma.polarWebhookEvent.delete as jest.Mock;

const CURRENT_ERA_SECRET = 'whsec_BvK1GJTtxRCjrPFTQ9F0vWYiVWJGsquV7uaHOsDwgHc=';
const PRE_CUTOVER_SECRET = 'whsec_kqzP3nJdV1sYcQmR8wXeH0fLtNbG6aE9pUxWyDoSjKl=';

const SUBSCRIPTION_ACTIVE_BODY = JSON.stringify({
  type: 'subscription.active',
  data: {
    id: 'sub_1',
    customer_id: 'cus_1',
    status: 'active',
    recurring_interval: 'month',
    metadata: { companyId: 'company-1' },
    customer: { id: 'cus_1', external_id: 'company-1' },
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
    expect(handleMock).toHaveBeenCalledWith(
      {
        data: {
          id: 'sub_1',
          customerId: 'cus_1',
          status: 'active',
          recurringInterval: 'month',
          metadata: { companyId: 'company-1' },
          customerExternalId: 'company-1',
        },
      },
      expect.any(Date),
    );
  });

  it('remaps to customerExternalId: undefined when the wire payload carries no nested customer object', async () => {
    const body = JSON.stringify({
      type: 'subscription.active',
      data: {
        id: 'sub_2',
        customer_id: 'cus_2',
        status: 'active',
        recurring_interval: 'year',
        metadata: { companyId: 'company-2' },
      },
    });
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(body, CURRENT_ERA_SECRET);

    await controller.handleWebhook(fakeRequest(body, headers));

    expect(handleMock).toHaveBeenCalledWith(
      {
        data: {
          id: 'sub_2',
          customerId: 'cus_2',
          status: 'active',
          recurringInterval: 'year',
          metadata: { companyId: 'company-2' },
          customerExternalId: undefined,
        },
      },
      expect.any(Date),
    );
  });

  it(
    'passes factAt as undefined (never an Invalid Date) when webhook-timestamp has trailing garbage ' +
      'that parseInt-based signature verification tolerates but a strict numeric read does not',
    async () => {
      const controller = new PolarWebhookController();
      const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_garbage_ts');
      // `standardwebhooks#verifyTimestamp` reads this with `parseInt`, which stops at the first
      // non-digit and still yields the SAME integer the signature above was computed over — so this
      // delivery verifies successfully, exactly like a genuine one; only `Number(...)` (a stricter,
      // whole-string parse) sees it differently.
      headers['webhook-timestamp'] = `${headers['webhook-timestamp']}garbage`;

      const result = await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

      expect(result).toEqual({ received: true });
      expect(handleMock).toHaveBeenCalledWith(expect.anything(), undefined);
    },
  );

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

  it('reserves a dedup row keyed by webhook-id before dispatching', async () => {
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_dedup_1');

    await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(createDedupRow).toHaveBeenCalledWith({ data: { id: 'msg_dedup_1' } });
  });

  it('a REPLAYED delivery (same webhook-id, a provider retry or a dashboard resend) 200s WITHOUT dispatching a second time', async () => {
    createDedupRow.mockRejectedValueOnce({ code: 'P2002' });
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_already_processed');

    const result = await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(result).toEqual({ received: true });
    expect(handleMock).not.toHaveBeenCalled();
  });

  it('propagates a genuine (non-duplicate) dedup-write failure rather than swallowing it', async () => {
    createDedupRow.mockRejectedValueOnce(new Error('db is down'));
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_db_down');

    await expect(controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers))).rejects.toThrow(
      'db is down',
    );
    expect(handleMock).not.toHaveBeenCalled();
  });

  it(
    'frees the dedup reservation and propagates the error when the handler itself throws, so a ' +
      "provider retry of the SAME webhook-id gets a real second attempt instead of 200'ing as an " +
      "'already processed' fact that was never actually applied",
    async () => {
      handleMock.mockRejectedValueOnce(new Error('prisma hiccup mid-handler'));
      const controller = new PolarWebhookController();
      const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_handler_failed');

      await expect(controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers))).rejects.toThrow(
        'prisma hiccup mid-handler',
      );

      expect(deleteDedupRow).toHaveBeenCalledWith({ where: { id: 'msg_handler_failed' } });
    },
  );

  it('a REPLAY after a freed reservation actually re-runs the handler (proves the retry is real, not just acknowledged)', async () => {
    handleMock.mockRejectedValueOnce(new Error('prisma hiccup mid-handler'));
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_retry_1');

    await expect(controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers))).rejects.toThrow();

    // The reservation was freed above (`deleteDedupRow`), so a same-webhook-id retry's own `create`
    // must NOT be rejected as a duplicate this time — a real, mockable `create` (not still stubbed to
    // always succeed) proves the row is actually gone rather than merely asserting the delete call.
    const result = await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(result).toEqual({ received: true });
    expect(handleMock).toHaveBeenCalledTimes(2);
  });

  it('never frees the reservation, and still 200s without dispatching, for an ordinary duplicate delivery', async () => {
    createDedupRow.mockRejectedValueOnce({ code: 'P2002' });
    const controller = new PolarWebhookController();
    const headers = signCurrentEra(SUBSCRIPTION_ACTIVE_BODY, CURRENT_ERA_SECRET, 'msg_ordinary_dup');

    await controller.handleWebhook(fakeRequest(SUBSCRIPTION_ACTIVE_BODY, headers));

    expect(deleteDedupRow).not.toHaveBeenCalled();
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
