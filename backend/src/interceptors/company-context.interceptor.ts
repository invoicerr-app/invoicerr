/**
 * Establishes the request-scoped `companyId` (`@/lib/request-context.ts` — read that file's own header
 * first for why this is an Interceptor and not `AuthGuard` itself) for every `Log` write this request
 * triggers, however many services/awaits downstream. Reads `request.companyId`, never re-resolves it:
 * `AuthGuard` (a Guard, and Nest guarantees every Guard runs before every Interceptor) already did that
 * work, for both the session and the API-key path — this must never become a second, divergent source
 * of truth for "which company is this request acting as".
 *
 * `request.companyId` is `undefined` for a `@Public()` route (`AuthGuard` returns early, before ever
 * touching it) — `?? null` is still the right call for that case: it establishes an EXPLICIT `null`
 * context rather than leaving whatever a Node.js worker thread's Async Context happened to hold before
 * (there is no such leftover in practice — a fresh continuation per request — but an explicit context
 * is the honest way to say "no active company" rather than relying on an absence).
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

import { runWithCompanyId } from '@/lib/request-context';
import { RequestWithUser } from '@/types/request';

@Injectable()
export class CompanyContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return new Observable((subscriber) => {
      runWithCompanyId(request.companyId ?? null, () => {
        // `next.handle()` is called SYNCHRONOUSLY here, inside `runWithCompanyId`'s own callback — this
        // is what actually invokes the controller (and everything it calls) from within the
        // AsyncLocalStorage boundary. Forwarding next/error/complete by hand (rather than returning
        // `next.handle()` directly) is what keeps this working for a plain request/response AND for a
        // long-lived multi-emission stream alike (`logger.controller.ts`'s own `@Sse()` route) — the
        // subscription itself, including whatever timer an `interval()` pipe sets up, is created while
        // this callback is on the stack, so every later tick still resolves the same store.
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (error) => subscriber.error(error),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
