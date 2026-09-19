import { SetMetadata } from '@nestjs/common';

import { CompanyRole } from '../../prisma/generated/prisma/client';

export const ROLES_KEY = 'roles';

// Restricts a handler/controller to callers whose active-company role is
// one of the given roles. Enforced by RolesGuard (src/guards/roles.guard.ts).
export const Roles = (...roles: CompanyRole[]) => SetMetadata(ROLES_KEY, roles);
