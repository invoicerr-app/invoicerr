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
} from '@nestjs/common';
import { Public } from '@thallesp/nestjs-better-auth';
import { User } from '@/decorators/user.decorator';
import { CompanyId } from '@/decorators/company.decorator';
import { SkipCompanyGuard } from '@/decorators/skip-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { CompanyGuard } from '@/guards/company.guard';
import { RoleGuard } from '@/guards/role.guard';
import { pendingInvitationCodes } from '@/lib/auth';
import type { CurrentUser } from '@/types/user';
import { InvitationsService, CreateInvitationDto } from './invitations.service';
import { UserCompanyRole } from '../../../prisma/generated/prisma/client';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get('can-register')
  @Public()
  async canRegister(@Query('code') code?: string) {
    return this.invitationsService.canRegister(code);
  }

  @Get('is-first-user')
  @Public()
  async isFirstUser() {
    const isFirst = await this.invitationsService.isFirstUser();
    return { isFirstUser: isFirst };
  }

  @Post('validate')
  @Public()
  async validateInvitation(@Body() body: { code: string; email: string }) {
    if (!body.code || !body.email) {
      throw new BadRequestException('Code and email are required');
    }

    const result = await this.invitationsService.canRegister(body.code);

    if (!result.allowed) {
      throw new BadRequestException(result.message || 'Invalid invitation code');
    }

    pendingInvitationCodes.set(body.email.toLowerCase(), body.code);

    return {
      valid: true,
      message: 'Invitation code validated',
      companyId: result.companyId,
      companyName: result.companyName,
      role: result.role,
    };
  }

  /**
   * Create a company-specific invitation
   * Requires OWNER or ADMIN role
   */
  @Post('company')
  @UseGuards(CompanyGuard, RoleGuard)
  @Roles('OWNER', 'ADMIN')
  async createCompanyInvitation(
    @User() user: CurrentUser,
    @CompanyId() companyId: string,
    @Body() body: { role?: UserCompanyRole; expiresInDays?: number },
  ) {
    return this.invitationsService.createInvitation(user.id, {
      companyId,
      role: body.role,
      expiresInDays: body.expiresInDays,
    });
  }

  /**
   * List invitations for a company
   * Requires OWNER or ADMIN role
   */
  @Get('company')
  @UseGuards(CompanyGuard, RoleGuard)
  @Roles('OWNER', 'ADMIN')
  async listCompanyInvitations(@User() user: CurrentUser, @CompanyId() companyId: string) {
    return this.invitationsService.listCompanyInvitations(companyId, user.id);
  }

  /**
   * Create a general invitation (not company-specific)
   * Legacy endpoint for backwards compatibility
   */
  @Post()
  @SkipCompanyGuard()
  async createInvitation(@User() user: CurrentUser, @Body() body: CreateInvitationDto) {
    return this.invitationsService.createInvitation(user.id, body);
  }

  /**
   * List all invitations created by the current user
   */
  @Get()
  @SkipCompanyGuard()
  async listInvitations(@User() user: CurrentUser) {
    return this.invitationsService.listInvitations(user.id);
  }

  @Delete(':id')
  @SkipCompanyGuard()
  async deleteInvitation(@Param('id') id: string, @User() user: CurrentUser) {
    return this.invitationsService.deleteInvitation(id, user.id);
  }

  /**
   * Get invitation details by code (public endpoint)
   */
  @Get('code/:code')
  @Public()
  async getInvitationByCode(@Param('code') code: string) {
    return this.invitationsService.getInvitationByCode(code);
  }

  /**
   * Accept an invitation (requires authentication)
   */
  @Post('code/:code/accept')
  @SkipCompanyGuard()
  async acceptInvitation(@Param('code') code: string, @User() user: CurrentUser) {
    return this.invitationsService.acceptInvitation(code, user.id);
  }
}
