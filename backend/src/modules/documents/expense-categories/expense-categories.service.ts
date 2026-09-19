import { Injectable } from '@nestjs/common';

import {
  archiveExpenseCategory,
  createExpenseCategory,
  listExpenseCategories,
  updateExpenseCategory,
} from './persistence';
import { CreateExpenseCategoryInput, ExpenseCategoryView, UpdateExpenseCategoryInput } from './types';

/**
 * A thin `@Injectable()` wrapper around persistence.ts's own plain functions — the same split
 * `CompanyCustomFieldsService` draws from `company-custom-fields/persistence.ts`, kept purely for
 * `Controller -> Service -> Prisma` consistency with every other controller in this codebase.
 */
@Injectable()
export class ExpenseCategoriesService {
  list(companyId: string, filter: { includeArchived?: boolean }): Promise<ExpenseCategoryView[]> {
    return listExpenseCategories(companyId, filter);
  }

  create(companyId: string, input: CreateExpenseCategoryInput): Promise<ExpenseCategoryView> {
    return createExpenseCategory(companyId, input);
  }

  update(companyId: string, id: string, patch: UpdateExpenseCategoryInput): Promise<ExpenseCategoryView> {
    return updateExpenseCategory(companyId, id, patch);
  }

  archive(companyId: string, id: string): Promise<ExpenseCategoryView> {
    return archiveExpenseCategory(companyId, id);
  }
}
