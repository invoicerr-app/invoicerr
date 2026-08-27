import { Article, ItemType } from '../../../prisma/generated/prisma/client';
import { Injectable, NotFoundException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

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
  async create(companyId: string, dto: CreateArticleDto): Promise<Article> {
    const article = await prisma.article.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type ?? ItemType.SERVICE,
        unitPrice: dto.unitPrice ?? 0,
        vatRate: dto.vatRate ?? 0,
      },
    });

    logger.info('Article created', { category: 'article', details: { articleId: article.id, companyId } });
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

    const updated = await prisma.article.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        description: dto.description !== undefined ? dto.description : existing.description,
        type: dto.type ?? existing.type,
        unitPrice: dto.unitPrice ?? existing.unitPrice,
        vatRate: dto.vatRate ?? existing.vatRate,
        isActive: dto.isActive ?? existing.isActive,
      },
    });

    logger.info('Article updated', { category: 'article', details: { articleId: updated.id, companyId } });
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

    logger.info('Article deactivated', { category: 'article', details: { articleId: existing.id, companyId } });
    return deleted;
  }
}
