/**
 * Shared, tenant-safe persistence for a company's own expense category DEFINITIONS — the same plain-
 * functions split `company-custom-fields/persistence.ts` already draws (not a Nest service): read from
 * both the settings-screen controller AND `documents.service.ts`'s `describeTypeForCompany`/`runAction`
 * (`applyExpenseCategoriesView` below), which is what makes the expense form's "category" select offer
 * — and validate against — exactly THIS company's own list, on every action the expense type has
 * ("save-draft" and "delete", see `expense.descriptor.ts`), not merely the settings screen's own read.
 *
 * Product decision (2026-09-15) — OVERRIDES this rank's original shipped design: `expense.descriptor.ts`
 * used to hardcode a closed `EXPENSE_CATEGORY_OPTIONS` list, reasoning at the time that no per-company
 * "write your own list" mechanism existed anywhere in this codebase (see that file's own CURRENT
 * header, and its prior one via git history on this file's introducing commit). `CompanyCustomField`
 * (rank 15) shipped that exact mechanism afterwards, but a company custom field is always a NEW field
 * bolted onto a type (`company-custom-fields/persistence.ts#toFieldDescriptor`, `custom:`-prefixed
 * key) — never a per-company override of an EXISTING native field's own `options`. Expense categories
 * need the latter: `category` keeps its native, un-prefixed key (every already-recorded expense's
 * `data.category` value stays meaningful), while WHICH values are offered/valid becomes per-company
 * data, composed onto the trunk descriptor with `country-fields/apply-overlay.ts`'s 'modify' operation
 * — the same reuse-not-reinvent precedent `applyCompanyCustomFieldsView`'s own 'add' operations set,
 * applied here to 'modify' instead since this is an override of an EXISTING field, not a new one.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { applyFieldOverlay } from '../country-fields/apply-overlay';
import { DocumentFieldDescriptor } from '../descriptors/types';
import {
  CreateExpenseCategoryInput,
  ExpenseCategoryRecord,
  ExpenseCategoryView,
  toView,
  UpdateExpenseCategoryInput,
} from './types';

/** The default set every company gets — the exact ten categories (+ "Other") `expense.descriptor.ts`'s
 *  now-removed `EXPENSE_CATEGORY_OPTIONS` constant used to hardcode, carried over verbatim so a company
 *  seeded from this default set sees NO behavior change the day this feature lands (existing e2e
 *  coverage — `62-expense-attachments.cy.ts` — picks "meals" by label prefix and keeps working
 *  unmodified). Only a STARTING point from here on: a company may rename, archive, or add to it freely
 *  — this array is read exactly once per company, by `ensureDefaultExpenseCategoriesSeeded` below. */
const DEFAULT_EXPENSE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'travel', label: 'Travel' },
  { key: 'meals', label: 'Meals & entertainment' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'office_supplies', label: 'Office supplies' },
  { key: 'software', label: 'Software & subscriptions' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'professional_services', label: 'Professional services' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'other', label: 'Other' },
];

/** Slugifies `label` into a stable, JSON-value-safe `key` — same shape as
 *  `company-custom-fields/persistence.ts#slugify` (lowercase ASCII letters/digits joined by
 *  underscores, falling back to a fixed literal for a label that slugifies to nothing at all).
 *  Deliberately duplicated rather than imported from that module: the two catalogs are independent on
 *  purpose (this repo's own "a dozen narrow, independent catalogs" discipline — see CLAUDE.md), and
 *  the two `key` scopes (`(companyId, key)` here vs. `(companyId, target, documentTypeId, key)` there)
 *  are different enough that sharing the helper would couple two things that don't need to be. */
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

function slugify(label: string): string {
  const base = label
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // strips combining diacritics left behind by NFKD (é -> e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'category';
}

/** Finds a `key` free within `companyId` — appending `_2`, `_3`, … to the slugified label until one
 *  doesn't collide, the same shape `company-custom-fields/persistence.ts#findAvailableKey` already
 *  holds for its own, per-scope key. Unlike that module, there is only ONE scope here (no
 *  target/documentTypeId to carve NULL-vs-specific cases out of — see `ExpenseCategory`'s own
 *  schema.prisma header), so the DB's own `@@unique([companyId, key])` is sufficient on its own; this
 *  is purely what lets creation succeed with a FRIENDLY suffixed key instead of a 500 on collision. */
