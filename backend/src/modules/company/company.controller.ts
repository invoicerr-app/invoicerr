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

  /**
   * PUT /api/company/number-format — sets ONE document type's own number-format pattern
   * (`Company.numberFormats`, `documents/numbering/format-number.ts`). See
   * `company.service.ts#updateNumberFormat`'s own header for why this is its own small endpoint
   * rather than a field on `POST info` above. Today's one real caller is the Portuguese ATCUD
   * settings screen (`documents/numbering/atcud.ts#parseAtcudPattern` requires a "/{number...}"-shaped
   * pattern before an invoice can even be numbered) — nothing here names Portugal, or any country.
   */
  @Put('number-format')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: "Set one document type's own number-format pattern",
    description:
      'Merges `{ [typeId]: pattern }` into Company.numberFormats — e.g. `{ "typeId": "invoice", ' +
      '"pattern": "FT {year}/{number:4}" }`. Rejects a pattern with no "{number}" token.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        typeId: { type: 'string', example: 'invoice' },
        pattern: { type: 'string', example: 'FT {year}/{number:4}' },
      },
      required: ['typeId', 'pattern'],
    },
  })
  @ApiResponse({ status: 200, description: 'Number format updated' })
  async updateNumberFormat(
    @ActiveCompany() companyId: string,
    @Body() body: { typeId: string; pattern: string },
  ) {
    return this.companyService.updateNumberFormat(companyId, body.typeId, body.pattern);
  }

  @Get('email-templates')
  @ApiOperation({
    summary: 'Get the system email templates',
    description:
      'The two emails that are not about a document — the signature request and the verification ' +
      "code — each resolved to what actually applies (this company's own override, else the copy " +
      'shipped in code), with the `variables` that family offers mapped to sample values. A ' +
      "DOCUMENT's email lives elsewhere, per document type: GET /api/documents/email-templates.",
  })
  @ApiResponse({ status: 200, description: 'Email templates retrieved' })
  async getEmailTemplates(@ActiveCompany() companyId: string) {
    const data = await this.companyService.getEmailTemplates(companyId);
    return data || {};
  }

  @Put('email-templates')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Update a system email template',
    description:
      "Saves this company's override of one system email. The template is identified by `id` (the " +
      'family: SIGNATURE_REQUEST or VERIFICATION_CODE) or, for a company that already has a stored ' +
      'row, by `dbId`. `body` is html and is sanitized server-side before storage; the text/plain ' +
      'alternative is derived from it at send time. An unknown `{placeholder}` comes back in ' +
      '`warnings` rather than being rejected — a typo must never be what stops a verification code.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Template family (SIGNATURE_REQUEST | VERIFICATION_CODE)' },
        dbId: { type: 'string', description: 'Database ID of an already-stored override' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Html body' },
      },
      required: ['subject', 'body'],
    },
  })
  @ApiResponse({ status: 200, description: 'Email template updated, with any placeholder warnings' })
  @ApiResponse({ status: 400, description: 'Unidentifiable family, blank subject, or empty body' })
  async updateEmailTemplate(
    @ActiveCompany() companyId: string,
    @Body() body: { id?: string; dbId?: string; subject: string; body: string },
  ) {
    const data = await this.companyService.updateEmailTemplate(companyId, body);
    return data || {};
  }
}
