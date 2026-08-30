/**
 * Applies a country's field-overlay OPERATIONS to a document type's `fields` — the actual mechanism
 * behind schema.ts's three operations. Always returns a FRESH, deep-cloned array: the descriptor a
 * type registers (descriptors/*.descriptor.ts) is one shared object instance reused across every
 * company and request (see descriptors/type-registry.ts), so mutating it in place for one company's
 * country would corrupt it for every other company. Every caller — including one that passes an
 * EMPTY operations list — gets back a clone, never the original reference; "a country with no
 * overlay gets the trunk intact" means the same VALUES, not the same object identity.
 *
 * Every failure mode here is a loud, named Error, never a silent no-op: a misconfigured overlay
 * (a `path`/`key` that does not resolve, an `add` that collides with an existing key) is a bug in a
 * DATA file, and this module's whole reason to exist is that such a bug must be caught, not quietly
 * swallowed into "the field just isn't there" — the same discipline country-policy/schema.ts's
 * `assertValidProvenance` already holds for its own data.
 */
import { DocumentFieldDescriptor } from '../descriptors/types';
import { FieldOverlayOperation } from './schema';

export class FieldOverlayError extends Error {}

function cloneField(field: DocumentFieldDescriptor): DocumentFieldDescriptor {
  const clone: DocumentFieldDescriptor = { ...field };
  if (field.options) clone.options = field.options.map((option) => ({ ...option }));
  if (field.fields) clone.fields = field.fields.map(cloneField);
  return clone;
}

/** Deep-clones a `fields` array — recursing into 'array' fields' own nested `fields` and into
 *  `options` lists — so a caller can safely mutate the result without ever touching the shared
 *  descriptor it came from. Exported for descriptors/company-view.ts, which needs the exact same
 *  clone-before-mutate guarantee for its own (unrelated) VAT-rate-catalog pass. */
export function cloneFields(fields: DocumentFieldDescriptor[]): DocumentFieldDescriptor[] {
  return fields.map(cloneField);
}

/**
 * Resolves WHICH array of fields an operation's `path` targets — see schema.ts's own header for the
 * two shapes `path` can take. Throws for a path that does not resolve to a real 'array' field with
 * rows of its own: a country-fields file naming a field that does not exist (a typo, a field that got
 * renamed in the trunk) must fail loudly rather than silently target nothing.
 */
function targetArrayFor(
  fields: DocumentFieldDescriptor[],
  path: string,
  context: string,
): DocumentFieldDescriptor[] {
  if (path === '') return fields;

  const parent = fields.find((candidate) => candidate.key === path);
  if (!parent) {
    throw new FieldOverlayError(`${context}: path "${path}" does not name a field on this document type.`);
  }
  if (parent.kind !== 'array' || !parent.fields) {
    throw new FieldOverlayError(
      `${context}: path "${path}" names field "${parent.key}" (kind "${parent.kind}"), which is not ` +
        "an 'array' field with rows of its own.",
    );
  }
  return parent.fields;
}

function describe(operation: FieldOverlayOperation): string {
  const key = operation.op === 'add' ? operation.field.key : operation.key;
  return `field overlay operation "${operation.op}" on path "${operation.path || '(top level)'}", key "${key}"`;
}

/**
 * Applies `operations`, in order, to a CLONE of `fields`. Each operation is resolved against the
 * result of every operation before it, so a country's file can legitimately `add` a field and then
 * `modify` the very same field in a later operation (not needed by any shipped file today, but not
 * artificially forbidden either — operations are just a list, applied in file order, the same way
 * country-policy's own `rules` are just a list).
 */
export function applyFieldOverlay(
  fields: DocumentFieldDescriptor[],
  operations: FieldOverlayOperation[],
): DocumentFieldDescriptor[] {
  const cloned = cloneFields(fields);

  for (const operation of operations) {
    const context = describe(operation);
    const target = targetArrayFor(cloned, operation.path, context);

    switch (operation.op) {
      case 'add': {
        if (target.some((candidate) => candidate.key === operation.field.key)) {
          throw new FieldOverlayError(
            `${context}: field "${operation.field.key}" already exists — use "modify" instead of "add".`,
          );
        }
        target.push(cloneField(operation.field));
        break;
      }

      case 'modify': {
        const index = target.findIndex((candidate) => candidate.key === operation.key);
        if (index === -1) {
          throw new FieldOverlayError(
            `${context}: field "${operation.key}" does not exist — nothing to modify.`,
          );
        }
        target[index] = { ...target[index], ...operation.patch };
        break;
      }

      case 'remove': {
        const index = target.findIndex((candidate) => candidate.key === operation.key);
        if (index === -1) {
          throw new FieldOverlayError(
            `${context}: field "${operation.key}" does not exist — nothing to remove.`,
          );
        }
        target.splice(index, 1);
        break;
      }
    }
  }

  return cloned;
}
