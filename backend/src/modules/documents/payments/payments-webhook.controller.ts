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
 * company's credentials to check the signature against, nothing more. They are NOT secret and they are
 * NOT what authorizes this call: a company connects Stripe once and pastes THIS exact URL into their
 * OWN Stripe dashboard's webhook settings (bring-your-own-account — see
 * `payment-sessions.service.ts`'s own header, decision 2), and the only thing that actually proves a
 * request came from Stripe is `PaymentSessionsService.handleWebhookEvent` verifying the
 * `Stripe-Signature` header against that company's own webhook secret. A forged request naming the
 * right ids but the wrong (or no) signature is refused with the SAME 400 as a malformed one — see
 * `stripe-signature.ts`'s own header for exactly what that check covers (a valid HMAC over the raw
 * body AND a fresh timestamp, so a captured-and-replayed request years later is refused too).
 *
 * Reads the RAW body Express already captured (`main.ts`'s own `bodyParser.json({ verify })` — Stripe
 * always sends `application/json`, so the global parser's `verify` callback already ran and stashed
 * `req.rawBody` before this handler is ever reached) rather than re-serializing `req.body`: a re-
 * serialized JSON object can differ byte-for-byte from what was actually signed (key order, whitespace),
 * which would make EVERY signature check fail — the exact same reasoning `main.ts`'s own comment gives.
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
        req.headers['stripe-signature'] as string | undefined,
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
