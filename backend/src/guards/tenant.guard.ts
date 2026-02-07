import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { PrismaService } from "@/prisma/prisma.service";
import { UserRole } from "../../prisma/generated/prisma/client";

@Injectable()
export class TenantGuard implements CanActivate {
	constructor(private readonly prisma: PrismaService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		const user = request.user;

		if (!user) {
			logger.error("TenantGuard: No user found in request", {
				category: "auth",
			});
			throw new UnauthorizedException("Authentication required");
		}

		// SUPERADMIN can access without companyId filter
		if (user.role === "SUPERADMIN" || user.isSuperAdmin) {
			request.companyId = null;
			request.isSuperAdmin = true;
			return true;
		}

		// Skip company check for certain endpoints that don't require a company
		const url = request.url || "";
		const isSwitchEndpoint = url.includes("/company/switch");
		const skipCompanyCheck =
			url.includes("/company/my-companies") ||
			url.includes("/company/info") ||
			isSwitchEndpoint;

		// Check for currentCompanyId in headers, body, query, params, or user object
		let companyId =
			request.headers["x-company-id"] ||
			request.body?.companyId ||
			request.query?.companyId ||
			request.params?.companyId ||
			user.currentCompanyId;

		// For endpoints that skip company check, don't require companyId
		if (skipCompanyCheck) {
			// Allow access without companyId for these endpoints
			request.companyId = companyId;
			request.headers["x-company-id"] = companyId || "";
			request.isSuperAdmin = false;
			return true;
		}

		// If no companyId found, automatically select the first company
		if (!companyId) {
			// Fetch user's companies from database (JWT might not have them)
			const userCompanies = await this.prisma.userCompany.findMany({
				where: { userId: user.id },
				include: { company: true },
			});

			if (userCompanies.length === 0) {
				// Migration: Link user to an existing company
				logger.warn("TenantGuard: User has no company memberships, auto-linking", {
					category: "auth",
					details: { userId: user.id },
				});

				await this.ensureUserHasCompany(user.id);

				// Refresh userCompanies after linking
				const refreshedCompanies = await this.prisma.userCompany.findMany({
					where: { userId: user.id },
					include: { company: true },
				});

				// Check if this user is SUPERADMIN (first user in system)
				const firstUser = await this.prisma.user.findFirst({
					orderBy: { createdAt: "asc" },
					select: { id: true },
				});
				if (firstUser?.id === user.id) {
					request.isSuperAdmin = true;
					request.companyId = null;
					request.headers["x-company-id"] = "";
					return true;
				}

				// If still no company, allow access for onboarding
				if (refreshedCompanies.length === 0) {
					logger.info("TenantGuard: No companies in system, allowing access for onboarding", {
						category: "auth",
						details: { userId: user.id },
					});
					request.companyId = null;
					request.headers["x-company-id"] = "";
					request.isSuperAdmin = false;
					return true;
				}

				companyId = refreshedCompanies[0].companyId;
			} else {
				companyId = userCompanies[0].companyId;
			}

			logger.info("TenantGuard: Auto-selected first company for user", {
				category: "auth",
				details: { userId: user.id, companyId },
			});
		}

		// For switch endpoint, skip access check
		if (isSwitchEndpoint) {
			request.companyId = companyId;
			request.headers["x-company-id"] = companyId || "";
			request.isSuperAdmin = false;
			return true;
		}

		// Verify user has access to this company
		const hasAccess = await this.checkUserHasAccess(user.id, companyId);

		if (!hasAccess) {
			logger.error("TenantGuard: User does not have access to company", {
				category: "auth",
				details: { userId: user.id, companyId },
			});
			throw new UnauthorizedException("You do not have access to this company");
		}

		// Attach companyId to request for downstream use
		request.companyId = companyId;
		request.headers["x-company-id"] = companyId || "";
		request.isSuperAdmin = false;

		return true;
	}

	private async checkUserHasAccess(userId: string, companyId: string): Promise<boolean> {
		const membership = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId,
					companyId,
				},
			},
		});
		return !!membership;
	}

	private async ensureUserHasCompany(userId: string): Promise<void> {
		// Check if this is the first user in the system (should be SUPERADMIN)
		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
			select: { id: true },
		});
		const isFirstUser = firstUser?.id === userId;
		const role = isFirstUser ? UserRole.SUPERADMIN : UserRole.ADMIN;

		// Try to find any existing company the user might be associated with
		const invitations = await this.prisma.invitationCode.findMany({
			where: { createdById: userId },
			take: 1,
		});

		if (invitations.length > 0 && invitations[0].companyId) {
			const existingMembership = await this.prisma.userCompany.findUnique({
				where: {
					userId_companyId: {
						userId,
						companyId: invitations[0].companyId,
					},
				},
			});

			if (!existingMembership) {
				await this.prisma.userCompany.create({
					data: {
						userId,
						companyId: invitations[0].companyId,
						role,
					},
				});
			}
			return;
		}

		// Check if there are existing companies in the system
		const existingCompanies = await this.prisma.company.findMany({
			take: 1,
			orderBy: { foundedAt: "asc" },
		});

		if (existingCompanies.length > 0) {
			const existingCompany = existingCompanies[0];
			const existingMembership = await this.prisma.userCompany.findUnique({
				where: {
					userId_companyId: {
						userId,
						companyId: existingCompany.id,
					},
				},
			});

			if (!existingMembership) {
				await this.prisma.userCompany.create({
					data: {
						userId,
						companyId: existingCompany.id,
						role,
					},
				});
				logger.info("TenantGuard: Linked user to existing company", {
					category: "auth",
					details: { userId, companyId: existingCompany.id, role },
				});
			}
			return;
		}
	}
}
