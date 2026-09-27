import { DocumentFieldDescriptor } from './types';
import { FieldKindRegistry } from './field-kinds';

export interface ValidationError {
  /** The field's key, or a path like "lines[0].quantity" for a nested row field. */
  key: string;
  message: string;
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Whether `field` is required RIGHT NOW for this `data` — `required` (unconditional),
 *  `requiredIfPresent` (conditional on a sibling field actually being set), or `requiredIfAbsent`
 *  (its mirror image, conditional on that sibling NOT being set — see both hints' own headers in
 *  types.ts). Folded into ONE predicate so the ordinary "is this field required" check below never
 *  has to know there are three different ways a field can end up that way. */
function isRequiredFor(field: DocumentFieldDescriptor, data: Record<string, unknown>): boolean {
  if (field.required) return true;
  if (field.requiredIfPresent) return !isMissing(data[field.requiredIfPresent]);
  if (field.requiredIfAbsent) return isMissing(data[field.requiredIfAbsent]);
  return false;
}

/**
 * Validates `data` against `fields` — the ONLY place that knows how a document's data is checked
 * against its descriptor. Presence/required-ness is decided here, once, for every kind; a kind's
 * own validator (FieldKindRegistry) is only ever asked "is this present value shaped right".
 *
 * 'array' is the one kind this function recurses into by itself: a row is just another `data`
 * object validated against the row's own `fields`, which is what makes "a table of sub-fields" a
 * structural feature of the core rather than a per-document-type special case.
 */
export function validateAgainstDescriptor(
  fields: DocumentFieldDescriptor[],
  data: Record<string, unknown>,
  registry: FieldKindRegistry,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of fields) {
    const value = data[field.key];

    if (isMissing(value)) {
      if (isRequiredFor(field, data)) {
        errors.push({ key: field.key, message: `"${field.label}" is required.` });
      }
      continue;
    }

    const validator = registry.resolve(field.kind);
    if (!validator) {
      errors.push({
        key: field.key,
        message: `"${field.label}" has field kind "${field.kind}", which no validator is registered for.`,
      });
      continue;
    }

    const error = validator(value, { field, data });
    if (error) {
      errors.push({ key: field.key, message: `"${field.label}" ${error}` });
      continue;
    }

    if (field.kind === 'array' && Array.isArray(value) && field.fields?.length) {
      value.forEach((row, index) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
          errors.push({
            key: `${field.key}[${index}]`,
            message: `Row ${index + 1} of "${field.label}" must be an object.`,
          });
          return;
        }
        const rowErrors = validateAgainstDescriptor(
          field.fields as DocumentFieldDescriptor[],
          row as Record<string, unknown>,
          registry,
        );
        for (const rowError of rowErrors) {
          errors.push({ key: `${field.key}[${index}].${rowError.key}`, message: rowError.message });
        }
      });
    }
  }

  return errors;
}

/** Whether a single ROW VALUE carries nothing worth keeping on its own. Mirrors `isMissing` above
 *  (undefined/null/'') and adds one thing: a bare number `0` counts as empty here too — a quantity or
 *  a price of exactly zero states nothing about a line by itself (see `dropEmptyRows`'s own header
 *  for why that matters). This is deliberately NOT what `isRequiredFor`/`isMissing` use to decide
 *  whether a REQUIRED field was satisfied elsewhere in this file — a required numeric field IS
 *  satisfied by a genuinely typed `0` (e.g. a free line's `discountPercent: 0`); this helper only
 *  ever answers the narrower "does the row, as a WHOLE, have anything worth validating" question. */
function isEmptyRowValue(value: unknown): boolean {
  if (isMissing(value)) return true;
  return typeof value === 'number' && value === 0;
}

