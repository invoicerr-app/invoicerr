/**
 * The country FIELD OVERLAY — the mechanism the user asked for in exactly these words: "on fait le
 * type invoice de base, et un pays peut ajouter, modifier ou supprimer un champ." Three operations,
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
