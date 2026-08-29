import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EditCompanyDto, IdentifierEntry, PDFConfigDto } from '@/modules/company/dto/company.dto';
import { MailTemplate, MailTemplateType, WebhookEvent } from '../../../prisma/generated/prisma/client';

import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { createHash } from 'node:crypto';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export interface EmailTemplate {
  dbId: string;
  id: string;
  companyId: string;
  name: string;
  subject: string;
  body: string;
  variables: Record<string, string>;
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
      include: { emailTemplates: true, partyIdentifiers: true },
    });
    if (!company) {
      logger.warn('No company found', { category: 'company', details: { companyId } });
      return null;
    }
    await prisma.$transaction([
      prisma.mailTemplate.upsert({
        where: {
          companyId_type: { companyId: company.id, type: MailTemplateType.SIGNATURE_REQUEST },
        },
        create: {
          companyId: company.id,
          type: MailTemplateType.SIGNATURE_REQUEST,
          subject: 'Please sign document #{{SIGNATURE_NUMBER}}',
          body: '<h2>Document Signature Required</h2><p>Hello,</p><p>You have been requested to sign the following document:</p><div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">  <strong>Document:</strong> {{SIGNATURE_NUMBER}}<br>  <strong>Signature ID:</strong> {{SIGNATURE_ID}}</div><p>Please click the button below to review and sign the document:</p><div style="text-align: center; margin: 30px 0;">  <a href="{{SIGNATURE_URL}}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Sign Document</a></div><p>If you have any questions, please don\'t hesitate to contact us.</p><p>Best regards,<br>The Invoicerr Team</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
        },
        update: {},
      }),
      prisma.mailTemplate.upsert({
        where: {
          companyId_type: { companyId: company.id, type: MailTemplateType.VERIFICATION_CODE },
        },
        create: {
          type: MailTemplateType.VERIFICATION_CODE,
          subject: 'Your verification code',
          body: '<p>Hello,</p><p>Here is your verification code:</p><div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">  <div style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 4px; font-family: monospace;">{{OTP_CODE}}</div></div><p>This code will expire in 10 minutes. Please enter it in the application to complete your verification.</p><p>If you didn\'t request this code, please ignore this email.</p><p>Best regards,<br>The Invoicerr Team</p>',
          companyId: company.id,
        },
        update: {},
      }),
      prisma.mailTemplate.upsert({
        where: {
          companyId_type: { companyId: company.id, type: MailTemplateType.INVOICE },
        },
        create: {
          type: MailTemplateType.INVOICE,
          subject: 'Invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}}',
          body: '<p>Dear {{CLIENT_NAME}},</p><p>Please find attached the invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}}.</p><p>Thank you for your business!</p><p>Best regards,<br>{{COMPANY_NAME}}</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
          companyId: company.id,
        },
        update: {},
      }),
      prisma.mailTemplate.upsert({
        where: {
          companyId_type: { companyId: company.id, type: MailTemplateType.PAYMENT },
        },
        create: {
          type: MailTemplateType.PAYMENT,
          subject: 'Payment #{{PAYMENT_NUMBER}} from {{COMPANY_NAME}}',
          body: '<p>Dear {{CLIENT_NAME}},</p><p>Please find attached the payment receipt #{{PAYMENT_NUMBER}} from {{COMPANY_NAME}}.</p><p>Thank you for your business!</p><p>Best regards,<br>{{COMPANY_NAME}}</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
          companyId: company.id,
        },
        update: {},
      }),
    ]);
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
        emailTemplates: {
          createMany: {
            data: [
              {
                type: 'SIGNATURE_REQUEST',
                subject: 'Please sign document #{{SIGNATURE_NUMBER}}',
                body: '<h2>Document Signature Required</h2><p>Hello,</p><p>You have been requested to sign the following document:</p><div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 20px 0;">  <strong>Document:</strong> {{SIGNATURE_NUMBER}}<br>  <strong>Signature ID:</strong> {{SIGNATURE_ID}}</div><p>Please click the button below to review and sign the document:</p><div style="text-align: center; margin: 30px 0;">  <a href="{{SIGNATURE_URL}}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Sign Document</a></div><p>If you have any questions, please don\'t hesitate to contact us.</p><p>Best regards,<br>The Invoicerr Team</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
              },
              {
                type: 'VERIFICATION_CODE',
                subject: 'Your verification code',
                body: '<p>Hello,</p><p>Here is your verification code:</p><div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">  <div style="font-size: 32px; font-weight: bold; color: #007bff; letter-spacing: 4px; font-family: monospace;">{{OTP_CODE}}</div></div><p>This code will expire in 10 minutes. Please enter it in the application to complete your verification.</p><p>If you didn\'t request this code, please ignore this email.</p><p>Best regards,<br>The Invoicerr Team</p>',
              },
              {
                type: 'INVOICE',
                subject: 'Invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}}',
                body: '<p>Dear {{CLIENT_NAME}},</p><p>Please find attached the invoice #{{INVOICE_NUMBER}} from {{COMPANY_NAME}}.</p><p>Thank you for your business!</p><p>Best regards,<br>{{COMPANY_NAME}}</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
              },
            ],
          },
        },
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

  async getEmailTemplates(companyId: string): Promise<EmailTemplate[]> {
    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
      include: { emailTemplates: true },
    });

    if (!existingCompany?.emailTemplates) {
      logger.error('No email templates found for the company', { category: 'company' });
      throw new BadRequestException('No email templates found for the company');
    }

    return existingCompany.emailTemplates.map((template) => ({
      id: template.type,
      dbId: template.id,
      companyId: existingCompany.id,
      name: template.type
        .replace('_', ' ')
        .toLowerCase()
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
      subject: template.subject,
      body: template.body,
      variables: {
        APP_URL: process.env.APP_URL || 'http://localhost:3000',
        ...(template.type === MailTemplateType.SIGNATURE_REQUEST && {
          SIGNATURE_ID: randomUUID(),
          SIGNATURE_NUMBER: 'QUOTE-2025-0001',
          SIGNATURE_URL: `${process.env.APP_URL || 'http://localhost:3000'}/signature/${randomUUID()}`,
        }),
        ...(template.type === MailTemplateType.VERIFICATION_CODE && {
          OTP_CODE: '1234-5678',
        }),
        ...(template.type === MailTemplateType.INVOICE && {
          INVOICE_NUMBER: 'INV-2025-0001',
          CLIENT_NAME: 'Acme',
          COMPANY_NAME: existingCompany.name,
        }),
        ...(template.type === MailTemplateType.PAYMENT && {
          PAYMENT_NUMBER: 'PAY-2025-0001',
          CLIENT_NAME: 'Acme',
          COMPANY_NAME: existingCompany.name,
        }),
      },
    }));
  }

  async updateEmailTemplate(companyId: string, id: MailTemplate['id'], subject: string, body: string) {
    let existingTemplate = await prisma.mailTemplate.findFirst({
      where: { id, companyId },
      include: { company: true },
    });
    if (!existingTemplate) {
      logger.error(`Email template with id ${id} not found`, { category: 'company', details: { id } });
      throw new BadRequestException(`Email template with id ${id} not found`);
    }

    existingTemplate = await prisma.mailTemplate.update({
      where: { id },
      data: {
        subject,
        body,
      },
      include: { company: true },
    });

    logger.info('Email template updated', { category: 'company', details: { templateId: id } });
    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_EMAIL_TEMPLATE_UPDATED, {
        company: existingTemplate.company,
        template: existingTemplate,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_EMAIL_TEMPLATE_UPDATED webhook', {
        category: 'company',
        details: { error },
      });
    }
    return existingTemplate;
  }
}
