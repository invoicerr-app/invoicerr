/**
 * Real Prisma (the same "construct the plain persistence layer directly, real DB" convention
 * `company-custom-fields/persistence.spec.ts` already holds) — no NestJS DI needed, these are plain
 * functions.
 */
import prisma from '@/prisma/prisma.service';

import {
  applyExpenseCategoriesView,
  archiveExpenseCategory,
  createExpenseCategory,
  ensureDefaultExpenseCategoriesSeeded,
  listExpenseCategories,
  updateExpenseCategory,
} from './persistence';
import { DocumentFieldDescriptor } from '../descriptors/types';

async function makeCompany(suffix: string) {
  return prisma.company.create({
    data: {
      name: `Expense Categories Co ${suffix}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `expense-categories-${suffix}-${Date.now()}@example.com`,
    },
  });
}

describe('expense-categories/persistence', () => {
  let companyId: string;
  let otherCompanyId: string;

  beforeAll(async () => {
    const company = await makeCompany('a');
    companyId = company.id;
    const other = await makeCompany('b');
    otherCompanyId = other.id;
  });

  afterAll(async () => {
    await prisma.expenseCategory.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  });

  describe('ensureDefaultExpenseCategoriesSeeded / listExpenseCategories — lazy, on-read reseed', () => {
    it('seeds the default ten-plus-Other set the first time this company is ever listed', async () => {
      const categories = await listExpenseCategories(companyId);
      const keys = categories.map((c) => c.key).sort();
      expect(keys).toEqual(
        [
          'travel',
          'meals',
          'accommodation',
          'office_supplies',
          'software',
          'equipment',
          'marketing',
          'professional_services',
          'utilities',
          'other',
        ].sort(),
      );
      const other = categories.find((c) => c.key === 'other');
      expect(other?.label).toBe('Other');
      expect(other?.archivedAt).toBeNull();
    });

    it('is idempotent — calling it again inserts nothing new', async () => {
      await ensureDefaultExpenseCategoriesSeeded(companyId);
      const categories = await listExpenseCategories(companyId);
      expect(categories.length).toBe(10);
    });

    it('a DIFFERENT company gets its OWN default set, never shares rows with the first', async () => {
      const categories = await listExpenseCategories(otherCompanyId);
      expect(categories.length).toBe(10);
      expect(categories.every((c) => c.id !== undefined)).toBe(true);
      // Genuinely separate rows, not a shared/global catalog.
      const firstCompanyIds = (await listExpenseCategories(companyId)).map((c) => c.id);
      expect(categories.some((c) => firstCompanyIds.includes(c.id))).toBe(false);
    });
  });

  describe('createExpenseCategory / updateExpenseCategory / archiveExpenseCategory — CRUD', () => {
    it('creates a category, slugifying the key from the label', async () => {
      const created = await createExpenseCategory(companyId, { label: 'Team Building!' });
      expect(created.key).toBe('team_building');
      expect(created.label).toBe('Team Building!');
      expect(created.archivedAt).toBeNull();
    });

    it('de-duplicates a colliding key within the same company', async () => {
      const first = await createExpenseCategory(companyId, { label: 'Custom One' });
      const second = await createExpenseCategory(companyId, { label: 'Custom One' });
      expect(first.key).toBe('custom_one');
      expect(second.key).toBe('custom_one_2');
    });

    it('rejects an empty label on create and on update', async () => {
      await expect(createExpenseCategory(companyId, { label: '   ' })).rejects.toThrow(
        'A label is required.',
      );
      const created = await createExpenseCategory(companyId, { label: 'Renamable' });
      await expect(updateExpenseCategory(companyId, created.id, { label: '' })).rejects.toThrow(
        'A label is required.',
      );
    });

    it('renames a category — the key never changes', async () => {
      const created = await createExpenseCategory(companyId, { label: 'Old Name' });
      const updated = await updateExpenseCategory(companyId, created.id, { label: 'New Name' });
      expect(updated.id).toBe(created.id);
      expect(updated.key).toBe(created.key);
      expect(updated.label).toBe('New Name');
    });

    it('archives a category — idempotent, and never a hard delete', async () => {
      const created = await createExpenseCategory(companyId, { label: 'To Archive' });
      const archived = await archiveExpenseCategory(companyId, created.id);
      expect(archived.archivedAt).not.toBeNull();

      // Idempotent: archiving again just re-stamps, never throws.
      await expect(archiveExpenseCategory(companyId, created.id)).resolves.toMatchObject({
        id: created.id,
      });

      // Excluded from the active list…
      const active = await listExpenseCategories(companyId, { includeArchived: false });
      expect(active.find((c) => c.id === created.id)).toBeUndefined();
      // …but still present when archived rows are included.
      const all = await listExpenseCategories(companyId, { includeArchived: true });
      expect(all.find((c) => c.id === created.id)).toBeDefined();
    });

    it('404s on an id that belongs to a DIFFERENT company — never forbidden, never found', async () => {
      const created = await createExpenseCategory(otherCompanyId, { label: 'Belongs To B' });
      await expect(updateExpenseCategory(companyId, created.id, { label: 'Stolen' })).rejects.toThrow(
        `No expense category "${created.id}" for this company.`,
      );
      await expect(archiveExpenseCategory(companyId, created.id)).rejects.toThrow(
        `No expense category "${created.id}" for this company.`,
      );
    });
  });

  describe('applyExpenseCategoriesView — the "category" field composition', () => {
    const baseFields: DocumentFieldDescriptor[] = [
      { key: 'description', kind: 'text', label: 'Description', required: true },
      { key: 'category', kind: 'select', label: 'Category', required: false, options: [] },
    ];

    it('a no-op — no DB round-trip, byte-for-byte the same array — for every type but "expense"', async () => {
      const result = await applyExpenseCategoriesView(companyId, 'quote', baseFields);
      expect(result).toBe(baseFields);
    });

    it('patches "category" with this company\'s own ACTIVE categories, excluding archived ones', async () => {
      const fresh = await makeCompany('view');
      // Seeds the default ten-plus-Other set first — same "first access" trigger any real caller
      // (the settings screen, or this very function) goes through.
      await ensureDefaultExpenseCategoriesSeeded(fresh.id);
      const kept = await createExpenseCategory(fresh.id, { label: 'Kept' });
      const archived = await createExpenseCategory(fresh.id, { label: 'Archived Away' });
      await archiveExpenseCategory(fresh.id, archived.id);

      const result = await applyExpenseCategoriesView(fresh.id, 'expense', baseFields);
      const category = result.find((f) => f.key === 'category');
      const values = category?.options?.map((o) => o.value) ?? [];
      expect(values).toContain(kept.key);
      expect(values).not.toContain(archived.key);
      // The default set is seeded first (lazy reseed), so it's in there too.
      expect(values).toContain('other');

      // The original array passed in is never mutated in place (same discipline
      // `country-fields/apply-overlay.ts#applyFieldOverlay` documents for every caller).
      expect(baseFields.find((f) => f.key === 'category')?.options).toEqual([]);

      await prisma.expenseCategory.deleteMany({ where: { companyId: fresh.id } });
      await prisma.company.delete({ where: { id: fresh.id } }).catch(() => undefined);
    });
  });
});
