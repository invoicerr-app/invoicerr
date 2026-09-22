import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompaniesService } from './companies.service';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CurrentUser } from '@/types/user';
import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { LegalGateExempt } from '@/legal/legal-gate-exempt.decorator';
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
  // A member with a pending legal re-acceptance has exactly one self-service way to end their
  // relationship with THIS company (the OWNER-only company-deletion path in `danger.controller.ts` is
  // closed to them by role, never by this check) — refusing it until they accept terms they are
  // trying to walk away from would turn "you must agree or leave" into "you must agree, full stop".
  @LegalGateExempt()
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

  @Post('export')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  // A POST by HTTP method, but the one write this route performs (bumping the cooldown timestamp
  // `claimExportSlot` reads — `companies.service.ts`) is incidental bookkeeping for what the route
  // fundamentally IS: reading the company's own data back out. `LegalAcceptanceGuard` withholds writes
  // that change what the account holds, never the ability to get a copy of it — this is the one export
  // mechanism the product offers (the same archive the billing lifecycle sweep already mails
  // automatically), so a pending re-acceptance must never be the reason a caller cannot retrieve it.
  @LegalGateExempt()
  @ApiOperation({
    summary: 'Export everything the active company holds',
    description:
      'Self-service full data export (every document the company holds, its stored fields plus a ' +
      'rendered PDF where one can be produced) — the same archive the hosted-billing lifecycle sweep ' +
      'already mails an OWNER automatically, available on demand instead of waiting for that or ' +
      'writing to support. OWNER/ADMIN only, rate-limited per company (see the 429 response below). ' +
      'A small export streams back directly; a large one is emailed to the caller instead.',
  })
  @ApiResponse({
    status: 200,
    description: 'Zip streamed directly',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiResponse({ status: 202, description: 'Export built and emailed to the caller instead' })
  @ApiResponse({ status: 429, description: 'Rate-limited — retry after the window named in the response' })
  async exportData(
    @ActiveCompany() companyId: string,
    @User() user: CurrentUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.companiesService.exportCompanyData(companyId, user.email);
    if (result.mode === 'stream') {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="invoicerr-export.zip"');
      res.status(200).send(result.zip);
      return;
    }
    res.status(202).json({
      message: `Your export was too large to download directly — it was emailed to ${result.to}.`,
      deliveredTo: result.to,
    });
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
