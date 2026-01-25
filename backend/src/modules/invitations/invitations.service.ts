import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import { PrismaService } from '@/prisma/prisma.service';
import { UserCompanyRole } from '../../../prisma/generated/prisma/client';

export interface CreateInvitationDto {
  companyId?: string;
  role?: UserCompanyRole;
  expiresInDays?: number;
}

export interface InvitationResult {
  allowed: boolean;
  requiresCode: boolean;
  message?: string;
  companyId?: string;
  companyName?: string;
  role?: UserCompanyRole;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
  }

  /**
   * Check if registration is allowed
   * - First user can always register (becomes system admin)
   * - Subsequent users need an invitation code (either global or company-specific)
   */
  async canRegister(invitationCode?: string): Promise<InvitationResult> {
    const userCount = await this.prisma.user.count();

    // First user can always register
    if (userCount === 0) {
      return { allowed: true, requiresCode: false };
    }

    // Check DISABLE_REGISTRATION env var
    const disableRegistration = process.env.DISABLE_REGISTRATION === 'true';
    if (disableRegistration && !invitationCode) {
      return {
        allowed: false,
        requiresCode: true,
        message: 'Registration is disabled. An invitation code is required.',
      };
    }

    if (!invitationCode) {
      return {
        allowed: false,
        requiresCode: true,
        message: 'An invitation code is required to register',
      };
    }

    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code: invitationCode },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!invitation) {
      return {
        allowed: false,
        requiresCode: true,
        message: 'Invalid invitation code',
      };
    }

    if (invitation.usedAt) {
      return {
        allowed: false,
        requiresCode: true,
        message: 'This invitation code has already been used',
      };
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      return {
        allowed: false,
        requiresCode: true,
        message: 'This invitation code has expired',
      };
    }

    return {
      allowed: true,
      requiresCode: true,
      companyId: invitation.companyId ?? undefined,
      companyName: invitation.company?.name ?? undefined,
      role: invitation.role,
    };
  }

  async isFirstUser(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0;
  }

  /**
   * Create an invitation code
   * - If companyId is provided, the invitation is for joining that specific company
   * - The role determines what role the user will have in the company
   */
  async createInvitation(createdById: string, dto: CreateInvitationDto) {
    const code = this.generateCode();

    // If companyId is provided, verify the creator has permission to invite
    if (dto.companyId) {
      const creatorCompany = await this.prisma.userCompany.findUnique({
        where: {
          userId_companyId: {
            userId: createdById,
            companyId: dto.companyId,
          },
        },
      });

      if (!creatorCompany) {
        throw new BadRequestException('You do not have access to this company');
      }

      // Only OWNER and ADMIN can invite (or SYSTEM_ADMIN)
      const user = await this.prisma.user.findUnique({
        where: { id: createdById },
      });

      const canInvite =
        user?.isSystemAdmin ||
        creatorCompany.role === 'OWNER' ||
        creatorCompany.role === 'ADMIN';

      if (!canInvite) {
        throw new BadRequestException('You do not have permission to invite users to this company');
      }

      // Cannot assign a role higher than your own (except SYSTEM_ADMIN can assign anything)
      const roleHierarchy: Record<UserCompanyRole, number> = {
        SYSTEM_ADMIN: 4,
        OWNER: 3,
        ADMIN: 2,
        ACCOUNTANT: 1,
      };

      const requestedRole = dto.role || 'ACCOUNTANT';
      const creatorRoleLevel = user?.isSystemAdmin ? 4 : roleHierarchy[creatorCompany.role];
      const requestedRoleLevel = roleHierarchy[requestedRole];

      if (requestedRoleLevel > creatorRoleLevel) {
        throw new BadRequestException(
          `You cannot invite someone with a higher role than your own`,
        );
      }
    }

    const invitation = await this.prisma.invitationCode.create({
      data: {
        code,
        createdById,
        companyId: dto.companyId ?? null,
        role: dto.role || 'ACCOUNTANT',
        expiresAt: dto.expiresInDays
          ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000)
          : null,
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    logger.info('Invitation created', {
      category: 'invitation',
      details: {
        id: invitation.id,
        code: invitation.code,
        createdById,
        companyId: dto.companyId,
        role: dto.role,
      },
    });

    return {
      id: invitation.id,
      code: invitation.code,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
      companyId: invitation.companyId,
      companyName: invitation.company?.name,
      role: invitation.role,
    };
  }

  /**
   * Use an invitation code during registration
   * - Marks the invitation as used
   * - If the invitation is company-specific, adds the user to that company
   */
  async useInvitation(code: string, userId: string) {
    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code },
      include: {
        company: true,
      },
    });

    if (!invitation) {
      logger.warn('Invitation code not found', { category: 'invitation', details: { code } });
      throw new NotFoundException('Invitation code not found');
    }

    if (invitation.usedAt) {
      logger.warn('Invitation code already used', { category: 'invitation', details: { code } });
      throw new BadRequestException('This invitation code has already been used');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      logger.warn('Invitation code expired', { category: 'invitation', details: { code } });
      throw new BadRequestException('This invitation code has expired');
    }

    // Use a transaction to ensure consistency
    const result = await this.prisma.$transaction(async (tx) => {
      // Mark invitation as used
      const updatedInvitation = await tx.invitationCode.update({
        where: { id: invitation.id },
        data: {
          usedAt: new Date(),
          usedById: userId,
        },
      });

      // If company-specific invitation, add user to the company
      if (invitation.companyId) {
        // Check if user is already in this company
        const existingMembership = await tx.userCompany.findUnique({
          where: {
            userId_companyId: {
              userId,
              companyId: invitation.companyId,
            },
          },
        });

        if (!existingMembership) {
          // Check if user has any companies (for isDefault)
          const userCompanyCount = await tx.userCompany.count({
            where: { userId },
          });

          await tx.userCompany.create({
            data: {
              userId,
              companyId: invitation.companyId,
              role: invitation.role,
              isDefault: userCompanyCount === 0, // First company is default
            },
          });

          logger.info('User added to company via invitation', {
            category: 'invitation',
            details: {
              userId,
              companyId: invitation.companyId,
              role: invitation.role,
            },
          });
        }
      }

      return updatedInvitation;
    });

    logger.info('Invitation code used', {
      category: 'invitation',
      details: { code, userId, companyId: invitation.companyId },
    });

    return result;
  }

  /**
   * List invitations created by a user
   */
  async listInvitations(userId: string) {
    return this.prisma.invitationCode.findMany({
      where: { createdById: userId },
      orderBy: { createdAt: 'desc' },
      include: {
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

  /**
   * List invitations for a specific company
   * Only OWNER and ADMIN can see company invitations
   */
  async listCompanyInvitations(companyId: string, userId: string) {
    // Verify user has permission to view company invitations
    const userCompany = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const canView =
      user?.isSystemAdmin ||
      userCompany?.role === 'OWNER' ||
      userCompany?.role === 'ADMIN';

    if (!canView) {
      throw new BadRequestException('You do not have permission to view company invitations');
    }

    return this.prisma.invitationCode.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: {
            id: true,
            email: true,
            firstname: true,
            lastname: true,
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

  /**
   * Get invitation details by code (public endpoint)
   */
  async getInvitationByCode(code: string) {
    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code },
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('This invitation has already been used');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    return {
      id: invitation.id,
      code: invitation.code,
      companyId: invitation.companyId,
      companyName: invitation.company?.name,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      invitedBy: invitation.createdBy,
    };
  }

  /**
   * Accept an invitation (for logged-in users)
   */
  async acceptInvitation(code: string, userId: string) {
    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code },
      include: {
        company: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.usedAt) {
      throw new BadRequestException('This invitation has already been used');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    if (!invitation.companyId) {
      throw new BadRequestException('This invitation is not for a specific company');
    }

    // Check if user is already a member
    const existingMembership = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId: invitation.companyId,
        },
      },
    });

    if (existingMembership) {
      throw new BadRequestException('You are already a member of this company');
    }

    // Accept the invitation
    await this.prisma.$transaction(async (tx) => {
      // Mark invitation as used
      await tx.invitationCode.update({
        where: { id: invitation.id },
        data: {
          usedAt: new Date(),
          usedById: userId,
        },
      });

      // Check if user has any companies (for isDefault)
      const userCompanyCount = await tx.userCompany.count({
        where: { userId },
      });

      // Add user to company
      const userCompany = await tx.userCompany.create({
        data: {
          userId,
          companyId: invitation.companyId!,
          role: invitation.role,
          isDefault: userCompanyCount === 0,
        },
      });

      return userCompany;
    });

    logger.info('Invitation accepted', {
      category: 'invitation',
      details: { code, userId, companyId: invitation.companyId, role: invitation.role },
    });

    return {
      success: true,
      companyId: invitation.companyId,
      companyName: invitation.company?.name,
      role: invitation.role,
    };
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
      // Check if user is OWNER/ADMIN of the company (they can delete any invitation)
      const invitationWithCompany = await this.prisma.invitationCode.findFirst({
        where: { id, usedAt: null },
      });

      if (invitationWithCompany?.companyId) {
        const userCompany = await this.prisma.userCompany.findUnique({
          where: {
            userId_companyId: {
              userId,
              companyId: invitationWithCompany.companyId,
            },
          },
        });

        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });

        const canDelete =
          user?.isSystemAdmin ||
          userCompany?.role === 'OWNER' ||
          userCompany?.role === 'ADMIN';

        if (canDelete) {
          await this.prisma.invitationCode.delete({
            where: { id },
          });

          logger.info('Invitation deleted by admin', {
            category: 'invitation',
            details: { id, userId },
          });

          return { success: true };
        }
      }

      logger.warn('Invitation not found or already used', {
        category: 'invitation',
        details: { id, userId },
      });
      throw new NotFoundException('Invitation not found or already used');
    }

    await this.prisma.invitationCode.delete({
      where: { id },
    });

    logger.info('Invitation deleted', { category: 'invitation', details: { id, userId } });

    return { success: true };
  }
}
