import { Article, ItemType } from '../../../prisma/generated/prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { toMinor } from '@/utils/financial';

export interface CreateArticleDto {
  name: string;
  description?: string;
  type?: ItemType;
  unitPrice?: number;
  vatRate?: number;
}

export interface EditArticleDto {
  name?: string;
  description?: string | null;
  type?: ItemType;
  unitPrice?: number;
  vatRate?: number;
  isActive?: boolean;
}

@Injectable()
export class ArticlesService {
  private async getCompanyCurrency(companyId: string): Promise<string> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { currency: true },
    });
    if (!company) {
      logger.error('Company not found', { category: 'article', details: { companyId } });
      throw new NotFoundException('Company not found');
    }
    return company.currency;
  }

  async create(companyId: string, dto: CreateArticleDto): Promise<Article> {
    const currency = await this.getCompanyCurrency(companyId);
    const article = await prisma.article.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type ?? ItemType.SERVICE,
        unitPrice: dto.unitPrice ?? 0,
        unitPriceMinor: toMinor(dto.unitPrice ?? 0, currency),
        vatRate: dto.vatRate ?? 0,
      },
    });

    logger.info('Article created', {
      category: 'article',
      details: { articleId: article.id, companyId },
    });
    return article;
  }

  async findAll(companyId: string): Promise<Article[]> {
    return prisma.article.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string): Promise<Article | null> {
    return prisma.article.findFirst({ where: { id, companyId } });
  }

  async update(companyId: string, id: string, dto: EditArticleDto): Promise<Article> {
    const existing = await prisma.article.findFirst({ where: { id, companyId } });
    if (!existing) {
      logger.error('Article not found', { category: 'article', details: { id } });
      throw new NotFoundException('Article not found');
    }

    const currency = await this.getCompanyCurrency(companyId);
    const updatedUnitPrice = dto.unitPrice ?? existing.unitPrice;
    const updated = await prisma.article.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        description: dto.description !== undefined ? dto.description : existing.description,
        type: dto.type ?? existing.type,
        unitPrice: updatedUnitPrice,
        unitPriceMinor: toMinor(updatedUnitPrice, currency),
        vatRate: dto.vatRate ?? existing.vatRate,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    logger.info('Article updated', {
      category: 'article',
      details: { articleId: updated.id, companyId },
    });
    return updated;
  }

  async softDelete(companyId: string, id: string): Promise<Article> {
    const existing = await prisma.article.findFirst({ where: { id, companyId } });
    if (!existing) {
      logger.error('Article not found', { category: 'article', details: { id } });
      throw new NotFoundException('Article not found');
    }

    const deleted = await prisma.article.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Article deactivated', {
      category: 'article',
      details: { articleId: existing.id, companyId },
    });
    return deleted;
  }
}
