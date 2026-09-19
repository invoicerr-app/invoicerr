import { createHmac, timingSafeEqual } from 'node:crypto';

import { PaymentWebhookVerificationError } from '../../provider';

/**
 * Stripe's own webhook signature scheme (`Stripe-Signature: t=<unix-seconds>,v1=<hex-hmac>[,v1=...]`),
 * hand-rolled from node's own `crypto` rather than the `stripe` SDK — the same "correct primitive,
 * no external dependency" choice this codebase already makes for an outbound HMAC
 * (`webhooks/drivers/generic.driver.ts`'s own `createHmac('sha256', secret)`) and for AES-256-GCM
 * (`utils/secret-crypto.ts`): neither is "home-grown crypto" in the sense this codebase's own
 * "delegate to libs" discipline warns against (a hand-written XML/Schematron engine) — `createHmac`
 * and `timingSafeEqual` ARE the library, node's own, and Stripe's algorithm is public, stable, and
 * exactly this size. Pulling in the full `stripe` SDK (a REST client, typed models, retries, an
 * idempotency layer, its own webhook helper) for eleven lines of HMAC would be the heavier, not the
 * safer, choice — and would not remove the ONE thing that actually matters here: correctly comparing
 * bytes in constant time, which `timingSafeEqual` already does for us either way.
 *
 * This function is deliberately real in every environment, including tests — see
 * `stripe-checkout-client.ts`'s own header for the ONE piece of this integration that IS faked under
 * `NODE_ENV=test` (opening a session against Stripe's real API, which needs a real account this
 * project does not have). Signature verification needs no network and no account: it is exercised for
 * real by `stripe-signature.spec.ts` and by `60-online-payment.cy.ts`'s own simulated webhook call,
 * both computing a genuine HMAC-SHA256 the exact way this function verifies one.
 */

const DEFAULT_TOLERANCE_SECONDS = 300; // Stripe's own default replay tolerance.

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

function parseSignatureHeader(header: string): { timestamp: number; v1Signatures: string[] } {
  let timestamp: number | undefined;
  const v1Signatures: string[] = [];

  for (const part of header.split(',')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') v1Signatures.push(value);
  }

  if (timestamp === undefined || Number.isNaN(timestamp) || v1Signatures.length === 0) {
    throw new PaymentWebhookVerificationError(
      'Malformed Stripe-Signature header — expected "t=<timestamp>,v1=<signature>".',
    );
  }
  return { timestamp, v1Signatures };
}

/** Constant-time compare of two hex strings of possibly DIFFERENT length — `timingSafeEqual` itself
 *  throws on a length mismatch rather than answering `false`, which would leak timing information
 *  about the length via which branch threw. A length mismatch can never be a genuine match, so it is
 *  treated as one, up front, before the timing-safe comparison ever runs. */
function hexEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Verifies `signatureHeader` against `rawBody` (the EXACT bytes Stripe sent — re-serializing a parsed
 * JSON object is unreliable for HMAC, see `main.ts`'s own `bodyParser.json({ verify })` comment) using
 * `secret` (this company's own webhook signing secret, resolved by the caller through
 * `ChannelCredentialsService` — never a shared/global secret, since this is a bring-your-own-account
 * integration, see `payment-sessions.service.ts`'s own header). Throws
 * `PaymentWebhookVerificationError` for a missing header, a malformed one, a signature that does not
 * match ANY `v1` candidate, or a timestamp further than `toleranceSeconds` from `now` (a REPLAY
 * defense distinct from `PaymentCheckoutSession.status`'s own idempotent-processing guard: this stops
 * an attacker who captured a genuine, old request from replaying it verbatim years later, long after
 * this app's own PENDING→COMPLETED claim would happily accept it again as "just another retry" of a
 * session that has since been re-opened).
 *
 * Never returns a "verified: false" — a caller either gets a genuine, parsed event or an exception,
 * so there is no boolean anyone could forget to check.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS,
  now: number = Date.now(),
): StripeWebhookEvent {
  if (!signatureHeader) {
    throw new PaymentWebhookVerificationError('Missing Stripe-Signature header.');
  }
  if (!secret) {
    // Unreachable through `PaymentSessionsService` (it never calls this without a resolved,
    // non-empty webhook secret — see that file's own header), but a signature check must never
    // silently "pass" against an empty secret either, the same defensive posture every other
    // action/handler in this codebase holds for its own "should never happen" case.
    throw new PaymentWebhookVerificationError('No webhook secret configured for this company.');
  }

  const { timestamp, v1Signatures } = parseSignatureHeader(signatureHeader);

  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new PaymentWebhookVerificationError(
      `Stripe-Signature timestamp (${timestamp}) is outside the ${toleranceSeconds}s tolerance — ` +
        'refusing a stale or replayed request.',
    );
  }

  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (!v1Signatures.some((candidate) => hexEquals(candidate, expected))) {
    throw new PaymentWebhookVerificationError(
      "Stripe-Signature does not match this company's configured webhook secret — refusing the event.",
    );
  }

  try {
    return JSON.parse(payload) as StripeWebhookEvent;
  } catch {
    // Extraordinarily unlikely once the signature above verified (it would mean the real Stripe
    // servers sent malformed JSON, or the exact secret was somehow guessed) — still refused, never
    // handed to a caller expecting a well-formed event.
    throw new PaymentWebhookVerificationError('Signature verified but the payload is not valid JSON.');
  }
}
