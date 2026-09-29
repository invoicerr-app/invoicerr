/**
 * The refusal every outbound-send chokepoint in this codebase throws once `DEMO_MODE` is on —
 * `mail/mail.service.ts#sendMail`/`sendForCompany`, `modules/webhooks/webhooks.service.ts#send`,
 * `modules/documents/transports/transport-registry.ts#TransportRegistry.register` (wraps every
 * transport's own `send`), `modules/documents/reporting/declaration-provider.ts
 * #DeclarationProviderRegistry.register` (wraps every provider's own `declare`),
 * `modules/documents/payments/payment-provider-registry.ts#PaymentProviderRegistry.register` (wraps
 * every provider's own `createCheckoutSession`), and `modules/billing/polar-client.ts#getPolarClient`.
 *
 * Registering the wrap AT `register()` for the three registries above — never only at their own
 * call site inside `documents.service.ts`/`reporting-runner.ts`/`payment-sessions.service.ts` — is the
 * point: a transport/provider registered LATER, by a third party who never reads this file, is blocked
 * automatically too, because it is wrapped the moment it is added to the registry, not because
 * whoever calls it remembered to check `isDemoModeEnabled()` first. `demo-mode-senders.spec.ts`
 * enumerates every registry this codebase actually builds in production
 * (`documents-core.module.ts`) and asserts every one of its entries throws this error in demo mode —
 * see that spec's own header for why that is the test the issue asked for, not a spec that merely
 * re-asserts this file's own wrapping helpers work.
 *
 * A plain `ForbiddenException` (403): safe to throw from an HTTP request (Nest's own exception filter
 * renders it correctly) and equally safe to throw from a BullMQ processor or a bare script — it is
 * still just a `Error` subclass there, logged/failed exactly like any other job error, which several
 * of these chokepoints require (the billing lifecycle sweep, the reminder sweep, the webhook delivery
 * processor all run with no HTTP request in the path at all — see `guards/global-guards.ts`'s own
 * header on why a global `APP_GUARD` alone could never have covered them).
 */
import { ForbiddenException } from '@nestjs/common';

import { isDemoModeEnabled } from './demo-flag';

export const DEMO_MODE_BLOCKED_CODE = 'DEMO_MODE_BLOCKED';

/** The one message every demo-mode refusal in this codebase shows, NestJS-side or better-auth-side
 *  alike (`lib/auth.ts`'s own `hooks.before`/`deleteUser.beforeDelete` build a plain better-auth
 *  `APIError` from this same string, since better-auth's own error type is not a NestJS exception). */
export function demoModeBlockedMessage(what: string): string {
  return `${what} is disabled in this demo. Nothing you enter here is kept or sent.`;
}

export class DemoModeBlockedError extends ForbiddenException {
  constructor(what: string) {
    super({
      message: demoModeBlockedMessage(what),
      code: DEMO_MODE_BLOCKED_CODE,
    });
  }
}

/**
 * Throws `DemoModeBlockedError` when `DEMO_MODE` is on — call this FIRST, before any network attempt,
 * at every outbound-send chokepoint. `what` is a short, human-facing noun phrase ("Email",
 * "Webhook delivery", "This transport", "Tax-authority declaration", "Card/online payment",
 * "Polar billing") — it becomes the whole visible refusal, so it must read correctly as
 * "<what> is disabled in this demo."
 */
export function assertDemoSendingAllowed(what: string, env: NodeJS.ProcessEnv = process.env): void {
  if (isDemoModeEnabled(env)) {
    throw new DemoModeBlockedError(what);
  }
}
