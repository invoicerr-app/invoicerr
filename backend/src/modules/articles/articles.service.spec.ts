/**
 * ArticlesService in isolation — basic stock management ("gestion de stock basique"). Mocks
 * `@/prisma/prisma.service` at its own entry point, the same discipline `channels.service.spec.ts`
 * already holds, so this proves the SERVICE's own logic (the `isLowStock` predicate, and every read
 * method attaching it consistently) — never a real database.
 */
import { ArticlesService, isArticleLowStock } from './articles.service';

import prisma from '@/prisma/prisma.service';
import { ItemType } from '../../../prisma/generated/prisma/client';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    article: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    company: { findUnique: jest.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  article: {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  company: { findUnique: jest.Mock };
};

function article(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'article-1',
    companyId: 'company-1',
    name: 'Widget',
    description: null,
    type: ItemType.PRODUCT,
    unitPrice: 10,
    unitPriceMinor: 1000,
    vatRate: 20,
    isActive: true,
    quantity: null,
    lowStockThreshold: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('isArticleLowStock (pure)', () => {
  it('is false when quantity is not stock-tracked at all (null)', () => {
    expect(isArticleLowStock({ quantity: null, lowStockThreshold: 5 })).toBe(false);
  });

  it('is false when a threshold was never configured (null), regardless of how low the quantity is', () => {
    expect(isArticleLowStock({ quantity: 0, lowStockThreshold: null })).toBe(false);
  });

  it('is false when quantity is comfortably above the threshold', () => {
    expect(isArticleLowStock({ quantity: 10, lowStockThreshold: 5 })).toBe(false);
  });

  it('is true when quantity is EXACTLY AT the threshold (the boundary is inclusive)', () => {
    expect(isArticleLowStock({ quantity: 5, lowStockThreshold: 5 })).toBe(true);
  });

  it('is true when quantity is under the threshold', () => {
    expect(isArticleLowStock({ quantity: 2, lowStockThreshold: 5 })).toBe(true);
  });

  it('is true for a NEGATIVE (oversold) quantity — never a special case, see apply-stock-on-issuance.ts', () => {
    expect(isArticleLowStock({ quantity: -3, lowStockThreshold: 5 })).toBe(true);
  });
});

describe('ArticlesService', () => {
  let service: ArticlesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ArticlesService();
    mockedPrisma.company.findUnique.mockResolvedValue({ currency: 'EUR' });
  });

  describe('read methods attach isLowStock consistently', () => {
    it('findAll computes isLowStock for every article it returns', async () => {
      mockedPrisma.article.findMany.mockResolvedValue([
        article({ id: 'a1', quantity: 2, lowStockThreshold: 5 }),
        article({ id: 'a2', quantity: 20, lowStockThreshold: 5 }),
        article({ id: 'a3' }), // not stock-tracked at all
      ]);

      const result = await service.findAll('company-1');

      expect(result).toEqual([
        expect.objectContaining({ id: 'a1', isLowStock: true }),
        expect.objectContaining({ id: 'a2', isLowStock: false }),
        expect.objectContaining({ id: 'a3', isLowStock: false }),
      ]);
    });

    it('findOne computes isLowStock, and stays null for a missing article', async () => {
      mockedPrisma.article.findFirst.mockResolvedValueOnce(article({ quantity: 1, lowStockThreshold: 3 }));
      await expect(service.findOne('company-1', 'article-1')).resolves.toMatchObject({ isLowStock: true });

      mockedPrisma.article.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('company-1', 'missing')).resolves.toBeNull();
    });

    it('create and update both return the freshly computed isLowStock, not a stale one', async () => {
      mockedPrisma.article.create.mockResolvedValue(article({ quantity: 1, lowStockThreshold: 5 }));
      await expect(service.create('company-1', { name: 'Widget' })).resolves.toMatchObject({
        isLowStock: true,
      });

      mockedPrisma.article.findFirst.mockResolvedValue(article({ quantity: 10, lowStockThreshold: 5 }));
      mockedPrisma.article.update.mockResolvedValue(article({ quantity: 2, lowStockThreshold: 5 }));
      await expect(service.update('company-1', 'article-1', { quantity: 2 })).resolves.toMatchObject({
        isLowStock: true,
      });
    });
  });

  describe('create/update persist quantity/lowStockThreshold', () => {
    it('create defaults both to null when omitted — not stock-tracked, no alert', async () => {
      mockedPrisma.article.create.mockResolvedValue(article());

      await service.create('company-1', { name: 'Widget' });

      expect(mockedPrisma.article.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: null, lowStockThreshold: null }),
        }),
      );
    });

    it('create persists explicit quantity/lowStockThreshold when given', async () => {
      mockedPrisma.article.create.mockResolvedValue(article({ quantity: 50, lowStockThreshold: 10 }));

      await service.create('company-1', { name: 'Widget', quantity: 50, lowStockThreshold: 10 });

      expect(mockedPrisma.article.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 50, lowStockThreshold: 10 }),
        }),
      );
    });

    it('update leaves quantity/lowStockThreshold UNCHANGED when omitted from the DTO', async () => {
      mockedPrisma.article.findFirst.mockResolvedValue(article({ quantity: 7, lowStockThreshold: 3 }));
      mockedPrisma.article.update.mockResolvedValue(article({ quantity: 7, lowStockThreshold: 3 }));

      await service.update('company-1', 'article-1', { name: 'Renamed' });

      expect(mockedPrisma.article.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 7, lowStockThreshold: 3 }),
        }),
      );
    });

    it('update accepts an EXPLICIT null to un-track stock (or clear a threshold) — distinct from "omitted"', async () => {
      mockedPrisma.article.findFirst.mockResolvedValue(article({ quantity: 7, lowStockThreshold: 3 }));
      mockedPrisma.article.update.mockResolvedValue(article({ quantity: null, lowStockThreshold: 3 }));

      await service.update('company-1', 'article-1', { quantity: null });

      expect(mockedPrisma.article.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: null, lowStockThreshold: 3 }),
        }),
      );
    });
  });

  describe('findLowStock', () => {
    it('queries only stock-tracked (quantity/lowStockThreshold both non-null) active articles for THIS company', async () => {
      mockedPrisma.article.findMany.mockResolvedValue([]);

      await service.findLowStock('company-1');

      expect(mockedPrisma.article.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            companyId: 'company-1',
            isActive: true,
            quantity: { not: null },
            lowStockThreshold: { not: null },
          },
        }),
      );
    });

    it('returns only the candidates actually AT or UNDER their own threshold', async () => {
      mockedPrisma.article.findMany.mockResolvedValue([
        article({ id: 'a1', quantity: 2, lowStockThreshold: 5 }), // low
        article({ id: 'a2', quantity: 20, lowStockThreshold: 5 }), // fine
        article({ id: 'a3', quantity: 5, lowStockThreshold: 5 }), // exactly at — still low
      ]);

      const result = await service.findLowStock('company-1');

      expect(result.map((a) => a.id)).toEqual(['a1', 'a3']);
      expect(result.every((a) => a.isLowStock)).toBe(true);
    });
  });
});
