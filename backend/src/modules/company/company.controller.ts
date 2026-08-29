import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { Roles } from '@/decorators/roles.decorator';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('company')
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('info')
  @ApiOperation({
    summary: 'Get company info',
    description: 'Returns the company name, address, contact details, and numbering configuration.',
  })
  @ApiResponse({ status: 200, description: 'Company info retrieved' })
  async getCompanyInfo(@ActiveCompany() companyId: string) {
    const data = await this.companyService.getCompanyInfo(companyId);
    return data || {};
  }

  @Post('info')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Update company info',
    description:
      'Saves the company profile including name, address, contact details, currency, numbering formats, and PDF config.',
  })
  @ApiResponse({ status: 201, description: 'Company info saved' })
  async postCompanyInfo(@ActiveCompany() companyId: string, @Body() body: EditCompanyDto) {
    const data = await this.companyService.editCompanyInfo(companyId, body);
    return data || {};
  }



  @Get('email-templates')
  @ApiOperation({
    summary: 'Get email templates',
    description:
      'Returns all customizable email templates used for sending documents (invoices, quotes, receipts).',
  })
  @ApiResponse({ status: 200, description: 'Email templates retrieved' })
  async getEmailTemplates(@ActiveCompany() companyId: string) {
    const data = await this.companyService.getEmailTemplates(companyId);
    return data || {};
  }

  @Put('email-templates')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Update an email template',
    description: 'Updates the subject and body of a specific email template identified by its database ID.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        dbId: { type: 'string', description: 'Database ID of the email template' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['dbId', 'subject', 'body'],
    },
  })
  @ApiResponse({ status: 200, description: 'Email template updated' })
  async updateEmailTemplate(
    @ActiveCompany() companyId: string,
    @Body() body: { dbId: string; subject: string; body: string },
  ) {
    const data = await this.companyService.updateEmailTemplate(companyId, body.dbId, body.subject, body.body);
    return data || {};
  }
}
