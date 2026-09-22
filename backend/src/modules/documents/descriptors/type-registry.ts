import { validateLifecycle } from './lifecycle';
import { DocumentTypeDescriptor } from './types';

/** Thrown by `resolve()` for an id nobody registered. Kept a plain Error (not a Nest exception) so
 *  this registry stays usable outside an HTTP request — the caller decides how to translate it
 *  (DocumentsService turns it into a 404). */
export class UnknownDocumentTypeError extends Error {
  constructor(public readonly typeId: string) {
    super(`Unknown document type "${typeId}".`);
    this.name = 'UnknownDocumentTypeError';
  }
}

/**
 * Registry of document TYPE descriptors, keyed by id. Open by design: registering a descriptor is
 * the entire cost of adding a document type (see quote.descriptor.ts + documents.module.ts).
 */
export class DocumentTypeRegistry {
  private readonly descriptors = new Map<string, DocumentTypeDescriptor>();

  register(descriptor: DocumentTypeDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`Document type "${descriptor.id}" is already registered.`);
    }
    // Fails the moment a broken lifecycle declaration is registered — at real app boot, or
    // synchronously in a jest spec that calls .register() directly — never on whichever request
    // happens to exercise the broken action first. See lifecycle.ts's own header.
    validateLifecycle(descriptor);
    this.descriptors.set(descriptor.id, descriptor);
  }

  list(): DocumentTypeDescriptor[] {
    return [...this.descriptors.values()];
  }

  has(id: string): boolean {
    return this.descriptors.has(id);
  }

  /** Throws UnknownDocumentTypeError for an id nobody registered — never returns undefined. */
  resolve(id: string): DocumentTypeDescriptor {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) {
      throw new UnknownDocumentTypeError(id);
    }
    return descriptor;
  }
}
