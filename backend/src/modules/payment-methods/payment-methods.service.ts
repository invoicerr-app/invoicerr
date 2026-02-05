import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PaymentMethod, PaymentMethodType, WebhookEvent } from '../../../prisma/generated/prisma/client';

import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

export interface CreatePaymentMethodDto {
  name: string;
  details?: string;
  type?: PaymentMethodType;
}

export interface EditPaymentMethodDto {
  name?: string;
  details?: string | null;
  type?: PaymentMethodType;
  isActive?: boolean;
}

@Injectable()
export class PaymentMethodsService {
  private readonly logger: Logger;

  constructor(private readonly webhookDispatcher: WebhookDispatcherService) {
    this.logger = new Logger(PaymentMethodsService.name);
  }
  async create(dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'payment-method' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    const pm = await prisma.paymentMethod.create({
      data: {
        companyId: company.id,
        name: dto.name,
        details: dto.details ?? '',
        type: dto.type ?? PaymentMethodType.BANK_TRANSFER,
      },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.PAYMENT_METHOD_CREATED, {
        paymentMethod: pm,
        company,
      });
      logger.info('Payment method created', { category: 'payment-method', details: { paymentMethodId: pm.id, companyId: company.id } });
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD_CREATED webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD_CREATED webhook', { category: 'payment-method', details: { error, paymentMethodId: pm.id, companyId: company.id } });
    }

    return pm;
  }

  async findAll(): Promise<PaymentMethod[]> {
    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'payment-method' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    return prisma.paymentMethod.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<PaymentMethod | null> {
    const pm = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!pm) return null;
    const company = await prisma.company.findFirst();
    if (!company || pm.companyId !== company.id) {
      return null;
    }
    return pm;
  }

  async update(id: string, dto: EditPaymentMethodDto): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id } });
      throw new BadRequestException('Payment method not found');
    }

    const company = await prisma.company.findFirst();
    if (!company || existing.companyId !== company.id) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id } });
      throw new BadRequestException('Payment method not found');
    }

    const updatedPm = await prisma.paymentMethod.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        details: dto.details ?? existing.details,
        type: dto.type ?? existing.type,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.PAYMENT_METHOD_UPDATED, {
        paymentMethod: updatedPm,
        company,
      });
      logger.info('Payment method updated', { category: 'payment-method', details: { paymentMethodId: updatedPm.id, companyId: company.id } });

      if (dto.isActive !== undefined && dto.isActive !== existing.isActive) {
        const event = dto.isActive ? WebhookEvent.PAYMENT_METHOD_ACTIVATED : WebhookEvent.PAYMENT_METHOD_DEACTIVATED;
        await this.webhookDispatcher.dispatch(event, {
          paymentMethod: updatedPm,
          company,
        });
        logger.info('Payment method activation status changed', { category: 'payment-method', details: { paymentMethodId: updatedPm.id, companyId: company.id, isActive: dto.isActive } });
      }
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD webhook', { category: 'payment-method', details: { error, paymentMethodId: updatedPm.id, companyId: company.id } });
    }

    return updatedPm;
  }

  async softDelete(id: string): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id } });
      throw new BadRequestException('Payment method not found');
    }

    const company = await prisma.company.findFirst();
    if (!company || existing.companyId !== company.id) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id } });
      throw new BadRequestException('Payment method not found');
    }

    const deletedPm = await prisma.paymentMethod.update({
      where: { id },
      data: { isActive: false },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.PAYMENT_METHOD_DELETED, {
        paymentMethod: existing,
        company,
      });
      logger.info('Payment method deactivated', { category: 'payment-method', details: { paymentMethodId: existing.id, companyId: company.id } });
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD_DELETED webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD_DELETED webhook', { category: 'payment-method', details: { error, paymentMethodId: existing.id, companyId: company.id } });
    }

    return deletedPm;
  }
}