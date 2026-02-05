import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import {
  type PaymentMethod,
  PaymentMethodType,
  WebhookEvent,
} from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';

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

  async create(companyId: string, dto: CreatePaymentMethodDto): Promise<PaymentMethod> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });
    if (!company) {
      logger.error('Company not found', { category: 'payment-method' });
      throw new BadRequestException('Company not found');
    }

    const pm = await prisma.paymentMethod.create({
      data: {
        companyId,
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
      logger.info('Payment method created', {
        category: 'payment-method',
        details: { paymentMethodId: pm.id, companyId },
      });
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD_CREATED webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD_CREATED webhook', {
        category: 'payment-method',
        details: { error, paymentMethodId: pm.id, companyId },
      });
    }

    return pm;
  }

  async findAll(companyId: string): Promise<PaymentMethod[]> {
    return prisma.paymentMethod.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string): Promise<PaymentMethod | null> {
    // Multi-tenant check: verify payment method belongs to the company
    const pm = await prisma.paymentMethod.findFirst({
      where: { id, companyId },
    });
    return pm;
  }

  async update(companyId: string, id: string, dto: EditPaymentMethodDto): Promise<PaymentMethod> {
    // Multi-tenant check: verify payment method belongs to the company
    const existing = await prisma.paymentMethod.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id, companyId } });
      throw new BadRequestException('Payment method not found');
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

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
      logger.info('Payment method updated', {
        category: 'payment-method',
        details: { paymentMethodId: updatedPm.id, companyId },
      });

      if (dto.isActive !== undefined && dto.isActive !== existing.isActive) {
        const event = dto.isActive
          ? WebhookEvent.PAYMENT_METHOD_ACTIVATED
          : WebhookEvent.PAYMENT_METHOD_DEACTIVATED;
        await this.webhookDispatcher.dispatch(event, {
          paymentMethod: updatedPm,
          company,
        });
        logger.info('Payment method activation status changed', {
          category: 'payment-method',
          details: { paymentMethodId: updatedPm.id, companyId, isActive: dto.isActive },
        });
      }
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD webhook', {
        category: 'payment-method',
        details: { error, paymentMethodId: updatedPm.id, companyId },
      });
    }

    return updatedPm;
  }

  async softDelete(companyId: string, id: string): Promise<PaymentMethod> {
    // Multi-tenant check: verify payment method belongs to the company
    const existing = await prisma.paymentMethod.findFirst({
      where: { id, companyId },
    });
    if (!existing) {
      logger.error('Payment method not found', { category: 'payment-method', details: { id, companyId } });
      throw new BadRequestException('Payment method not found');
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    const deletedPm = await prisma.paymentMethod.update({
      where: { id },
      data: { isActive: false },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.PAYMENT_METHOD_DELETED, {
        paymentMethod: existing,
        company,
      });
      logger.info('Payment method deactivated', {
        category: 'payment-method',
        details: { paymentMethodId: existing.id, companyId },
      });
    } catch (error) {
      this.logger.error('Failed to dispatch PAYMENT_METHOD_DELETED webhook', error);
      logger.error('Failed to dispatch PAYMENT_METHOD_DELETED webhook', {
        category: 'payment-method',
        details: { error, paymentMethodId: existing.id, companyId },
      });
    }

    return deletedPm;
  }
}
