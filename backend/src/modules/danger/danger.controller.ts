import { User } from '@/decorators/user.decorator';
import { DangerService } from '@/modules/danger/danger.service';
import { CurrentUser } from '@/types/user';
import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

interface OtpConfirmationBody {
  otp: string;
}

interface DeleteCompanyBody {
  otp: string;
  companyName: string;
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

  @Get('reset/company-data/preflight')
  @ApiOperation({
    summary: 'Preview a company-data reset',
    description:
      'Reports what "Reset company data" would delete, and whether it is currently refused because ' +
      'a document is still under legal retention. Read-only — never touches an OTP.',
  })
  @ApiResponse({ status: 200, description: 'Preflight result' })
  async getCompanyDataResetPreflight(@ActiveCompany() companyId: string) {
    return this.dangerService.getCompanyDataResetPreflight(companyId);
  }

  @Post('reset/company-data')
  @ApiOperation({
    summary: 'Reset company data',
    description:
      'Deletes every document, client, article, project, time entry, bank statement/reconciliation, ' +
      'archived file and attachment for the active company, while keeping the company itself, its ' +
      'members, its subscription, its channels and its e-mail templates.',
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
  @ApiResponse({ status: 201, description: 'Company data reset' })
  @ApiResponse({ status: 409, description: 'Refused — a document is still under legal retention' })
  async resetCompanyData(
    @User() user: CurrentUser,
    @ActiveCompany() companyId: string,
    @Body() body: OtpConfirmationBody,
  ) {
    if (!body?.otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    return this.dangerService.resetCompanyData(user, companyId, body.otp);
  }

  @Post('delete-company')
  @ApiOperation({
    summary: 'Delete company',
    description:
      'Permanently deletes the active company and everything scoped to it — members, documents, ' +
      'channels, subscription, every setting. A full data export is mailed to the requesting OWNER ' +
      'first. Irreversible.',
  })
  // See `resetCompanyData`'s own comment: the OTP travels in the body, never the query string. The
  // company's own exact name is a second, independent confirmation — see `DangerService#deleteCompany`'s
  // own header for why.
  @ApiBody({
    schema: {
      type: 'object',
      required: ['otp', 'companyName'],
      properties: {
        otp: { type: 'string', description: 'One-time passcode sent via POST /danger/otp' },
        companyName: { type: 'string', description: "The company's own exact, current name" },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Company deleted' })
  async deleteCompany(
    @User() user: CurrentUser,
    @ActiveCompany() companyId: string,
    @Body() body: DeleteCompanyBody,
  ) {
    if (!body?.otp) {
      throw new BadRequestException('OTP is required for this action');
    }
    if (!body?.companyName) {
      throw new BadRequestException('Company name is required for this action');
    }
    return this.dangerService.deleteCompany(user, companyId, body.otp, body.companyName);
  }
}
