import { createHmac } from 'node:crypto';

import { PaymentWebhookVerificationError } from '../../provider';
import { verifyStripeSignature } from './stripe-signature';

const SECRET = 'whsec_test_secret';

/** Builds a genuine `Stripe-Signature` header the exact way Stripe itself does — computed
 *  independently here (never by calling into `verifyStripeSignature`'s own internals) so a passing
 *  test is real evidence the production code verifies a signature correctly, not a tautology. */
function sign(payload: string, secret: string, timestampSeconds: number): string {
  const hmac = createHmac('sha256', secret).update(`${timestampSeconds}.${payload}`).digest('hex');
  return `t=${timestampSeconds},v1=${hmac}`;
}

describe('verifyStripeSignature', () => {
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_test_123', payment_status: 'paid' } },
  });

  it('accepts a genuinely signed, fresh payload and returns the parsed event', () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, SECRET, Math.floor(nowMs / 1000));

    const event = verifyStripeSignature(payload, header, SECRET, 300, nowMs);

    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('checkout.session.completed');
    expect(event.data.object.id).toBe('cs_test_123');
  });

  it('accepts a Buffer body identically to the equivalent string', () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, SECRET, Math.floor(nowMs / 1000));

    const event = verifyStripeSignature(Buffer.from(payload, 'utf-8'), header, SECRET, 300, nowMs);
    expect(event.id).toBe('evt_1');
  });

  it('refuses a missing signature header', () => {
    expect(() => verifyStripeSignature(payload, undefined, SECRET)).toThrow(PaymentWebhookVerificationError);
  });

  it('refuses a malformed header (no v1, no t)', () => {
    expect(() => verifyStripeSignature(payload, 'garbage', SECRET)).toThrow(PaymentWebhookVerificationError);
    expect(() => verifyStripeSignature(payload, 't=123', SECRET)).toThrow(PaymentWebhookVerificationError);
  });

  it('refuses a signature computed with the WRONG secret', () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, 'whsec_other_secret', Math.floor(nowMs / 1000));

    expect(() => verifyStripeSignature(payload, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses a TAMPERED payload even against a genuinely signed header', () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, SECRET, Math.floor(nowMs / 1000));
    const tampered = payload.replace('cs_test_123', 'cs_test_999');

    expect(() => verifyStripeSignature(tampered, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses a signature that is the right LENGTH but wrong bytes — never throws from timingSafeEqual itself', () => {
    const nowMs = 1_700_000_000_000;
    const timestamp = Math.floor(nowMs / 1000);
    const real = sign(payload, SECRET, timestamp);
    const [, v1Part] = real.split(',');
    const [, hex] = v1Part.split('=');
    const flipped = (hex[0] === '0' ? '1' : '0') + hex.slice(1);
    const header = `t=${timestamp},v1=${flipped}`;

    expect(() => verifyStripeSignature(payload, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  // Boundary-tested (mutation-proof): exactly AT the tolerance must still pass, one second past must not.
  it('accepts a timestamp exactly AT the tolerance boundary', () => {
    const nowMs = 1_700_000_000_000;
    const timestamp = Math.floor(nowMs / 1000) - 300;
    const header = sign(payload, SECRET, timestamp);

    expect(() => verifyStripeSignature(payload, header, SECRET, 300, nowMs)).not.toThrow();
  });

  it('refuses a timestamp one second past the tolerance boundary', () => {
    const nowMs = 1_700_000_000_000;
    const timestamp = Math.floor(nowMs / 1000) - 301;
    const header = sign(payload, SECRET, timestamp);

    expect(() => verifyStripeSignature(payload, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses a FUTURE timestamp past tolerance too — not just a stale one', () => {
    const nowMs = 1_700_000_000_000;
    const timestamp = Math.floor(nowMs / 1000) + 301;
    const header = sign(payload, SECRET, timestamp);

    expect(() => verifyStripeSignature(payload, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses an empty secret rather than silently matching anything', () => {
    const nowMs = 1_700_000_000_000;
    const header = sign(payload, SECRET, Math.floor(nowMs / 1000));
    expect(() => verifyStripeSignature(payload, header, '', 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });

  it('refuses a signature that verified but is not valid JSON', () => {
    const nowMs = 1_700_000_000_000;
    const notJson = '{not json';
    const header = sign(notJson, SECRET, Math.floor(nowMs / 1000));

    expect(() => verifyStripeSignature(notJson, header, SECRET, 300, nowMs)).toThrow(
      PaymentWebhookVerificationError,
    );
  });
});
