import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { logger } from "@/logger/logger.service";
import { UserRole } from "../../prisma/generated/prisma/client";
import { PrismaService } from "@/prisma/prisma.service";

/**
 * Decorator to specify required roles for a route
 */
import { SetMetadata } from "@nestjs/common";

export const REQUIRED_ROLES_KEY = "requiredRoles";
export const RequiredRoles = (...roles: UserRole[]) =>
	SetMetadata(REQUIRED_ROLES_KEY, roles);

/**
 * PermissionGuard checks if the user has the required role for the action.
 * Roles hierarchy: SUPERADMIN > ADMIN > USER
 * Use @RequiredRoles() decorator to specify required roles.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
	constructor(
		private reflector: Reflector,
		private prisma: PrismaService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
			REQUIRED_ROLES_KEY,
			[context.getHandler(), context.getClass()],
		);

		// If no roles are required, allow access
		if (!requiredRoles || requiredRoles.length === 0) {
			return true;
		}

		const request = context.switchToHttp().getRequest();
		const user = request.user;

		if (!user) {
			logger.error("PermissionGuard: No user found in request", {
				category: "auth",
			});
			throw new ForbiddenException("Authentication required");
		}

		// Get user's role for the current company context
		const companyId = request.companyId;
		const userRole = await this.getUserRoleInCompany(user.id, companyId);

		// Check if user has any of the required roles
		const hasPermission = requiredRoles.some((role) =>
			this.hasRole(userRole, role),
		);

		if (!hasPermission) {
			logger.error(
				`PermissionGuard: User lacks required role. Required: ${requiredRoles.join(", ")}, Got: ${userRole}`,
				{
					category: "auth",
					details: { userId: user.id, companyId },
				},
			);
			throw new ForbiddenException(
				`This action requires one of the following roles: ${requiredRoles.join(", ")}`,
			);
		}

		return true;
	}

	/**
	 * Get the user's role in a specific company
	 */
	private async getUserRoleInCompany(
		userId: string,
		companyId: string | null,
	): Promise<UserRole> {
		// SUPERADMIN has global access
		if (!companyId) {
			return UserRole.USER;
		}

		const userCompany = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId,
					companyId,
				},
			},
		});

		return userCompany?.role || UserRole.USER;
	}

	/**
	 * Check if userRole meets the required role level
	 * Hierarchy: SUPERADMIN > ADMIN > USER
	 */
	private hasRole(userRole: UserRole, requiredRole: UserRole): boolean {
		const roleHierarchy: Record<UserRole, number> = {
			[UserRole.USER]: 1,
			[UserRole.ADMIN]: 2,
			[UserRole.SUPERADMIN]: 3,
		};

		return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
	}
}
