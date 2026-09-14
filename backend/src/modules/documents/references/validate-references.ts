/**
 * The ASYNC, company-scoped half of the 'reference' field kind's existence check — see
 * descriptors/field-kinds.ts's own comment on its 'reference' validator: a SYNCHRONOUS, DB-free kind
 * only ever proves "a non-empty id was submitted", and explicitly names what was missing as "the
 * documented limitation" — DocumentsService.runAction never cross-checked that id against the entity
 * it claims to name. This file closes that limitation, wired into `runAction` right alongside
 * `row-selection/resolve-row-selection.ts`'s own `validateRowSelections` (same reason: existence is
 * company-scoped persistence access, which the pure kind registry cannot reach).
 *
 * SCOPE, deliberately narrower than "every reference-shaped value in the document":
 *  - Only TOP-LEVEL 'reference' fields (`descriptor.fields`, never a field nested inside an 'array'
 *    row). The audited hole (a company-scoped audit of `prisma.client.findUnique` call sites) was
 *    exactly the document's own relationship fields — `client`, `supplierClient`, `invoice`,
 *    `origin` — every one of them top-level. 'hiddenReference' (a line's `articleId`, targeting the
 *    `article` catalog) is a DIFFERENT multi-tenancy question this pass was not commissioned to
 *    close, and a nested row has no stable identity to diff against the previous save the way a
 *    top-level field's plain key lookup does (see "changed vs unchanged" below) — extending here is
 *    future work, not an oversight.
 *
 *    FOLLOW-UP, TODO_ISSUES.md's own "`hiddenReference` n'est pas couvert" entry — investigated and
 *    closed by MEASUREMENT, not by code: every consumer that actually resolves an `articleId` already
 *    scopes by the ACTING company's own `companyId`, never by a company implied by the id itself —
 *    `ArticlesService.findOne`/`findAll` (`modules/articles/articles.service.ts`, `where: { id,
 *    companyId }`) and `stock/apply-stock-on-issuance.ts`'s own `prisma.article.findMany({ where: {
 *    companyId, id: { in: articleIds }, quantity: { not: null } } })`. A foreign or invented
 *    `articleId` therefore matches nothing for either lookup and degrades to exactly "no article", the
 *    same as one since deleted — it never prices a line, sets a VAT rate, or moves ANOTHER company's
 *    stock (rendering excludes the field from print entirely, so it never leaks a foreign article's
 *    name/price either — rendering/render-html.ts). The gap this file's scope note names is real but
 *    cosmetic: a dangling `articleId` sits inert, never re-validated, never acted on — see
 *    `stock/apply-stock-on-issuance.spec.ts`'s own cross-tenant test for the proof. Extending THIS
 *    file to it anyway was still evaluated, and still declined, for the identity reason just above:
 *    `$rowId` (row-selection/row-selection.ts) is stamped on an 'array' field only when some CURRENTLY
 *    REGISTERED 'rowSelection' field sources FROM it (`referencedArrayFieldKeys`) — true for
 *    `invoice.lines` (credit-note's own `correctedLines` sources it) but NOT for `quote.lines` (no
 *    'rowSelection' field targets quotes at all). A "changed vs unchanged" diff keyed on `$rowId` would
 *    therefore be reliable for one document type and silently wrong for the other, forcing either an
 *    always-revalidate fallback for quotes (recreating the exact "existing document becomes
 *    permanently unsendable" failure this file's own "changed vs unchanged" section exists to avoid)
 *    or a per-type special case this generic pass has no business hard-coding.
 *  - An entity nobody registered (`EntityReferenceRegistry.resolve` throwing
 *    `UnknownEntityReferenceError`) is silently SKIPPED, never turned into a validation error: that is
 *    a descriptor/wiring mistake, a different and boot-level concern `DocumentsService.searchReferences`/
 *    `resolveReference` already surface as a 404 on their own read paths — this write-time pass has no
 *    business inventing a data error out of a configuration one.
 *
 * WHY "changed vs unchanged", not "always" (unlike `validateRowSelections`, which deliberately DOES
 * re-check its own field on every save — see that file's own header for why a row selection's source
 * can legitimately go stale over time and must be caught again and again): a 'reference' field's
 * target can ALSO go stale for a reason that has nothing to do with another tenant — the referenced
 * client can be deleted after the invoice was sent — and this repository already treats that as a
 * "the label just falls back to the raw id, never a block" degrade (rendering/render-instance-pdf.ts's
 * own `referenceLabels` loop, every transport's "no valid client on file" 400 at SEND time only, never
 * at every subsequent action). Every `RunActionDto` call carries the record's FULL current `data`
 * (frontend's `use-document-action-runner.ts` — a list row acting on an already-saved instance sends
 * that instance's OWN stored data unchanged), including for actions that never touch this field at all
 * ("cancel", "record-payment", "download-xml"). Re-proving a value nobody re-typed would turn a merely
 * stale reference — including one already sitting in the database from before this check existed, or
 * from the exact cross-tenant gap this pass closes — into a document nobody can act on ever again,
 * which breaks decision 2 of this fix's own brief ("a refusal at write time must not make an existing
 * document unopenable or unsendable"). So the check only fires the moment a value is actually WRITTEN,
 * new or changed: a brand-new document (nothing to compare against — every value is "new"), or an edit
 * that touches this exact field. That is also exactly the guarantee this fix needs: a foreign or
 * invented id can no longer be INTRODUCED going forward, while whatever already exists on disk stays
 * exactly as usable as it always was — the corresponding read-side fix (scoping the 15 consumers
 * themselves) is what protects THAT pre-existing data at the point it is actually read.
 */
