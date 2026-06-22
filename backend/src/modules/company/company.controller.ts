import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto, PDFConfigDto } from '@/modules/company/dto/company.dto';
import { Body, Controller, Get, Post, Put, Sse } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { from, interval, map, startWith, switchMap } from 'rxjs';


@ApiTags('company')
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) { }

  @Get('info')
  @ApiOperation({ summary: 'Get company info', description: 'Returns the company name, address, contact details, and numbering configuration.' })
  @ApiResponse({ status: 200, description: 'Company info retrieved' })
  async getCompanyInfo() {
    const data = await this.companyService.getCompanyInfo();
    return data || {};
  }

  @Sse('info/sse')
  @ApiOperation({ summary: 'Subscribe to company info updates', description: 'Server-sent event stream that pushes company info every second.' })
  async getCompanyInfoSse() {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.companyService.getCompanyInfo())),
      map((company) => ({ data: JSON.stringify(company) })),
    );
  }

  @Post('info')
  @ApiOperation({ summary: 'Create or update company info', description: 'Saves the company profile including name, address, contact details, currency, numbering formats, and PDF config.' })
  @ApiResponse({ status: 201, description: 'Company info saved' })
  async postCompanyInfo(@Body() body: EditCompanyDto) {
    const data = await this.companyService.editCompanyInfo(body);
    return data || {};
  }

  @Get('pdf-template')
  @ApiOperation({ summary: 'Get PDF template configuration', description: 'Returns the PDF styling config: fonts, colors, padding, logo, and label translations.' })
  @ApiResponse({ status: 200, description: 'PDF template config retrieved' })
  async getPDFTemplateConfig() {
    const data = await this.companyService.getPDFTemplateConfig();
    return data || {};
  }

  @Post('pdf-template')
  @ApiOperation({ summary: 'Update PDF template configuration', description: 'Updates the PDF styling config: fonts, colors, padding, logo, and label translations.' })
  @ApiResponse({ status: 201, description: 'PDF template config saved' })
  async postPDFTemplateConfig(@Body() body: PDFConfigDto) {
    const data = await this.companyService.editPDFTemplateConfig(body);
    return data || {};
  }

  @Get('email-templates')
  @ApiOperation({ summary: 'Get email templates', description: 'Returns all customizable email templates used for sending documents (invoices, quotes, receipts).' })
  @ApiResponse({ status: 200, description: 'Email templates retrieved' })
  async getEmailTemplates() {
    const data = await this.companyService.getEmailTemplates();
    return data || {};
  }

  @Put('email-templates')
  @ApiOperation({ summary: 'Update an email template', description: 'Updates the subject and body of a specific email template identified by its database ID.' })
  @ApiBody({ schema: { type: 'object', properties: { dbId: { type: 'string', description: 'Database ID of the email template' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['dbId', 'subject', 'body'] } })
  @ApiResponse({ status: 200, description: 'Email template updated' })
  async updateEmailTemplate(
    @Body() body: { dbId: string; subject: string; body: string },
  ) {
    const data = await this.companyService.updateEmailTemplate(
      body.dbId,
      body.subject,
      body.body,
    );
    return data || {};
  }
}
