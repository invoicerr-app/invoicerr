import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerExpenseActions } from './actions/expense-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import * as countryPolicy from './country-policy/country-policy';
import { DocumentsService } from './documents.service';
import { buildExpenseDescriptor } from './descriptors/expense.descriptor';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import {
  archiveExpenseCategory,
  createExpenseCategory,
  listExpenseCategories,
} from './expense-categories/persistence';
import * as persistence from './persistence';
import prisma from '@/prisma/prisma.service';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

jest.mock('./persistence');
// Same reasoning documents.service.company-custom-fields.spec.ts's own header gives for mocking this
// wholesale: this file is about wiring EXPENSE CATEGORIES into describeTypeForCompany/runAction, not
// country policy — proven for real elsewhere.
jest.mock('./country-policy/country-policy');

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — product decision 2026-09-15. Proves
 * `DocumentsService` actually composes a company's own expense category DEFINITIONS onto the
 * "category" field's `options`, on BOTH `describeTypeForCompany` (the create/edit FORM) and
 * `runAction` (what actually gets VALIDATED) — the field-level analogue
 * `documents.service.company-custom-fields.spec.ts` already proves for its own, different mechanism
 * ('modify' an EXISTING field here, vs. 'add' a NEW one there). Real Prisma for `expense-categories/`
 * (same "construct the plain persistence layer directly" convention that module's own spec holds) —
 * everything document PERSISTENCE-shaped stays mocked via `./persistence`, so this never touches a
 * real DocumentInstance row.
 */
async function makeCompany(suffix: string) {
  return prisma.company.create({
    data: {
      name: `Expense Categories Wiring Co ${suffix}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 rue de Test',
      postalCode: '75000',
      city: 'Paris',
      country: 'France',
      countryCode: 'FR',
      phone: '+33100000000',
      email: `documents-service-expense-categories-${suffix}-${Date.now()}@example.com`,
    },
  });
}

function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildExpenseDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const referenceRegistry = new EntityReferenceRegistry();

  const actionRegistry = new ActionRegistry();
  registerExpenseActions(actionRegistry);

  const transportRegistry = new TransportRegistry();

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    actionRegistry,
    new ActionExtensionRegistry(),
    referenceRegistry,
    transportRegistry,
    new ContributionRegistry(),
  );
  return { service };
}

const baseExpenseData = {
  description: 'Business lunch',
  amount: 42.5,
  currency: 'EUR',
  date: '2026-01-15',
};

describe('DocumentsService — wiring expense categories (TODO_FEATURES.md rank 13) into the expense type', () => {
  let companyId: string;

  beforeAll(async () => {
    const company = await makeCompany('a');
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.expenseCategory.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  beforeEach(() => {
    (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
    (countryPolicy.resolveCompanyCountryCode as jest.Mock).mockResolvedValue(undefined);
  });
  afterEach(() => jest.resetAllMocks());

  describe('describeTypeForCompany — the FORM view', () => {
    it("this company's own default ten-plus-Other set shows up as the category field's options", async () => {
      (countryPolicy.evaluateCountryPolicy as jest.Mock).mockResolvedValue({ allowed: true });
      const descriptor = await buildService().service.describeTypeForCompany(companyId, 'expense');

      const category = descriptor.fields.find((f) => f.key === 'category');
      const values = category?.options?.map((o) => o.value) ?? [];
      expect(values).toContain('other');
      expect(values.length).toBe(10);
      // Every other native field is untouched.
      expect(descriptor.fields.find((f) => f.key === 'description')).toBeDefined();
    });

    it('a renamed category label flows straight through — the API refuses/offers exactly what the settings screen just changed', async () => {
      const categories = await listExpenseCategories(companyId);
      const meals = categories.find((c) => c.key === 'meals')!;

      const descriptor = await buildService().service.describeTypeForCompany(companyId, 'expense');
      const category = descriptor.fields.find((f) => f.key === 'category');
      expect(category?.options?.find((o) => o.value === 'meals')?.label).toBe(meals.label);
    });

    it('an ARCHIVED category never appears on the form view', async () => {
      const created = await createExpenseCategory(companyId, { label: 'Soon Archived' });
      await archiveExpenseCategory(companyId, created.id);

      const descriptor = await buildService().service.describeTypeForCompany(companyId, 'expense');
      const category = descriptor.fields.find((f) => f.key === 'category');
      expect(category?.options?.some((o) => o.value === created.key)).toBe(false);
    });

    it("a DIFFERENT company gets its OWN category set, never the first company's custom additions", async () => {
      const other = await makeCompany('b');
      const descriptor = await buildService().service.describeTypeForCompany(other.id, 'expense');
      const category = descriptor.fields.find((f) => f.key === 'category');
      const values = category?.options?.map((o) => o.value) ?? [];
      expect(values).not.toContain('soon_archived');
      expect(values.length).toBe(10);

      await prisma.expenseCategory.deleteMany({ where: { companyId: other.id } });
      await prisma.company.delete({ where: { id: other.id } }).catch(() => undefined);
    });
  });

  describe('runAction — the SAME view is what actually gets validated', () => {
    it('"save-draft": a category value from this company\'s own active set is accepted', async () => {
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'expense',
        status: 'draft',
        data: { ...baseExpenseData, category: 'meals' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction(companyId, 'expense', 'save-draft', {
        data: { ...baseExpenseData, category: 'meals' },
      });

      expect(result.changed).toBe(true);
      expect(persistence.upsertDocument).toHaveBeenCalledWith(
        companyId,
        'expense',
        undefined,
        'draft',
        expect.objectContaining({ category: 'meals' }),
      );
    });

    it('"save-draft": no category at all is fine — the field is optional', async () => {
      (persistence.upsertDocument as jest.Mock).mockResolvedValue({
        id: 'doc-1',
        typeId: 'expense',
        status: 'draft',
        data: { ...baseExpenseData },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const { service } = buildService();
      const result = await service.runAction(companyId, 'expense', 'save-draft', {
        data: { ...baseExpenseData },
      });
      expect(result.changed).toBe(true);
    });

    it('"save-draft": an ARCHIVED category is refused — the exact "offered choices" error a native select gets', async () => {
      const created = await createExpenseCategory(companyId, { label: 'Once Offered' });
      await archiveExpenseCategory(companyId, created.id);

      const { service } = buildService();
      await expect(
        service.runAction(companyId, 'expense', 'save-draft', {
          data: { ...baseExpenseData, category: created.key },
        }),
      ).rejects.toMatchObject({
        response: {
          message: 'Invalid document data',
          errors: expect.arrayContaining([
            expect.objectContaining({
              key: 'category',
              message: '"Category" is not one of the offered choices.',
            }),
          ]),
        },
      });
      expect(persistence.upsertDocument).not.toHaveBeenCalled();
    });

    it('"save-draft": a value belonging to a DIFFERENT company is refused — no cross-tenant leak', async () => {
      const other = await makeCompany('c');
      const theirsOnly = await createExpenseCategory(other.id, { label: 'Only Theirs' });

      const { service } = buildService();
      await expect(
        service.runAction(companyId, 'expense', 'save-draft', {
          data: { ...baseExpenseData, category: theirsOnly.key },
        }),
      ).rejects.toMatchObject({
        response: { message: 'Invalid document data' },
      });

      await prisma.expenseCategory.deleteMany({ where: { companyId: other.id } });
      await prisma.company.delete({ where: { id: other.id } }).catch(() => undefined);
    });
  });
});
