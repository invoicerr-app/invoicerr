import { EditCompanyDto } from '@/modules/company/dto/company.dto';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CompanyService } from '@/modules/company/company.service';
import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { Roles } from '@/decorators/roles.decorator';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import {
  SetCompanyMailReplyToDto,
  SetCompanyMailSettingsDto,
} from '@/modules/company/mail-settings/company-mail-settings.dto';
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
   * GET /api/company/number-formats - issue #496: the document number format each numbered type of
   * this company is issued with, where it comes from (the country's own format, or a running series
   * kept for continuity), the next number it would print, and every rule that constrains it with its
   * source. Read-only: see `updateNumberFormat` below.
   */
  @Get('number-formats')
  @RequiresScope('company:read')
  @ApiOperation({
    summary: 'Get the document number formats that apply, and why',
    description:
      'Number formats are defined per country and document type, from the rules that constrain them ' +
      '(law, e-invoicing formats, clearance platforms), and cannot be changed by the company. A series ' +
      'the company started before that rule is kept while it satisfies those constraints.',
  })
  @ApiResponse({ status: 200, description: 'Number formats retrieved' })
  async getNumberFormats(@ActiveCompany() companyId: string) {
    return this.companyService.getNumberFormats(companyId);
  }

  /**
   * PUT /api/company/number-format - kept only to REFUSE (405), with the reason (issue #496): a
   * number format is no longer the company's to change. See `company.service.ts#updateNumberFormat`.
   */
  @Put('number-format')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: 'Refused: number formats cannot be changed',
    description:
      'Always answers 405. Number formats are defined per country and document type; ' +
      'GET /api/company/number-formats shows which applies and why.',
  })
  @ApiResponse({ status: 405, description: 'Number formats cannot be changed' })
  updateNumberFormat() {
    return this.companyService.updateNumberFormat();
  }

  /**
   * GET /api/company/revenue-settings - issue #516: the RESOLVED revenue basis/period (this
   * company's own explicit choice, or the computed per-country default), plus whether each is
   * explicit - the settings screen uses this to show "default" vs. "your own choice" without
   * duplicating `resolve-revenue-basis.ts`'s own per-country table client-side.
   */
  @Get('revenue-settings')
  @RequiresScope('company:read')
  @ApiOperation({
    summary: 'Get the resolved revenue basis/period (explicit choice, or the computed default)',
    description:
      'invoiced/cashed and monthly/quarterly, defaulted from the company’s own country where a ' +
      'clear regime exists (see resolve-revenue-basis.ts), always overridable through POST /api/company/info.',
  })
  @ApiResponse({ status: 200, description: 'Resolved revenue settings' })
  async getRevenueSettings(@ActiveCompany() companyId: string) {
    return this.companyService.getRevenueSettings(companyId);
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
   * PUT /api/company/mail-settings/reply-to — sets or clears this company's own Reply-To override,
   * applied to every outgoing message sent for it. Independent of the SMTP/Resend override above: a
   * company can set this without running its own mail server at all. `null`/omitted clears back to
   * "use the instance's own MAIL_REPLY_TO" (or no Reply-To header at all when that is unset too).
   */
  @Put('mail-settings/reply-to')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: "Set this company's own Reply-To address",
    description:
      'Applied to every outgoing message sent for this company, winning over the instance-level ' +
      'MAIL_REPLY_TO. Validated as an e-mail address here, at write time. null/omitted clears it.',
  })
  @ApiBody({
    schema: { type: 'object', properties: { replyTo: { type: 'string', nullable: true } } },
  })
  @ApiResponse({ status: 200, description: 'Reply-To saved' })
  @ApiResponse({ status: 400, description: 'replyTo is not a valid e-mail address' })
  async setMailReplyTo(@ActiveCompany() companyId: string, @Body() body: SetCompanyMailReplyToDto) {
    return this.companyMailSettingsService.setReplyTo(companyId, body);
  }

  /**
   * POST /api/company/mail-settings/test — sends a real test email to the CALLER's own address
   * (never an address from the request body — see `CompanyMailSettingsService#sendTest`'s own header)
   * through this company's actual send cascade, and reports the reason it failed, vetted: which
   * distinctions survive and which collapse is `mail-endpoint-guard.ts`'s decision, documented there.
   *
   * Same roles as the PUT that sets the host in the first place. This route makes the server open a
   * socket to an address a member of this company chose, so "who may make it connect" must not be a
   * wider set than "who may choose where" — it used to be every MEMBER, which meant the narrowest role
   * in a company could drive a connection attempt the role above it configured.
   */
  @Post('mail-settings/test')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
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
      'failure reason (credentials rejected, address not allowed, nothing configured at all, ...). ' +
      'Every network-level outcome reports identically — see the mail endpoint guard.',
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