async function findAvailableKey(companyId: string, label: string): Promise<string> {
  const base = slugify(label);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
    const existing = await prisma.expenseCategory.findFirst({
      where: { companyId, key: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
}

/**
 * Inserts this company's default category set IF AND ONLY IF it has none yet at all (archived or not)
 * — called from BOTH `company.service.ts#createCompany` (a brand-new company, count is trivially 0, so
 * this always inserts) and `listExpenseCategories` below (an EXISTING company that predates this
 * feature, or one whose defaults were never inserted for any other reason — "at first access", per
 * this feature's own product brief). Deliberately NOT run as data migrated by the schema migration
 * itself — CLAUDE.md's own Prisma section: a migration creates the TABLE, it never writes data, so a
 * fresh checkout's `migrate deploy` stays a pure schema operation; this lazy, on-read reseed is what
 * actually populates it, for every company, old or new, the first time anything asks.
 *
 * `skipDuplicates: true` is the concurrency guard: two simultaneous first-accesses (e.g. two tabs
 * opening the expense form/settings screen at once) can both observe `count === 0` and both attempt
 * the insert — the LOSER's rows are silently skipped by the DB's own `(companyId, key)` unique
 * constraint rather than throwing, since the winner's rows already satisfy it.
 */
export async function ensureDefaultExpenseCategoriesSeeded(companyId: string): Promise<void> {
  const existing = await prisma.expenseCategory.count({ where: { companyId } });
  if (existing > 0) return;
  await prisma.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((category) => ({
      companyId,
      key: category.key,
      label: category.label,
    })),
    skipDuplicates: true,
  });
}

/** Every category for `companyId` — the settings screen's own list (`includeArchived: true`, greyed-out
 *  rows with no "restore" action, see this feature's own controller header for why there is none) and
 *  `resolveActiveExpenseCategoryOptions` below (`includeArchived: false`) both go through this. Always
 *  seeds the default set first (see `ensureDefaultExpenseCategoriesSeeded`'s own header) — the ONE
 *  choke point every caller of this table passes through, so "first access" means exactly that,
 *  whichever caller happens to be first. */
export async function listExpenseCategories(
  companyId: string,
  filter: { includeArchived?: boolean } = {},
): Promise<ExpenseCategoryView[]> {
  await ensureDefaultExpenseCategoriesSeeded(companyId);
  const rows = await prisma.expenseCategory.findMany({
    where: { companyId, ...(filter.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ createdAt: 'asc' }],
  });
  return rows.map((row) => toView(row as ExpenseCategoryRecord));
}

/** Throws 404 for an id that doesn't exist, or belongs to a DIFFERENT company — the same tenant-scoped
 *  "not found, never forbidden" posture the rest of this codebase holds (see
 *  `company-custom-fields/persistence.ts#resolveOwnedOrThrow`). */
async function resolveOwnedOrThrow(companyId: string, id: string): Promise<ExpenseCategoryRecord> {
  const row = await prisma.expenseCategory.findFirst({ where: { id, companyId } });
  if (!row) {
    throw new NotFoundException(`No expense category "${id}" for this company.`);
  }
  return row as ExpenseCategoryRecord;
}

export async function createExpenseCategory(
  companyId: string,
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategoryView> {
  if (!input.label?.trim()) {
    throw new BadRequestException('A label is required.');
  }
  const key = await findAvailableKey(companyId, input.label);
  const row = await prisma.expenseCategory.create({
    data: { companyId, key, label: input.label.trim() },
  });
  return toView(row as ExpenseCategoryRecord);
}

/** Renames a category — `key` is immutable (see `ExpenseCategory.key`'s own schema.prisma header):
 *  this is the ONLY mutation a category ever gets besides archiving. */
export async function updateExpenseCategory(
  companyId: string,
  id: string,
  patch: UpdateExpenseCategoryInput,
): Promise<ExpenseCategoryView> {
  await resolveOwnedOrThrow(companyId, id);
  if (!patch.label?.trim()) {
    throw new BadRequestException('A label is required.');
  }
  const row = await prisma.expenseCategory.update({
    where: { id },
    data: { label: patch.label.trim() },
  });
  return toView(row as ExpenseCategoryRecord);
}

/** Soft-delete — an expense that already carries an archived category's `key` keeps reading it
 *  forever (`data.category` is a plain stored string, untouched by this write); the create/edit
 *  surface (`resolveActiveExpenseCategoryOptions`, `includeArchived: false`) stops offering it.
 *  Idempotent: archiving an already-archived row just re-stamps `archivedAt`. */
export async function archiveExpenseCategory(companyId: string, id: string): Promise<ExpenseCategoryView> {
  await resolveOwnedOrThrow(companyId, id);
  const row = await prisma.expenseCategory.update({
    where: { id },
    data: { archivedAt: new Date() },
  });
  return toView(row as ExpenseCategoryRecord);
}

/**
 * Injects this company's own ACTIVE expense categories as the "category" field's `options` — reusing
 * `country-fields/apply-overlay.ts#applyFieldOverlay`'s 'modify' operation exactly as it stands (see
 * this module's own header for why 'modify', not company-custom-fields' own 'add'). Called from
 * `documents.service.ts`'s `describeTypeForCompany` (what the create/edit FORM renders) and `runAction`
 * (what actually gets VALIDATED — `validateAgainstDescriptor` over whatever this returns), so the two
 * can never drift apart: a category a company just archived stops being a valid NEW value the moment
 * it's gone from both, the same "the API refuses exactly what the screen would refuse" discipline
 * `applyCompanyCustomFieldsView`'s own header already holds for its case.
 *
 * A no-op — no DB round-trip at all — for every OTHER document type: 'expense' is the only descriptor
 * that declares a `category` field, so `typeId !== 'expense'` returns `fields` untouched before this
 * ever queries `ExpenseCategory`. This composition point (`documents.service.ts`) is shared by every
 * one of the thirteen registered types, so this guard is what keeps the other twelve free of a query
 * that could never affect them.
 */
export async function applyExpenseCategoriesView(
  companyId: string,
  typeId: string,
  fields: DocumentFieldDescriptor[],
): Promise<DocumentFieldDescriptor[]> {
  if (typeId !== 'expense') return fields;
  const categories = await listExpenseCategories(companyId, { includeArchived: false });
  const options = categories.map((category) => ({ value: category.key, label: category.label }));
  return applyFieldOverlay(fields, [{ op: 'modify', path: '', key: 'category', patch: { options } }]);
}
