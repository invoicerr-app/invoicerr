import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { RequiresScope } from '@/utils/scope-check';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { TransferService } from './transfer.service';

/** The OWNER's own side of a company ownership transfer — see `transfer.module.ts`'s own header. The
 *  recipient's side (`GET /account/transfers`, `POST /account/transfers/:id/accept`) lives in
 *  `account-transfers.controller.ts` instead: it is not scoped to the ACTIVE company at all (the
 *  recipient may not even be a member of it yet), so it cannot share `@ActiveCompany()`/`@Roles()`
 *  with this one. */
@ApiTags('company-transfer')
@Controller('companies/transfer')
@Roles(CompanyRole.OWNER)
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post()
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Initiate an ownership transfer',
    description:
      'OWNER-only. Requires an OTP from `POST /danger/otp` (the same challenge the danger zone ' +
      'uses). Always returns the same generic message whether or not `email` has an account — see ' +
      "this endpoint's own anti-enumeration discipline in `transfer.service.ts`.",
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'otp'],
      properties: {
        email: { type: 'string', description: 'The destination account email' },
        otp: { type: 'string', description: 'One-time passcode sent via POST /danger/otp' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Request processed (generic message)' })
  async initiate(
    @ActiveCompany() companyId: string,
    @User() user: CurrentUser,
    @Body() body: { email: string; otp: string },
  ) {
    return this.transferService.initiateTransfer(companyId, user, body?.email, body?.otp);
  }

  @Get()
  @RequiresScope('company:read')
  @ApiOperation({
    summary: "The active company's current pending transfer",
    description: 'OWNER-only. `null` when none is pending.',
  })
  @ApiResponse({ status: 200, description: 'Current transfer (or null) retrieved' })
  async current(@ActiveCompany() companyId: string) {
    return this.transferService.getCurrentTransfer(companyId);
  }

  @Delete(':id')
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Cancel a pending ownership transfer',
    description: 'OWNER-only. No OTP required — a lower-stakes, reversible action.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Transfer canceled' })
  async cancel(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.transferService.cancelTransfer(companyId, id);
  }
}
