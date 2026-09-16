/**
 * `POST /api/billing/webhooks/polar` — this app's OWN Polar webhook receiver, replacing
 * `@polar-sh/better-auth`'s `webhooks()` sub-plugin (formerly mounted at
 * `POST /api/auth/polar/webhooks` — see `polar-plugin.ts`'s own header for why that route is gone).
 *
 * ## Why this exists — `@polar-sh/sdk@0.49`'s `validateEvent` signs with the WRONG key for a current
 * Polar webhook secret
 *
 * Polar's OWN documentation (https://polar.sh/docs/integrate/webhooks/delivery, "Custom validation",
 * fetched 2026-09-15) states a hard cutover:
 *
 *   "Polar sends one `webhook-signature`. The HMAC key is which secret you have.
 *    Before 8 September 2026, 00:00 UTC: Polar HMAC. Key is the UTF-8 bytes of the full `whsec_…`
 *    string. Base64-encode that string before you hand it to a Standard Webhooks library.
 *    On or after that instant: Standard Webhooks. Pass the `whsec_…` secret to the library as-is.
 *    Polar SDKs 1.0.0-alpha.19 and later try both keys."
 *
 * `@polar-sh/sdk@0.49`'s `validateEvent` (`dist/commonjs/webhooks.js`) only ever computes the FIRST
 * (legacy, pre-cutover) derivation — `Buffer.from(secret, "utf-8").toString("base64")` fed to a
 * non-raw `standardwebhooks#Webhook` — unconditionally, for every secret, regardless of era. Confirmed
 * against a real captured delivery to this app's own sandbox endpoint (created 2026-09-15, so
 * necessarily post-cutover): `new Webhook(secret).verify(body, headers)` (the Standard Webhooks way)
 * PASSES; `validateEvent(body, headers, secret)` FAILS. Every hosted-billing instance stood up from
 * here on connects a Polar webhook endpoint created AFTER the cutover, so `validateEvent` is a
 * guaranteed 400 for it, silently (see `status-reconcile.ts`'s own header for the DB-side symptom this
 * produced before this controller existed) — `@polar-sh/better-auth`'s `webhooks()` plugin calls
 * `validateEvent` internally with no way to inject a different verifier, so the only fix was to stop
 * using it. Polar's own SDK fixes this properly in 1.0.0-alpha.19+ (tries both keys) — not usable here
 * (this repo pins `^0.49.0`, and an alpha is not something to depend on for a production credential
 * path); this controller does the SAME "try both" instead, by hand.
 *
 * `polar-webhook-verify.ts` carries the actual dual-verification logic — kept in its own file so it is
 * unit-testable without an HTTP harness.
 *
 * ## Dispatch
 * Reuses `handleSubscriptionPayload` (`webhook-handlers.ts`) — the SAME referenceId-extraction +
 * `applySubscriptionWebhook` call `polar-plugin.ts`'s own (now-removed) `onSubscription*` wiring used.
 * Every OTHER Polar event type (`order.*`, `checkout.*`, …) is acknowledged 200 and dropped — this app
 * has no handler for them today; a provider retries any non-2xx response, so an unhandled type must
 * never look like a failure.
 *
 * Polar's WIRE payload is snake_case (`customer_id`, `recurring_interval`) — established by reading
 * `@polar-sh/sdk`'s own generated `Subscription$inboundSchema`
 * (`node_modules/@polar-sh/sdk/dist/commonjs/models/components/subscription.js`), which remaps these
 * via zod before ever handing a payload to a handler. This controller never calls that schema (see
 * above), so `toSubscriptionWebhookPayload` below does the same two-field remap by hand. `id`/
 * `status`/`metadata` are single words, unaffected either way. The nested `data.customer.external_id`
 * (option A, product decision 2026-09-16 — `webhook-handlers.ts`'s own header on why this is the
 * PRIMARY company-resolution signal, `metadata.companyId` the fallback) is confirmed present on a
 * real wire delivery's `data.customer` object, sandbox 2026-09-16, for both `subscription.*` and
 * `order.*` events.
 *
 * ## Idempotency
 * `PolarWebhookEvent` (`schema.prisma`) is a dedup ledger keyed by the delivery's own `webhook-id`
 * header — a stable id Polar reuses VERBATIM on every retry of the SAME delivery (Standard Webhooks'
 * own guarantee), never re-minted per attempt. This controller inserts a row for it BEFORE dispatching
 * to a handler; a unique-constraint violation on that insert means this exact delivery already ran
 * (a provider retry, or Polar's own dashboard "resend"), answered 200 immediately without re-running
 * `handleSubscriptionPayload` a second time. `applySubscriptionWebhook`'s own field-set write (plain
 * `prisma.companySubscription.update`, never an increment/append) was ALSO naturally idempotent on its
 * own for the specific case of two deliveries carrying identical facts — this ledger additionally
 * covers the case that shape alone cannot: two deliveries of the SAME `webhook-id` racing each other
 * concurrently, which would otherwise run the handler twice regardless of how idempotent its own
 * writes are. A future handler for a genuinely non-idempotent effect (anything that increments a
 * counter or sends a one-off notification) can now rely on this same ledger rather than needing its
 * own.
 *
 * ## Wiring
 * `@Public()` is `@thallesp/nestjs-better-auth`'s own decorator (the one `AuthGuard`,
 * `src/guards/auth.guard.ts`, actually reads — its own `IS_PUBLIC_KEY = 'PUBLIC'` is deliberately the
 * SAME metadata key that package's decorator sets; `@/decorators/public.decorator.ts` uses a
 * DIFFERENT key and would not work here — see `payments-webhook.controller.ts`'s own header for the
 * same fact). No active company on this request, so `CompanyWriteGuard` (`company-write.guard.ts`)
 * lets it through unconditionally too (its own `!request.companyId` early-return). Reads
 * `req.rawBody`, captured by `main.ts`'s own `bodyParser.json({ verify })` — this route is NOT under
 * `/api/auth`, so (unlike the removed route) it IS parsed by that body parser and DOES get `rawBody`
 * populated; see `main.ts`'s own comment on why `/api/auth/*` is skipped instead.
 */
