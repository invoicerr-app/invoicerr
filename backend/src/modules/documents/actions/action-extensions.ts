import { DocumentActionDescriptor } from '../descriptors/types';

/**
 * Where a THIRD PARTY attaches a new action to a document type it does not own — without editing
 * that type's own descriptor file, and without editing anything in descriptors/ or
 * documents.service.ts (the "core"). This is deliberately a second, independent registry rather
 * than a method added to DocumentTypeRegistry: a type's descriptor stays the single source of truth
 * for the actions its OWN author declared, and this registry is purely additive on top of it —
 * DocumentsService is the only place the two are ever combined (see its `mergedDescriptor`).
 *
 * Registering here is exactly half of what makes an extension action actually run: this only
 * DECLARES it (id, label, availableWhen, params), matching what a type's own descriptor does for its
 * native actions. The implementation still goes through the ordinary ActionRegistry — a plugin that
 * declares an extension action here but never registers a handler gets the exact same 501 an
 * unimplemented native action gets, which is the point: extensibility does not get a shortcut around
 * the "declared but not implemented" contract.
 */
export class ActionExtensionRegistry {
  private readonly extensionsByType = new Map<string, DocumentActionDescriptor[]>();

  register(typeId: string, action: DocumentActionDescriptor): void {
    const existing = this.extensionsByType.get(typeId) ?? [];
    if (existing.some((declared) => declared.id === action.id)) {
      throw new Error(
        `Action "${action.id}" is already declared as an extension of document type "${typeId}".`,
      );
    }
    this.extensionsByType.set(typeId, [...existing, action]);
  }

  /** Every extension action declared for `typeId`, in registration order. Empty (never undefined)
   *  for a type nobody has extended — most types, most of the time. */
  listFor(typeId: string): DocumentActionDescriptor[] {
    return this.extensionsByType.get(typeId) ?? [];
  }
}
