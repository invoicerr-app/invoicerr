/**
 * Request-scoped `companyId`, threaded through `AsyncLocalStorage` rather than a parameter added to
 * every one of the several dozen call sites that write a `Log` row (`@/logger/logger.service.ts`) —
 * see that file's own header for why the write side needs this at all.
 *
 * Established by `CompanyContextInterceptor` (`@/interceptors/company-context.interceptor.ts`), never
 * by `AuthGuard` itself, even though `AuthGuard` is what actually RESOLVES `request.companyId` (both
 * for a session and for an API key). This split is not a style choice — a Guard's `canActivate`
 * cannot make an `AsyncLocalStorage.run()` call survive into the controller: Nest's own request
 * pipeline (Middleware → Guards → Interceptors → Pipes → Handler) treats a Guard's return value as a
 * plain boolean that its OWN internal orchestration `await`s and then acts on as a SEPARATE, LATER
 * continuation — nothing about wrapping `canActivate`'s own return statement in `run()` puts the
 * controller invocation "inside" that callback. Empirically checked (not just reasoned about) with a
 * minimal repro before writing this file: a guard-only `als.run(store, () => true)` loses the store by
 * the time a handler several `await`s downstream reads it back. An `Interceptor` runs strictly AFTER
 * every Guard and receives a `CallHandler` whose `next.handle()` — called synchronously, from inside
 * THIS module's own `run()` callback — is what actually triggers the controller. That is what makes
 * the context survive every subsequent `await`, however many services deep.
 *
 * BullMQ jobs, sweep runners, and pollers have no HTTP request and reach none of the above: they either
 * already carry `companyId` on every `logger.*()` call they make (added explicitly, at each call site,
 * next to the `details` object that already carried it for readability — see e.g.
 * `queue/document-authority-webhook.ts`), or — for the rare case a whole background unit of work is
 * scoped to one company from its very first line — call `runWithCompanyId` once, at their own entry
 * point.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  companyId: string | null;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Runs `fn` with `companyId` as the active request-scoped company for the rest of its own async
 * chain — a `logger.info/warn/error/debug()` call made from inside `fn` (however many awaits deep)
 * picks it up automatically unless it explicitly passes its own `companyId`.
 */
export function runWithCompanyId<T>(companyId: string | null, fn: () => T): T {
  return storage.run({ companyId }, fn);
}

/**
 * `null` both when no context was ever established (an instance-level boot path — see
 * `logger.service.ts`'s own header on why that is the CORRECT default for one, not a gap to paper
 * over) and when one WAS established for a request/job with no active company (a `@Public()` route,
 * e.g.). The two are indistinguishable from here on purpose — classifying which one applies is each
 * entry point's own job, not this generic accessor's.
 */
export function getContextCompanyId(): string | null {
  return storage.getStore()?.companyId ?? null;
}
