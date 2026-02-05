import { SetMetadata } from '@nestjs/common';
import type { UserCompanyRole } from '../../prisma/generated/prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for accessing a route.
 * Used with RoleGuard to enforce role-based access control.
 *
 * @example
 * ```typescript
 * @Roles('OWNER', 'ADMIN')
 * @Get('settings')
 * getSettings() { ... }
 * ```
 */
export const Roles = (...roles: UserCompanyRole[]) => SetMetadata(ROLES_KEY, roles);
