/**
 * "Un webhook non vérifié est refusé" — proven directly against the REAL verification code
 * `polar-plugin.ts`'s `webhooks({ secret })` config relies on (`@polar-sh/sdk/webhooks#validateEvent`,
 * called by `@polar-sh/better-auth`'s own `/api/auth/polar/webhooks` endpoint BEFORE
 * `handleSubscriptionPayload`/`applySubscriptionWebhook` ever runs — see `polar-plugin.ts`'s own
 * header, established by reading `node_modules/@polar-sh/better-auth/dist/index.cjs` directly).
 * Never mocked: this is the exact function the plugin calls, imported from the exact same package.
 *
 * Mirrors `@polar-sh/sdk`'s OWN test for this function
 * (`node_modules/@polar-sh/sdk/dist/commonjs/webhooks.test.js`) — same `standardwebhooks` signing
 * helper (a transitive dependency of `@polar-sh/sdk`, used here only to construct a REAL signature
 * for the "wrong secret" and "tampered body" cases below; never installed as a project dependency of
 * our own).
 */
import { Webhook } from 'standardwebhooks';

// Plain `require`, not a static `import`: `@polar-sh/sdk`'s own `package.json` "exports" declares
// this subpath only via a generic `"./*"` wildcard, which TypeScript's `moduleResolution: nodenext`
// fails to resolve for TYPE CHECKING ("Cannot find module '@polar-sh/sdk/webhooks'") even though the
// exact same specifier resolves and runs correctly at real Node runtime — `@polar-sh/better-auth`'s
// own compiled `dist/index.cjs` does `require("@polar-sh/sdk/webhooks")` this same way (confirmed:
// this repo's real backend boot, WITH the billing flag on, gets past constructing that plugin with no
// resolution error at all). A bare `require` sidesteps the type-only resolution failure entirely.
// biome-ignore lint/suspicious/noExplicitAny: untyped on purpose — see the comment above.
const polarWebhooks: any = require('@polar-sh/sdk/webhooks');
const { validateEvent, WebhookVerificationError } = polarWebhooks;

const REAL_SECRET = 'whsec_test_secret';
const REAL_SECRET_BASE64 = Buffer.from(REAL_SECRET, 'utf-8').toString('base64');

function signedHeaders(body: string, webhookId = 'msg_1', timestamp: Date = new Date()) {
  const signature = new Webhook(REAL_SECRET_BASE64).sign(webhookId, timestamp, body);
  return {
    'webhook-id': webhookId,
    'webhook-timestamp': Math.floor(timestamp.getTime() / 1000).toString(),
    'webhook-signature': signature,
  };
}

describe('Polar webhook signature verification (the real @polar-sh/sdk#validateEvent)', () => {
  const body = JSON.stringify({ type: 'subscription.active', data: {} });

  it('passes SIGNATURE verification for a payload genuinely signed with the configured secret', () => {
    // The test body here is intentionally a minimal shape, not a full real `Subscription` payload —
    // so a SEPARATE schema-validation error (SDKValidationError, not WebhookVerificationError) is
    // expected and fine: it proves the payload never even reached signature verification's own
    // rejection path, which is the only thing this test is about — never confused with "the signature
    // check itself passed or failed" the way the OTHER three tests in this file are.
    const headers = signedHeaders(body);
    expect(() => validateEvent(body, headers, REAL_SECRET)).not.toThrow(WebhookVerificationError);
  });

  it('refuses a payload signed with a DIFFERENT secret than the one configured', () => {
    const headers = signedHeaders(body); // signed with REAL_SECRET
    expect(() => validateEvent(body, headers, 'a-completely-different-secret')).toThrow(
      WebhookVerificationError,
    );
  });

  it('refuses a genuinely-signed payload whose BODY was tampered with after signing', () => {
    const headers = signedHeaders(body);
    const tampered = JSON.stringify({ type: 'subscription.active', data: { tampered: true } });
    expect(() => validateEvent(tampered, headers, REAL_SECRET)).toThrow(WebhookVerificationError);
  });

  it('refuses a request with no signature headers at all', () => {
    expect(() =>
      validateEvent(
        body,
        { 'webhook-id': '', 'webhook-timestamp': '', 'webhook-signature': '' },
        REAL_SECRET,
      ),
    ).toThrow();
  });
});
