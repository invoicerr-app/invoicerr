/**
 * `CompanyContextInterceptor` against a fake `ExecutionContext`/`CallHandler` — no real Nest app or
 * HTTP server, the same lightweight style `guards/auth.guard.spec.ts` already uses for the sibling
 * piece of this mechanism. What matters here is exactly the property a plain unit test on
 * `request-context.ts` alone cannot prove: that `next.handle()` — the actual controller invocation, in
 * a real app — runs WITH the context established, several `await`s deep, the same way
 * `@/lib/request-context.ts`'s own header documents a bare Guard could not achieve.
 */
import { ExecutionContext } from '@nestjs/common';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';

import { CompanyContextInterceptor } from './company-context.interceptor';
import { getContextCompanyId } from '@/lib/request-context';

function contextWithCompanyId(companyId: string | null | undefined): ExecutionContext {
  const request = companyId === undefined ? {} : { companyId };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CompanyContextInterceptor', () => {
  let interceptor: CompanyContextInterceptor;

  beforeEach(() => {
    interceptor = new CompanyContextInterceptor();
  });

  it('makes the active companyId visible from inside next.handle(), several awaits deep', async () => {
    async function threeLevelsDeep(): Promise<string | null> {
      await Promise.resolve();
      return twoLevelsDeep();
    }
    async function twoLevelsDeep(): Promise<string | null> {
      await new Promise((resolve) => setImmediate(resolve));
      return getContextCompanyId();
    }

    const next = { handle: () => new Observable((sub) => void threeLevelsDeep().then((v) => sub.next(v))) };
    const result = await firstValueFrom(
      interceptor.intercept(contextWithCompanyId('company-1'), next) as Observable<string | null>,
    );
    expect(result).toBe('company-1');
  });

  it('establishes an explicit null context for a @Public() route (no companyId on the request)', async () => {
    const next = { handle: () => of(getContextCompanyId()) };
    const result = await firstValueFrom(
      interceptor.intercept(contextWithCompanyId(undefined), next) as Observable<string | null>,
    );
    expect(result).toBeNull();
  });

  it('forwards multiple emissions — the SSE / long-lived-stream shape', async () => {
    const next = { handle: () => of(1, 2, 3) };
    const emitted: number[] = [];
    await new Promise<void>((resolve) => {
      (interceptor.intercept(contextWithCompanyId('company-1'), next) as Observable<number>).subscribe({
        next: (v) => emitted.push(v),
        complete: resolve,
      });
    });
    expect(emitted).toEqual([1, 2, 3]);
  });

  it('forwards an error from next.handle() unchanged', async () => {
    const boom = new Error('handler failed');
    const next = { handle: () => throwError(() => boom) };
    await expect(
      firstValueFrom(interceptor.intercept(contextWithCompanyId('company-1'), next) as Observable<unknown>),
    ).rejects.toBe(boom);
  });

  it('reverts to no context once the request finishes — never leaks into the next one', async () => {
    const next = { handle: () => of(null) };
    await firstValueFrom(
      interceptor.intercept(contextWithCompanyId('company-1'), next) as Observable<unknown>,
    );
    expect(getContextCompanyId()).toBeNull();
  });
});
