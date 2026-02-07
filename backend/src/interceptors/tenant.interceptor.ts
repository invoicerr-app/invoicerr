import {
	Injectable,
	NestInterceptor,
	ExecutionContext,
	CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { TenantContext } from "@/modules/tenant/tenant.service";
import { PrismaService } from "@/prisma/prisma.service";
import { UserRole } from "../../prisma/generated/prisma/client";

/**
 * TenantInterceptor automatically sets the tenant context for each request.
 * It extracts companyId from the request and determines the user's role.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
	constructor(
		private readonly tenantContext: TenantContext,
		private readonly prisma: PrismaService,
	) {}

	async intercept(
		context: ExecutionContext,
		next: CallHandler,
	): Promise<Observable<any>> {
		const request = context.switchToHttp().getRequest();
		const user = request.user;

		if (user) {
			// Check if user is super admin
			const firstUser = await this.prisma.user.findFirst({
				orderBy: { createdAt: "asc" },
			});
			const isSuperAdmin = firstUser?.id === user.id;

			// Get companyId from request
			const companyId =
				request.body?.companyId ||
				request.query?.companyId ||
				request.params?.companyId ||
				user.currentCompanyId;

			// Determine user role
			let userRole: UserRole = UserRole.USER;
			if (isSuperAdmin) {
				userRole = UserRole.SUPERADMIN;
			} else if (companyId) {
				const membership = await this.prisma.userCompany.findUnique({
					where: {
						userId_companyId: {
							userId: user.id,
							companyId,
						},
					},
				});
				if (membership) {
					userRole = membership.role;
				}
			}

			// Set tenant context
			this.tenantContext.setContext(
				companyId || null,
				user.id,
				userRole,
				isSuperAdmin,
			);

			// Attach to request for guards to use
			request.companyId = companyId || null;
			request.isSuperAdmin = isSuperAdmin;
			request.userRole = userRole;
		}

		return next.handle();
	}
}