import { DocumentFieldDescriptor, isMultiTargetReference } from '../descriptors/types';
import { ValidationError } from '../descriptors/validate';
import {
  EntityReferenceOption,
  EntityReferenceRegistry,
  UnknownEntityReferenceError,
} from './reference-registry';

interface ReferenceTarget {
  entity: string;
  id: string;
}

/** The `{ entity, id }` a 'reference' field's raw stored value currently names, whichever shape the
 *  field is declared with (types.ts's `MultiTargetReferenceValue` vs a bare id string) — undefined for
 *  anything that isn't a well-formed reference, which is already a DIFFERENT, synchronous error
 *  `field-kinds.ts`'s own validator reports; this function is never asked to re-explain that. The same
 *  extraction `row-selection/resolve-row-selection.ts`'s own `currentSourceReference` performs for a
 *  'rowSelection' field's sibling — duplicated rather than shared, the same self-containment discipline
 *  every field kind here already holds (descriptors/types.ts's own comment on `sourceEntity`). */
function referenceTargetOf(rawValue: unknown, field: DocumentFieldDescriptor): ReferenceTarget | undefined {
  if (isMultiTargetReference(field)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return undefined;
    const { entity, id } = rawValue as Record<string, unknown>;
    return typeof entity === 'string' && typeof id === 'string' && id.length > 0 ? { entity, id } : undefined;
  }
  return typeof rawValue === 'string' && rawValue.length > 0 && field.entity
    ? { entity: field.entity, id: rawValue }
    : undefined;
}

function sameTarget(a: ReferenceTarget | undefined, b: ReferenceTarget | undefined): boolean {
  if (!a || !b) return a === b;
  return a.entity === b.entity && a.id === b.id;
}

/**
 * Re-proves every top-level 'reference' field's target actually exists FOR THIS COMPANY — called by
 * DocumentsService.runAction alongside (after) validateAgainstDescriptor, the same way
 * validateRowSelections already is. `existingData` is the CURRENTLY PERSISTED document's own `data`
 * (undefined for a brand-new document, i.e. `payload.documentId` unset) — see this file's own header
 * for why a value identical to what is already on file is never re-checked.
 */
export async function validateReferenceFields(params: {
  companyId: string;
  referenceRegistry: EntityReferenceRegistry;
  fields: DocumentFieldDescriptor[];
  data: Record<string, unknown>;
  existingData: Record<string, unknown> | undefined;
}): Promise<ValidationError[]> {
  const { companyId, referenceRegistry, fields, data, existingData } = params;
  const errors: ValidationError[] = [];

  for (const field of fields) {
    if (field.kind !== 'reference') continue;

    const value = data[field.key];
    if (value === undefined || value === null || value === '') continue; // required-ness: validate.ts's job.

    const target = referenceTargetOf(value, field);
    if (!target) continue; // malformed shape: field-kinds.ts's own synchronous validator already reports this.

    const previousTarget = existingData ? referenceTargetOf(existingData[field.key], field) : undefined;
    if (sameTarget(target, previousTarget)) continue; // grandfathered — see header.

    let resolved: EntityReferenceOption | null;
    try {
      resolved = await referenceRegistry.resolve(target.entity).resolve(companyId, target.id);
    } catch (error) {
      if (error instanceof UnknownEntityReferenceError) continue; // descriptor/wiring issue, not this pass's job.
      throw error;
    }

    if (!resolved) {
      errors.push({
        key: field.key,
        message: `"${field.label}" references a "${target.entity}" that does not exist, or does not belong to this company.`,
      });
    }
  }

  return errors;
}
