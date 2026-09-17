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

/** Whether `field` is required RIGHT NOW for this `data` — `required` (unconditional) OR
 *  `requiredIfPresent` (conditional on a sibling field actually being set, see that hint's own
 *  header in types.ts). Folded into ONE predicate so the ordinary "is this field required" check
 *  below never has to know there are two different ways a field can end up that way. */
function isRequiredFor(field: DocumentFieldDescriptor, data: Record<string, unknown>): boolean {
  if (field.required) return true;
  if (field.requiredIfPresent) return !isMissing(data[field.requiredIfPresent]);
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
