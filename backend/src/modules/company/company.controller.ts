import { CompanyService } from '@/modules/company/company.service';
import { EditCompanyDto, PDFConfigDto } from '@/modules/company/dto/company.dto';
import { Body, Controller, Get, Post, Put, Sse } from '@nestjs/common';
import { from, interval, map, startWith, switchMap } from 'rxjs';


@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) { }

  @Get('info')
  async getCompanyInfo() {
    const data = await this.companyService.getCompanyInfo();
    return data || {};
  }

  @Sse('info/sse')
  async getCompanyInfoSse() {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.companyService.getCompanyInfo())),
      map((company) => ({ data: JSON.stringify(company) })),
    );
  }

  @Post('info')
  async postCompanyInfo(@Body() body: EditCompanyDto) {
    const data = await this.companyService.editCompanyInfo(body);
    return data || {};
  }

  @Get('pdf-template')
  async getPDFTemplateConfig() {
    const data = await this.companyService.getPDFTemplateConfig();
    return data || {};
  }

  @Post('pdf-template')
  async postPDFTemplateConfig(@Body() body: PDFConfigDto) {
    const data = await this.companyService.editPDFTemplateConfig(body);
    return data || {};
  }

  @Get('email-templates')
  async getEmailTemplates() {
    const data = await this.companyService.getEmailTemplates();
    return data || {};
  }

  @Put('email-templates')
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
