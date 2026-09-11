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
  // TODO_FEATURES.md rank 18 ("gestion de stock basique") — see Article's own schema comment
  // (schema.prisma) for what `null`/omitted means for each: no `quantity` at all is "not
  // stock-tracked" (the SERVICE default), no `lowStockThreshold` is "no alert, ever".
  quantity?: number | null;
  lowStockThreshold?: number | null;
}

export interface EditArticleDto {
  name?: string;
  description?: string | null;
  type?: ItemType;
  unitPrice?: number;
  vatRate?: number;
  isActive?: boolean;
  quantity?: number | null;
  lowStockThreshold?: number | null;
}

/**
 * An Article as this module hands it back to a caller — the raw row plus the ONE fact
 * `quantity`/`lowStockThreshold` alone don't spell out for a reader: is this thing low on stock RIGHT
 * NOW. See `isArticleLowStock`'s own doc comment for the exact predicate.
 *
 * An intersection (`&`), deliberately NOT `interface ArticleWithStock extends Article` — Prisma's own
 * generated model type is itself a resolved conditional/mapped type
 * (`runtime.Types.Result.DefaultSelection<...>`, prisma/generated/prisma/models/Article.ts), and an
 * `interface extends` heritage clause over that kind of type does not reliably propagate its members
 * to callers outside this file (confirmed here: every OTHER module reading `ArticleWithStock` lost
 * every one of `Article`'s own fields, TS2339 on `id`/`name`/... — `npm run build` is what caught it).
 * A plain intersection type has no such heritage-resolution step and does not hit this at all.
 */
export type ArticleWithStock = Article & { isLowStock: boolean };

/**
 * Pure: whether an article's current stock is AT or UNDER its own configured alert threshold. Both
 * `quantity` and `lowStockThreshold` must be non-null for an alert to even be possible — an article
 * that isn't stock-tracked at all (`quantity: null`, e.g. every SERVICE by default) or that tracks
 * stock but declares no threshold (`lowStockThreshold: null`) never alerts, by construction, not by a
 * magic sentinel value. No clamping happens here or anywhere upstream (see
 * `documents/stock/apply-stock-on-issuance.ts`'s own header) — a NEGATIVE `quantity` (an oversold
 * article) is exactly as much "low stock" as a merely-low positive one, never a special case.
 */
export function isArticleLowStock(article: Pick<Article, 'quantity' | 'lowStockThreshold'>): boolean {
  return (
    article.quantity !== null &&
    article.lowStockThreshold !== null &&
    article.quantity <= article.lowStockThreshold
  );
}

/** The one place `isArticleLowStock` gets attached to a raw Article row — every method below that
 *  hands an Article back to a caller goes through this, so `isLowStock` is never computed twice with
 *  two different rules. */
function withStockFlag(article: Article): ArticleWithStock {
  return { ...article, isLowStock: isArticleLowStock(article) };
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

  async create(companyId: string, dto: CreateArticleDto): Promise<ArticleWithStock> {
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
        quantity: dto.quantity ?? null,
        lowStockThreshold: dto.lowStockThreshold ?? null,
      },
    });

    logger.info('Article created', {
      category: 'article',
      details: { articleId: article.id, companyId },
    });
    return withStockFlag(article);
  }

  async findAll(companyId: string): Promise<ArticleWithStock[]> {
    const articles = await prisma.article.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    return articles.map(withStockFlag);
  }

  async findOne(companyId: string, id: string): Promise<ArticleWithStock | null> {
    const article = await prisma.article.findFirst({ where: { id, companyId } });
    return article ? withStockFlag(article) : null;
  }

  /**
   * TODO_FEATURES.md rank 18 — every active, stock-tracked article this company owns that is
   * currently AT or UNDER its own threshold. `quantity`/`lowStockThreshold` "not null" is filtered at
   * the DB — cheap and exact, since NEITHER side of `isArticleLowStock`'s comparison can hold once
   * either is null — but comparing the two COLUMNS to each other is not something a plain Prisma
   * `where` can express (only column-to-LITERAL comparisons), so the actual `quantity <=
   * lowStockThreshold` test still runs in JS via `isArticleLowStock`, over this already-narrow
   * candidate set. A per-company catalog is small enough that this is a non-issue in practice; a
   * genuinely large catalog would earn a raw SQL query, not a reason to change this method's contract.
   */
  async findLowStock(companyId: string): Promise<ArticleWithStock[]> {
    const candidates = await prisma.article.findMany({
      where: { companyId, isActive: true, quantity: { not: null }, lowStockThreshold: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    return candidates.map(withStockFlag).filter((article) => article.isLowStock);
  }

  async update(companyId: string, id: string, dto: EditArticleDto): Promise<ArticleWithStock> {
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
        // `!== undefined` (never `??`), same convention `description` above already holds: it is what
        // lets a caller explicitly send `null` to UN-track stock (or clear a threshold) rather than
        // that always being indistinguishable from "field omitted, keep the existing value".
        quantity: dto.quantity !== undefined ? dto.quantity : existing.quantity,
        lowStockThreshold:
          dto.lowStockThreshold !== undefined ? dto.lowStockThreshold : existing.lowStockThreshold,
      },
    });

    logger.info('Article updated', {
      category: 'article',
      details: { articleId: updated.id, companyId },
    });
    return withStockFlag(updated);
  }

  async softDelete(companyId: string, id: string): Promise<ArticleWithStock> {
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
    return withStockFlag(deleted);
  }
}
