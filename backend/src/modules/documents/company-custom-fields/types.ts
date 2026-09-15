import { CompanyCustomFieldTarget } from '../../../../prisma/generated/prisma/client';

import { DocumentFieldDescriptor } from '../descriptors/types';

/**
 * The RESTRICTED subset of CORE_FIELD_KINDS (descriptors/types.ts) a company-defined field may use —
 * deliberately narrower than the full core set: a company-defined field is always a single SCALAR
 * value entered by hand, never a structural one. Excluded, and why:
 *  - 'reference'/'hiddenReference' — resolving an entity needs an EntityReferenceRegistry entry a
 *    company cannot register from a settings screen.
 *  - 'array'/'rowSelection' — a repeatable/derived shape, not "one more field" the way every kind
 *    below is; letting a company nest an arbitrary row shape here would need this whole feature to
 *    re-implement `country-fields/apply-overlay.ts`'s own nested-path handling for company data too.
 *  - 'file' — attachments/attachments.service.ts's upload/download surface is company-scoped but
 *    NOT keyed by an arbitrary field id today; wiring a company-defined attachment field is real,
 *    unstarted work (TODO_ISSUES.md), not a one-line addition to this list.
 *
 * PRODUCT CHOICE TO VALIDATE: this list — text/longText/number/money/date/boolean/select — is the
 * simplest reading of the feature request's own "au minimum text, number, date, select, boolean";
 * 'longText'/'money' are included because they cost nothing (already fully generic, both ends) and a
 * company is at least as likely to want a paragraph note or a monetary amount as a plain number.
 */
export const ALLOWED_CUSTOM_FIELD_KINDS = [
  'text',
  'longText',
  'number',
  'money',
  'date',
  'boolean',
  'select',
] as const;

export type AllowedCompanyCustomFieldKind = (typeof ALLOWED_CUSTOM_FIELD_KINDS)[number];

export function isAllowedCustomFieldKind(kind: string): kind is AllowedCompanyCustomFieldKind {
  return (ALLOWED_CUSTOM_FIELD_KINDS as readonly string[]).includes(kind);
}

export { CompanyCustomFieldTarget };

export interface CompanyCustomFieldOptionInput {
  value: string;
  label: string;
}

/** The request body for `POST /custom-fields`. `key` is deliberately ABSENT: it is derived from
 *  `label` at creation time (persistence.ts#slugifyKey) and never accepted from the caller — see
 *  schema.prisma's own `CompanyCustomField.key` header for why it must be assigned once and never
 *  renamed. */
export interface CreateCompanyCustomFieldInput {
  target: CompanyCustomFieldTarget;
  /** DOCUMENT target only — a DocumentTypeDescriptor id, or omitted/null for "every document type".
   *  Ignored (forced to `null`) for a CLIENT-target row. */
  documentTypeId?: string | null;
  label: string;
  kind: string;
  /** 'select' only. */
  options?: CompanyCustomFieldOptionInput[];
  required?: boolean;
  order?: number;
}

/**
 * The request body for `PATCH /custom-fields/:id` — deliberately NARROWER than the create input:
 * `target`/`documentTypeId`/`key`/`kind` are all immutable after creation (see this model's own
 * schema.prisma header on why `key` cannot change; `kind` is frozen alongside it here so a value
 * already on file for this field never stops matching the validator that originally accepted it, and
 * `target`/`documentTypeId` are frozen so a definition can never retroactively "move" onto a
 * document/type whose past instances never had a chance to carry a value for it under a
 * consistent meaning). Only presentation/behavior facts stay editable — renaming (`label`),
 * requiredness, the offered choices, and display order.
 */
export interface UpdateCompanyCustomFieldInput {
  label?: string;
  options?: CompanyCustomFieldOptionInput[];
  required?: boolean;
  order?: number;
}

/** One definition, as returned to the settings screen — the full row minus nothing: unlike the
 *  RESOLVED view (a `DocumentFieldDescriptor`, only ever active-or-relevant), the settings screen
 *  needs `archivedAt` itself (to grey the row out and offer "restore") and the immutable `key`/`kind`
 *  (shown, never editable — see UpdateCompanyCustomFieldInput's own header). */
export interface CompanyCustomFieldView {
  id: string;
  target: CompanyCustomFieldTarget;
  documentTypeId: string | null;
  key: string;
  label: string;
  kind: string;
  options: CompanyCustomFieldOptionInput[] | null;
  required: boolean;
  order: number;
  archivedAt: string | null;
}

/** A raw DB row shape wide enough for the conversion helpers below — matches the Prisma model,
 *  kept separate from `CompanyCustomFieldView` (whose `archivedAt` is already ISO-stringified) so
 *  persistence.ts's Prisma calls don't have to fight this file's own wire type. */
export interface CompanyCustomFieldRecord {
  id: string;
  companyId: string;
  target: CompanyCustomFieldTarget;
  documentTypeId: string | null;
  key: string;
  label: string;
  kind: string;
  options: unknown;
  required: boolean;
  order: number;
  archivedAt: Date | null;
}

export function toView(record: CompanyCustomFieldRecord): CompanyCustomFieldView {
  return {
    id: record.id,
    target: record.target,
    documentTypeId: record.documentTypeId,
    key: record.key,
    label: record.label,
    kind: record.kind,
    options: (record.options as CompanyCustomFieldOptionInput[] | null) ?? null,
    required: record.required,
    order: record.order,
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
  };
}

/**
 * Converts one definition into a real `DocumentFieldDescriptor` — the SAME vocabulary a native
 * document type's own `fields`/a country overlay's `add` operation already use, which is what lets
 * both the create/edit form (`DocumentField`, generic per-KIND renderer) and the read-only display
 * (`DocumentFieldValue`) render a company-defined field with ZERO kind-specific code of their own.
 *
 * `keyPrefix` is what keeps a DOCUMENT-target field's stored value from ever colliding with a native
 * field of the SAME document type: `resolve.ts` (this module's own DOCUMENT-side caller) always
 * passes `'custom:'`, so a company field labeled "Client" becomes key `custom:client` — structurally
 * unable to collide with the invoice's own native `client` field, whatever a company names its field,
 * without this module ever having to cross-check against `DocumentTypeRegistry` (the same declared
 * independence `country-fields/schema.ts`'s own `TypeFieldOverlay` already keeps from that registry).
 * A CLIENT-target field passes `''` instead — `Client.customFields` is already its OWN isolated JSON
 * column (see that column's own schema.prisma header), so no prefix is needed there at all.
 *
 * `hideWhenEmpty: true` unconditionally — see `DocumentFieldDescriptor.hideWhenEmpty`'s own header
 * (descriptors/types.ts): a company field nobody has filled in yet has nothing to communicate, and
 * (more importantly here) this is also the mechanism that lets an ARCHIVED definition's already-
 * entered value keep rendering on the document list / PDF while never showing an empty "—" row on
 * every document that never had one.
 */
export function toFieldDescriptor(
  record: CompanyCustomFieldRecord,
  keyPrefix: string,
): DocumentFieldDescriptor {
  return {
    key: `${keyPrefix}${record.key}`,
    kind: record.kind,
    label: record.label,
    required: record.required,
    options: (record.options as CompanyCustomFieldOptionInput[] | null) ?? undefined,
    hideWhenEmpty: true,
  };
}
