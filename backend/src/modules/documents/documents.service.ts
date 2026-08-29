import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { ActionRegistry, DocumentInstanceResult } from './actions/action-registry';
import { FieldKindRegistry } from './descriptors/field-kinds';
import { DocumentTypeRegistry, UnknownDocumentTypeError } from './descriptors/type-registry';
import { DocumentTypeDescriptor, isActionAvailable } from './descriptors/types';
import { validateAgainstDescriptor } from './descriptors/validate';
import { RunActionDto } from './dto/documents.dto';
import { findOwnedDocument, listDocuments } from './persistence';
import {
  EntityReferenceOption,
  EntityReferenceRegistry,
  UnknownEntityReferenceError,
} from './references/reference-registry';
import {
  ACTION_REGISTRY,
  DOCUMENT_TYPE_REGISTRY,
  ENTITY_REFERENCE_REGISTRY,
  FIELD_KIND_REGISTRY,
} from './tokens';

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DOCUMENT_TYPE_REGISTRY) private readonly typeRegistry: DocumentTypeRegistry,
    @Inject(FIELD_KIND_REGISTRY) private readonly fieldKindRegistry: FieldKindRegistry,
    @Inject(ACTION_REGISTRY) private readonly actionRegistry: ActionRegistry,
    @Inject(ENTITY_REFERENCE_REGISTRY) private readonly referenceRegistry: EntityReferenceRegistry,
  ) {}

  /** The list a front-end nav can render without knowing any type by name. */
  listTypes(): { id: string; label: string }[] {
    return this.typeRegistry.list().map(({ id, label }) => ({ id, label }));
  }

  getType(typeId: string): DocumentTypeDescriptor {
    return this.resolveType(typeId);
  }

  private resolveType(typeId: string): DocumentTypeDescriptor {
    try {
      return this.typeRegistry.resolve(typeId);
    } catch (error) {
      if (error instanceof UnknownDocumentTypeError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async searchReferences(companyId: string, entity: string, query: string): Promise<EntityReferenceOption[]> {
    return this.resolveReferenceProvider(entity).search(companyId, query ?? '');
  }

  async resolveReference(
    companyId: string,
    entity: string,
    id: string,
  ): Promise<EntityReferenceOption | null> {
    return this.resolveReferenceProvider(entity).resolve(companyId, id);
  }

  private resolveReferenceProvider(entity: string) {
    try {
      return this.referenceRegistry.resolve(entity);
    } catch (error) {
      if (error instanceof UnknownEntityReferenceError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }

  async listDocuments(companyId: string, typeId?: string): Promise<DocumentInstanceResult[]> {
    return listDocuments(companyId, typeId);
  }

  async getDocument(companyId: string, typeId: string, id: string): Promise<DocumentInstanceResult> {
    return findOwnedDocument(companyId, typeId, id);
  }

  /**
   * Runs one declared action of one document type. Every way this can fail is deliberate and
   * distinct, so the caller (and the frontend) never has to guess which one happened:
   *  - unknown type / action not declared on it -> 404
   *  - action declared but not available for the record's current status -> 409
   *  - action declared, available, but no implementation registered -> 501, clearly worded
   *  - data does not match the descriptor's fields -> 400 with per-field errors
   */
  async runAction(
    companyId: string,
    typeId: string,
    actionId: string,
    payload: RunActionDto,
  ): Promise<DocumentInstanceResult> {
    const descriptor = this.resolveType(typeId);
    const actionDescriptor = descriptor.actions.find((action) => action.id === actionId);
    if (!actionDescriptor) {
      throw new NotFoundException(`Document type "${typeId}" has no action "${actionId}".`);
    }

    let currentStatus: string | undefined;
    if (payload.documentId) {
      const existing = await findOwnedDocument(companyId, typeId, payload.documentId);
      currentStatus = existing.status;
    }
    if (!isActionAvailable(actionDescriptor, currentStatus)) {
      throw new ConflictException(
        currentStatus === undefined
          ? `Action "${actionId}" is not available before the document has been saved.`
          : `Action "${actionId}" is not available for a document with status "${currentStatus}".`,
      );
    }

    const handler = this.actionRegistry.resolve(typeId, actionId);
    if (!handler) {
      logger.error('Document action declared but not implemented', {
        category: 'documents',
        details: { typeId, actionId },
      });
      throw new NotImplementedException(
        `Action "${actionId}" is declared for document type "${typeId}" but has no registered implementation yet.`,
      );
    }

    const errors = validateAgainstDescriptor(descriptor.fields, payload.data ?? {}, this.fieldKindRegistry);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid document data', errors });
    }

    return handler({ companyId, typeId, documentId: payload.documentId, data: payload.data ?? {} });
  }
}
