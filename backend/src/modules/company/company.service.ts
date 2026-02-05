import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import type { EditCompanyDto, PDFConfigDto } from '@/modules/company/dto/company.dto';
import prisma from '@/prisma/prisma.service';
import {
  type MailTemplate,
  MailTemplateType,
  WebhookEvent,
} from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

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
    } catch (_e) {
      return String(Date.now());
    }
  }

  constructor(private readonly webhookDispatcher: WebhookDispatcherService) {}

  async getCompanyInfo(companyId: string) {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: { emailTemplates: true },
    });
    if (!company) {
      logger.warn('Company not found', { category: 'company', details: { companyId } });
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
          companyId_type: { companyId: company.id, type: MailTemplateType.RECEIPT },
        },
        create: {
          type: MailTemplateType.RECEIPT,
          subject: 'Receipt #{{RECEIPT_NUMBER}} from {{COMPANY_NAME}}',
          body: '<p>Dear {{CLIENT_NAME}},</p><p>Please find attached the receipt #{{RECEIPT_NUMBER}} from {{COMPANY_NAME}}.</p><p>Thank you for your business!</p><p>Best regards,<br>{{COMPANY_NAME}}</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
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
    return await prisma.company.findUnique({
      where: { id: companyId },
    });
  }

  async getPDFTemplateConfig(companyId: string): Promise<PDFConfigDto> {
    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
      include: { pdfConfig: true },
    });

    if (!existingCompany?.pdfConfig) {
      logger.error('No PDF configuration found for the company', {
        category: 'company',
        details: { companyId },
      });
      throw new BadRequestException('No PDF configuration found for the company');
    }

    return {
      fontFamily: existingCompany.pdfConfig.fontFamily,
      includeLogo: existingCompany.pdfConfig.includeLogo,
      logoB64: existingCompany.pdfConfig.logoB64,
      padding: existingCompany.pdfConfig.padding,
      primaryColor: existingCompany.pdfConfig.primaryColor,
      secondaryColor: existingCompany.pdfConfig.secondaryColor,

      labels: {
        // Receipt-specific labels
        receipt: existingCompany.pdfConfig.receipt,
        receivedFrom: existingCompany.pdfConfig.receivedFrom,
        invoiceRefer: existingCompany.pdfConfig.invoiceRefer,
        paymentDate: existingCompany.pdfConfig.paymentDate,
        totalReceived: existingCompany.pdfConfig.totalReceived,

        // Generic / shared labels
        billTo: existingCompany.pdfConfig.billTo,
        description: existingCompany.pdfConfig.description,
        date: existingCompany.pdfConfig.date,
        dueDate: existingCompany.pdfConfig.dueDate,
        grandTotal: existingCompany.pdfConfig.grandTotal,
        invoice: existingCompany.pdfConfig.invoice,
        quantity: existingCompany.pdfConfig.quantity,
        quote: existingCompany.pdfConfig.quote,
        quoteFor: existingCompany.pdfConfig.quoteFor,
        subtotal: existingCompany.pdfConfig.subtotal,
        total: existingCompany.pdfConfig.total,
        unitPrice: existingCompany.pdfConfig.unitPrice,
        validUntil: existingCompany.pdfConfig.validUntil,
        vat: existingCompany.pdfConfig.vat,
        vatRate: existingCompany.pdfConfig.vatRate,
        notes: existingCompany.pdfConfig.notes,
        paymentMethod: existingCompany.pdfConfig.paymentMethod,
        paymentDetails: existingCompany.pdfConfig.paymentDetails,

        // Payment method display labels
        paymentMethodBankTransfer: existingCompany.pdfConfig.paymentMethodBankTransfer,
        paymentMethodPayPal: existingCompany.pdfConfig.paymentMethodPayPal,
        paymentMethodCash: existingCompany.pdfConfig.paymentMethodCash,
        paymentMethodCheck: existingCompany.pdfConfig.paymentMethodCheck,
        paymentMethodOther: existingCompany.pdfConfig.paymentMethodOther,

        type: existingCompany.pdfConfig.type,
        hour: existingCompany.pdfConfig.hour,
        day: existingCompany.pdfConfig.day,
        deposit: existingCompany.pdfConfig.deposit,
        service: existingCompany.pdfConfig.service,
        product: existingCompany.pdfConfig.product,

        legalId: existingCompany.pdfConfig.legalId,
        VATId: existingCompany.pdfConfig.VATId,
      },
    };
  }

  async editPDFTemplateConfig(companyId: string, pdfConfig: PDFConfigDto) {
    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
      include: { pdfConfig: true },
    });

    if (!existingCompany?.pdfConfig) {
      logger.error('No PDF configuration found for the company', {
        category: 'company',
        details: { companyId },
      });
      throw new BadRequestException('No PDF configuration found for the company');
    }

    const updatedConfig = await prisma.pDFConfig.update({
      where: { id: existingCompany.pdfConfig.id }, // ✅ ici on utilise un identifiant unique
      data: {
        fontFamily: pdfConfig.fontFamily,
        includeLogo: pdfConfig.includeLogo,
        logoB64: pdfConfig.logoB64,
        padding: pdfConfig.padding,
        primaryColor: pdfConfig.primaryColor,
        secondaryColor: pdfConfig.secondaryColor,

        // Receipt-specific labels
        receipt: pdfConfig.labels.receipt,
        receivedFrom: pdfConfig.labels.receivedFrom,
        invoiceRefer: pdfConfig.labels.invoiceRefer,
        paymentDate: pdfConfig.labels.paymentDate,
        totalReceived: pdfConfig.labels.totalReceived,

        // Generic / shared labels
        billTo: pdfConfig.labels.billTo,
        description: pdfConfig.labels.description,
        dueDate: pdfConfig.labels.dueDate,
        date: pdfConfig.labels.date,
        grandTotal: pdfConfig.labels.grandTotal,
        invoice: pdfConfig.labels.invoice,
        quantity: pdfConfig.labels.quantity,
        quote: pdfConfig.labels.quote,
        quoteFor: pdfConfig.labels.quoteFor,
        subtotal: pdfConfig.labels.subtotal,
        total: pdfConfig.labels.total,
        unitPrice: pdfConfig.labels.unitPrice,
        validUntil: pdfConfig.labels.validUntil,
        vat: pdfConfig.labels.vat,
        vatRate: pdfConfig.labels.vatRate,

        notes: pdfConfig.labels.notes,
        paymentMethod: pdfConfig.labels.paymentMethod,
        paymentDetails: pdfConfig.labels.paymentDetails,

        // Payment method display labels
        paymentMethodBankTransfer: pdfConfig.labels.paymentMethodBankTransfer,
        paymentMethodPayPal: pdfConfig.labels.paymentMethodPayPal,
        paymentMethodCash: pdfConfig.labels.paymentMethodCash,
        paymentMethodCheck: pdfConfig.labels.paymentMethodCheck,
        paymentMethodOther: pdfConfig.labels.paymentMethodOther,

        type: pdfConfig.labels.type,
        hour: pdfConfig.labels.hour,
        day: pdfConfig.labels.day,
        deposit: pdfConfig.labels.deposit,
        service: pdfConfig.labels.service,
        product: pdfConfig.labels.product,

        legalId: pdfConfig.labels.legalId,
        VATId: pdfConfig.labels.VATId,
      },
    });

    logger.info('Company PDF config updated', {
      category: 'company',
      details: { companyId: existingCompany.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_PDF_CONFIG_UPDATED, {
        config: updatedConfig,
        company: existingCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_PDF_CONFIG_UPDATED webhook', {
        category: 'company',
        details: { error },
      });
    }

    return updatedConfig;
  }

  async editCompanyInfo(companyId: string, editCompanyDto: EditCompanyDto) {
    const data = { ...editCompanyDto };
    const existingCompany = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!existingCompany) {
      logger.error('Company not found', { category: 'company', details: { companyId } });
      throw new BadRequestException('Company not found');
    }

    const { pdfConfig, ...rest } = data;

    const updatedCompany = await prisma.company.update({
      where: { id: companyId },
      data: {
        ...rest,
      },
    });

    logger.info('Company info updated', {
      category: 'company',
      details: { companyId: updatedCompany.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.COMPANY_UPDATED, {
        company: updatedCompany,
      });
    } catch (error) {
      logger.error('Failed to dispatch COMPANY_UPDATED webhook', {
        category: 'company',
        details: { error },
      });
    }

    return updatedCompany;
  }

  /**
   * Create a new company (for multi-tenant setup)
   * This should be called when a user creates a new company
   */
  async createCompany(userId: string, data: EditCompanyDto) {
    const newCompany = await prisma.company.create({
      data: {
        ...data,
        pdfConfig: {
          create: {},
        },
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
              {
                type: 'RECEIPT',
                subject: 'Receipt #{{RECEIPT_NUMBER}} from {{COMPANY_NAME}}',
                body: '<p>Dear {{CLIENT_NAME}},</p><p>Please find attached the receipt #{{RECEIPT_NUMBER}} from {{COMPANY_NAME}}.</p><p>Thank you for your business!</p><p>Best regards,<br>{{COMPANY_NAME}}</p><hr><p style="font-size: 12px; color: #666;">This email was sent from {{APP_URL}}</p>',
              },
            ],
          },
        },
        // Add the creator as OWNER of the company
        users: {
          create: {
            userId,
            role: 'OWNER',
            isDefault: true,
          },
        },
      },
    });

    logger.info('Company created', {
      category: 'company',
      details: { companyId: newCompany.id, userId },
    });

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
      logger.error('No email templates found for the company', {
        category: 'company',
        details: { companyId },
      });
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
        ...(template.type === MailTemplateType.RECEIPT && {
          RECEIPT_NUMBER: 'REC-2025-0001',
          CLIENT_NAME: 'Acme',
          COMPANY_NAME: existingCompany.name,
        }),
      },
    }));
  }

  /**
   * Get all companies that a user belongs to with their roles
   */
  async getUserCompanies(userId: string) {
    const userCompanies = await prisma.userCompany.findMany({
      where: { userId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            country: true,
            currency: true,
          },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { joinedAt: 'asc' }],
    });

    return userCompanies.map((uc) => ({
      companyId: uc.company.id,
      companyName: uc.company.name,
      country: uc.company.country,
      currency: uc.company.currency,
      role: uc.role,
      joinedAt: uc.joinedAt,
      isDefault: uc.isDefault,
    }));
  }

  async updateEmailTemplate(
    companyId: string,
    id: MailTemplate['id'],
    subject: string,
    body: string,
  ) {
    // Verify the template belongs to the company (multi-tenant check)
    let existingTemplate = await prisma.mailTemplate.findFirst({
      where: { id, companyId },
      include: { company: true },
    });
    if (!existingTemplate) {
      logger.error(`Email template with id ${id} not found`, {
        category: 'company',
        details: { id, companyId },
      });
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

    logger.info('Email template updated', {
      category: 'company',
      details: { templateId: id, companyId },
    });
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

  /**
   * Set a company as the default for the user
   */
  async setDefaultCompany(userId: string, companyId: string) {
    // Verify user has access to the company
    const userCompany = await prisma.userCompany.findUnique({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
    });

    if (!userCompany) {
      throw new BadRequestException('You do not have access to this company');
    }

    // Reset all defaults for this user
    await prisma.userCompany.updateMany({
      where: { userId },
      data: { isDefault: false },
    });

    // Set new default
    await prisma.userCompany.update({
      where: {
        userId_companyId: {
          userId,
          companyId,
        },
      },
      data: { isDefault: true },
    });

    logger.info('Default company set', { category: 'company', details: { userId, companyId } });

    return { success: true, companyId };
  }
}
