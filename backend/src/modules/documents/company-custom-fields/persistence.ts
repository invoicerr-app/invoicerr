/**
 * Shared, tenant-safe persistence for a company's own custom-field DEFINITIONS — the same split
 * `payment-methods/persistence.ts` already draws (plain functions, not a Nest service): this module
 * is read from both the settings-screen controller AND the plain rendering pipeline
 * (`rendering/render-instance-pdf.ts` has no Nest injector to pull a service from), and from
 * `actions/generic-actions.ts`'s `performSaveDraft` for the save-time validation pass.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { validateAgainstDescriptor } from '../descriptors/validate';
import {
  CompanyCustomFieldOptionInput,
  CompanyCustomFieldRecord,
  CompanyCustomFieldTarget,
  CompanyCustomFieldView,
  CreateCompanyCustomFieldInput,
  isAllowedCustomFieldKind,
  toFieldDescriptor,
  toView,
  UpdateCompanyCustomFieldInput,
} from './types';
import { DocumentFieldDescriptor } from '../descriptors/types';

// Validating a company-defined field's own VALUE needs nothing beyond the closed CORE_FIELD_KINDS
// (ALLOWED_CUSTOM_FIELD_KINDS is a subset of it) — same reasoning payment-methods/persistence.ts's
// own module-level registry gives for not sharing `documents-core.module.ts`'s FIELD_KIND_REGISTRY
// token (which additionally carries whatever a plugin registered): a company custom field can never
// BE a plugin kind (see types.ts's own closed list), so there is nothing a shared instance would add.
const fieldKindRegistry = new FieldKindRegistry();
registerCoreFieldKinds(fieldKindRegistry);

/** Slugifies `label` into a stable, URL/JSON-key-safe `key` — lowercase ASCII letters/digits joined
 *  by underscores, truncated defensively, falling back to a fixed literal for a label that slugifies
 *  to nothing at all (e.g. one written entirely in a non-Latin script or pure punctuation) so the
 *  scope's uniqueness check below always has a real string to append a numeric suffix to. */
const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

function slugify(label: string): string {
  const base = label
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // strips combining diacritics left behind by NFKD (é -> e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return base || 'field';
}

/**
 * Finds a `key` that is free within `(companyId, target, documentTypeId)` — appending `_2`, `_3`, …
 * to the slugified label until one doesn't collide. Re-checked here rather than trusted to the DB
 * constraint alone: schema.prisma's own `@@unique` cannot distinguish two DIFFERENT
 * `documentTypeId: null` ("every document type") rows from each other (Postgres treats two NULLs as
 * unequal for uniqueness) — see that constraint's own comment.
 */
