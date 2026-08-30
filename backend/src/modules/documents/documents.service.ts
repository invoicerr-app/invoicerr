import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';

import { logger } from '@/logger/logger.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry, ActionResult } from './actions/action-registry';
import { FieldKindRegistry } from './descriptors/field-kinds';
import { DocumentTypeRegistry, UnknownDocumentTypeError } from './descriptors/type-registry';
import { DocumentActionDescriptor, DocumentTypeDescriptor, isActionAvailable } from './descriptors/types';
import { validateAgainstDescriptor } from './descriptors/validate';
import { RunActionDto } from './dto/documents.dto';
import { findOwnedDocument, listDocuments } from './persistence';
import {
  EntityReferenceOption,
  EntityReferenceRegistry,
  UnknownEntityReferenceError,
} from './references/reference-registry';
import {
  listSourceRows,
  SelectableRowsResult,
  validateRowSelections,
} from './row-selection/resolve-row-selection';
import { referencedArrayFieldKeys, stampRowIds } from './row-selection/row-selection';
import { TransportRegistry } from './transports/transport-registry';
import {
  ACTION_EXTENSION_REGISTRY,
  ACTION_REGISTRY,
  DOCUMENT_TYPE_REGISTRY,
  ENTITY_REFERENCE_REGISTRY,
  FIELD_KIND_REGISTRY,
  TRANSPORT_REGISTRY,
} from './tokens';

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    @Inject(DOCUMENT_TYPE_REGISTRY) private readonly typeRegistry: DocumentTypeRegistry,
    @Inject(FIELD_KIND_REGISTRY) private readonly fieldKindRegistry: FieldKindRegistry,
    @Inject(ACTION_REGISTRY) private readonly actionRegistry: ActionRegistry,
    @Inject(ACTION_EXTENSION_REGISTRY) private readonly actionExtensionRegistry: ActionExtensionRegistry,
    @Inject(ENTITY_REFERENCE_REGISTRY) private readonly referenceRegistry: EntityReferenceRegistry,
    @Inject(TRANSPORT_REGISTRY) private readonly transportRegistry: TransportRegistry,
  ) {}

  /**
   * Forces every registered type's extension actions to be merged once at boot, so an id collision
   * between a type's own descriptor and a third party's extension (two different modules declaring
   * the same action id) fails loudly when the app starts — not on whichever request happens to hit
   * it first. This is the "booting the app is the real check of the wiring" rule applied to this
   * specific composition point.
   */
  onModuleInit(): void {
    for (const { id } of this.typeRegistry.list()) {
      this.mergedDescriptor(id);
    }
  }

  /** The list a front-end nav can render without knowing any type by name. */
  listTypes(): { id: string; label: string }[] {
    return this.typeRegistry.list().map(({ id, label }) => ({ id, label }));
  }

  /** Every registered document transport, id and label only — what a company's settings screen
   *  offers to choose from for `Company.invoiceTransportId`. Never filtered by country: the whole
   *  point is that the choice is the company's, not derived from where it is. */
  listTransports(): { id: string; label: string }[] {
    return this.transportRegistry.list();
  }

  getType(typeId: string): DocumentTypeDescriptor {
    return this.mergedDescriptor(typeId);
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

  /**
   * The type's own descriptor, PLUS whatever a third party attached through ActionExtensionRegistry
   * — the one place these two sources of actions are combined. Everything downstream (the frontend's
   * form, runAction's lookup) only ever sees this merged shape, never the two sources separately.
   */
  private mergedDescriptor(typeId: string): DocumentTypeDescriptor {
    const native = this.resolveType(typeId);
    const extensions = this.actionExtensionRegistry.listFor(typeId);
    if (extensions.length === 0) return native;

    const nativeIds = new Set(native.actions.map((action) => action.id));
    for (const extension of extensions) {
      if (nativeIds.has(extension.id)) {
        // A configuration bug (two different registrations for the same id), not a request-time
        // condition — deliberately a plain Error, surfaced at boot by onModuleInit above.
        throw new Error(
          `Action "${extension.id}" is declared both natively and as an extension for document type "${typeId}".`,
        );
      }
    }

    return { ...native, actions: [...native.actions, ...extensions] };
  }

  private resolveAction(
    typeId: string,
    actionId: string,
  ): { descriptor: DocumentTypeDescriptor; action: DocumentActionDescriptor } {
    const descriptor = this.mergedDescriptor(typeId);
    const action = descriptor.actions.find((candidate) => candidate.id === actionId);
    if (!action) {
      throw new NotFoundException(`Document type "${typeId}" has no action "${actionId}".`);
    }
    return { descriptor, action };
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

  async listDocuments(companyId: string, typeId?: string) {
    return listDocuments(companyId, typeId);
  }

  async getDocument(companyId: string, typeId: string, id: string) {
    return findOwnedDocument(companyId, typeId, id);
  }

  /**
   * Default values for one action's own `params` (see DocumentActionDescriptor.params), given the
   * document's current data — e.g. "send" pre-filling `recipient` from the quote's client. Returns
   * `{}` (never throws for this) when the action declares no defaults resolver: that just means the
   * params form opens empty, not that anything is wrong.
   */
  async resolveActionParamsDefaults(
    companyId: string,
    typeId: string,
    actionId: string,
    payload: RunActionDto,
  ): Promise<Record<string, unknown>> {
    this.resolveAction(typeId, actionId); // 404s for an unknown type/action, same as runAction.

    const resolver = this.actionRegistry.resolveParamsDefaults(typeId, actionId);
    if (!resolver) return {};

    return resolver({
      companyId,
      typeId,
      documentId: payload.documentId,
      data: payload.data ?? {},
      params: {},
    });
  }

  /**
   * Runs one declared action of one document type. Every way this can fail is deliberate and
   * distinct, so the caller (and the frontend) never has to guess which one happened:
   *  - unknown type / action not declared on it (native OR extension) -> 404
   *  - action declared but not available for the record's current status -> 409
   *  - action declared, available, but no implementation registered -> 501, clearly worded
   *  - document data or the action's own params don't match their descriptors -> 400, per-field
   */
  async runAction(
    companyId: string,
    typeId: string,
    actionId: string,
    payload: RunActionDto,
  ): Promise<ActionResult> {
    const { descriptor, action } = this.resolveAction(typeId, actionId);

    let currentStatus: string | undefined;
    if (payload.documentId) {
      const existing = await findOwnedDocument(companyId, typeId, payload.documentId);
      currentStatus = existing.status;
    }
    if (!isActionAvailable(action, currentStatus)) {
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

    const dataErrors = validateAgainstDescriptor(
      descriptor.fields,
      payload.data ?? {},
      this.fieldKindRegistry,
    );
    // Cross-document existence for every 'rowSelection' field — a no-op for a type that declares
    // none (the loop inside just finds nothing), never a DB round-trip for the quote or the invoice.
    // See row-selection/resolve-row-selection.ts's header for why this is a SEPARATE, async pass
    // rather than one more FieldKindRegistry validator: it needs company-scoped persistence access
    // validateAgainstDescriptor's pure, synchronous kinds deliberately never get.
    const rowSelectionErrors = await validateRowSelections({
      companyId,
      descriptor,
      typeRegistry: this.typeRegistry,
      data: payload.data ?? {},
    });
    const paramErrors = action.params
      ? validateAgainstDescriptor(action.params, payload.params ?? {}, this.fieldKindRegistry)
      : [];
    if (dataErrors.length > 0 || rowSelectionErrors.length > 0 || paramErrors.length > 0) {
      const errors = [...dataErrors, ...rowSelectionErrors, ...paramErrors];
      throw new BadRequestException({ message: 'Invalid document data', errors });
    }

    // Stamps a stable id onto any row of an 'array' field that at least one CURRENTLY REGISTERED
    // 'rowSelection' field points at (row-selection.ts's `referencedArrayFieldKeys`) — the row-identity
    // prerequisite a selection needs, applied only where something actually selects from, and only to
    // data that has already passed every check above (never to data about to be rejected anyway).
    const data = stampRowIds(
      descriptor.fields,
      payload.data ?? {},
      referencedArrayFieldKeys(this.typeRegistry, typeId),
    );

    return handler({
      companyId,
      typeId,
      documentId: payload.documentId,
      data,
      params: payload.params ?? {},
    });
  }

  /**
   * What a 'rowSelection' field's picker may currently offer — see
   * row-selection/resolve-row-selection.ts's `listSourceRows` for the full contract (why an
   * unresolvable source degrades to an empty list here rather than an error, while `runAction` above
   * is what actually blocks on save). 404s for an unknown type or field the same way `getType` and
   * `resolveAction` already do; a field that exists but isn't a 'rowSelection' field, or is one but
   * misconfigured, is a 400 (listSourceRows throws BadRequestException for those).
   */
  async listSelectableRows(
    companyId: string,
    typeId: string,
    fieldKey: string,
    sourceId: string | undefined,
  ): Promise<SelectableRowsResult> {
    const descriptor = this.mergedDescriptor(typeId);
    const field = descriptor.fields.find((candidate) => candidate.key === fieldKey);
    if (!field) {
      throw new NotFoundException(`Document type "${typeId}" has no field "${fieldKey}".`);
    }

    return listSourceRows({ companyId, descriptor, field, typeRegistry: this.typeRegistry, sourceId });
  }
}
