/**
 * The ASYNC, company-scoped half of the 'rowSelection' kind — see row-selection.ts's header for why
 * this lives in a separate file from the kind's synchronous structural check. Two entry points:
 *
 *  - `validateRowSelections`: called by DocumentsService.runAction alongside (after)
 *    validateAgainstDescriptor, on every save, for every 'rowSelection' field on the document — this
 *    is what makes decision 3 (row-selection.ts's header) real: a selection is re-proven against the
 *    CURRENT state of its source every time, not only when it was first made.
 *  - `listSourceRows`: called by DocumentsService.listSelectableRows, the read-side helper the
 *    frontend's picker calls to know what it may currently offer — deliberately degrades to an EMPTY
 *    list rather than an error when the source simply is not resolvable yet (no source picked, or a
 *    stale/foreign id typed by a misbehaving client): the actual BLOCK is guaranteed at save time by
 *    `validateRowSelections` regardless of what this read helper returns, so there is nothing unsafe
 *    about a permissive read path here — only the write path enforces (see row-selection.ts's header,
 *    decision 3, and validate.ts's own "presence/required-ness is decided once" precedent for why a
 *    read helper and a write validator are allowed to disagree on how strict to be).
 *
 * Both share `resolveRowSelectionSource`: the purely descriptor-level checks (is `sourceField` a real
 * 'reference' field on this document, does it actually target `sourceEntity`, is `sourceArrayField` a
 * real 'array' field on that type) that do not depend on any particular document INSTANCE — a
 * misconfigured descriptor fails the same way for every instance of the type, so there is exactly one
 * place that decides what "misconfigured" means.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { DocumentInstanceResult } from '../actions/action-registry';
import {
  DocumentFieldDescriptor,
  DocumentTypeDescriptor,
  isMultiTargetReference,
  targetEntitiesOf,
} from '../descriptors/types';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { ValidationError } from '../descriptors/validate';
import { findOwnedDocument } from '../persistence';
import { ROW_ID_KEY, ROW_SELECTION_KIND, rowIdOf } from './row-selection';

interface ResolvedRowSelectionSource {
  sourceFieldDescriptor: DocumentFieldDescriptor;
  sourceTypeId: string;
  sourceArrayFieldDescriptor: DocumentFieldDescriptor;
}

type SourceResolution = { ok: true; value: ResolvedRowSelectionSource } | { ok: false; message: string };

/**
 * The purely descriptor-level half of resolving a 'rowSelection' field — no company, no database, no
 * particular document instance. A misconfigured field (a typo'd `sourceField`, a `sourceEntity` that
 * `sourceField` never actually targets, a `sourceArrayField` that isn't repeatable on that type) fails
 * IDENTICALLY here regardless of which document instance triggered the check, exactly like an unknown
 * field kind fails identically for every value (validate.ts).
 */
function resolveRowSelectionSource(
  field: DocumentFieldDescriptor,
  descriptor: DocumentTypeDescriptor,
  typeRegistry: DocumentTypeRegistry,
): SourceResolution {
  if (!field.sourceField) {
    return { ok: false, message: 'does not declare a "sourceField" to select rows from.' };
  }
  const sourceFieldDescriptor = descriptor.fields.find((candidate) => candidate.key === field.sourceField);
  if (!sourceFieldDescriptor) {
    return { ok: false, message: `names an unknown field ("${field.sourceField}") as its "sourceField".` };
  }
  if (sourceFieldDescriptor.kind !== 'reference') {
    return { ok: false, message: `"sourceField" ("${field.sourceField}") is not a "reference" field.` };
  }

  if (!field.sourceEntity) {
    return { ok: false, message: 'does not declare a "sourceEntity".' };
  }
  if (!targetEntitiesOf(sourceFieldDescriptor).includes(field.sourceEntity)) {
    return {
      ok: false,
      message: `declares "sourceEntity" ("${field.sourceEntity}") that "${field.sourceField}" never targets.`,
    };
  }
  if (!typeRegistry.has(field.sourceEntity)) {
    return {
      ok: false,
      message: `"sourceEntity" ("${field.sourceEntity}") is not a registered document type.`,
    };
  }

  if (!field.sourceArrayField) {
    return { ok: false, message: 'does not declare a "sourceArrayField".' };
  }
  const sourceDescriptor = typeRegistry.resolve(field.sourceEntity);
  const sourceArrayFieldDescriptor = sourceDescriptor.fields.find(
    (candidate) => candidate.key === field.sourceArrayField,
  );
  if (sourceArrayFieldDescriptor?.kind !== 'array') {
    return {
      ok: false,
      message: `points at "${field.sourceEntity}.${field.sourceArrayField}", which is not a repeatable field.`,
    };
  }

  return {
    ok: true,
    value: { sourceFieldDescriptor, sourceTypeId: field.sourceEntity, sourceArrayFieldDescriptor },
  };
}

