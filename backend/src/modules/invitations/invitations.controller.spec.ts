import 'reflect-metadata';

// `@thallesp/nestjs-better-auth`'s own package ships an ESM-only transitive dependency jest's
// ts-jest transform doesn't parse — mocked here the same way `legal.controller.spec.ts`/
// `public-documents.controller.spec.ts` already do (see those files' own headers for the full
// account), rather than widening jest's transformIgnorePatterns for one decorator.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

const setPendingInvitationCode = jest.fn().mockResolvedValue(undefined);

// This controller opens its OWN Redis-backed store at module scope (see its own header comment on
// why) — mocked here so importing it, or calling `validateInvitation`, never touches a real socket in
// a plain `jest` run (this codebase's convention gates any REAL-Redis spec behind an explicit env flag,
// see e.g. `modules/documents/queue/__tests__/*.redis.spec.ts`'s own header).
jest.mock('@/lib/pending-signup-store', () => ({
  createRedisClientForPendingSignups: jest.fn(),
  createPendingSignupStore: jest.fn(() => ({ setPendingInvitationCode })),
}));

import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

function buildController() {
  const service = {
    canRegister: jest.fn(),
    isFirstUser: jest.fn(),
    createInvitation: jest.fn(),
    listInvitations: jest.fn(),
    deleteInvitation: jest.fn(),
  } as unknown as InvitationsService;
  return { controller: new InvitationsController(service), service };
}

describe('InvitationsController.validateInvitation', () => {
  beforeEach(() => setPendingInvitationCode.mockClear());

  it('deposits the code into the shared, cross-replica store — never a local Map any more', async () => {
    const { controller, service } = buildController();
    (service.canRegister as jest.Mock).mockResolvedValue({ allowed: true, requiresCode: false });

    await controller.validateInvitation({ code: 'CODE123', email: 'Ada@Acme.test' });

    expect(setPendingInvitationCode).toHaveBeenCalledWith('ada@acme.test', 'CODE123');
  });
});

describe('InvitationsController.isFirstUser — throttled like sso-lookup', () => {
  it('carries the same @Throttle budget as the SSO lookup route (10/minute)', () => {
    const method = InvitationsController.prototype.isFirstUser;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', method)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', method)).toBe(60_000);
  });
});
