import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Query,
	UseGuards,
} from "@nestjs/common";
import { Public } from "@thallesp/nestjs-better-auth";
import { User } from "@/decorators/user.decorator";
import { pendingInvitationCodes } from "@/lib/auth";
import { CurrentUser } from "@/types/user";
import { InvitationsService } from "./invitations.service";
import { PermissionGuard, RequiredRoles } from "@/guards/permission.guard";
import { TenantGuard } from "@/guards/tenant.guard";
import { AuthGuard } from "@/guards/auth.guard";
import { UserRole } from "../../../prisma/generated/prisma/client";
import { CompanyMembershipService } from "@/modules/company-membership/company-membership.service";

@Controller("invitations")
export class InvitationsController {
	constructor(
		private readonly invitationsService: InvitationsService,
		private readonly companyMembershipService: CompanyMembershipService,
	) {}

	@Get("can-register")
	@Public()
	async canRegister(@Query("code") code?: string) {
		return this.invitationsService.canRegister(code);
	}

	@Get("is-first-user")
	@Public()
	async isFirstUser() {
		const isFirst = await this.invitationsService.isFirstUser();
		return { isFirstUser: isFirst };
	}

	@Post("validate")
	@Public()
	async validateInvitation(@Body() body: { code: string; email: string }) {
		if (!body.code || !body.email) {
			throw new BadRequestException("Code and email are required");
		}

		const result = await this.invitationsService.canRegister(body.code);

		if (!result.allowed) {
			throw new BadRequestException(
				result.message || "Invalid invitation code",
			);
		}

		pendingInvitationCodes.set(body.email.toLowerCase(), body.code);

		return { valid: true, message: "Invitation code validated" };
	}

	/**
	 * Create an invitation code for a specific company
	 * Only ADMIN and SUPERADMIN can create invitations
	 */
	@Post()
	@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
	@RequiredRoles(UserRole.ADMIN)
	async createInvitation(
		@User() user: CurrentUser & { currentCompanyId?: string },
		@Body() body: { companyId?: string; expiresInDays?: number },
	) {
		// Get companyId from body or user's current company
		const companyId = body.companyId || user.currentCompanyId;

		if (!companyId) {
			throw new BadRequestException("Company ID is required");
		}

		// Use the company membership service to create the invitation
		const invitation = await this.companyMembershipService.inviteUser(
			companyId,
			user.id,
			body.expiresInDays,
		);

		return {
			code: invitation.code,
			expiresAt: invitation.expiresAt,
			companyId,
		};
	}

	/**
	 * Join a company using an invitation code
	 */
	@Post("join")
	@UseGuards(AuthGuard)
	async joinCompany(
		@User() user: CurrentUser,
		@Body() body: { code: string },
	) {
		if (!body.code) {
			throw new BadRequestException("Invitation code is required");
		}

		const membership = await this.companyMembershipService.joinCompany(
			user.id,
			body.code,
		);

		return {
			companyId: membership.companyId,
			companyName: membership.company.name,
			role: membership.role,
		};
	}

	@Get()
	@UseGuards(AuthGuard)
	async listInvitations(@User() user: CurrentUser) {
		return this.invitationsService.listInvitations(user.id);
	}

	@Delete(":id")
	@UseGuards(AuthGuard)
	async deleteInvitation(@Param("id") id: string, @User() user: CurrentUser) {
		return this.invitationsService.deleteInvitation(id, user.id);
	}
}
