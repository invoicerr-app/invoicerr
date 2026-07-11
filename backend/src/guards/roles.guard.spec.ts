import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/guards/roles.guard';

function createContext(role: CompanyRole | null): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ role }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  function createGuard(requiredRoles: CompanyRole[] | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;
    return new RolesGuard(reflector);
  }

  it('allows the request when no @Roles() metadata is present', () => {
    const guard = createGuard(undefined);
    expect(guard.canActivate(createContext(null))).toBe(true);
  });

  it('allows the request when @Roles() is an empty array', () => {
    const guard = createGuard([]);
    expect(guard.canActivate(createContext(CompanyRole.MEMBER))).toBe(true);
  });

  it('allows the request when the caller role is in the required list', () => {
    const guard = createGuard([CompanyRole.OWNER, CompanyRole.ADMIN]);
    expect(guard.canActivate(createContext(CompanyRole.ADMIN))).toBe(true);
  });

  it('rejects the request when the caller role is not in the required list', () => {
    const guard = createGuard([CompanyRole.OWNER]);
    expect(() => guard.canActivate(createContext(CompanyRole.MEMBER))).toThrow(ForbiddenException);
  });

  it('rejects the request when the caller has no active-company role at all', () => {
    const guard = createGuard([CompanyRole.OWNER, CompanyRole.ADMIN]);
    expect(() => guard.canActivate(createContext(null))).toThrow(ForbiddenException);
  });
});
