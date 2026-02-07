import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { PrismaService } from "@/prisma/prisma.service";
import {
	UserRole,
	type UserCompany,
} from "../../../prisma/generated/prisma/client";

export interface UserCompanyWithDetails extends UserCompany {
	company: {
		id: string;
		name: string;
		email: string;
		currency: string;
	};
}

export interface CompanyMember {
	id: string;
	email: string;
	firstname: string;
	lastname: string;
	role: UserRole;
	joinedAt: Date;
}

/**
 * CompanyMembershipService handles all company membership operations
 * including switching companies, inviting users, and managing members.
 */
@Injectable()
export class CompanyMembershipService {
	constructor(private readonly prisma: PrismaService) {}

	/**
	 * Get all companies for a user with their roles
	 */
	async getUserCompanies(
		userId: string,
	): Promise<UserCompanyWithDetails[]> {
		const memberships = await this.prisma.userCompany.findMany({
			where: { userId },
			include: {
				company: {
					select: {
						id: true,
						name: true,
						email: true,
						currency: true,
					},
				},
			},
			orderBy: { createdAt: "desc" },
		});

		return memberships as UserCompanyWithDetails[];
	}

	/**
	 * Switch the active company for a user
	 * Returns the new active company details
	 */
	async switchCompany(
		userId: string,
		companyId: string,
	): Promise<UserCompanyWithDetails> {
		// Verify user has access to this company
		const membership = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId,
					companyId,
				},
			},
			include: {
				company: {
					select: {
						id: true,
						name: true,
						email: true,
						currency: true,
					},
				},
			},
		});

		if (!membership) {
			logger.error(
				"CompanyMembershipService: User tried to switch to unauthorized company",
				{
					category: "auth",
					details: { userId, companyId },
				},
			);
			throw new ForbiddenException(
				"You do not have access to this company",
			);
		}

		logger.info("CompanyMembershipService: Switched company", {
			category: "auth",
			details: { userId, companyId },
		});

		return membership as UserCompanyWithDetails;
	}

	/**
	 * Create an invitation code for a user to join a company
	 * Only ADMIN and SUPERADMIN can create invitations
	 */
	async inviteUser(
		companyId: string,
		invitedByUserId: string,
		expiresInDays = 7,
	): Promise<{ code: string; expiresAt: Date }> {
		// Verify the inviter has ADMIN or SUPERADMIN role in this company
		const inviterMembership = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId: invitedByUserId,
					companyId,
				},
			},
		});

		// Also check if inviter is SUPERADMIN (first user)
		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});
		const isSuperAdmin = firstUser?.id === invitedByUserId;

		if (
			!isSuperAdmin &&
			(!inviterMembership || inviterMembership.role !== UserRole.ADMIN)
		) {
			logger.error(
				"CompanyMembershipService: User tried to invite without permission",
				{
					category: "auth",
					details: { userId: invitedByUserId, companyId },
				},
			);
			throw new ForbiddenException(
				"Only company admins can invite users",
			);
		}

		// Generate invitation code
		const code = this.generateInvitationCode();
		const expiresAt = new Date(
			Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
		);

		const invitation = await this.prisma.invitationCode.create({
			data: {
				code,
				companyId,
				createdById: invitedByUserId,
				expiresAt,
			},
		});

		logger.info("CompanyMembershipService: Created invitation", {
			category: "auth",
			details: {
				invitationId: invitation.id,
				companyId,
				invitedByUserId,
			},
		});

		return { code: invitation.code, expiresAt };
	}

	/**
	 * Join a company using an invitation code
	 */
	async joinCompany(
		userId: string,
		invitationCode: string,
	): Promise<UserCompanyWithDetails> {
		// Find the invitation
		const invitation = await this.prisma.invitationCode.findUnique({
			where: { code: invitationCode },
			include: { company: true },
		});

		if (!invitation) {
			throw new NotFoundException("Invalid invitation code");
		}

		if (invitation.usedAt) {
			throw new BadRequestException("This invitation has already been used");
		}

		if (invitation.expiresAt && invitation.expiresAt < new Date()) {
			throw new BadRequestException("This invitation has expired");
		}

		if (!invitation.companyId) {
			throw new BadRequestException(
				"This invitation is not linked to a company",
			);
		}

		// Mark invitation as used
		await this.prisma.invitationCode.update({
			where: { id: invitation.id },
			data: {
				usedAt: new Date(),
				usedById: userId,
			},
		});

		// Create the user-company relationship with USER role
		const membership = await this.prisma.userCompany.create({
			data: {
				userId,
				companyId: invitation.companyId,
				role: UserRole.USER,
			},
			include: {
				company: {
					select: {
						id: true,
						name: true,
						email: true,
						currency: true,
					},
				},
			},
		});

		logger.info("CompanyMembershipService: User joined company", {
			category: "auth",
			details: { userId, companyId: invitation.companyId },
		});

		return membership as UserCompanyWithDetails;
	}

	/**
	 * Get all members of a company
	 */
	async getCompanyMembers(companyId: string): Promise<CompanyMember[]> {
		const memberships = await this.prisma.userCompany.findMany({
			where: { companyId },
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
			orderBy: { createdAt: "desc" },
		});

		return memberships.map((membership) => ({
			id: membership.user.id,
			email: membership.user.email,
			firstname: membership.user.firstname,
			lastname: membership.user.lastname,
			role: membership.role,
			joinedAt: membership.createdAt,
		}));
	}

	/**
	 * Remove a member from a company
	 * Only ADMIN can remove members, and cannot remove themselves
	 */
	async removeMember(
		companyId: string,
		memberUserId: string,
		removedByUserId: string,
	): Promise<void> {
		// Cannot remove yourself
		if (memberUserId === removedByUserId) {
			throw new BadRequestException("You cannot remove yourself from the company");
		}

		// Verify the remover has ADMIN role
		const removerMembership = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId: removedByUserId,
					companyId,
				},
			},
		});

		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});
		const isSuperAdmin = firstUser?.id === removedByUserId;

		if (
			!isSuperAdmin &&
			(!removerMembership || removerMembership.role !== UserRole.ADMIN)
		) {
			throw new ForbiddenException(
				"Only company admins can remove members",
			);
		}

		// Check if member exists
		const memberToRemove = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId: memberUserId,
					companyId,
				},
			},
		});

		if (!memberToRemove) {
			throw new NotFoundException("Member not found in this company");
		}

		// Cannot remove the company creator (ADMIN who created the company)
		if (memberToRemove.role === UserRole.ADMIN) {
			throw new ForbiddenException("Cannot remove company admins");
		}

		await this.prisma.userCompany.delete({
			where: {
				userId_companyId: {
					userId: memberUserId,
					companyId,
				},
			},
		});

		logger.info("CompanyMembershipService: Member removed from company", {
			category: "auth",
			details: {
				companyId,
				memberUserId,
				removedByUserId,
			},
		});
	}

	/**
	 * Update a member's role
	 * Only ADMIN can update roles
	 */
	async updateMemberRole(
		companyId: string,
		memberUserId: string,
		newRole: UserRole,
		updatedByUserId: string,
	): Promise<void> {
		// Verify the updater has ADMIN role
		const updaterMembership = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId: updatedByUserId,
					companyId,
				},
			},
		});

		const firstUser = await this.prisma.user.findFirst({
			orderBy: { createdAt: "asc" },
		});
		const isSuperAdmin = firstUser?.id === updatedByUserId;

		if (
			!isSuperAdmin &&
			(!updaterMembership || updaterMembership.role !== UserRole.ADMIN)
		) {
			throw new ForbiddenException(
				"Only company admins can update member roles",
			);
		}

		// Check if member exists
		const memberToUpdate = await this.prisma.userCompany.findUnique({
			where: {
				userId_companyId: {
					userId: memberUserId,
					companyId,
				},
			},
		});

		if (!memberToUpdate) {
			throw new NotFoundException("Member not found in this company");
		}

		// Cannot change the role of the company creator
		if (memberToUpdate.role === UserRole.ADMIN && newRole !== UserRole.ADMIN) {
			throw new ForbiddenException("Cannot change the role of company admins");
		}

		await this.prisma.userCompany.update({
			where: {
				userId_companyId: {
					userId: memberUserId,
					companyId,
				},
			},
			data: { role: newRole },
		});

		logger.info("CompanyMembershipService: Member role updated", {
			category: "auth",
			details: {
				companyId,
				memberUserId,
				newRole,
				updatedByUserId,
			},
		});
	}

	/**
	 * Generate a random invitation code
	 */
	private generateInvitationCode(): string {
		const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
		let code = "";
		for (let i = 0; i < 16; i++) {
			code += chars.charAt(Math.floor(Math.random() * chars.length));
		}
		return code;
	}
}