/**
 * Drops every row of every declared 'array' field whose subfields are ALL empty (`isEmptyRowValue`)
 * — the mechanism behind issue #365 ("empty line items should not survive a save"). The frontend's
 * "+ Add line" button (array-field.tsx's own `emptyRow`) appends a row with every subfield
 * `undefined`; a row the user cleared back to nothing ends up the same way. Neither carries a single
 * business fact, and persisting either just leaves a blank row for the eventual PDF to print. Runs
 * BEFORE `validateAgainstDescriptor` (documents.service.ts#runAction) so an all-empty row's own
 * required subfields (an invoice line's `description`/`quantity`/`unit`/`unitPrice`/`vatRate`) never
 * even reach that check — the row disappears instead of blocking the save with a wall of "required"
 * errors for fields the user never intended to fill in.
 *
 * A row where the user typed ANYTHING real — even a single field, e.g. only a price or only a
 * description — is left EXACTLY as it is, required-field gaps included: `validateAgainstDescriptor`
 * still asks for whatever that specific row is still missing, exactly as it always has. This function
 * only ever removes a row that has NOTHING to validate in the first place; it never guesses that a
 * half-filled row was "probably" meant to be discarded too.
 *
 * A consequence, not a special case: a document left with nothing but empty rows ends up with an
 * empty array, which the 'array' kind's own `min` check (field-kinds.ts) then refuses exactly the way
 * it would refuse an array that started empty — so a document made only of empty lines is correctly
 * rejected rather than silently persisted with `lines: []`.
 *
 * Applies to every 'array' field generically, never hardcoded to "lines": any document type that
 * declares one row-shaped array field gets the same behavior for free, the same "a document type is
 * just data" discipline `stripSidecarKeys` right below already holds. Scoped to document `data` only
 * (documents.service.ts#runAction calls this on `payload.data`, never on `payload.params`) — an
 * action's own params (e.g. "request-installments"'s `milestones`) are a different namespace with
 * their own, unrelated shape. Returns a NEW object (and new arrays) — never mutates `data` in place,
 * same discipline as `stripSidecarKeys`.
 */
export function dropEmptyRows<T extends Record<string, unknown>>(
  fields: DocumentFieldDescriptor[],
  data: T,
): T {
  const cleaned: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (field.kind !== 'array' || !field.fields?.length) continue;
    const rows = cleaned[field.key];
    if (!Array.isArray(rows)) continue;
    const rowFields = field.fields as DocumentFieldDescriptor[];
    cleaned[field.key] = rows
      .filter((row) => {
        // Not this function's shape to judge — validateAgainstDescriptor (or the 'array' validator
        // itself) is what rejects a row that isn't even an object; leaving it in place is what lets
        // that rejection still happen, with the row's own index intact, instead of it vanishing here.
        if (row === null || typeof row !== 'object' || Array.isArray(row)) return true;
        const record = row as Record<string, unknown>;
        return !rowFields.every((rowField) => isEmptyRowValue(record[rowField.key]));
      })
      .map((row) =>
        row !== null && typeof row === 'object' && !Array.isArray(row)
          ? dropEmptyRows(rowFields, row as Record<string, unknown>)
          : row,
      );
  }
  return cleaned as T;
}

/**
 * Recursively removes every key starting with `__` from `data` and from each row of every declared
 * 'array' field — the internal, server-only sidecar convention a handful of fields rely on (e.g.
 * `field-kinds.ts`'s 'select' validator, `usesVatRateCatalog` branch, keyed on `__crossBorderCategory`)
 * to recognize a value THIS SERVER already resolved (`tax/resolve-invoice-tax.ts`'s own header),
 * never a descriptor field a caller could see, type into a form, or post directly. A raw HTTP body is
 * not the only thing that can carry one of these keys today — the pre-refonte draft simply passed one
 * FORWARD once it existed (a preflight resolution replayed through the SAME "sending" record) — so
 * this is a generic, schema-driven strip a caller applies at whatever boundary actually separates
 * "fresh, caller-supplied data" from "this server's own, already-resolved data": see
 * `actions/invoice-actions.ts`'s own "send" registration for the one caller that matters today, and
 * why it strips ONLY when the record is not already "sending" (a worker replaying its own prior
 * resolution) — this function itself has no notion of that distinction, it only removes the keys it
 * is asked to remove, from whatever `data` it is handed.
 *
 * Returns a NEW object (and new row objects) — never mutates `data` in place — so a caller that still
 * holds a reference to the original is never surprised by this call.
 */
export function stripSidecarKeys<T extends Record<string, unknown>>(
  fields: DocumentFieldDescriptor[],
  data: T,
): T {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('__')) continue;
    cleaned[key] = value;
  }
  for (const field of fields) {
    if (field.kind !== 'array' || !field.fields?.length) continue;
    const rows = cleaned[field.key];
    if (!Array.isArray(rows)) continue;
    cleaned[field.key] = rows.map((row) =>
      row !== null && typeof row === 'object' && !Array.isArray(row)
        ? stripSidecarKeys(field.fields as DocumentFieldDescriptor[], row as Record<string, unknown>)
        : row,
    );
  }
  return cleaned as T;
}