/** The `{ entity, id }` a 'rowSelection' field's `sourceField` currently names, whichever shape that
 *  sibling field stores its value as (see types.ts's `MultiTargetReferenceValue`) — undefined when
 *  nothing usable is set yet, which callers treat as "reference absente", not a crash. */
function currentSourceReference(
  rawValue: unknown,
  sourceFieldDescriptor: DocumentFieldDescriptor,
): { entity: string; id: string } | undefined {
  if (isMultiTargetReference(sourceFieldDescriptor)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return undefined;
    const { entity, id } = rawValue as Record<string, unknown>;
    return typeof entity === 'string' && typeof id === 'string' && id.length > 0 ? { entity, id } : undefined;
  }
  return typeof rawValue === 'string' && rawValue.length > 0
    ? { entity: sourceFieldDescriptor.entity as string, id: rawValue }
    : undefined;
}

function looksLikeSelection(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

/**
 * Re-validates every 'rowSelection' field on `data` against the CURRENT, live state of whatever it
 * points at — called by DocumentsService.runAction after the synchronous validateAgainstDescriptor
 * has already passed. Deliberately silent (no error pushed) for a field whose OWN value already
 * failed the synchronous structural check (not an array of ids at all): that error is already
 * reported once, by the right validator, and this function re-explaining the same malformed value
 * would only be noise.
 */
export async function validateRowSelections(params: {
  companyId: string;
  descriptor: DocumentTypeDescriptor;
  typeRegistry: DocumentTypeRegistry;
  data: Record<string, unknown>;
}): Promise<ValidationError[]> {
  const { companyId, descriptor, typeRegistry, data } = params;
  const errors: ValidationError[] = [];

  for (const field of descriptor.fields) {
    if (field.kind !== ROW_SELECTION_KIND) continue;

    const value = data[field.key];
    if (value === undefined || value === null || value === '') continue; // required-ness: validate.ts's job.
    if (!looksLikeSelection(value)) continue; // shape: validateRowSelectionShape's job.

    const resolved = resolveRowSelectionSource(field, descriptor, typeRegistry);
    if (!resolved.ok) {
      errors.push({ key: field.key, message: `"${field.label}" ${resolved.message}` });
      continue;
    }
    const { sourceFieldDescriptor, sourceTypeId, sourceArrayFieldDescriptor } = resolved.value;

    const reference = currentSourceReference(data[field.sourceField as string], sourceFieldDescriptor);
    if (!reference) {
      errors.push({
        key: field.key,
        message: `"${field.label}" needs "${sourceFieldDescriptor.label}" to be set first.`,
      });
      continue;
    }
    if (reference.entity !== sourceTypeId) {
      errors.push({
        key: field.key,
        message:
          `"${field.label}" expects "${sourceFieldDescriptor.label}" to reference a "${sourceTypeId}", ` +
          `but it currently references a "${reference.entity}".`,
      });
      continue;
    }

    let sourceDocument: DocumentInstanceResult;
    try {
      sourceDocument = await findOwnedDocument(companyId, sourceTypeId, reference.id);
    } catch (error) {
      if (error instanceof NotFoundException) {
        errors.push({
          key: field.key,
          message: `"${field.label}" references a "${sourceTypeId}" that no longer exists.`,
        });
        continue;
      }
      throw error;
    }

    const sourceData = (sourceDocument.data ?? {}) as Record<string, unknown>;
    const sourceRowsRaw = sourceData[sourceArrayFieldDescriptor.key];
    const sourceRows = Array.isArray(sourceRowsRaw) ? sourceRowsRaw : [];
    const validRowIds = new Set(
      sourceRows.map((row) => rowIdOf(row)).filter((id): id is string => id !== undefined),
    );

    value.forEach((selectedId, index) => {
      if (validRowIds.has(selectedId)) return;
      errors.push({
        key: `${field.key}[${index}]`,
        message:
          `"${field.label}" selects a row ("${selectedId}") that is no longer among ` +
          `"${sourceArrayFieldDescriptor.label}" on the referenced ${sourceTypeId} — it may have been ` +
          'removed, or the reference may have changed.',
      });
    });
  }

  return errors;
}

export interface SelectableRow {
  id: string;
  /** The row's own field values, exactly as stored — ROW_ID_KEY stripped, since the frontend renders
   *  this against the source type's OWN row sub-fields and has no use for the internal identity key. */
  data: Record<string, unknown>;
}

export interface SelectableRowsResult {
  sourceTypeId: string;
  sourceArrayField: string;
  rows: SelectableRow[];
}

/**
 * What the frontend's picker for one 'rowSelection' field may currently offer, given `sourceId` — the
 * live value of that field's `sourceField` sibling, as typed/loaded in the form (NOT necessarily the
 * document's own last-saved value: the source may have just been picked and not saved yet, which is
 * exactly why this takes `sourceId` as a parameter instead of re-reading `descriptor`'s own instance).
 * A descriptor misconfiguration (see resolveRowSelectionSource) throws — that is a deployment bug, the
 * same class of failure DocumentsService already throws BadRequestException for elsewhere. An
 * unresolvable `sourceId` (unset, or naming a document that does not exist / is not owned by this
 * company) is NOT an error here — see this file's header for why the read side degrades to `rows: []`
 * while the write side (`validateRowSelections`) is what actually blocks.
 */
export async function listSourceRows(params: {
  companyId: string;
  descriptor: DocumentTypeDescriptor;
  field: DocumentFieldDescriptor;
  typeRegistry: DocumentTypeRegistry;
  sourceId: string | undefined;
}): Promise<SelectableRowsResult> {
  const { companyId, descriptor, field, typeRegistry, sourceId } = params;

  if (field.kind !== ROW_SELECTION_KIND) {
    throw new BadRequestException(`"${field.label}" is not a "rowSelection" field.`);
  }
  const resolved = resolveRowSelectionSource(field, descriptor, typeRegistry);
  if (!resolved.ok) {
    throw new BadRequestException(`"${field.label}" ${resolved.message}`);
  }
  const { sourceTypeId, sourceArrayFieldDescriptor } = resolved.value;
  const sourceArrayField = sourceArrayFieldDescriptor.key;

  if (!sourceId) {
    return { sourceTypeId, sourceArrayField, rows: [] };
  }

  let sourceDocument: DocumentInstanceResult;
  try {
    sourceDocument = await findOwnedDocument(companyId, sourceTypeId, sourceId);
  } catch (error) {
    if (error instanceof NotFoundException) {
      return { sourceTypeId, sourceArrayField, rows: [] };
    }
    throw error;
  }

  const sourceData = (sourceDocument.data ?? {}) as Record<string, unknown>;
  const sourceRowsRaw = sourceData[sourceArrayField];
  const sourceRows = Array.isArray(sourceRowsRaw) ? sourceRowsRaw : [];

  const rows: SelectableRow[] = [];
  for (const row of sourceRows) {
    const id = rowIdOf(row);
    // A row nobody has stamped an id onto yet (saved before this kind existed, or not resaved since)
    // is excluded, never offered with a fabricated stand-in id — see row-selection.ts's header,
    // decision 1, on why that would be a ghost the moment the page is reloaded.
    if (!id) continue;
    const { [ROW_ID_KEY]: _rowId, ...rest } = row as Record<string, unknown>;
    rows.push({ id, data: rest });
  }

  return { sourceTypeId, sourceArrayField, rows };
}
