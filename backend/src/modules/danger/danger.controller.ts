import { User } from '@/decorators/user.decorator';
import { DangerService } from '@/modules/danger/danger.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, Controller, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

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
  async requestOtp(@User() user: CurrentUser) {
    return this.dangerService.requestOtp(user);
  }

  @Post('reset/app')
  @ApiOperation({
    summary: 'Reset app data',
    description:
      'Deletes all documents (invoices, quotes, payments) for the active company while preserving its configuration.',
  })
  @ApiQuery({
    name: 'otp',
    required: true,
    type: String,
    description: 'One-time passcode sent via POST /danger/otp',
  })
  @ApiResponse({ status: 201, description: 'App data reset' })
  async resetApp(@User() user: CurrentUser, @ActiveCompany() companyId: string, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetApp(user, companyId, otp);
  }

  @Post('reset/all')
  @ApiOperation({
    summary: 'Reset everything',
    description:
      'Deletes all data including documents, clients, and configuration for the active company. The company returns to its initial state.',
  })
  @ApiQuery({
    name: 'otp',
    required: true,
    type: String,
    description: 'One-time passcode sent via POST /danger/otp',
  })
  @ApiResponse({ status: 201, description: 'Everything reset' })
  async resetAll(@User() user: CurrentUser, @ActiveCompany() companyId: string, @Query('otp') otp: string) {
    if (!otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetAll(user, companyId, otp);
  }
}
