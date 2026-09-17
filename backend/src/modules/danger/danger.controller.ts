import { User } from '@/decorators/user.decorator';
import { DangerService } from '@/modules/danger/danger.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

interface OtpConfirmationBody {
  otp: string;
}

@ApiTags('danger')
@Controller('danger')
@Roles(CompanyRole.OWNER)
export class DangerController {
  constructor(private readonly dangerService: DangerService) {}

  @Post('otp')
  @ApiOperation({
    summary: 'Request OTP for dangerous actions',
    description: 'Sends a one-time passcode to the user email to authorize destructive operations.',
  })
  @ApiResponse({ status: 201, description: 'OTP sent' })
  async requestOtp(@User() user: CurrentUser, @ActiveCompany() companyId: string) {
    return this.dangerService.requestOtp(user, companyId);
  }

  @Post('reset/app')
  @ApiOperation({
    summary: 'Reset app data',
    description:
      'Deletes all documents (invoices, quotes, payments) for the active company while preserving its configuration.',
  })
  // A confirmation code is a bearer secret for the duration of its own window: a query string lands in
  // nginx access logs and browser history the exact same way a password would, which is why this is a
  // request BODY, never `@Query('otp')` (as it used to be) — see `POST /danger/otp`'s own description.
  @ApiBody({
    schema: {
      type: 'object',
      required: ['otp'],
      properties: { otp: { type: 'string', description: 'One-time passcode sent via POST /danger/otp' } },
    },
  })
  @ApiResponse({ status: 201, description: 'App data reset' })
  async resetApp(
    @User() user: CurrentUser,
    @ActiveCompany() companyId: string,
    @Body() body: OtpConfirmationBody,
  ) {
    if (!body?.otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetApp(user, companyId, body.otp);
  }

  @Post('reset/all')
  @ApiOperation({
    summary: 'Reset everything',
    description:
      'Deletes all data including documents, clients, and configuration for the active company. The company returns to its initial state.',
  })
  // See `resetApp`'s own comment: the OTP travels in the body, never the query string.
  @ApiBody({
    schema: {
      type: 'object',
      required: ['otp'],
      properties: { otp: { type: 'string', description: 'One-time passcode sent via POST /danger/otp' } },
    },
  })
  @ApiResponse({ status: 201, description: 'Everything reset' })
  async resetAll(
    @User() user: CurrentUser,
    @ActiveCompany() companyId: string,
    @Body() body: OtpConfirmationBody,
  ) {
    if (!body?.otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetAll(user, companyId, body.otp);
  }
}
