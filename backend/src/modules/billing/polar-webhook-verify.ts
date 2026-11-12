/**
 * Verifies a Polar webhook signature without `@polar-sh/sdk`'s `validateEvent`, which derives the wrong
 * key for legacy secrets. Per Polar's docs, older secrets use the UTF-8 bytes
 * of the full `whsec_` string as the HMAC key, later ones use Standard Webhooks; both look identical, so
 * both derivations are always tried.
 */
import { Webhook, WebhookVerificationError } from 'standardwebhooks';

export { WebhookVerificationError };

export interface PolarWebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

/**
 * Tries Standard Webhooks first, then the legacy key. Throws `WebhookVerificationError` (the caller
 * maps it to 400); when both fail, the Standard Webhooks error is surfaced as the more informative one.
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
