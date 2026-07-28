import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { logger } from '@/logger/logger.service';

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private generateCode(): string {
    return randomBytes(16).toString('hex').toUpperCase();
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
        message: 'An invitation code is required to register',
      };
    }

    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code: invitationCode },
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

    return { allowed: true, requiresCode: true };
  }

  async isFirstUser(): Promise<boolean> {
    const userCount = await this.prisma.user.count();
    return userCount === 0;
  }

  async createInvitation(createdById: string, companyId: string, role: CompanyRole, expiresInDays?: number) {
    // Only an OWNER can mint an invitation that would create a peer OWNER.
    if (role === CompanyRole.OWNER) {
      const creatorMembership = await this.prisma.userCompany.findUnique({
        where: { userId_companyId: { userId: createdById, companyId } },
      });
      if (creatorMembership?.role !== CompanyRole.OWNER) {
        throw new ForbiddenException('Only an owner can invite another owner');
      }
    }

    const code = this.generateCode();

    const invitation = await this.prisma.invitationCode.create({
      data: {
        code,
        createdById,
        companyId,
        role,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      },
    });

    logger.info('Invitation created', {
      category: 'invitation',
      details: { id: invitation.id, code: invitation.code, createdById, companyId, role },
    });

    return {
      id: invitation.id,
      code: invitation.code,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    };
  }

  async useInvitation(code: string, userId: string) {
    const invitation = await this.prisma.invitationCode.findUnique({
      where: { code },
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

    logger.info('Invitation code used', { category: 'invitation', details: { code, userId } });

    const updatedInvitation = await this.prisma.invitationCode.update({
      where: { id: invitation.id },
      data: {
        usedAt: new Date(),
        usedById: userId,
      },
    });

    await this.prisma.userCompany.upsert({
      where: { userId_companyId: { userId, companyId: invitation.companyId } },
      create: { userId, companyId: invitation.companyId, role: invitation.role },
      update: {},
    });

    return updatedInvitation;
  }

  async listInvitations(companyId: string) {
    return this.prisma.invitationCode.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        role: true,
        createdAt: true,
        expiresAt: true,
        usedAt: true,
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

  async deleteInvitation(id: string, companyId: string) {
    const invitation = await this.prisma.invitationCode.findFirst({
      where: {
        id,
        companyId,
        usedAt: null,
      },
    });

    if (!invitation) {
      logger.warn('Invitation not found or already used', {
        category: 'invitation',
        details: { id, companyId },
      });
      throw new NotFoundException('Invitation not found or already used');
    }

    await this.prisma.invitationCode.delete({
      where: { id },
    });

    logger.info('Invitation deleted', { category: 'invitation', details: { id, companyId } });

    return { success: true };
  }
}
