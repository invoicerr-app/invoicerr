/**
 * The country FIELD OVERLAY — the mechanism the user asked for, in these words: "build the invoice
 * type as a base, and a country can add, modify, or remove a field." Three operations,
 * no more: `add`, `modify`, `remove`. The core (descriptors/*.descriptor.ts) never names a country;
 * this is where a country's DIFFERENCE from the trunk is expressed, as DATA, the same "a country is
 * data" principle country-policy/ already applies to which ACTIONS a country allows.
 *
 * A field overlay is DELIBERATELY a different concern from country-policy/: that module decides
 * whether an ACTION may run at all; this one decides what an EXISTING type's FIELDS look like for a
 * company in a given country. Neither reads the other.
 *
 * `path` addresses WHICH array of fields an operation targets:
 *  - `''` (empty string) — the document type's own top-level `fields`.
 *  - a non-empty string — the KEY of a top-level 'array' field, whose OWN `field.fields` (one row's
 *    shape) is the target (e.g. `'lines'` for the invoice's line fields). Deliberately only ONE level
 *    of nesting: nothing in this core has a field nested two levels deep today (an 'array' inside an
 *    'array'), so supporting it now would be machinery with no real caller — see apply-overlay.ts's
 *    `targetArrayFor`, which throws a clear, named error for a path that does not resolve, rather
 *    than silently doing nothing.
 *
 * No operation carries its OWN provenance: unlike a country-policy rule or a VAT rate, "add/modify/
 * remove this field" is a STRUCTURAL/product fact about what a document type's shape is for this
 * country, not itself a new legal claim — any legal weight lives in the DATA an operation might wire
 * in (e.g. a 'modify' that points a field at vat-rates/, whose own entries already carry their own
 * provenance) or is written out in this file's own `notes`, the same way a document type descriptor's
 * own header carries its reasoning in prose rather than a machine-checked field.
 */
import { DocumentFieldDescriptor } from '../descriptors/types';

export interface AddFieldOperation {
  op: 'add';
  path: string;
  field: DocumentFieldDescriptor;
}

export interface ModifyFieldOperation {
  op: 'modify';
  path: string;
  /** The KEY of the existing field to modify — not `field.key`, since a 'modify' patch may be
   *  partial and need not repeat the key at all. */
  key: string;
  patch: Partial<DocumentFieldDescriptor>;
}

export interface RemoveFieldOperation {
  op: 'remove';
  path: string;
  key: string;
}

export type FieldOverlayOperation = AddFieldOperation | ModifyFieldOperation | RemoveFieldOperation;

export interface TypeFieldOverlay {
  /** A DocumentTypeDescriptor.id (descriptors/types.ts) — e.g. "invoice". Deliberately NOT validated
   *  against the live DocumentTypeRegistry here — the same declared independence
   *  country-policy/schema.ts's own `DocumentActionRuleFact.typeId` already keeps from that
   *  registry, for the same reason: this file and the descriptor registry are two
   *  independently-maintained sources. */
  typeId: string;
  operations: FieldOverlayOperation[];
}

export interface CountryFieldOverlayFile {
  /** ISO 3166-1 alpha-2, uppercase — must match the file's own name (data/all.ts checks this). */
  countryCode: string;
  overlays: TypeFieldOverlay[];
  /** Free-form, file-level caveats. */
  notes?: string;
}

export class InvalidCountryFieldOverlayError extends Error {}

/**
 * The one gate a field-overlay file cannot get past without a structurally sound shape — this catalog
 * carries no per-operation PROVENANCE (see this file's own header: an "add/modify/remove" is a
 * structural/product fact, not itself a new legal claim), so unlike country-policy/schema.ts's
 * `assertValidProvenance` this checks SHAPE, not sourcing. Before this existed, a JSON typo on `op`
 * (`"delete"` for `"remove"`) or a missing `key`/`field.key` reached `apply-overlay.ts` at RUNTIME —
 * where an unrecognized `op` fell through its own `switch` with no `default` case and silently did
 * nothing, and a missing `key` threw an unlabelled error far from the file that actually caused it.
 * This makes both a loud, named failure at BOOT instead — the same "every failure mode here is a
 * loud, named Error, never a silent no-op" discipline `apply-overlay.ts`'s own header already holds
 * for the APPLY side, now held for the DATA side too.
 *
 * Called from `data/all.ts` when a file loads — the only loader this catalog has (no seed/DB step to
 * double-gate at the way `country-policy/seed.ts` re-validates independently of `data/all.ts`).
 */
export function assertValidCountryFields(file: CountryFieldOverlayFile, context: string): void {
  if (!Array.isArray(file.overlays)) {
    throw new InvalidCountryFieldOverlayError(`${context}: "overlays" must be an array.`);
  }

  const seenTypeIds = new Set<string>();
  file.overlays.forEach((overlay, overlayIndex) => {
    const overlayContext = `${context}: overlay block #${overlayIndex + 1}`;
    if (!overlay.typeId?.trim()) {
      throw new InvalidCountryFieldOverlayError(`${overlayContext} is missing its "typeId".`);
    }
    if (seenTypeIds.has(overlay.typeId)) {
      // registry.ts#operationsFor resolves ONE block per typeId with a bare `.find()` — a SECOND
      // block for the SAME type would silently lose every one of its operations, applied nowhere and
      // reported nowhere. Refused here, at load, rather than discovered only once a country-specific
      // field is silently missing from a live screen.
      throw new InvalidCountryFieldOverlayError(
        `${context}: typeId "${overlay.typeId}" is declared in more than one overlay block — merge ` +
          'them into a single block (registry.ts only ever reads the FIRST one; the rest would be ' +
          'silently ignored).',
      );
    }
    seenTypeIds.add(overlay.typeId);

    if (!Array.isArray(overlay.operations)) {
      throw new InvalidCountryFieldOverlayError(
        `${context}: typeId "${overlay.typeId}" is missing "operations" (must be an array).`,
      );
    }

    overlay.operations.forEach((operation, operationIndex) => {
      const where = `${context}: typeId "${overlay.typeId}", operation #${operationIndex + 1}`;
      if (typeof operation.path !== 'string') {
        throw new InvalidCountryFieldOverlayError(`${where}: "path" must be a string.`);
      }
      switch (operation.op) {
        case 'add':
          if (!operation.field?.key?.trim()) {
            throw new InvalidCountryFieldOverlayError(`${where} ("add"): missing a field with a "key".`);
          }
          if (!operation.field.kind?.trim()) {
            throw new InvalidCountryFieldOverlayError(
              `${where} ("add"): field "${operation.field.key}" is missing a "kind".`,
            );
          }
          break;
        case 'modify':
          if (!operation.key?.trim()) {
            throw new InvalidCountryFieldOverlayError(
              `${where} ("modify"): missing the "key" of the field to modify.`,
            );
          }
          break;
        case 'remove':
          if (!operation.key?.trim()) {
            throw new InvalidCountryFieldOverlayError(
              `${where} ("remove"): missing the "key" of the field to remove.`,
            );
          }
          break;
        default:
          // The exact bug this validation exists to catch: an unknown `op` (a typo — "delete" for
          // "remove") used to fall through apply-overlay.ts's own `switch` with NO `default` case and
          // silently do nothing. Refused here, loudly, before it can ever reach a live company.
          throw new InvalidCountryFieldOverlayError(
            `${where}: unknown "op" ${JSON.stringify((operation as { op?: unknown }).op)} — must be ` +
              '"add", "modify", or "remove".',
          );
      }
    });
  });
}
