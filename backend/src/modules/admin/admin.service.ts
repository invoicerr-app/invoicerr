import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import { PrismaService } from '@/prisma/prisma.service';
import { UserCompanyRole } from '../../../prisma/generated/prisma/client';

export interface UserWithCompanies {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  isSystemAdmin: boolean;
  createdAt: Date;
  companies: Array<{
    companyId: string;
    companyName: string;
    role: UserCompanyRole;
    joinedAt: Date;
    isDefault: boolean;
  }>;
}

export interface CompanyWithUsers {
  id: string;
  name: string;
  country: string;
  currency: string;
  createdAt: Date;
  users: Array<{
    userId: string;
    email: string;
    firstname: string;
    lastname: string;
    role: UserCompanyRole;
    joinedAt: Date;
  }>;
}

export interface SystemStats {
  totalUsers: number;
  totalCompanies: number;
  totalInvoices: number;
  totalQuotes: number;
  totalClients: number;
  systemAdminCount: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verify the user is a system admin
   */
  private async verifySystemAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.isSystemAdmin) {
      throw new ForbiddenException('Only system administrators can perform this action');
    }
  }

  /**
   * Get system-wide statistics
   */
  async getSystemStats(adminUserId: string): Promise<SystemStats> {
    await this.verifySystemAdmin(adminUserId);

    const [
      totalUsers,
      totalCompanies,
      totalInvoices,
      totalQuotes,
      totalClients,
      systemAdminCount,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.company.count(),
      this.prisma.invoice.count({ where: { isActive: true } }),
      this.prisma.quote.count({ where: { isActive: true } }),
      this.prisma.client_model.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isSystemAdmin: true } }),
    ]);

    return {
      totalUsers,
      totalCompanies,
      totalInvoices,
      totalQuotes,
      totalClients,
      systemAdminCount,
    };
  }

  /**
   * List all users in the system
   */
  async listAllUsers(adminUserId: string): Promise<UserWithCompanies[]> {
    await this.verifySystemAdmin(adminUserId);

    const users = await this.prisma.user.findMany({
      include: {
        companies: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      isSystemAdmin: user.isSystemAdmin,
      createdAt: user.createdAt,
      companies: user.companies.map((uc) => ({
        companyId: uc.company.id,
        companyName: uc.company.name,
        role: uc.role,
        joinedAt: uc.joinedAt,
        isDefault: uc.isDefault,
      })),
    }));
  }

  /**
   * List all companies in the system
   */
  async listAllCompanies(adminUserId: string): Promise<CompanyWithUsers[]> {
    await this.verifySystemAdmin(adminUserId);

    const companies = await this.prisma.company.findMany({
      include: {
        users: {
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
      orderBy: { foundedAt: 'desc' },
    });

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      country: company.country,
      currency: company.currency,
      createdAt: company.foundedAt || new Date(),
      users: (company as any).users.map((uc: any) => ({
        userId: uc.user.id,
        email: uc.user.email,
        firstname: uc.user.firstname,
        lastname: uc.user.lastname,
        role: uc.role,
        joinedAt: uc.joinedAt,
      })),
    }));
  }

  /**
   * Grant system admin privileges to a user
   */
  async grantSystemAdmin(adminUserId: string, targetUserId: string) {
    await this.verifySystemAdmin(adminUserId);

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new BadRequestException('User not found');
    }

    if (targetUser.isSystemAdmin) {
      throw new BadRequestException('User is already a system administrator');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isSystemAdmin: true },
    });

    logger.info('System admin granted', {
      category: 'admin',
      details: { adminUserId, targetUserId },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      isSystemAdmin: updatedUser.isSystemAdmin,
    };
  }

  /**
   * Revoke system admin privileges from a user
   */
  async revokeSystemAdmin(adminUserId: string, targetUserId: string) {
    await this.verifySystemAdmin(adminUserId);

    if (adminUserId === targetUserId) {
      throw new BadRequestException('You cannot revoke your own system administrator privileges');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) {
      throw new BadRequestException('User not found');
    }

    if (!targetUser.isSystemAdmin) {
      throw new BadRequestException('User is not a system administrator');
    }

    // Ensure there's at least one system admin remaining
    const systemAdminCount = await this.prisma.user.count({
      where: { isSystemAdmin: true },
    });

    if (systemAdminCount <= 1) {
      throw new BadRequestException('Cannot revoke the last system administrator');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { isSystemAdmin: false },
    });

    logger.info('System admin revoked', {
      category: 'admin',
      details: { adminUserId, targetUserId },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      isSystemAdmin: updatedUser.isSystemAdmin,
    };
  }

  /**
   * Add a user to a company with a specific role
   */
  async addUserToCompany(
    adminUserId: string,
    userId: string,
    companyId: string,
    role: UserCompanyRole,
  ) {
    await this.verifySystemAdmin(adminUserId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Check if already member
    const existingMembership = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (existingMembership) {
      throw new BadRequestException('User is already a member of this company');
    }

    // Check if user has any companies (for isDefault)
    const userCompanyCount = await this.prisma.userCompany.count({
      where: { userId },
    });

    const membership = await this.prisma.userCompany.create({
      data: {
        userId,
        companyId,
        role,
        isDefault: userCompanyCount === 0,
      },
      include: {
        user: {
          select: {
            email: true,
            firstname: true,
            lastname: true,
          },
        },
        company: {
          select: {
            name: true,
          },
        },
      },
    });

    logger.info('User added to company by admin', {
      category: 'admin',
      details: { adminUserId, userId, companyId, role },
    });

    return {
      userId: membership.userId,
      userEmail: membership.user.email,
      companyId: membership.companyId,
      companyName: membership.company.name,
      role: membership.role,
      joinedAt: membership.joinedAt,
    };
  }

  /**
   * Remove a user from a company
   */
  async removeUserFromCompany(adminUserId: string, userId: string, companyId: string) {
    await this.verifySystemAdmin(adminUserId);

    const membership = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (!membership) {
      throw new BadRequestException('User is not a member of this company');
    }

    // Check if user is the only OWNER
    if (membership.role === 'OWNER') {
      const ownerCount = await this.prisma.userCompany.count({
        where: { companyId, role: 'OWNER' },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot remove the last owner from a company');
      }
    }

    await this.prisma.userCompany.delete({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    // If this was the user's default company, set another as default
    if (membership.isDefault) {
      const anotherCompany = await this.prisma.userCompany.findFirst({
        where: { userId },
      });

      if (anotherCompany) {
        await this.prisma.userCompany.update({
          where: { id: anotherCompany.id },
          data: { isDefault: true },
        });
      }
    }

    logger.info('User removed from company by admin', {
      category: 'admin',
      details: { adminUserId, userId, companyId },
    });

    return { success: true };
  }

  /**
   * Update a user's role in a company
   */
  async updateUserRole(
    adminUserId: string,
    userId: string,
    companyId: string,
    newRole: UserCompanyRole,
  ) {
    await this.verifySystemAdmin(adminUserId);

    const membership = await this.prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (!membership) {
      throw new BadRequestException('User is not a member of this company');
    }

    // If demoting from OWNER, ensure there's another owner
    if (membership.role === 'OWNER' && newRole !== 'OWNER') {
      const ownerCount = await this.prisma.userCompany.count({
        where: { companyId, role: 'OWNER' },
      });

      if (ownerCount <= 1) {
        throw new BadRequestException('Cannot demote the last owner of a company');
      }
    }

    const updatedMembership = await this.prisma.userCompany.update({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
      data: { role: newRole },
      include: {
        user: {
          select: {
            email: true,
          },
        },
        company: {
          select: {
            name: true,
          },
        },
      },
    });

    logger.info('User role updated by admin', {
      category: 'admin',
      details: { adminUserId, userId, companyId, oldRole: membership.role, newRole },
    });

    return {
      userId: updatedMembership.userId,
      userEmail: updatedMembership.user.email,
      companyId: updatedMembership.companyId,
      companyName: updatedMembership.company.name,
      role: updatedMembership.role,
    };
  }

  /**
   * Delete a company and all its data
   * WARNING: This is a destructive operation
   */
  async deleteCompany(adminUserId: string, companyId: string) {
    await this.verifySystemAdmin(adminUserId);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new BadRequestException('Company not found');
    }

    // Delete company (cascades to related data due to Prisma relations)
    await this.prisma.company.delete({
      where: { id: companyId },
    });

    logger.info('Company deleted by admin', {
      category: 'admin',
      details: { adminUserId, companyId, companyName: company.name },
    });

    return { success: true, deletedCompany: company.name };
  }
}
