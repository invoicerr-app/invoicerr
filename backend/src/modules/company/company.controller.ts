import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Roles } from '@/decorators/roles.decorator';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import { SetCompanyMailSettingsDto } from '@/modules/company/mail-settings/company-mail-settings.dto';
import { CompanyMailSettingsService } from '@/modules/company/mail-settings/company-mail-settings.service';
import { resolveUserLanguage } from '@/modules/documents/rendering/language/resolve-user-language';
import { RequiresScope } from '@/utils/scope-check';

@ApiTags('company')
@Controller('company')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly companyMailSettingsService: CompanyMailSettingsService,
  ) {}

  @Get('info')
  @RequiresScope('company:read')
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
  @RequiresScope('company:write')
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
  @RequiresScope('company:write')
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
  @RequiresScope('company:read')
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
  @RequiresScope('company:write')
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

  /**
   * GET /api/company/mail-settings — the company-level step of the mail-server cascade: whether this
   * company has its OWN mail server configured (status only — never the SMTP password / Resend API
   * key, see `CompanyMailSettingsStatus`'s own header). Absent/`configured: false` means sends for this
   * company fall back to this INSTANCE's own provider (`MailService#sendForCompany`'s own cascade).
   */
  @Get('mail-settings')
  @RequiresScope('company:read')
  @ApiOperation({
    summary: "Get this company's own mail server status",
    description:
      'Status only (configured + kind + fromAddress) — never a secret. Falls back to the instance-' +
      'level provider when unconfigured.',
  })
  @ApiResponse({ status: 200, description: 'Mail settings status retrieved' })
  async getMailSettings(@ActiveCompany() companyId: string) {
    return this.companyMailSettingsService.getStatus(companyId);
  }

  /**
   * PUT /api/company/mail-settings — connects/updates this company's own mail server (SMTP or
   * Resend). Encrypted at rest via the existing `CompanyChannelConfig`/`ChannelCredentialsService`
   * mechanism (503 if `CREDENTIALS_ENCRYPTION_KEY` is not configured on this server).
   */
  @Put('mail-settings')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: "Set this company's own mail server",
    description:
      'Body is discriminated by "kind": "smtp" (host, port, secure, username, password, ' +
      'fromAddress) or "resend" (apiKey, fromAddress). Replaces any existing configuration.',
  })
  @ApiBody({
    schema: {
      oneOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['smtp'] },
            host: { type: 'string' },
            port: { type: 'number' },
            secure: { type: 'boolean' },
            username: { type: 'string' },
            password: { type: 'string' },
            fromAddress: { type: 'string' },
          },
          required: ['kind', 'host', 'port', 'username', 'password', 'fromAddress'],
        },
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['resend'] },
            apiKey: { type: 'string' },
            fromAddress: { type: 'string' },
          },
          required: ['kind', 'apiKey', 'fromAddress'],
        },
      ],
    },
  })
  @ApiResponse({ status: 200, description: 'Mail settings saved' })
  @ApiResponse({ status: 400, description: 'Missing required field for the given "kind"' })
  @ApiResponse({ status: 503, description: 'CREDENTIALS_ENCRYPTION_KEY is not configured' })
  async setMailSettings(@ActiveCompany() companyId: string, @Body() body: SetCompanyMailSettingsDto) {
    return this.companyMailSettingsService.set(companyId, body);
  }

  /** DELETE /api/company/mail-settings — clears this company's own mail server; sends for it then
   *  fall back to the instance level (or a named refusal — see `MailService#sendForCompany`). */
  @Delete('mail-settings')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: "Clear this company's own mail server",
    description: 'Falls back to the instance-level provider (or a named refusal if none is set either).',
  })
  @ApiResponse({ status: 200, description: 'Mail settings cleared' })
  async deleteMailSettings(@ActiveCompany() companyId: string) {
    return this.companyMailSettingsService.clear(companyId);
  }

  /**
   * POST /api/company/mail-settings/test — sends a real test email to the CALLER's own address
   * (never an address from the request body — see `CompanyMailSettingsService#sendTest`'s own header)
   * through this company's actual send cascade, and returns the REAL provider error on failure rather
   * than a generic "check your configuration" message.
   */
  @Post('mail-settings/test')
  @RequiresScope('company:write')
  // Nest's default for POST is 201 (Created) — wrong here, this action creates nothing (see
  // `verifyDomain` in sso.controller.ts for the same "action, not creation" precedent). Without this,
  // the route's own `@ApiResponse({ status: 200 })` right below was already lying about what it
  // actually returned — see 65-company-mail-settings.cy.ts's own CI-run comment on how that surfaced.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send a test email to yourself',
    description:
      "Exercises this company's real société → instance → refus-nommé mail cascade and reports the " +
      'actual failure reason (bad credentials, unreachable host, nothing configured at all, ...).',
  })
  @ApiResponse({ status: 200, description: 'Test email sent' })
  @ApiResponse({ status: 400, description: 'The real send failure — see the message' })
  async testMailSettings(@ActiveCompany() companyId: string, @User() user: CurrentUser) {
    // The requester's own language, no company-language fallback (`resolveRecipientLanguage`'s own
    // second step is for a document's recipient, not the OWNER/ADMIN clicking a settings button).
    const language = resolveUserLanguage(user.locale, undefined);
    return this.companyMailSettingsService.sendTest(companyId, user.email, language);
  }
}
