import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompaniesService } from './companies.service';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '@/types/user';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { RequestWithUser } from '@/types/request';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { RequiresScope } from '@/utils/scope-check';

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Post()
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Create a new company',
    description:
      'Creates an additional company and makes the caller its owner. Open to any authenticated user, regardless of existing memberships.',
  })
  @ApiResponse({ status: 201, description: 'Company created' })
  async create(@User() user: CurrentUser, @Body() body: EditCompanyDto) {
    return this.companiesService.createCompany(user.id, body);
  }

  @Post('switch')
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Switch active company',
    description: "Switches the current session's active company to one the caller belongs to.",
  })
  @ApiBody({
    schema: { type: 'object', properties: { companyId: { type: 'string' } }, required: ['companyId'] },
  })
  @ApiResponse({ status: 201, description: 'Active company switched' })
  async switch(@User() user: CurrentUser, @Req() req: RequestWithUser, @Body() body: { companyId: string }) {
    return this.companiesService.switchActiveCompany(user.id, req.session.id, body.companyId);
  }

  @Delete('leave')
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Leave the active company',
    description:
      "Removes the caller's own membership from the active company. Refused for the company's last " +
      'remaining owner — ownership must be transferred to another member first.',
  })
  @ApiResponse({ status: 200, description: 'Left the company' })
  async leave(@ActiveCompany() companyId: string, @User() user: CurrentUser) {
    return this.companiesService.leaveCompany(companyId, user.id);
  }

  @Get('members')
  @RequiresScope('company:read')
  @ApiOperation({ summary: 'List the active company members' })
  @ApiResponse({ status: 200, description: 'Members retrieved' })
  async listMembers(@ActiveCompany() companyId: string) {
    return this.companiesService.listMembers(companyId);
  }

  @Patch('members/:userId')
  @Roles(CompanyRole.OWNER)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: "Change a member's role",
    description: 'Owner-only: promoting/demoting owners is ownership-sensitive.',
  })
  @ApiParam({ name: 'userId', type: String })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { role: { type: 'string', enum: Object.values(CompanyRole) } },
      required: ['role'],
    },
  })
  @ApiResponse({ status: 200, description: 'Member role updated' })
  async changeMemberRole(
    @ActiveCompany() companyId: string,
    @Param('userId') userId: string,
    @Body() body: { role: CompanyRole },
  ) {
    return this.companiesService.changeMemberRole(companyId, userId, body.role);
  }

  @Delete('members/:userId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({ summary: 'Remove a member from the active company' })
  @ApiParam({ name: 'userId', type: String })
  @ApiResponse({ status: 200, description: 'Member removed' })
  async removeMember(
    @ActiveCompany() companyId: string,
    @Req() req: RequestWithUser,
    @Param('userId') userId: string,
  ) {
    return this.companiesService.removeMember(companyId, req.role!, userId);
  }
}