async function findAvailableKey(
  companyId: string,
  target: CompanyCustomFieldTarget,
  documentTypeId: string | null,
  label: string,
): Promise<string> {
  const base = slugify(label);
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
    const existing = await prisma.companyCustomField.findFirst({
      where: { companyId, target, documentTypeId, key: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
}

function assertValidKind(kind: string): void {
  if (!isAllowedCustomFieldKind(kind)) {
    throw new BadRequestException(
      `"${kind}" is not an allowed custom field kind. Allowed: text, longText, number, money, date, boolean, select.`,
    );
  }
}

function assertValidOptions(kind: string, options: CompanyCustomFieldOptionInput[] | undefined): void {
  if (kind !== 'select') return;
  if (!options || options.length === 0) {
    throw new BadRequestException('A "select" custom field needs at least one option.');
  }
  const values = new Set<string>();
  for (const option of options) {
    if (!option.value || !option.label) {
      throw new BadRequestException('Every option needs both a value and a label.');
    }
    if (values.has(option.value)) {
      throw new BadRequestException(`Duplicate option value "${option.value}".`);
    }
    values.add(option.value);
  }
}

/** Every definition for `companyId`, optionally narrowed — the settings screen's own list (every
 *  target/type, `includeArchived: true`) and the resolution helpers below (one target/type at a
 *  time) both go through this. Ordered by `order` then `createdAt` so a tie (two rows created with
 *  the same explicit `order`) still comes back in a stable, deterministic sequence. */
export async function listCompanyCustomFields(
  companyId: string,
  filter: {
    target?: CompanyCustomFieldTarget;
    documentTypeId?: string | null;
    includeArchived?: boolean;
  } = {},
): Promise<CompanyCustomFieldView[]> {
  const rows = await prisma.companyCustomField.findMany({
    where: {
      companyId,
      ...(filter.target ? { target: filter.target } : {}),
      ...(filter.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  const filtered =
    filter.documentTypeId === undefined
      ? rows
      : rows.filter((row) => row.documentTypeId === null || row.documentTypeId === filter.documentTypeId);
  return filtered.map((row) => toView(row as CompanyCustomFieldRecord));
}

/** Throws 404 for an id that doesn't exist, or belongs to a DIFFERENT company — the same
 *  tenant-scoped "not found, never forbidden" posture the rest of this codebase holds (see
 *  clients.service.ts's own `editClientsInfo`). */
async function resolveOwnedOrThrow(companyId: string, id: string): Promise<CompanyCustomFieldRecord> {
  const row = await prisma.companyCustomField.findFirst({ where: { id, companyId } });
  if (!row) {
    throw new NotFoundException(`No custom field definition "${id}" for this company.`);
  }
  return row as CompanyCustomFieldRecord;
}

export async function createCompanyCustomField(
  companyId: string,
  input: CreateCompanyCustomFieldInput,
): Promise<CompanyCustomFieldView> {
  assertValidKind(input.kind);
  assertValidOptions(input.kind, input.options);
  if (!input.label?.trim()) {
    throw new BadRequestException('A label is required.');
  }

  // A CLIENT-target row has no "type" for `documentTypeId` to narrow — forced to `null` regardless of
  // what the caller sent, the same defensive normalization `field-kinds.ts`'s own kind-specific
  // branches hold for a hint that only makes sense for one shape.
  const documentTypeId = input.target === 'CLIENT' ? null : (input.documentTypeId ?? null);
  const key = await findAvailableKey(companyId, input.target, documentTypeId, input.label);

  const row = await prisma.companyCustomField.create({
    data: {
      companyId,
      target: input.target,
      documentTypeId,
      key,
      label: input.label.trim(),
      kind: input.kind,
      options: input.kind === 'select' ? (input.options as object[]) : undefined,
      required: input.required ?? false,
      order: input.order ?? 0,
    },
  });
  return toView(row as CompanyCustomFieldRecord);
}

/**
 * Updates the mutable facts only (`label`/`options`/`required`/`order`) — `key`/`kind`/`target`/
 * `documentTypeId` are not part of `UpdateCompanyCustomFieldInput` at all (see that type's own
 * header): there is no code path here that could touch them even by mistake.
 */
export async function updateCompanyCustomField(
  companyId: string,
  id: string,
  patch: UpdateCompanyCustomFieldInput,
): Promise<CompanyCustomFieldView> {
  const existing = await resolveOwnedOrThrow(companyId, id);

  if (patch.label !== undefined && !patch.label.trim()) {
    throw new BadRequestException('A label is required.');
  }
  const nextOptions = patch.options !== undefined ? patch.options : undefined;
  if (nextOptions !== undefined) {
    assertValidOptions(existing.kind, nextOptions);
  }

  const row = await prisma.companyCustomField.update({
    where: { id },
    data: {
      label: patch.label !== undefined ? patch.label.trim() : undefined,
      options: nextOptions !== undefined ? (nextOptions as object[]) : undefined,
      required: patch.required,
      order: patch.order,
    },
  });
  return toView(row as CompanyCustomFieldRecord);
}

/** Soft-delete — see schema.prisma's own `CompanyCustomField` header for the full "why": a document
 *  or client that already carries a value for this field keeps rendering it forever (resolve with
 *  `includeArchived: true`), while the create/edit surface (`includeArchived: false`, the default)
 *  stops offering it. Idempotent: archiving an already-archived row just re-stamps `archivedAt`. */
export async function archiveCompanyCustomField(
  companyId: string,
  id: string,
): Promise<CompanyCustomFieldView> {
  await resolveOwnedOrThrow(companyId, id);
  const row = await prisma.companyCustomField.update({ where: { id }, data: { archivedAt: new Date() } });
  return toView(row as CompanyCustomFieldRecord);
}

/** The undo for `archiveCompanyCustomField` — re-offers an archived definition on the create/edit
 *  surface again. Never re-checks key availability: the key was this row's own all along, nothing
 *  else could have taken it (creating a NEW row with the same key, in the same scope, is refused by
 *  `findAvailableKey`'s own collision check while this row is still archived and holding it). */
export async function restoreCompanyCustomField(
  companyId: string,
  id: string,
): Promise<CompanyCustomFieldView> {
  await resolveOwnedOrThrow(companyId, id);
  const row = await prisma.companyCustomField.update({ where: { id }, data: { archivedAt: null } });
  return toView(row as CompanyCustomFieldRecord);
}

/**
 * The fields a DOCUMENT TYPE's create/edit form (or a validation pass) should offer for `companyId` —
 * every DOCUMENT-target definition that names this exact `typeId` OR names none at all ("every
 * document type"), converted with the `custom:` prefix (see `toFieldDescriptor`'s own header).
 * `includeArchived: false` (the default) is what the FORM asks for; `render-instance-pdf.ts` and
 * `document-list.tsx`'s own resolved-fields fetch ask with `true` instead, so an archived
 * definition's already-entered value keeps rendering wherever it was already recorded.
 */
export async function resolveDocumentCustomFieldDescriptors(
  companyId: string,
  typeId: string,
  options: { includeArchived?: boolean } = {},
): Promise<DocumentFieldDescriptor[]> {
  const views = await listCompanyCustomFields(companyId, {
    target: 'DOCUMENT',
    documentTypeId: typeId,
    includeArchived: options.includeArchived ?? false,
  });
  return views.map((view) => toFieldDescriptor(view as unknown as CompanyCustomFieldRecord, 'custom:'));
}

/** The CLIENT-target counterpart — see `resolveDocumentCustomFieldDescriptors`'s own header. No
 *  `typeId` to narrow by (a client isn't one of several types), and no prefix (`Client.customFields`
 *  is already its own isolated JSON column — see that column's own schema.prisma header). */
export async function resolveClientCustomFieldDescriptors(
  companyId: string,
  options: { includeArchived?: boolean } = {},
): Promise<DocumentFieldDescriptor[]> {
  const views = await listCompanyCustomFields(companyId, {
    target: 'CLIENT',
    includeArchived: options.includeArchived ?? false,
  });
  return views.map((view) => toFieldDescriptor(view as unknown as CompanyCustomFieldRecord, ''));
}

/**
 * Validates a document's own `data` against `companyId`'s ACTIVE (non-archived) custom field
 * definitions for `typeId` — called from `actions/generic-actions.ts#performSaveDraft`, the one
 * generic write path every document type's "save-draft" goes through, so a required company field
 * left empty (or a value the field's own kind rejects — `field-kinds.ts`, the exact same validators
 * a NATIVE field's value is checked with) is refused with a 400 exactly the way a native field
 * already is, rather than silently accepted because this module lives outside `descriptor.fields`.
 *
 * Deliberately reads `data[field.key]` (the ALREADY-PREFIXED `custom:...` key) — this function does
 * not need to know the un-prefixed, human `key` at all, only the descriptor shape it converts to.
 * A company with NO custom field definitions for this type returns instantly (`fields.length === 0`
 * short-circuits `validateAgainstDescriptor` to `[]`), so this costs nothing for the overwhelming
 * majority of saves today.
 */
export async function assertDocumentCustomFieldValuesValid(
  companyId: string,
  typeId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const fields = await resolveDocumentCustomFieldDescriptors(companyId, typeId);
  if (fields.length === 0) return;
  const errors = validateAgainstDescriptor(fields, data, fieldKindRegistry);
  if (errors.length > 0) {
    throw new BadRequestException({ message: 'Invalid custom field data', errors });
  }
}

/** The CLIENT counterpart — called from `clients.service.ts`'s create/edit paths against
 *  `Client.customFields` (or `{}` when a caller sends none at all). Same short-circuit for a company
 *  with no CLIENT-target definitions. */
export async function assertClientCustomFieldValuesValid(
  companyId: string,
  customFields: Record<string, unknown> | null | undefined,
): Promise<void> {
  const fields = await resolveClientCustomFieldDescriptors(companyId);
  if (fields.length === 0) return;
  const errors = validateAgainstDescriptor(fields, customFields ?? {}, fieldKindRegistry);
  if (errors.length > 0) {
    throw new BadRequestException({ message: 'Invalid custom field data', errors });
  }
}
