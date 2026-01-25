import { Body, Controller, Get, Post, Put, Req, Sse } from '@nestjs/common';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import { CompanyId } from '@/decorators/company.decorator';
import { SkipCompanyGuard } from '@/decorators/skip-company.decorator';
import { CompanyService } from '@/modules/company/company.service';
import type { EditCompanyDto, PDFConfigDto } from '@/modules/company/dto/company.dto';
import type { RequestWithUser } from '@/types/request';
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('user-companies')
  @SkipCompanyGuard()
  async getUserCompanies(@Req() req: RequestWithUser) {
    return this.companyService.getUserCompanies(req.user.id);
  }

  @Get('info')
  async getCompanyInfo(@CompanyId() companyId: string) {
    const data = await this.companyService.getCompanyInfo(companyId);
    return data || {};
  }

  @Sse('info/sse')
  async getCompanyInfoSse(@CompanyId() companyId: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.companyService.getCompanyInfo(companyId))),
      map((company) => ({ data: JSON.stringify(company) })),
    );
  }

  @Post('info')
  async postCompanyInfo(@CompanyId() companyId: string, @Body() body: EditCompanyDto) {
    const data = await this.companyService.editCompanyInfo(companyId, body);
    return data || {};
  }

  @Get('pdf-template')
  async getPDFTemplateConfig(@CompanyId() companyId: string) {
    const data = await this.companyService.getPDFTemplateConfig(companyId);
    return data || {};
  }

  @Post('pdf-template')
  async postPDFTemplateConfig(@CompanyId() companyId: string, @Body() body: PDFConfigDto) {
    const data = await this.companyService.editPDFTemplateConfig(companyId, body);
    return data || {};
  }

  @Get('email-templates')
  async getEmailTemplates(@CompanyId() companyId: string) {
    const data = await this.companyService.getEmailTemplates(companyId);
    return data || {};
  }

  @Put('email-templates')
  async updateEmailTemplate(
    @CompanyId() companyId: string,
    @Body() body: { dbId: string; subject: string; body: string },
  ) {
    const data = await this.companyService.updateEmailTemplate(
      companyId,
      body.dbId,
      body.subject,
      body.body,
    );
    return data || {};
  }

  @Post('create')
  @SkipCompanyGuard()
  async createCompany(@Req() req: RequestWithUser, @Body() body: EditCompanyDto) {
    return this.companyService.createCompany(req.user.id, body);
  }

  @Post('set-default')
  @SkipCompanyGuard()
  async setDefaultCompany(@Req() req: RequestWithUser, @Body() body: { companyId: string }) {
    return this.companyService.setDefaultCompany(req.user.id, body.companyId);
  }
}
