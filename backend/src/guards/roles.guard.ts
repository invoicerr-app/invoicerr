import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@/decorators/roles.decorator';
import { RequestWithUser } from '@/types/request';

// Runs after the global AuthGuard (which always populates request.role),
// so it can safely assume request.role is set whenever this guard runs.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) { }

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<CompanyRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest() as RequestWithUser;
    if (!request.role || !requiredRoles.includes(request.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
