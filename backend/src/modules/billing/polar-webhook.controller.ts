/**
 * Own Polar webhook receiver instead of `@polar-sh/better-auth`'s `webhooks()` plugin, whose
 * `validateEvent` could not be swapped out. Polar signs with one of two key derivations depending on
 * when the secret was created; `polar-webhook-verify.ts` tries both.
 *
 * Polar's wire payload is snake_case, so `toSubscriptionWebhookPayload` remaps it by hand. Unhandled
 * event types are acknowledged 200, since any non-2xx triggers a retry.
 *
 * Idempotency: `PolarWebhookEvent` is a ledger keyed by the `webhook-id` header, which Polar reuses on
 * every retry. Reserving it before dispatch also guards against concurrent duplicate deliveries.
 *
 * `@Public()` must come from `@thallesp/nestjs-better-auth`: `@/decorators/public.decorator.ts` uses a
 * different metadata key that `AuthGuard` does not read.
 */
import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { verifyPolarWebhook, WebhookVerificationError } from './polar-webhook-verify';
import { handleSubscriptionPayload, SubscriptionWebhookPayload } from './webhook-handlers';

/** Prisma unique-constraint code, duck-typed to avoid importing the Prisma error class. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

const HANDLED_SUBSCRIPTION_EVENT_TYPES = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
]);

interface PolarSubscriptionWireData {
  id: string;
  customer_id: string;
  status: string;
  recurring_interval: string;
  /** Only read from Polar, never written back. */
  seats?: number | null;
  /** ISO-8601 on the wire. */
  current_period_end?: string | null;
  metadata?: Record<string, string | number | boolean>;
  customer?: { external_id?: string | null };
}

interface PolarWebhookEvent {
  type: string;
  data: PolarSubscriptionWireData;
}

function isPolarWebhookEvent(value: unknown): value is PolarWebhookEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; data?: unknown };
  return typeof candidate.type === 'string' && typeof candidate.data === 'object' && candidate.data !== null;
}

/** `undefined` rather than an `Invalid Date`, which is truthy and would make Prisma reject the write. */
function parseWireDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toSubscriptionWebhookPayload(event: PolarWebhookEvent): SubscriptionWebhookPayload {
  return {
    data: {
      id: event.data.id,
      customerId: event.data.customer_id,
      status: event.data.status,
      recurringInterval: event.data.recurring_interval,
      seats: event.data.seats ?? undefined,
      currentPeriodEnd: parseWireDate(event.data.current_period_end),
      metadata: event.data.metadata ?? {},
      customerExternalId: event.data.customer?.external_id ?? undefined,
    },
  };
}

@ApiExcludeController()
@Controller('billing/webhooks')
export class PolarWebhookController {
  @Post('polar')
  @Public()
  async handleWebhook(@Req() req: RequestWithRawBody): Promise<{ received: true }> {
    if (!req.rawBody) {
      throw new BadRequestException('Missing request body.');
    }

    const secret = process.env.POLAR_WEBHOOK_SECRET;
    if (!secret) {
      // Unreachable once billing is enabled: boot refuses with the flag on and this var blank.
      throw new BadRequestException('Polar webhook secret not configured.');
    }

    const headers = {
      'webhook-id': String(req.headers['webhook-id'] ?? ''),
      'webhook-timestamp': String(req.headers['webhook-timestamp'] ?? ''),
      'webhook-signature': String(req.headers['webhook-signature'] ?? ''),
    };

    let event: unknown;
    try {
      event = verifyPolarWebhook(req.rawBody, headers, secret);
    } catch (error) {
      const message =
        error instanceof WebhookVerificationError ? error.message : 'Signature verification failed.';
      logger.warn('Polar webhook signature verification failed', {
        category: 'billing',
        details: { message },
      });
      throw new BadRequestException(message);
    }

    if (!isPolarWebhookEvent(event)) {
      throw new BadRequestException('Malformed webhook payload.');
    }

    if (!HANDLED_SUBSCRIPTION_EVENT_TYPES.has(event.type)) {
      logger.info(`Polar webhook: ignoring unhandled event type "${event.type}"`, { category: 'billing' });
      return { received: true };
    }

    // Reserved before dispatch: a unique-constraint violation means this delivery already ran.
    try {
      await prisma.polarWebhookEvent.create({ data: { id: headers['webhook-id'] } });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        logger.info('Polar webhook: duplicate delivery (already processed), acknowledged without replay', {
          category: 'billing',
          details: { webhookId: headers['webhook-id'] },
        });
        return { received: true };
      }
      throw error;
    }

    // Passed as the fact timestamp so a later, slower `status-reconcile.ts` read cannot clobber it.
    // `verifyPolarWebhook` uses lenient `parseInt`, so validate strictly here: an `Invalid Date` would
    // 500 after the ledger row is committed and the retry would then skip the fact for good.
    const timestampSeconds = Number(headers['webhook-timestamp']);
    const factAt = Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1000) : undefined;

    try {
      await handleSubscriptionPayload(toSubscriptionWebhookPayload(event), factAt);
    } catch (error) {
      // Release the reservation so Polar's retry gets a real second attempt instead of hitting the
      // "already processed" branch for a fact that was never applied.
      await prisma.polarWebhookEvent.delete({ where: { id: headers['webhook-id'] } }).catch(() => undefined);
      throw error;
    }

    return { received: true };
  }
}
