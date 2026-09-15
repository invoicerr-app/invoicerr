/**
 * The ONE decision behind `PAYMENT_PROVIDERS_REAL=1` — see `documents-core.module.ts
 * #buildPaymentProviderRegistry`'s own header for the full rationale (why the Fake clients exist under
 * `NODE_ENV=test` at all, and why this flag is the deliberately narrow escape hatch from that: it wires
 * the REAL Stripe/Mollie/PayPal clients into the RUNNING app under test, the one thing a `*.live.spec.ts`
 * process building `RealStripeCheckoutClient` itself can never prove — that the app's own boot path
 * actually does it).
 *
 * A standalone file, not a function inside `documents-core.module.ts` itself, on purpose: that module
 * file's own top-level imports pull in the ENTIRE documents wiring graph (every registry, `WebhooksModule`
 * and its drivers included) — fine for the app itself, but it means a jest spec that merely wants to
 * unit-test this one pure decision would drag all of that in too. Keeping it here lets
 * `should-use-real-clients.spec.ts` import nothing but this file.
 */
export function shouldUseRealPaymentClients(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== 'test') {
    // Outside test, behaviour is unchanged: always real. The flag has nothing to opt into here.
    return true;
  }
  return env.PAYMENT_PROVIDERS_REAL === '1';
}
