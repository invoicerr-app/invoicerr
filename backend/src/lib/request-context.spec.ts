/**
 * `runWithCompanyId`/`getContextCompanyId` in isolation — the `AsyncLocalStorage` wrapper every `Log`
 * write site relies on (`@/logger/logger.service.ts`'s own header). Covers the one property that
 * actually matters for this mechanism: the store survives an arbitrary number of `await`s and nested
 * async function calls made FROM INSIDE the wrapped callback, and two concurrent calls never see each
 * other's company — a plain module-level variable would fail both.
 */
import { getContextCompanyId, runWithCompanyId } from './request-context';

describe('runWithCompanyId / getContextCompanyId', () => {
  it('is null outside any established context', () => {
    expect(getContextCompanyId()).toBeNull();
  });

  it('makes the companyId visible for the duration of a synchronous callback', () => {
    const seen = runWithCompanyId('company-1', () => getContextCompanyId());
    expect(seen).toBe('company-1');
  });

  it('reverts to the outer context once the callback returns', () => {
    runWithCompanyId('company-1', () => undefined);
    expect(getContextCompanyId()).toBeNull();
  });

  it('survives several awaits and nested async function calls made from inside the callback', async () => {
    async function threeLevelsDeep(): Promise<string | null> {
      await Promise.resolve();
      return twoLevelsDeep();
    }
    async function twoLevelsDeep(): Promise<string | null> {
      await new Promise((resolve) => setImmediate(resolve));
      return oneLevelDeep();
    }
    async function oneLevelDeep(): Promise<string | null> {
      await Promise.resolve();
      return getContextCompanyId();
    }

    const seen = await runWithCompanyId('company-1', () => threeLevelsDeep());
    expect(seen).toBe('company-1');
    // The outer, un-wrapped scope never saw it either — this isn't a global leaking across tests.
    expect(getContextCompanyId()).toBeNull();
  });

  it('a nested runWithCompanyId shadows the outer one only for its own callback', async () => {
    const seenInsideInner: (string | null)[] = [];
    await runWithCompanyId('outer-company', async () => {
      seenInsideInner.push(getContextCompanyId());
      await runWithCompanyId('inner-company', async () => {
        await Promise.resolve();
        seenInsideInner.push(getContextCompanyId());
      });
      seenInsideInner.push(getContextCompanyId());
    });
    expect(seenInsideInner).toEqual(['outer-company', 'inner-company', 'outer-company']);
  });

  it('null is a real, distinct context (a @Public() request) — never confused with "no context at all"', () => {
    const seen = runWithCompanyId(null, () => getContextCompanyId());
    expect(seen).toBeNull();
  });

  it('two concurrent contexts never see the other one’s companyId', async () => {
    const results = await Promise.all([
      runWithCompanyId('company-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getContextCompanyId();
      }),
      runWithCompanyId('company-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getContextCompanyId();
      }),
    ]);
    expect(results).toEqual(['company-a', 'company-b']);
  });
});
