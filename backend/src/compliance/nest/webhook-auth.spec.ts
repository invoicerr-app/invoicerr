/**
 * webhook-auth — unit tests
 *
 * Tests: valid HMAC passes / tampered body fails / missing-sig falls back-or-rejects
 * per config, IP allowlist.
 */
import * as crypto from 'crypto';
import { verifyHmacSignature, isIpAllowed, assertWebhookAuth } from './webhook-auth';

// ---------------------------------------------------------------------------
// verifyHmacSignature
// ---------------------------------------------------------------------------

describe('verifyHmacSignature', () => {
  const secret = 'test-secret-key';
  const payload = Buffer.from('{"invoice_id":1,"status_code":"fr:205"}');

  function sign(buf: Buffer, s: string): string {
    return 'sha256=' + crypto.createHmac('sha256', s).update(buf).digest('hex');
  }

  it('returns true for a valid HMAC signature', () => {
    const sig = sign(payload, secret);
    expect(verifyHmacSignature(payload, sig, secret)).toBe(true);
  });

  it('returns false when the body is tampered', () => {
    const sig = sign(payload, secret);
    const tampered = Buffer.from('{"invoice_id":2,"status_code":"fr:205"}');
    expect(verifyHmacSignature(tampered, sig, secret)).toBe(false);
  });

  it('returns false when the secret is wrong', () => {
    const sig = sign(payload, 'other-secret');
    expect(verifyHmacSignature(payload, sig, secret)).toBe(false);
  });

  it('returns false when the header has no sha256= prefix', () => {
    expect(verifyHmacSignature(payload, 'invalidheader', secret)).toBe(false);
  });

  it('returns false when the hex digest is the wrong length', () => {
    expect(verifyHmacSignature(payload, 'sha256=deadbeef', secret)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isIpAllowed
// ---------------------------------------------------------------------------

describe('isIpAllowed', () => {
  it('allows any IP when allowlist is empty', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('allows a listed IP', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4', '5.6.7.8'])).toBe(true);
  });

  it('blocks an unlisted IP', () => {
    expect(isIpAllowed('9.9.9.9', ['1.2.3.4', '5.6.7.8'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// assertWebhookAuth
// ---------------------------------------------------------------------------

function makePayload(): Buffer {
  return Buffer.from('{"test":true}');
}

function sign(payload: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

describe('assertWebhookAuth', () => {
  const PDP_SECRET = 'pdp-hmac-secret-for-test';
  const payload = makePayload();

  beforeEach(() => {
    // Clear env
    delete process.env.WEBHOOK_SECRET_PDP;
    delete process.env.COMPLIANCE_WEBHOOK_SECRET;
    delete process.env.WEBHOOK_ALLOWLIST_PDP;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET_PDP;
    delete process.env.COMPLIANCE_WEBHOOK_SECRET;
    delete process.env.WEBHOOK_ALLOWLIST_PDP;
  });

  it('passes with a valid HMAC signature and per-channel secret', () => {
    process.env.WEBHOOK_SECRET_PDP = PDP_SECRET;
    const sig = sign(payload, PDP_SECRET);
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: payload, signatureHeader: sig }),
    ).not.toThrow();
  });

  it('rejects with a tampered body (invalid HMAC)', () => {
    process.env.WEBHOOK_SECRET_PDP = PDP_SECRET;
    const sig = sign(payload, PDP_SECRET);
    const tampered = Buffer.from('{"tampered":true}');
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: tampered, signatureHeader: sig }),
    ).toThrow(/403|Forbidden|invalid webhook signature/i);
  });

  it('falls back to shared-secret header when no X-Signature', () => {
    process.env.COMPLIANCE_WEBHOOK_SECRET = 'shared-secret';
    expect(() =>
      assertWebhookAuth({ channel: 'SDI', rawBody: payload, sharedSecretHeader: 'shared-secret' }),
    ).not.toThrow();
  });

  it('rejects mismatched shared-secret', () => {
    process.env.COMPLIANCE_WEBHOOK_SECRET = 'shared-secret';
    expect(() =>
      assertWebhookAuth({ channel: 'SDI', rawBody: payload, sharedSecretHeader: 'wrong-secret' }),
    ).toThrow(/403|Forbidden/i);
  });

  it('rejects when secret is configured but neither header is present', () => {
    process.env.WEBHOOK_SECRET_PDP = PDP_SECRET;
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: payload }),
    ).toThrow(/403|Forbidden/i);
  });

  it('allows (with warning) when no secret is configured at all', () => {
    // no env vars set
    expect(() =>
      assertWebhookAuth({ channel: 'NOCHANNEL', rawBody: payload }),
    ).not.toThrow();
  });

  it('uses COMPLIANCE_WEBHOOK_SECRET as fallback when no per-channel secret', () => {
    process.env.COMPLIANCE_WEBHOOK_SECRET = 'global-secret';
    const sig = sign(payload, 'global-secret');
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: payload, signatureHeader: sig }),
    ).not.toThrow();
  });

  it('rejects a request from a blocked IP (IP allowlist)', () => {
    process.env.WEBHOOK_SECRET_PDP = PDP_SECRET;
    process.env.WEBHOOK_ALLOWLIST_PDP = '1.2.3.4,5.6.7.8';
    const sig = sign(payload, PDP_SECRET);
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: payload, signatureHeader: sig, remoteIp: '9.9.9.9' }),
    ).toThrow(/403|Forbidden/i);
  });

  it('accepts a request from an allowed IP', () => {
    process.env.WEBHOOK_SECRET_PDP = PDP_SECRET;
    process.env.WEBHOOK_ALLOWLIST_PDP = '1.2.3.4,5.6.7.8';
    const sig = sign(payload, PDP_SECRET);
    expect(() =>
      assertWebhookAuth({ channel: 'PDP', rawBody: payload, signatureHeader: sig, remoteIp: '1.2.3.4' }),
    ).not.toThrow();
  });
});
