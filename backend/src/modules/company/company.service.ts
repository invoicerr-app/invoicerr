import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EditCompanyDto, IdentifierEntry, PDFConfigDto } from '@/modules/company/dto/company.dto';
import { MailTemplateType, WebhookEvent } from '../../../prisma/generated/prisma/client';

import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { createHash } from 'node:crypto';
import { logger } from '@/logger/logger.service';
import { sanitizeEmailHtml } from '@/mail/sanitize-email-html';
import {
  describeSystemEmailVocabulary,
  resolveSystemEmailTemplate,
  SYSTEM_EMAIL_FAMILIES,
  SystemEmailFamily,
  systemEmailFamilyLabel,
} from '@/mail/system-email-templates';
import { renderEmailTemplate } from '@/modules/documents/actions/email-template';
import prisma from '@/prisma/prisma.service';

/**
 * One SYSTEM email template, as this module's settings routes hand it over — the signature request and
 * the verification code only. A DOCUMENT type's email is a different mechanism, keyed by type rather
 * than by a closed enum: see `documents/actions/company-email-templates.ts` and
 * `GET /api/documents/email-templates`.
 */
export interface EmailTemplate {
  /** The stored override's row id, or '' when this company has none and the shipped default applies —
   *  which is what makes `source` below worth reporting rather than inferring from a string compare. */
  dbId: string;
  id: SystemEmailFamily;
  companyId: string;
  name: string;
  subject: string;
  /** HTML — see `MailTemplate.body`'s own schema comment. The text/plain alternative is derived from it
   *  at send time (`email-template.ts#deriveTextFromHtml`), never stored twice. */
  body: string;
  source: 'company' | 'default';
  variables: Record<string, string>;
}

/** Where the sample `{appUrl}` in a preview points, and what the senders interpolate — one fallback,
 *  spelled once. */
function appUrl(): string {
  return process.env.APP_URL || 'http://localhost:3000';
}

@Injectable()
export class CompanyService {
  private lastCompanyHash?: string;

  private computeHash(payload: any): string {
    try {
      const hash = createHash('sha1');
      hash.update(JSON.stringify(payload));
      return hash.digest('hex');
    } catch (e) {
      return String(Date.now());
    }
  }

  constructor(private readonly webhookDispatcher: WebhookDispatcherService) {}

