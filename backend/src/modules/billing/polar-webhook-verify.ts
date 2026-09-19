/**
 * Verifies an inbound Polar webhook delivery's signature against the configured secret — the
 * REPLACEMENT for `@polar-sh/sdk`'s own `webhooks#validateEvent`, which derives the wrong HMAC key for
 * roughly half of all Polar webhook secrets in existence. Sourced directly from Polar's OWN
 * documentation (https://polar.sh/docs/integrate/webhooks/delivery, "Custom validation", fetched
 * 2026-09-15 — not an inference from reading the SDK alone, though that reading — carried in
 * `polar-webhook.controller.ts`'s own header — matches this exactly):
 *
 *   "Polar sends one `webhook-signature`. The HMAC key is which secret you have.
 *    Before 8 September 2026, 00:00 UTC: Polar HMAC. Key is the UTF-8 bytes of the full `whsec_…`
 *    string. Base64-encode that string before you hand it to a Standard Webhooks library.
 *    On or after that instant: Standard Webhooks. Pass the `whsec_…` secret to the library as-is.
 *    Polar SDKs 1.0.0-alpha.19 and later try both keys."
 *
 * Both eras' secrets share the exact same `whsec_<44 base64 chars>` STRING SHAPE — the prefix alone
 * never tells you which era a given endpoint's secret belongs to, only that endpoint's own
 * creation/reset date does, which this app has no way to read at verification time (and a self-hosted
 * instance may well have connected Polar billing before the cutover and never touched its secret
 * since). So, exactly like Polar's own 1.0.0-alpha.19+ SDK, BOTH derivations are tried here,
 * unconditionally, for every secret — never gated on the secret's own shape.
 *
 * `standardwebhooks#Webhook` is the same primitive `@polar-sh/sdk`'s own `validateEvent` delegates to
 * (`node_modules/@polar-sh/sdk/dist/commonjs/webhooks.js`) for both derivations below.
 */
import { Webhook, WebhookVerificationError } from 'standardwebhooks';

export { WebhookVerificationError };

export interface PolarWebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

/**
 * Two key derivations, tried in this order:
 *
 * 1. Standard Webhooks (current era, since 2026-09-08 — tried FIRST because a hosted-billing endpoint
 *    created today, 2026-09-15, is necessarily post-cutover): `new Webhook(secret)` — the library's
 *    own constructor strips the `whsec_` prefix and base64-decodes the remainder as the key. This is
 *    the SAME key a genuinely current Polar delivery is signed with — no re-encoding, no bug.
 * 2. Polar HMAC (legacy era, before 2026-09-08 — self-hosted instances that connected Polar billing
 *    before the cutover and never reset their webhook secret since): the key is the LITERAL UTF-8
 *    bytes of the full `whsec_…` string — exactly what base64-encoding the secret and handing THAT to
 *    a non-raw `Webhook` computes (base64-decoding what was just base64-encoded returns the original
 *    bytes) — reproduced directly here rather than calling `@polar-sh/sdk`'s own `validateEvent` (this
 *    file has no `@polar-sh/*` import at all).
 *
 * Throws `WebhookVerificationError` (headers missing/malformed, timestamp outside the library's own
 * 5-minute tolerance — Polar's own docs state no tolerance of their own, so this is
 * `standardwebhooks`'s default, unmodified — or neither derivation's signature matches) — the caller's
 * whole job is to turn a thrown error into a 400. When BOTH derivations fail, the error surfaced is
 * derivation 1's (the current-era one) — the expected, informative case for an operator reading logs,
 * not derivation 2's.
 */
export function verifyPolarWebhook(
  body: Buffer | string,
  headers: PolarWebhookHeaders,
  secret: string,
): unknown {
  try {
    return new Webhook(secret).verify(body, headers);
  } catch (standardEraError) {
    const legacyHmacKey = Buffer.from(secret, 'utf-8').toString('base64');
    try {
      return new Webhook(legacyHmacKey).verify(body, headers);
    } catch {
      throw standardEraError;
    }
  }
}
