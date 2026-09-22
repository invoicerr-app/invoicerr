/**
 * Shared, tenant-safe persistence for a company's own custom-field DEFINITIONS — the same split
 * `payment-methods/persistence.ts` already draws (plain functions, not a Nest service): this module
 * is read from both the settings-screen controller AND the plain rendering pipeline
 * (`rendering/render-instance-pdf.ts` has no Nest injector to pull a service from), and from
 * `documents.service.ts`'s `describeTypeForCompany`/`runAction` (`applyCompanyCustomFieldsView`
 * below), which is what makes a company custom field validate on every action a document has —
 * "send" included — not merely on "save-draft". See that function's own header for why the earlier
 * `actions/generic-actions.ts#performSaveDraft` hook this module used to expose
 * (`assertDocumentCustomFieldValuesValid`, CLIENT-side counterpart `assertClientCustomFieldValuesValid`
 * kept) was removed once this composition point existed: `runAction` is the ONE place a document
 * action ever actually runs, so a check inside one single handler was strictly narrower than, and
 * therefore made redundant by, one wired into the shared field VIEW every handler's data is already
 * checked against.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { applyFieldOverlay } from '../country-fields/apply-overlay';
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
 *
 * For a DOCUMENT-target field, the scope checked is WIDER than the exact `documentTypeId` this row
 * will carry: `resolveDocumentCustomFieldDescriptors` resolves one TYPE's fields as the UNION of that
 * type's own rows AND the `documentTypeId: null` ("every type") rows (its own header), so a specific
 * type's row and an "every type" row are composed together the moment anyone asks for that type's
 * fields — `applyCompanyCustomFieldsView` (below) then feeds both into
 * `country-fields/apply-overlay.ts#applyFieldOverlay` as plain `add` operations, which THROWS on a
 * duplicate key. A key must therefore be unique across whichever OTHER scope could end up composed
 * alongside it, never merely within its own exact `documentTypeId` value — a NEW "every type" field
 * must not collide with an EXISTING specific-type one (or every type using it would break the moment
 * this field is added), and a NEW specific-type field must not collide with an EXISTING "every type"
 * one either. CLIENT-target rows have no such cross-scope composition (`documentTypeId` is always
 * `null` for them — see this model's own header), so they keep the exact, single-scope check.
 */
async function findAvailableKey(
  companyId: string,
  target: CompanyCustomFieldTarget,
  documentTypeId: string | null,
  label: string,
): Promise<string> {
  const base = slugify(label);
  // Prisma's `in` filter never matches a NULL column value (a Postgres/Prisma limitation, not a
  // choice here) — the "specific type OR every type" scope below is therefore an explicit `OR` of
  // two `equals` clauses, never `documentTypeId: { in: [documentTypeId, null] } }`, which would
  // silently drop the `null` half and let a genuine collision through uncaught.
  const scope =
    target === 'DOCUMENT'
      ? documentTypeId === null
        ? {} // "every type": collides with ANY existing DOCUMENT-target row, whatever ITS own scope.
        : { OR: [{ documentTypeId }, { documentTypeId: null }] }
      : { documentTypeId };

  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? base : `${base}_${attempt + 1}`;
    const existing = await prisma.companyCustomField.findFirst({
      where: { companyId, target, key: candidate, ...scope },
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
 * Appends this company's ACTIVE custom field definitions for `typeId` onto `fields` as `add`
 * operations — reusing `country-fields/apply-overlay.ts#applyFieldOverlay` exactly as it stands, per
 * this feature's own governing decision: a company custom field IS an "add", nothing more, composed
 * AFTER the country's own field view (`descriptors/company-view.ts#applyCompanyFieldView`). Called
 * from `documents.service.ts`'s `describeTypeForCompany` (what the create/edit FORM renders) and
 * `runAction` (what actually gets VALIDATED — `validateAgainstDescriptor` over whatever this
 * returns), so the two can never drift apart: a required custom field left empty is refused with the
 * exact same 400 shape a native or country-added field's own violation already gets, on EVERY
 * action a document has — "send" included, not merely "save-draft" (see this module's own header
 * for why the earlier, save-draft-only hook was removed once this existed).
 *
 * ARCHIVED definitions are deliberately excluded (`resolveDocumentCustomFieldDescriptors`'s own
 * `includeArchived: false` default): this is the ONE shared field view both callers above use, so an
 * archived definition must never be offered for fresh input, nor be required, again. An
 * already-recorded value for an archived definition is a document LIST/PDF concern instead — their
 * own separate `includeArchived: true` resolution (the controller's `GET .../resolved` and
 * `render-instance-pdf.ts#companyCustomFieldsFor`): a per-TYPE descriptor is shared across every
 * instance of that type, so it has no per-instance `data` here to check an archived key's value
 * against, unlike those two per-INSTANCE reads.
 *
 * The `custom:` key prefix (`toFieldDescriptor`) makes a genuine collision with a native or
 * country-overlay field structurally impossible, so `applyFieldOverlay`'s own duplicate-key check
 * here is a defensive backstop, never a path any correctly-keyed data reaches — see
 * `findAvailableKey`'s own header for the one place a collision BETWEEN TWO custom fields
 * themselves is actually prevented, at creation time.
 */
export async function applyCompanyCustomFieldsView(
  companyId: string,
  typeId: string,
  fields: DocumentFieldDescriptor[],
): Promise<DocumentFieldDescriptor[]> {
  const customFields = await resolveDocumentCustomFieldDescriptors(companyId, typeId);
  if (customFields.length === 0) return fields;
  return applyFieldOverlay(
    fields,
    customFields.map((field) => ({ op: 'add' as const, path: '', field })),
  );
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