  async getCompanyInfo(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });
    if (!company) {
      logger.warn('No company found', { category: 'company', details: { companyId } });
      return null;
    }
    // Compute hash and log only on init or when company data changed
    const companyData = company;
    const hash = this.computeHash(companyData);
    if (!this.lastCompanyHash) {
      this.lastCompanyHash = hash;
      logger.info('Company fetch initialized', {
        category: 'company',
        details: { companyId: company.id, hash },
      });
    } else if (this.lastCompanyHash !== hash) {
      this.lastCompanyHash = hash;
      logger.info('Company fetched data changed', {
        category: 'company',
        details: { companyId: company.id, hash },
      });
    }
    return await prisma.company.findUnique({ where: { id: companyId }, include: { partyIdentifiers: true } });
  }

  private async upsertPartyIdentifiers(companyId: string, identifiers: IdentifierEntry[] | undefined) {
    if (!identifiers) return;

    const existing = await prisma.partyIdentifier.findMany({
      where: { companyId },
    });

    const incomingSchemes = new Set(identifiers.map((i) => i.scheme));

    // Delete rows whose scheme is no longer present
    for (const row of existing) {
      if (!incomingSchemes.has(row.scheme)) {
        await prisma.partyIdentifier.delete({ where: { id: row.id } });
      }
    }

    // Upsert each submitted entry
    for (const entry of identifiers) {
      await prisma.partyIdentifier.upsert({
        where: { companyId_scheme: { companyId, scheme: entry.scheme } },
        create: { companyId, scheme: entry.scheme, value: entry.value },
        update: { value: entry.value },
      });
    }
  }

  async editCompanyInfo(companyId: string, editCompanyDto: EditCompanyDto) {
    const { pdfConfig, identifiers, ...rest } = editCompanyDto;

    const existingCompany = await prisma.company.findUnique({ where: { id: companyId } });
    if (!existingCompany) {
      throw new NotFoundException('Company not found');
    }

    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...rest,
      },
    });

    await this.upsertPartyIdentifiers(companyId, identifiers);

    logger.info('Company info updated', { category: 'company', details: { companyId: updatedCompany.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_UPDATED, {
        company: updatedCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_UPDATED webhook', { category: 'company', details: { error } });
    }

    return updatedCompany;
  }

  // Creates a brand-new company and makes the creating user its OWNER —
  // used both for a first-time user's onboarding and for an existing user
  // starting an additional company from the company switcher.
  async createCompany(userId: string, editCompanyDto: EditCompanyDto) {
    const { identifiers, ...data } = editCompanyDto;

    const newCompany = await prisma.company.create({
      data: {
        // Sensible blanks for the fields the simplified onboarding (name + country
        // only) doesn't collect — the user fills these in later via Settings.
        foundedAt: new Date(),
        address: '',
        postalCode: '',
        city: '',
        phone: '',
        email: '',
        ...data,
      },
    });

    await prisma.userCompany.create({
      data: { userId, companyId: newCompany.id, role: 'OWNER' },
    });

    await this.upsertPartyIdentifiers(newCompany.id, identifiers);

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_CREATED, {
        company: newCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_CREATED webhook', error);
    }

    return newCompany;
  }

  /**
   * The two SYSTEM emails, each resolved to what ACTUALLY applies: this company's own `MailTemplate`
   * override when it has one, else the copy shipped in code (`mail/system-email-templates.ts`). Driven by
   * `SYSTEM_EMAIL_FAMILIES` rather than a list written down here, so a family added to the enum cannot
   * be silently missing from this response.
   *
   * Nothing is seeded to make this work. A company whose rows were never created — or were deleted
   * (`danger.service.ts`'s reset does exactly that) — still gets both templates here and can still send
   * both emails: "no row" means "the shipped default applies", never "unconfigured". That is what
   * replaced the upsert this method's own caller used to fire on every read of a company's info.
   */
  async getEmailTemplates(companyId: string): Promise<EmailTemplate[]> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { emailTemplates: true },
    });
    if (!company) {
      logger.warn('No company found for email templates', { category: 'company', details: { companyId } });
      throw new NotFoundException('Company not found');
    }

    return SYSTEM_EMAIL_FAMILIES.map((family): EmailTemplate => {
      const row = company.emailTemplates.find((candidate) => candidate.type === family) ?? null;
      const template = resolveSystemEmailTemplate(family, row);

      return {
        dbId: row?.id ?? '',
        id: family,
        companyId: company.id,
        name: systemEmailFamilyLabel(family),
        subject: template.subject,
        // The html part: this is the field the settings editor writes, and `MailTemplate.body` has held
        // html since it existed. The text/plain alternative is never stored — it is derived from this at
        // send time (`email-template.ts#deriveTextFromHtml`).
        body: template.html ?? template.body,
        source: row ? 'company' : 'default',
        variables: describeSystemEmailVocabulary(family, appUrl()),
      };
    });
  }

  /**
   * Saves this company's override of one system email.
   *
   * The family is identified by `id` (the family name) or by `dbId`, the row id a screen holding an
   * already-stored override will have — resolved TENANT-SCOPED, so a `dbId` belonging to another company
   * is simply not found rather than updated. An upsert, not an update: the row IS the override, and a
   * company overriding a shipped default for the first time has no row yet.
   *
   * Refused (400): an unidentifiable family, a blank subject, an empty body — none of those is a
   * sendable email. REPORTED in `warnings`, never refused: an unknown `{placeholder}`, exactly as the
   * engine documents (`renderEmailTemplate`). A typo in a verification-code template must never be what
   * stops a code from reaching someone mid-signature.
   */
  async updateEmailTemplate(
    companyId: string,
    input: { id?: string; dbId?: string; subject: string; body: string },
  ): Promise<EmailTemplate & { warnings: string[] }> {
    const family = await this.resolveSystemEmailFamily(companyId, input);
    const subject = input.subject ?? '';
    // Sanitized BEFORE the emptiness check (`mail/sanitize-email-html.ts`), so markup that is nothing
    // but a script tag is refused as an empty body rather than stored as one.
    const body = sanitizeEmailHtml(input.body ?? '');
    if (subject.trim() === '') {
      throw new BadRequestException('An email template needs a subject.');
    }
    if (body.trim() === '') {
      throw new BadRequestException('An email template needs a body.');
    }

    const row = await prisma.mailTemplate.upsert({
      where: { companyId_type: { companyId, type: family } },
      create: { companyId, type: family, subject, body },
      update: { subject, body },
      include: { company: true },
    });

    const variables = describeSystemEmailVocabulary(family, appUrl());
    const { warnings } = renderEmailTemplate(resolveSystemEmailTemplate(family, row), variables);

    logger.info('Email template updated', {
      category: 'company',
      details: { templateId: row.id, family, warningCount: warnings.length },
    });
    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED, {
        company: row.company,
        template: { id: row.id, type: row.type, subject: row.subject, body: row.body },
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_EMAIL_TEMPLATE_UPDATED webhook', {
        category: 'company',
        details: { error },
      });
    }

    return {
      dbId: row.id,
      id: family,
      companyId,
      name: systemEmailFamilyLabel(family),
      subject: row.subject,
      body: row.body,
      source: 'company',
      variables,
      warnings,
    };
  }

  /** Which family a write targets — by name when the caller knows it, else by the row id of an override
   *  it already holds. The `dbId` lookup carries `companyId`, so it can only ever resolve a row this
   *  tenant owns; an id from another company falls through to the same refusal as a missing one. */
  private async resolveSystemEmailFamily(
    companyId: string,
    input: { id?: string; dbId?: string },
  ): Promise<SystemEmailFamily> {
    const named = SYSTEM_EMAIL_FAMILIES.find((family) => family === input.id);
    if (named) return named;

    if (input.dbId) {
      const row = await prisma.mailTemplate.findFirst({
        where: { id: input.dbId, companyId },
        select: { type: true },
      });
      if (row) return row.type;
    }

    throw new BadRequestException(
      `Unknown email template — identify it by id (${SYSTEM_EMAIL_FAMILIES.join(' | ')}) or by dbId.`,
    );
  }
}
