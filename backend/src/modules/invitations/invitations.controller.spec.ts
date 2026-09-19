import { vi, type Mock } from 'vitest';

import 'reflect-metadata';

// `@thallesp/nestjs-better-auth`'s own package ships an ESM-only transitive dependency jest's
// ts-jest transform doesn't parse — mocked here the same way `legal.controller.spec.ts`/
// `public-documents.controller.spec.ts` already do (see those files' own headers for the full
// account), rather than widening jest's transformIgnorePatterns for one decorator.
vi.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

// `vi.hoisted()`, not a plain `const` (even a `mock`-prefixed one, which is normally enough — see
// e.g. `modules/documents/actions/invoice-b2g-chorus-pro-send.spec.ts`'s own comment on that
// convention): `invitations.controller.ts` calls `createPendingSignupStore(...)` EAGERLY, at ITS
// OWN module top level (see its own header comment on why), and real ESM evaluates a statically
// imported dependency to completion BEFORE the importing file's own top-level statements run — so
// by the time this controller module (a dependency of this spec file, imported below) actually
// CALLS the mocked factory, a plain `const` declared here would still be in its temporal dead zone,
// "mock" prefix or not. Under Jest's CJS transpilation this was never a problem (`require()` executes
// inline, in written order, so the const above a `jest.mock()` call always ran first) — confirmed by
// reverting this to a plain `const` during this migration: it reproduces "Cannot access
// 'mockSetPendingInvitationCode' before initialization" every time. `vi.hoisted()` is hoisted (and
// RUN) before any module evaluation at all, dependencies included, closing that race for good.
const { mockSetPendingInvitationCode } = vi.hoisted(() => ({
  mockSetPendingInvitationCode: vi.fn().mockResolvedValue(undefined),
}));

// This controller opens its OWN Redis-backed store at module scope (see its own header comment on
// why) — mocked here so importing it, or calling `validateInvitation`, never touches a real socket in
// a plain `jest` run (this codebase's convention gates any REAL-Redis spec behind an explicit env flag,
// see e.g. `modules/documents/queue/__tests__/*.redis.spec.ts`'s own header).
vi.mock('@/lib/pending-signup-store', () => ({
  createRedisClientForPendingSignups: vi.fn(),
  createPendingSignupStore: vi.fn(() => ({ setPendingInvitationCode: mockSetPendingInvitationCode })),
}));

import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

function buildController() {
  const service = {
    canRegister: vi.fn(),
    isFirstUser: vi.fn(),
    createInvitation: vi.fn(),
    listInvitations: vi.fn(),
    deleteInvitation: vi.fn(),
  } as unknown as InvitationsService;
  return { controller: new InvitationsController(service), service };
}

describe('InvitationsController.validateInvitation', () => {
  beforeEach(() => mockSetPendingInvitationCode.mockClear());

  it('deposits the code into the shared, cross-replica store — never a local Map any more', async () => {
    const { controller, service } = buildController();
    (service.canRegister as Mock).mockResolvedValue({ allowed: true, requiresCode: false });

    await controller.validateInvitation({ code: 'CODE123', email: 'Ada@Acme.test' });

    expect(mockSetPendingInvitationCode).toHaveBeenCalledWith('ada@acme.test', 'CODE123');
  });
});

describe('InvitationsController.isFirstUser — throttled like sso-lookup', () => {
  it('carries the same @Throttle budget as the SSO lookup route (10/minute)', () => {
    const method = InvitationsController.prototype.isFirstUser;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', method)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', method)).toBe(60_000);
  });
});
