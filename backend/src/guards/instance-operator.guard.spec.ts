import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { BILLING_FLAG_NAME } from '@/modules/billing/billing-flag';
import { InstanceOperatorGuard } from './instance-operator.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** A real operator: on the allowlist AND holding an address he has actually proven he owns. The
 *  second half is not decoration on this fixture — see the guard's own header for what a row with
 *  `emailVerified: false` costs. */
const VERIFIED_OPERATOR = { email: 'ops@example.test', emailVerified: true };

describe('InstanceOperatorGuard', () => {
  const originalOperatorEmails = process.env.INSTANCE_OPERATOR_EMAILS;
  const originalBillingFlag = process.env[BILLING_FLAG_NAME];

  beforeEach(() => {
    process.env.INSTANCE_OPERATOR_EMAILS = 'ops@example.test';
    delete process.env[BILLING_FLAG_NAME];
  });

  afterEach(() => {
    if (originalOperatorEmails === undefined) delete process.env.INSTANCE_OPERATOR_EMAILS;
    else process.env.INSTANCE_OPERATOR_EMAILS = originalOperatorEmails;
    if (originalBillingFlag === undefined) delete process.env[BILLING_FLAG_NAME];
    else process.env[BILLING_FLAG_NAME] = originalBillingFlag;
  });

  it('lets an instance operator on a real session through', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: VERIFIED_OPERATOR, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('is case-insensitive against the allowlist', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { ...VERIFIED_OPERATOR, email: 'OPS@EXAMPLE.TEST' }, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses a caller whose e-mail is not on the allowlist', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({
      user: { email: 'someone-else@example.test', emailVerified: true },
      scopes: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses EVERY caller when INSTANCE_OPERATOR_EMAILS is unset — no operator by default', () => {
    delete process.env.INSTANCE_OPERATOR_EMAILS;
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: VERIFIED_OPERATOR, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses API-key auth outright, even for an operator email, even with an empty scopes array', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: VERIFIED_OPERATOR, scopes: [] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // Deliberately UNAFFECTED by billing mode — this guard is shared with GET /api/backup/status, which
  // must keep answering for a real operator on SaaS too (see this guard's own header, and
  // `instance-reset-saas.guard.ts` for where the reset flow's OWN SaaS masking actually lives).
  it('still lets a real operator through when billing (SaaS) is enabled', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: VERIFIED_OPERATOR, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still refuses a non-operator when billing (SaaS) is enabled — not a 404, a 403', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const guard = new InstanceOperatorGuard();
    const context = contextFor({
      user: { email: 'someone-else@example.test', emailVerified: true },
      scopes: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // The address on the allowlist, held by an account that never proved it owns it. Reachable by
  // anyone at all: sign-up is open by default and writes `emailVerified: false`, so on every
  // instance this is the state of an account created between the moment an operator puts his address
  // in the environment and the moment he registers it himself.
  it('refuses the operator address held by an account that never verified it', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({
      user: { email: 'ops@example.test', emailVerified: false },
      scopes: null,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // A `User` row predating the column, or any caller shape that simply does not carry the field:
  // "absent" must read as "not proven", never as "no reason to refuse".
  it('refuses the operator address when the verified flag is absent altogether', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'ops@example.test' }, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // Nothing but `true` passes — a truthy string or a 1 from a loosely-typed caller is not a boolean
  // this guard is willing to read as proof.
  it('refuses a merely truthy verified flag', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'ops@example.test', emailVerified: 'yes' }, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // One message for both halves of the second refusal: an unverified caller AT the operator address
  // must not be able to tell his 403 apart from a stranger's, or the guard answers "is this the
  // operator's address?" for exactly the caller who wants to know.
  it('gives an unverified operator address and a stranger the same refusal, telling them apart in no way', () => {
    const guard = new InstanceOperatorGuard();
    const unverifiedOperator = contextFor({
      user: { email: 'ops@example.test', emailVerified: false },
      scopes: null,
    });
    const stranger = contextFor({
      user: { email: 'someone-else@example.test', emailVerified: true },
      scopes: null,
    });

    const messageFrom = (context: ExecutionContext): string => {
      try {
        guard.canActivate(context);
      } catch (error) {
        return (error as ForbiddenException).message;
      }
      throw new Error('expected a refusal');
    };

    expect(messageFrom(unverifiedOperator)).toBe(messageFrom(stranger));
  });
});
