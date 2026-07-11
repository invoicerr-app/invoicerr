import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private readonly companyService: CompanyService) {}

  async createCompany(userId: string, dto: EditCompanyDto) {
    return this.companyService.createCompany(userId, dto);
  }

  async switchActiveCompany(userId: string, sessionId: string, companyId: string) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId, companyId } },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this company');
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: { activeCompanyId: companyId },
    });

    logger.info('Active company switched', { category: 'companies', details: { userId, companyId } });

    return { success: true };
  }

  async listMembers(companyId: string) {
    const members = await prisma.userCompany.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, firstname: true, lastname: true } } },
    });

    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      firstname: m.user.firstname,
      lastname: m.user.lastname,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async changeMemberRole(companyId: string, targetUserId: string, role: CompanyRole) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === CompanyRole.OWNER && role !== CompanyRole.OWNER) {
      await this.assertNotLastOwner(companyId);
    }

    const updated = await prisma.userCompany.update({
      where: { userId_companyId: { userId: targetUserId, companyId } },
      data: { role },
    });

    logger.info('Member role changed', { category: 'companies', details: { companyId, targetUserId, role } });

    return updated;
  }

  async removeMember(companyId: string, actingRole: CompanyRole, targetUserId: string) {
    const membership = await prisma.userCompany.findUnique({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    // ADMIN can remove regular members but not peers or owners.
    if (actingRole === CompanyRole.ADMIN && membership.role !== CompanyRole.MEMBER) {
      throw new ForbiddenException('Admins cannot remove owners or other admins');
    }

    if (membership.role === CompanyRole.OWNER) {
      await this.assertNotLastOwner(companyId);
    }

    await prisma.userCompany.delete({
      where: { userId_companyId: { userId: targetUserId, companyId } },
    });

    logger.info('Member removed', { category: 'companies', details: { companyId, targetUserId } });

    return { success: true };
  }

  private async assertNotLastOwner(companyId: string) {
    const ownerCount = await prisma.userCompany.count({
      where: { companyId, role: CompanyRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new BadRequestException('A company must have at least one owner');
    }
  }
}
