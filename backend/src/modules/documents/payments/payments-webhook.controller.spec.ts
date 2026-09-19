/**
 * `PaymentsWebhookController` in isolation — `PaymentSessionsService` is mocked wholesale: this spec
 * proves the HTTP-SHAPE contract only, in particular the ONE thing that must never leak to an
 * unauthenticated caller (see this controller's own header on why `:companyId`/`:providerId` are a
 * routing hint, not a secret): the RESPONSE TEXT of a failed verification must be identical whichever
 * of the several distinct reasons `PaymentSessionsService.handleWebhookEvent` actually failed for —
 * "this provider isn't connected for this company" and "the signature doesn't match" must read the
 * same from the outside, or an anonymous caller can enumerate which companies exist and which payment
 * providers they have connected purely from the 400 body.
 */
import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

// `@thallesp/nestjs-better-auth`'s own transitive dependency is ESM-only and does not parse under
// ts-jest — same discipline `sdi-notifiche.controller.spec.ts` already holds for the identical import.
vi.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

import { PaymentWebhookVerificationError } from './provider';
import { PaymentSessionsService } from './payment-sessions.service';
import { PaymentsWebhookController } from './payments-webhook.controller';

function fakeRequest(rawBody?: Buffer) {
  return { rawBody, headers: { 'stripe-signature': 't=1,v1=abc' } } as unknown as Parameters<
    PaymentsWebhookController['handleWebhook']
  >[2];
}

describe('PaymentsWebhookController.handleWebhook', () => {
  it('answers 200 with the outcome once the event is verified and processed', async () => {
    const handleWebhookEvent = vi.fn().mockResolvedValue({ outcome: 'processed' });
    const controller = new PaymentsWebhookController({
      handleWebhookEvent,
    } as unknown as PaymentSessionsService);

    const result = await controller.handleWebhook('stripe', 'company-1', fakeRequest(Buffer.from('{}')));

    expect(result).toEqual({ received: true, outcome: 'processed' });
  });

  it('400s, named, when the raw body was never captured', async () => {
    const handleWebhookEvent = vi.fn();
    const controller = new PaymentsWebhookController({
      handleWebhookEvent,
    } as unknown as PaymentSessionsService);

    await expect(controller.handleWebhook('stripe', 'company-1', fakeRequest(undefined))).rejects.toThrow(
      BadRequestException,
    );
    expect(handleWebhookEvent).not.toHaveBeenCalled();
  });

  // THE MUTATION TARGET: the controller used to re-throw `error.message` verbatim, so the 400 body
  // itself told an anonymous caller WHICH of several reasons verification failed for. Both scenarios
  // below must produce the exact same response text.
  describe('verification failures never leak WHICH reason they failed for', () => {
    const NOT_CONNECTED_MESSAGE =
      '"stripe" is not connected for company "company-1" — cannot verify this webhook.';
    const BAD_SIGNATURE_MESSAGE = 'Invalid Stripe webhook signature.';

    async function messageFor(rejection: Error): Promise<string> {
      const handleWebhookEvent = vi.fn().mockRejectedValue(rejection);
      const controller = new PaymentsWebhookController({
        handleWebhookEvent,
      } as unknown as PaymentSessionsService);
      try {
        await controller.handleWebhook('stripe', 'company-1', fakeRequest(Buffer.from('{}')));
        throw new Error('expected handleWebhook to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(BadRequestException);
        return (error as BadRequestException).message;
      }
    }

    it('a provider never connected for this company reads identically to a bad signature', async () => {
      const notConnected = await messageFor(new PaymentWebhookVerificationError(NOT_CONNECTED_MESSAGE));
      const badSignature = await messageFor(new PaymentWebhookVerificationError(BAD_SIGNATURE_MESSAGE));

      expect(notConnected).toBe(badSignature);
      // Neither the company id nor which specific check failed ever reaches the response body.
      expect(notConnected).not.toMatch(/company-1/);
      expect(notConnected).not.toMatch(/not connected/i);
      expect(notConnected).not.toMatch(/signature/i);
    });
  });

  it('a genuine processing failure (post-verification) is rethrown as-is — a real 5xx, not swallowed', async () => {
    const processingError = new Error('record-payment failed');
    const handleWebhookEvent = vi.fn().mockRejectedValue(processingError);
    const controller = new PaymentsWebhookController({
      handleWebhookEvent,
    } as unknown as PaymentSessionsService);

    await expect(
      controller.handleWebhook('stripe', 'company-1', fakeRequest(Buffer.from('{}'))),
    ).rejects.toBe(processingError);
  });
});
