import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	ForbiddenException,
} from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { PrismaService } from "@/prisma/prisma.service";

/**
 * SuperAdminGuard verifies that the user is the first user in the database (SUPERADMIN).
 * SUPERADMIN has special access to all companies and admin features.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
	constructor(private readonly prisma: PrismaService) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		const user = request.user;

		if (!user) {
			logger.error("SuperAdminGuard: No user found in request", {
				category: "auth",
			});
			throw new ForbiddenException("Authentication required");
		}

		// Check if user is marked as superadmin from JWT
		if (user.role === "SUPERADMIN" || user.isSuperAdmin) {
			request.isSuperAdmin = true;
			return true;
		}

		// Verify from database - check if this is the first user
		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});

		const isSuperAdmin = firstUser?.id === user.id;

		if (!isSuperAdmin) {
			logger.error("SuperAdminGuard: User is not the super admin", {
				category: "auth",
				details: { userId: user.id },
			});
			throw new ForbiddenException(
				"This action requires super administrator privileges",
			);
		}

		request.isSuperAdmin = true;

		logger.info("SuperAdminGuard: Super admin access granted", {
			category: "auth",
			details: { userId: user.id },
		});

		return true;
	}
}
