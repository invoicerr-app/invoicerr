import { BadRequestException, Controller, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { logger } from '@/logger/logger.service';

import { PaymentWebhookVerificationError } from './provider';
import { PaymentSessionsService } from './payment-sessions.service';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/**
 * The ONE `@Public()` route for an inbound payment-provider webhook — same reasoning
 * `sdi-notifiche.controller.ts`'s/`public-documents.controller.ts`'s own headers already give for
 * keeping an unauthenticated route in a controller of its own: "does this controller require a
 * session" stays a per-FILE fact. `@Public()` here is `@thallesp/nestjs-better-auth`'s own decorator
 * (the one actually wired to `AuthGuard` — see `PortalController`'s own header for why not
 * `@/decorators/public.decorator.ts`).
 *
 * `:companyId`/`:providerId` in the URL are a ROUTING hint ONLY — what tells this endpoint which
 * company's credentials to verify against, nothing more, and which registered `PaymentProvider` (see
 * `payment-provider-registry.ts`) actually does the verifying. They are NOT secret and they are NOT
 * what authorizes this call: a company connects a provider once (Stripe/Mollie/PayPal, bring-your-own-
 * account — see `payment-sessions.service.ts`'s own header, decision 2) and registers THIS exact URL as
 * that provider's own webhook endpoint, and the only thing that actually proves a request is genuine is
 * `PaymentSessionsService.handleWebhookEvent` delegating to `provider.parseWebhookEvent` — a signature
 * check for Stripe/PayPal, an authenticated re-fetch for Mollie (see `provider.ts`'s own header on why
 * the three differ). A forged/unverifiable request naming the right ids is refused with the SAME 400 as
 * a malformed one, regardless of which provider's own check caught it.
 *
 * The FULL header map (`req.headers`) is handed to `handleWebhookEvent`, not one named header — Stripe
 * needs `stripe-signature`, PayPal needs five `paypal-*` headers, Mollie needs none at all (see
 * `provider.ts`'s own header on why the shared interface was widened for this).
 *
 * Reads the RAW body Express already captured (`main.ts`'s own `bodyParser.json({ verify })` for
 * Stripe/PayPal's `application/json` webhooks, `bodyParser.urlencoded({ verify })` for Mollie's
 * `application/x-www-form-urlencoded` one — both stash `req.rawBody` before this handler is ever
 * reached) rather than re-serializing `req.body`: a re-serialized body can differ byte-for-byte from
 * what was actually signed (key order, whitespace), which would make a signature check fail — the exact
 * same reasoning `main.ts`'s own comment gives.
 */
@ApiExcludeController()
@Controller('public/payments')
export class PaymentsWebhookController {
  constructor(private readonly paymentSessions: PaymentSessionsService) {}

  @Post(':providerId/:companyId/webhook')
  @Public()
  async handleWebhook(
    @Param('providerId') providerId: string,
    @Param('companyId') companyId: string,
    @Req() req: RequestWithRawBody,
  ) {
    if (!req.rawBody) {
      // Unreachable for a genuine Stripe delivery (always `application/json`, always captured — see
      // this file's own header) — a defensive 400 rather than passing `undefined` into a signature
      // check that would otherwise throw a less legible error.
      throw new BadRequestException('Missing request body.');
    }

    try {
      const result = await this.paymentSessions.handleWebhookEvent(
        companyId,
        providerId,
        req.rawBody,
        req.headers,
      );
      // Always 200 for anything that got PAST signature verification — see
      // `PaymentSessionsService.handleWebhookEvent`'s own header on why an "ignored"/"unknown_session"
      // outcome must never look like a failure to the provider's own retry logic.
      return { received: true, outcome: result.outcome };
    } catch (error) {
      if (error instanceof PaymentWebhookVerificationError) {
        logger.warn('Payment webhook signature verification failed', {
          category: 'documents',
          details: { providerId, companyId, message: error.message },
        });
        throw new BadRequestException(error.message);
      }
      // Anything else (a "record-payment" failure surfaced by `handleWebhookEvent`) is a genuine 5xx —
      // the provider's own retry schedule is the recovery path, see that method's own header.
      logger.error('Payment webhook processing failed', {
        category: 'documents',
        details: {
          providerId,
          companyId,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }
}
