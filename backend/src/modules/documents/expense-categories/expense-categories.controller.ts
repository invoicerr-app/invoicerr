import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { ExpenseCategoriesService } from './expense-categories.service';
import { CreateExpenseCategoryInput, UpdateExpenseCategoryInput } from './types';

/**
 * TODO_FEATURES.md rank 13 ("notes de frais enrichies") — the settings screen's own controller for
 * the per-company expense category list, product decision 2026-09-15 (see `persistence.ts`'s own
 * header for the full "why"). Nested under `documents/` (`/api/documents/expense-categories`, not a
 * bespoke top-level path the way `PaymentMethodsController`/`CompanyCustomFieldsController` are) since
 * this is scoped to exactly ONE document type's own field, unlike either of those.
 *
 * GET is open to every authenticated member of the company — read is never restricted (the expense
 * FORM itself never calls this endpoint directly either; it reads `describeTypeForCompany`, which
 * composes this same data through `persistence.ts#applyExpenseCategoriesView`). POST/PUT/DELETE are
 * OWNER/ADMIN-only, the same "changing what the whole company sees is a privileged write, reading it
 * isn't" split `AtcudSeriesController`'s own header documents for a comparable per-company setting.
 */
@ApiTags('documents')
@Controller('documents/expense-categories')
export class ExpenseCategoriesController {
  constructor(private readonly expenseCategories: ExpenseCategoriesService) {}

  @Get()
  @ApiOperation({
    summary: "Every expense category for this company (settings screen's own list)",
    description:
      'Includes archived rows unless `includeArchived=false` is passed — the settings screen shows ' +
      'them (greyed out) so a category disappearing from the expense FORM is never a silent deletion ' +
      "from this screen's point of view. Also seeds this company's default category set the first " +
      'time anything reads this table at all — see `persistence.ts#ensureDefaultExpenseCategoriesSeeded`.',
  })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Expense categories retrieved' })
  list(@ActiveCompany() companyId: string, @Query('includeArchived') includeArchived?: string) {
    return this.expenseCategories.list(companyId, {
      includeArchived: includeArchived === undefined ? true : includeArchived !== 'false',
    });
  }

  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Create a new expense category',
    description:
      '`key` is never accepted here — it is derived from `label` and frozen forever (see ' +
      "schema.prisma's own `ExpenseCategory.key` header).",
  })
  @ApiResponse({ status: 201, description: 'Expense category created' })
  create(@ActiveCompany() companyId: string, @Body() body: CreateExpenseCategoryInput) {
    return this.expenseCategories.create(companyId, body);
  }

  @Put(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Rename an expense category',
    description: '`key` is immutable after creation — this only ever changes `label`.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Expense category updated' })
  update(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: UpdateExpenseCategoryInput,
  ) {
    return this.expenseCategories.update(companyId, id, body);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: 'Archive (soft-delete) an expense category',
    description:
      'Never a hard delete — an expense that already carries this category keeps reading it forever ' +
      "(see persistence.ts's own header). Disappears from the create/edit surface only.",
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Expense category archived' })
  archive(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.expenseCategories.archive(companyId, id);
  }
}