import { BadRequestException, Controller, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { verifyPolarWebhook, WebhookVerificationError } from './polar-webhook-verify';
import { handleSubscriptionPayload, SubscriptionWebhookPayload } from './webhook-handlers';

/** Postgres/Prisma's own unique-constraint-violation code — checked structurally (never importing
 *  `Prisma.PrismaClientKnownRequestError` by name) the same way every other billing file duck-types a
 *  third-party error shape (`billing-customer.ts#isResourceNotFoundError`'s own header). */
function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

/** The six event types `polar-plugin.ts`'s removed `onSubscription*` wiring used to cover — see this
 *  file's own header. Anything else: acknowledged, dropped, logged (never a 4xx/5xx — an unhandled
 *  type is not an error). */
const HANDLED_SUBSCRIPTION_EVENT_TYPES = new Set([
  'subscription.created',
  'subscription.updated',
  'subscription.active',
  'subscription.canceled',
  'subscription.uncanceled',
  'subscription.revoked',
]);

/** Polar's raw wire shape for a subscription event's own `data` — see this file's own header on why
 *  the two fields below are snake_case here and need remapping. `customer` is the nested customer
 *  object Polar echoes onto the subscription payload — only `external_id` is read here. */
interface PolarSubscriptionWireData {
  id: string;
  customer_id: string;
  status: string;
  recurring_interval: string;
  /** The subscription's own seat quantity — this webhook field, plus `seat-reconcile.ts`'s own
   *  periodic SDK read, are the ONLY two places seat quantity ever enters this app; nothing here ever
   *  writes it back to Polar (`webhook-handlers.ts#PolarSubscriptionWebhookFacts.seats`'s own doc
   *  comment). */
  seats?: number | null;
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

function toSubscriptionWebhookPayload(event: PolarWebhookEvent): SubscriptionWebhookPayload {
  return {
    data: {
      id: event.data.id,
      customerId: event.data.customer_id,
      status: event.data.status,
      recurringInterval: event.data.recurring_interval,
      seats: event.data.seats ?? undefined,
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
      // Unreachable for a genuine delivery (always `application/json`, always captured — see this
      // file's own header) — a defensive 400 rather than passing `undefined` into a signature check
      // that would otherwise throw a less legible error.
      throw new BadRequestException('Missing request body.');
    }

    const secret = process.env.POLAR_WEBHOOK_SECRET;
    if (!secret) {
      // Unreachable once billing is genuinely enabled — `assertPolarEnvConfiguredForBoot` (main.ts)
      // already refuses to boot with the flag on and this var blank. Named defensively rather than
      // reading `undefined` into `verifyPolarWebhook` and getting a less legible library error.
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

    // Idempotency ledger — see this file's own header. Reserved BEFORE dispatch: a unique-constraint
    // violation here means this exact delivery (by its own `webhook-id`) already ran, answered 200
    // immediately without touching `handleSubscriptionPayload` a second time.
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

    // `webhook-timestamp` is Standard Webhooks' own delivery timestamp (unix seconds, the same header
    // `verifyPolarWebhook` above already required to be present and within tolerance) — threaded
    // through as the fact's own timestamp so a later, slower `status-reconcile.ts` read can never
    // clobber whatever this delivery is about to apply. `verifyPolarWebhook` validates it with
    // `parseInt` (tolerant of trailing garbage — `"1758066400junk"` parses to `1758066400`), so a
    // header that PASSES verification can still fail a stricter `Number(...)` read here. `new
    // Date(NaN)` is NOT the inert fallback a caller might expect — it is a truthy `Invalid Date`
    // object, so it survives every `facts.factAt ?` truthiness check downstream and reaches
    // `prisma.companySubscription.update({ data: { lastPolarFactAt: ... } })`, which Prisma rejects,
    // turning this delivery into a 500 AFTER the dedup ledger row above was already committed — a
    // retry then 200s on the "already processed" branch without ever having actually applied the
    // fact, losing it for good. Validating numerically and falling back to `undefined` avoids ever
    // constructing that Invalid Date; `undefined` is the exact shape `handleSubscriptionPayload`'s own
    // optional `factAt` already expects for "no fact to compare/persist".
    const timestampSeconds = Number(headers['webhook-timestamp']);
    const factAt = Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1000) : undefined;

    await handleSubscriptionPayload(toSubscriptionWebhookPayload(event), factAt);

    return { received: true };
  }
}
