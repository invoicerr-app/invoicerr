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
      if (field.required) {
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
