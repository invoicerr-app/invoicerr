import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { User } from '@/decorators/user.decorator';
import { SkipCompanyGuard } from '@/decorators/skip-company.decorator';
import type { CurrentUser } from '@/types/user';
import { AdminService } from './admin.service';
import { UserCompanyRole } from '../../../prisma/generated/prisma/client';

/**
 * Admin controller for system administration
 * All endpoints require SYSTEM_ADMIN privileges
 */
@Controller('admin')
@SkipCompanyGuard()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * Get system-wide statistics
   */
  @Get('stats')
  async getSystemStats(@User() user: CurrentUser) {
    return this.adminService.getSystemStats(user.id);
  }

  /**
   * List all users in the system
   */
  @Get('users')
  async listAllUsers(@User() user: CurrentUser) {
    return this.adminService.listAllUsers(user.id);
  }

  /**
   * List all companies in the system
   */
  @Get('companies')
  async listAllCompanies(@User() user: CurrentUser) {
    return this.adminService.listAllCompanies(user.id);
  }

  /**
   * Grant system admin privileges to a user
   */
  @Post('users/:userId/grant-admin')
  async grantSystemAdmin(@User() user: CurrentUser, @Param('userId') targetUserId: string) {
    return this.adminService.grantSystemAdmin(user.id, targetUserId);
  }

  /**
   * Revoke system admin privileges from a user
   */
  @Post('users/:userId/revoke-admin')
  async revokeSystemAdmin(@User() user: CurrentUser, @Param('userId') targetUserId: string) {
    return this.adminService.revokeSystemAdmin(user.id, targetUserId);
  }

  /**
   * Add a user to a company with a specific role
   */
  @Post('companies/:companyId/users')
  async addUserToCompany(
    @User() user: CurrentUser,
    @Param('companyId') companyId: string,
    @Body() body: { userId: string; role: UserCompanyRole },
  ) {
    return this.adminService.addUserToCompany(user.id, body.userId, companyId, body.role);
  }

  /**
   * Remove a user from a company
   */
  @Delete('companies/:companyId/users/:userId')
  async removeUserFromCompany(
    @User() user: CurrentUser,
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
  ) {
    return this.adminService.removeUserFromCompany(user.id, userId, companyId);
  }

  /**
   * Update a user's role in a company
   */
  @Patch('companies/:companyId/users/:userId/role')
  async updateUserRole(
    @User() user: CurrentUser,
    @Param('companyId') companyId: string,
    @Param('userId') userId: string,
    @Body() body: { role: UserCompanyRole },
  ) {
    return this.adminService.updateUserRole(user.id, userId, companyId, body.role);
  }

  /**
   * Delete a company (destructive operation)
   */
  @Delete('companies/:companyId')
  async deleteCompany(@User() user: CurrentUser, @Param('companyId') companyId: string) {
    return this.adminService.deleteCompany(user.id, companyId);
  }
}
