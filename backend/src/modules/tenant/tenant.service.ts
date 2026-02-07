import { Injectable, Scope } from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { PrismaService } from "@/prisma/prisma.service";
import { UserRole } from "../../../prisma/generated/prisma/client";

/**
 * TenantContext holds the current tenant context for the request
 * This is a request-scoped service that is unique per request
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContext {
	private _companyId: string | null = null;
	private _userId: string | null = null;
	private _userRole: UserRole = UserRole.USER;
	private _isSuperAdmin = false;

	setContext(
		companyId: string | null,
		userId: string,
		userRole: UserRole,
		isSuperAdmin: boolean,
	) {
		this._companyId = companyId;
		this._userId = userId;
		this._userRole = userRole;
		this._isSuperAdmin = isSuperAdmin;
	}

	get companyId(): string | null {
		return this._companyId;
	}

	get userId(): string | null {
		return this._userId;
	}

	get userRole(): UserRole {
		return this._userRole;
	}

	get isSuperAdmin(): boolean {
		return this._isSuperAdmin;
	}

	/**
	 * Check if the current user can access data for the given company
	 */
	canAccessCompany(companyId: string): boolean {
		if (this._isSuperAdmin) return true;
		return this._companyId === companyId;
	}

	/**
	 * Get the where clause for Prisma queries
	 * Returns an empty object for SUPERADMIN (no filtering)
	 * Returns { companyId: ... } for regular users
	 */
	getCompanyFilter(): { companyId?: string } {
		if (this._isSuperAdmin || !this._companyId) {
			return {};
		}
		return { companyId: this._companyId };
	}
}

/**
 * TenantService provides methods for tenant-related operations
 */
@Injectable()
export class TenantService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Get the current company from the request context
	 */
	async getCurrentCompany(companyId: string) {
		return this.prisma.company.findUnique({
			where: { id: companyId },
			include: {
				pdfConfig: true,
				members: {
					include: {
						user: {
							select: {
								id: true,
								email: true,
								firstname: true,
								lastname: true,
							},
						},
					},
				},
			},
		});
	}

	/**
	 * Get user's role in a specific company
	 */
	async getUserRoleInCompany(
		userId: string,
		companyId: string,
	): Promise<UserRole | null> {
		// Check if user is the first user (SUPERADMIN)
		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});

		if (firstUser?.id === userId) {
			return UserRole.SUPERADMIN;
		}

		const userCompany = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId,
					companyId,
				},
			},
		});

		return userCompany?.role || null;
	}

	/**
	 * Check if user has the required permission level
	 */
	async hasPermission(
		userId: string,
		companyId: string,
		requiredRole: UserRole,
	): Promise<boolean> {
		const userRole = await this.getUserRoleInCompany(userId, companyId);

		if (!userRole) {
			return false;
		}

		const roleHierarchy: Record<UserRole, number> = {
			[UserRole.USER]: 1,
			[UserRole.ADMIN]: 2,
			[UserRole.SUPERADMIN]: 3,
		};

		return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
	}

	/**
	 * Check if user is SUPERADMIN
	 */
	async isSuperAdmin(userId: string): Promise<boolean> {
		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});

		return firstUser?.id === userId;
	}

	/**
	 * Build a where clause with company filter
	 * SUPERADMIN gets no filter, regular users get their companyId
	 */
	buildWhereClause(
		baseWhere: Record<string, any>,
		companyId: string | null,
		isSuperAdmin: boolean,
	): Record<string, any> {
		if (isSuperAdmin || !companyId) {
			return baseWhere;
		}

		return {
			...baseWhere,
			companyId,
		};
	}
}
