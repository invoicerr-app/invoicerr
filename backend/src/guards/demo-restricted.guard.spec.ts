import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { DemoRestrictedGuard } from './demo-restricted.guard';
import { DemoModeBlockedError } from '@/modules/demo/demo-blocked';

function fakeContext(): ExecutionContext {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
  } as ExecutionContext;
}

describe('DemoRestrictedGuard (issue #533)', () => {
  it('allows a route with no @DemoRestricted() metadata', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = new DemoRestrictedGuard(reflector);

    expect(guard.canActivate(fakeContext())).toBe(true);
  });

  it('refuses a route carrying @DemoRestricted()', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new DemoRestrictedGuard(reflector);

    expect(() => guard.canActivate(fakeContext())).toThrow(DemoModeBlockedError);
  });

  // This guard is only ever REGISTERED when demo mode is on (`global-guards.ts`'s own
  // `demoModeEnabled` conditional), so unlike `assertDemoSendingAllowed`, it never re-checks
  // `isDemoModeEnabled()` itself. Documented here so the assumption stays visible next to the code
  // that relies on it.
  it('does not itself read DEMO_MODE: refusal is unconditional once the route is marked', () => {
    const reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const guard = new DemoRestrictedGuard(reflector);

    const originalEnv = process.env.DEMO_MODE;
    delete process.env.DEMO_MODE;
    try {
      expect(() => guard.canActivate(fakeContext())).toThrow(DemoModeBlockedError);
    } finally {
      if (originalEnv === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = originalEnv;
    }
  });
});
