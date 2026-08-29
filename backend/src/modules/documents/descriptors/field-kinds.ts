import { CORE_FIELD_KINDS, DocumentFieldDescriptor } from './types';

/** Everything a validator needs beyond the raw value: the field's own descriptor, and the whole
 *  document's data so a kind can read a sibling field (e.g. 'money' resolving `currencyField`). */
export interface FieldValidationContext {
  field: DocumentFieldDescriptor;
  data: Record<string, unknown>;
}

/** Returns an error message, or null when `value` is a structurally valid value for this kind.
 *  Presence/required-ness is handled once by `validateAgainstDescriptor`, not by individual
 *  validators — a validator is only ever called with a value that is actually present. */
export type FieldValidator = (value: unknown, ctx: FieldValidationContext) => string | null;

/**
 * Registry of field KIND validators, keyed by kind name. Open by design: a plugin registers a new
 * kind here (under a prefixed name, e.g. "plugin:acme.rating") to make it structurally validatable
 * — the frontend separately registers a matching renderer to make it drawable. Neither registry
 * knows about the other; a kind is usable end to end only once both sides have registered it.
 */
export class FieldKindRegistry {
  private readonly validators = new Map<string, FieldValidator>();

  register(kind: string, validator: FieldValidator): void {
    if (this.validators.has(kind)) {
      throw new Error(`Field kind "${kind}" is already registered.`);
    }
    this.validators.set(kind, validator);
  }

  has(kind: string): boolean {
    return this.validators.has(kind);
  }

  /** Undefined (not thrown) for an unknown kind — the orchestrator (validate.ts) turns that into a
   *  per-field "unknown kind, cannot validate" error rather than crashing the whole request. */
  resolve(kind: string): FieldValidator | undefined {
    return this.validators.get(kind);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberRangeError(value: number, field: DocumentFieldDescriptor): string | null {
  if (field.min !== undefined && value < field.min) return `must be at least ${field.min}.`;
  if (field.max !== undefined && value > field.max) return `must be at most ${field.max}.`;
  return null;
}

/**
 * Registers the closed core set (CORE_FIELD_KINDS) into `registry`. These are structural checks
 * only — "is this shaped like a date/a number/one of the offered choices" — never a business or
 * legal rule (no currency conversion, no tax, no numbering).
 */
export function registerCoreFieldKinds(registry: FieldKindRegistry): void {
  registry.register('text', (value) => (typeof value === 'string' ? null : 'must be text.'));

  registry.register('longText', (value) => (typeof value === 'string' ? null : 'must be text.'));

  registry.register('number', (value, { field }) => {
    if (!isFiniteNumber(value)) return 'must be a number.';
    return numberRangeError(value, field);
  });

  registry.register('money', (value, { field }) => {
    if (!isFiniteNumber(value)) return 'must be a number.';
    return numberRangeError(value, field);
  });

  registry.register('date', (value) => {
    if (typeof value !== 'string' && !(value instanceof Date)) return 'must be a date.';
    const time = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(time) ? 'must be a valid date.' : null;
  });

  registry.register('boolean', (value) => (typeof value === 'boolean' ? null : 'must be true or false.'));

  registry.register('select', (value, { field }) => {
    if (typeof value !== 'string') return 'must be one of the offered choices.';
    const options = field.options ?? [];
    return options.some((o) => o.value === value) ? null : 'is not one of the offered choices.';
  });

  // The referenced entity's existence is deliberately NOT checked here: that would need an async,
  // company-scoped lookup through EntityReferenceRegistry, which a synchronous structural validator
  // cannot do. This kind only proves "a non-empty id was submitted" — DocumentsService.runAction
  // does not currently cross-check it against the entity, which is the documented limitation.
  registry.register('reference', (value) =>
    typeof value === 'string' && value.length > 0 ? null : 'must reference an existing record.',
  );

  registry.register('array', (value, { field }) => {
    if (!Array.isArray(value)) return 'must be a list.';
    if (field.min !== undefined && value.length < field.min) return `must have at least ${field.min} row(s).`;
    if (field.max !== undefined && value.length > field.max) return `must have at most ${field.max} row(s).`;
    return null;
  });
}

export { CORE_FIELD_KINDS };
