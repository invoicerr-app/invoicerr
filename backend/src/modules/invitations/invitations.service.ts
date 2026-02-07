import { randomBytes } from "node:crypto";
import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import { logger } from "@/logger/logger.service";
import { PrismaService } from "@/prisma/prisma.service";

@Injectable()
export class InvitationsService {
	constructor(private readonly prisma: PrismaService) {}

	private generateCode(): string {
		return randomBytes(16).toString("hex").toUpperCase();
	}

	async canRegister(
		invitationCode?: string,
	): Promise<{ allowed: boolean; requiresCode: boolean; message?: string }> {
		const userCount = await this.prisma.user.count();

		if (userCount === 0) {
			return { allowed: true, requiresCode: false };
		}

		if (!invitationCode) {
			return {
				allowed: false,
				requiresCode: true,
				message: "An invitation code is required to register",
			};
		}

		const invitation = await this.prisma.invitationCode.findUnique({
			where: { code: invitationCode },
		});

		if (!invitation) {
			return {
				allowed: false,
				requiresCode: true,
				message: "Invalid invitation code",
			};
		}

		if (invitation.usedAt) {
			return {
				allowed: false,
				requiresCode: true,
				message: "This invitation code has already been used",
			};
		}

		if (invitation.expiresAt && invitation.expiresAt < new Date()) {
			return {
				allowed: false,
				requiresCode: true,
				message: "This invitation code has expired",
			};
		}

		return { allowed: true, requiresCode: true };
	}

	async isFirstUser(): Promise<boolean> {
		const userCount = await this.prisma.user.count();
		return userCount === 0;
	}

	async createInvitation(
		createdById: string,
		companyId?: string,
		expiresInDays?: number,
	) {
		const code = this.generateCode();

		const invitation = await this.prisma.invitationCode.create({
			data: {
				code,
				createdById,
				companyId: companyId || null,
				expiresAt: expiresInDays
					? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
					: null,
			},
		});

		logger.info("Invitation created", {
			category: "invitation",
			details: {
				id: invitation.id,
				code: invitation.code,
				createdById,
				companyId,
			},
		});

		return {
			id: invitation.id,
			code: invitation.code,
			createdAt: invitation.createdAt,
			expiresAt: invitation.expiresAt,
			companyId: invitation.companyId,
		};
	}

	async useInvitation(code: string, userId: string) {
		const invitation = await this.prisma.invitationCode.findUnique({
			where: { code },
		});

		if (!invitation) {
			logger.warn("Invitation code not found", {
				category: "invitation",
				details: { code },
			});
			throw new NotFoundException("Invitation code not found");
		}

		if (invitation.usedAt) {
			logger.warn("Invitation code already used", {
				category: "invitation",
				details: { code },
			});
			throw new BadRequestException(
				"This invitation code has already been used",
			);
		}

		if (invitation.expiresAt && invitation.expiresAt < new Date()) {
			logger.warn("Invitation code expired", {
				category: "invitation",
				details: { code },
			});
			throw new BadRequestException("This invitation code has expired");
		}

		logger.info("Invitation code used", {
			category: "invitation",
			details: { code, userId },
		});

		return this.prisma.invitationCode.update({
			where: { id: invitation.id },
			data: {
				usedAt: new Date(),
				usedById: userId,
			},
		});
	}

	async listInvitations(userId: string) {
		return this.prisma.invitationCode.findMany({
			where: { createdById: userId },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				code: true,
				createdAt: true,
				expiresAt: true,
				usedAt: true,
				companyId: true,
				company: {
					select: {
						id: true,
						name: true,
					},
				},
				usedBy: {
					select: {
						id: true,
						email: true,
						firstname: true,
						lastname: true,
					},
				},
			},
		});
	}

	async deleteInvitation(id: string, userId: string) {
		const invitation = await this.prisma.invitationCode.findFirst({
			where: {
				id,
				createdById: userId,
				usedAt: null,
			},
		});

		if (!invitation) {
			logger.warn("Invitation not found or already used", {
				category: "invitation",
				details: { id, userId },
			});
			throw new NotFoundException("Invitation not found or already used");
		}

		await this.prisma.invitationCode.delete({
			where: { id },
		});

		logger.info("Invitation deleted", {
			category: "invitation",
			details: { id, userId },
		});

		return { success: true };
	}
}
