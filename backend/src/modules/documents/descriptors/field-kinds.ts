import { registerRowSelectionFieldKind } from '../row-selection/row-selection';
import { CORE_FIELD_KINDS, DocumentFieldDescriptor, isMultiTargetReference } from './types';

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

/** The real EN 16931 BT-151 ("VAT category code") values — see the 'select' validator's own
 *  `usesVatRateCatalog` branch below for why this file needs to know them at all. Kept in sync BY
 *  EYE with `formats/shared-build.ts`'s own `VAT_CATEGORY_CODES` (never imported: a 'descriptors'
 *  file has no business depending on 'formats', the same layering this module already holds
 *  elsewhere) — both lists are the same closed, standardized vocabulary, not something either file
 *  invents independently. */
const CROSS_BORDER_CATEGORY_CODES = new Set(['S', 'Z', 'E', 'AE', 'K', 'G', 'O']);

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

  registry.register('select', (value, { field, data }) => {
    if (typeof value !== 'string') return 'must be one of the offered choices.';
    const options = field.options ?? [];
    if (options.some((o) => o.value === value)) return null;
    // See `DocumentFieldDescriptor.legacyOptions`'s own header (types.ts) — a value already
    // PERSISTED under a convention `options` no longer offers going forward (today: a VAT rate's bare
    // percentage, before `vat-rates/registry.ts#vatRateFieldOptions` switched to each rate's own
    // stable `id`). Never rendered as a choice, never a way to bypass a genuinely unknown value.
    if ((field.legacyOptions ?? []).some((o) => o.value === value)) return null;
    // `allowCustomValue` is an escape hatch for "no catalog/options known AT ALL" (see types.ts's own
    // comment) — it only opens when `options` is itself empty. A NON-empty, known list is enforced
    // exactly as before regardless of this flag: a scripted client must be refused exactly what the
    // screen would refuse, never allowed to bypass a real, sourced list by posting directly.
    if (field.allowCustomValue && options.length === 0) return null;
    // A DIFFERENT, NARROWER exception (2026-09-01), not a relaxation of
    // the one above: a VAT-rate-catalog field (`usesVatRateCatalog`, today only the invoice line's
    // `vatRate`) whose ROW was already resolved by the tax engine — marked by the
    // `__crossBorderCategory` sidecar `documents/tax/resolve-invoice-tax.ts` writes onto that SAME
    // row — legitimately carries either a FOREIGN country's real rate (e.g. Germany's 19% on a FR
    // seller's OSS sale) OR a 0% small-business-exemption rate for a DOMESTIC franchise seller
    // (`applyDomesticTaxScheme`, added 2026-09-13 — a franchise-exempt FR seller's own catalog may not
    // even list "0" as an option, since `tax-systems/data/fr.json` records `hasDomesticZeroRate:
    // false`), neither of which the seller's own domestic catalog (`options` here) was ever meant to
    // validate in the first place. Without this, the surgical fix (the resolved
    // treatment is persisted at "sending" and REPLAYED through this exact validator when the queued
    // worker job runs `runAction` again — see `queue/processors/document-action.processor.ts`'s own
    // header, "the EXACT SAME entry point") rejects its own output with "Invalid document data" the
    // moment a destination rate isn't ALSO one of the seller's own rates. Invisible for every
    // existing B2B case (0% — reverse charge/intra-Community/export — happens to already be a valid
    // FR rate); only surfaced once a REAL non-zero OSS destination rate (de.json,
    // it.json, ...) reached a genuine end-to-end send, caught by `35-cross-border-tax.cy.ts` — never
    // by a jest test that calls `resolveInvoiceCrossBorderTax` directly and never replays through
    // `runAction`. `allowCustomValue`'s own contract (never bypass a known, non-empty list for a
    // genuinely user-typed value) stays exactly as strict as before for every OTHER case.
    // Narrowed further (defense in depth): the sidecar's mere PRESENCE used to be enough to bypass
    // this check entirely, for ANY string value — meaning a caller could type an arbitrary garbage
    // `vatRate` (or, before `invoice-actions.ts`'s own strip existed, fabricate the sidecar itself on
    // a purely domestic line) and have it accepted outright. Requiring the value to be one of the real
    // EN 16931 BT-151 category codes (`shared-build.ts`'s own `VAT_CATEGORY_CODES` — duplicated here
    // rather than imported, the same small-intentional-duplication this module already holds
    // elsewhere: a 'descriptors' file has no business depending on 'formats') at least confines what a
    // request that reaches this validator can ever get treated as "already resolved by the tax
    // engine" — never a bypass for an arbitrary string. The LOAD-BEARING guard against a caller
    // fabricating this sidecar on a domestic invoice in the first place is
    // `actions/invoice-actions.ts`'s own strip (`descriptors/validate.ts#stripSidecarKeys`, applied
    // before this validator ever runs for a fresh, non-replayed submission) — this is a second,
    // independent layer, not a substitute for it.
    if (
      field.usesVatRateCatalog &&
      typeof data.__crossBorderCategory === 'string' &&
      CROSS_BORDER_CATEGORY_CODES.has(data.__crossBorderCategory)
    ) {
      return null;
    }
    return 'is not one of the offered choices.';
  });

  // The referenced entity's existence is deliberately NOT checked here: that would need an async,
  // company-scoped lookup through EntityReferenceRegistry, which a synchronous structural validator
  // cannot do. This kind only proves "a non-empty id was submitted" — DocumentsService.runAction
  // does not currently cross-check it against the entity, which is the documented limitation.
  //
  // A MULTI-TARGET field (`field.entities` set — see types.ts) additionally has to prove which of
  // the allowed entities the id belongs to, because a bare id string can no longer say that by
  // itself once there is more than one possible target: the stored value becomes
  // `{ entity, id }`, and `entity` must be one of the declared targets. A single-target field
  // (`field.entity`) is completely unchanged by this — same bare-string check as before.
  registry.register('reference', (value, { field }) => {
    if (!isMultiTargetReference(field)) {
      return typeof value === 'string' && value.length > 0 ? null : 'must reference an existing record.';
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'must reference an existing record (with its type).';
    }
    const { entity, id } = value as Record<string, unknown>;
    if (typeof entity !== 'string' || !(field.entities ?? []).includes(entity)) {
      return `must reference one of: ${(field.entities ?? []).join(', ')}.`;
    }
    if (typeof id !== 'string' || id.length === 0) {
      return 'must reference an existing record.';
    }
    return null;
  });

  registry.register('array', (value, { field }) => {
    if (!Array.isArray(value)) return 'must be a list.';
    if (field.min !== undefined && value.length < field.min) return `must have at least ${field.min} row(s).`;
    if (field.max !== undefined && value.length > field.max) return `must have at most ${field.max} row(s).`;
    return null;
  });

  // The 10th kind: a selection of rows belonging to ANOTHER document instance. This ONE line is the
  // entire extent to which this file knows about it — the actual validator, the row-identity
  // prerequisite it rests on, and the async cross-document existence check DocumentsService runs
  // alongside validateAgainstDescriptor all live in row-selection/, deliberately never spread in here
  // (see row-selection/row-selection.ts's header).
  registerRowSelectionFieldKind(registry);

  // The 11th ("gestion de stock basique") — structurally IDENTICAL to
  // single-target 'reference' (a plain non-empty id string; presence/required-ness is still decided
  // once, above, by validateAgainstDescriptor, so this is only ever called with a value that is
  // actually present). The entire difference from 'reference' is what happens once the value is
  // valid: nothing renders it, anywhere a human looks — see types.ts's own `entity` doc comment for
  // the full "why a dedicated kind" account. Never multi-target (no `entities` variant): a line either
  // names one catalog article or it doesn't, there is no case here for "one of several possible
  // entities" the way an invoice's cross-document `origin` field needs.
  registry.register('hiddenReference', (value) =>
    typeof value === 'string' && value.length > 0 ? null : 'must reference an existing record.',
  );

  // The 12th — Enriched expense categories ("notes de frais enrichies") — a company-scoped attachment.
  // Purely structural, like every other kind here: only checks the shape `attachments/
  // attachments.service.ts` actually hands back (`{ fileRef, fileName, mime }`, three non-empty
  // strings) — never that the file still exists on disk, the SAME deliberate limitation 'reference'
  // documents for itself above (an async existence check needs a company-scoped lookup a synchronous
  // validator cannot do; DocumentsService.runAction does not currently cross-check either kind
  // against its own store).
  registry.register('file', (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return 'must be an uploaded file reference.';
    }
    const { fileRef, fileName, mime } = value as Record<string, unknown>;
    if (typeof fileRef !== 'string' || fileRef.length === 0) return 'must be an uploaded file reference.';
    if (typeof fileName !== 'string' || fileName.length === 0) return 'must be an uploaded file reference.';
    if (typeof mime !== 'string' || mime.length === 0) return 'must be an uploaded file reference.';
    return null;
  });
}

export { CORE_FIELD_KINDS };
