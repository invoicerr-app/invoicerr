import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserCompanyRole } from '../../prisma/generated/prisma/client';
import { ROLES_KEY } from '@/decorators/roles.decorator';
import type { RequestWithUser } from '@/types/request';

/**
 * Role hierarchy: higher roles include permissions of lower roles
 * SYSTEM_ADMIN > OWNER > ADMIN > ACCOUNTANT
 */
const ROLE_HIERARCHY: Record<UserCompanyRole, number> = {
  SYSTEM_ADMIN: 4,
  OWNER: 3,
  ADMIN: 2,
  ACCOUNTANT: 1,
};

/**
 * Guard that validates user roles for company operations.
 * Must be used after CompanyGuard to have access to companyContext.
 *
 * Supports role hierarchy: a user with OWNER role can access routes
 * that require ADMIN or ACCOUNTANT roles.
 *
 * @example
 * ```typescript
 * @UseGuards(CompanyGuard, RoleGuard)
 * @Roles('ADMIN', 'OWNER')
 * @Delete(':id')
 * deleteInvoice() { ... }
 * ```
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserCompanyRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest() as RequestWithUser;
    const user = request.user;

    // System admin always has access
    if (user?.isSystemAdmin) {
      return true;
    }

    const companyContext = request.companyContext;

    if (!companyContext) {
      throw new ForbiddenException(
        'Company context is required. Apply CompanyGuard before RoleGuard.',
      );
    }

    const userRole = companyContext.role;
    const userRoleLevel = ROLE_HIERARCHY[userRole];

    // Check if user's role level is sufficient for any of the required roles
    const hasRequiredRole = requiredRoles.some((requiredRole) => {
      const requiredRoleLevel = ROLE_HIERARCHY[requiredRole];
      return userRoleLevel >= requiredRoleLevel;
    });

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        `Insufficient permissions. Required roles: ${requiredRoles.join(', ')}. Your role: ${userRole}`,
      );
    }

    return true;
  }
}
