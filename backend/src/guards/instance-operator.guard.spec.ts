import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { BILLING_FLAG_NAME } from '@/modules/billing/billing-flag';
import { InstanceOperatorGuard } from './instance-operator.guard';

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

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
    const context = contextFor({ user: { email: 'ops@example.test' }, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('is case-insensitive against the allowlist', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'OPS@EXAMPLE.TEST' }, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('refuses a caller whose e-mail is not on the allowlist', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'someone-else@example.test' }, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses EVERY caller when INSTANCE_OPERATOR_EMAILS is unset — no operator by default', () => {
    delete process.env.INSTANCE_OPERATOR_EMAILS;
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'ops@example.test' }, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('refuses API-key auth outright, even for an operator email, even with an empty scopes array', () => {
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'ops@example.test' }, scopes: [] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // Deliberately UNAFFECTED by billing mode — this guard is shared with GET /api/backup/status, which
  // must keep answering for a real operator on SaaS too (see this guard's own header, and
  // `instance-reset-saas.guard.ts` for where the reset flow's OWN SaaS masking actually lives).
  it('still lets a real operator through when billing (SaaS) is enabled', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'ops@example.test' }, scopes: null });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('still refuses a non-operator when billing (SaaS) is enabled — not a 404, a 403', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const guard = new InstanceOperatorGuard();
    const context = contextFor({ user: { email: 'someone-else@example.test' }, scopes: null });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
