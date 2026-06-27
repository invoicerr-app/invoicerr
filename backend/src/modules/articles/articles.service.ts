import { Article, ItemType } from '../../../prisma/generated/prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';

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
  async create(dto: CreateArticleDto): Promise<Article> {
    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'article' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    const article = await prisma.article.create({
      data: {
        companyId: company.id,
        name: dto.name,
        description: dto.description ?? null,
        type: dto.type ?? ItemType.SERVICE,
        unitPrice: dto.unitPrice ?? 0,
        vatRate: dto.vatRate ?? 0,
      },
    });

    logger.info('Article created', { category: 'article', details: { articleId: article.id, companyId: company.id } });
    return article;
  }

  async findAll(): Promise<Article[]> {
    const company = await prisma.company.findFirst();
    if (!company) {
      logger.error('No company found. Please create a company first.', { category: 'article' });
      throw new BadRequestException('No company found. Please create a company first.');
    }

    return prisma.article.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<Article | null> {
    const article = await prisma.article.findUnique({ where: { id } });
    if (!article) return null;
    const company = await prisma.company.findFirst();
    if (!company || article.companyId !== company.id) {
      return null;
    }
    return article;
  }

  async update(id: string, dto: EditArticleDto): Promise<Article> {
    const existing = await prisma.article.findUnique({ where: { id } });
    const company = await prisma.company.findFirst();
    if (!existing || !company || existing.companyId !== company.id) {
      logger.error('Article not found', { category: 'article', details: { id } });
      throw new BadRequestException('Article not found');
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

    logger.info('Article updated', { category: 'article', details: { articleId: updated.id, companyId: company.id } });
    return updated;
  }

  async softDelete(id: string): Promise<Article> {
    const existing = await prisma.article.findUnique({ where: { id } });
    const company = await prisma.company.findFirst();
    if (!existing || !company || existing.companyId !== company.id) {
      logger.error('Article not found', { category: 'article', details: { id } });
      throw new BadRequestException('Article not found');
    }

    const deleted = await prisma.article.update({
      where: { id },
      data: { isActive: false },
    });

    logger.info('Article deactivated', { category: 'article', details: { articleId: existing.id, companyId: company.id } });
    return deleted;
  }
}
