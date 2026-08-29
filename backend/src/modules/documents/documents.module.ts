import { Module } from '@nestjs/common';

import { ClientsModule } from '@/modules/clients/clients.module';
import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerDuplicateExtension } from './actions/duplicate-extension';
import { registerQuoteActions } from './actions/quote-actions';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { buildClientReferenceProvider } from './references/client-reference.provider';
import { EntityReferenceRegistry } from './references/reference-registry';
import {
  ACTION_EXTENSION_REGISTRY,
  ACTION_REGISTRY,
  DOCUMENT_TYPE_REGISTRY,
  ENTITY_REFERENCE_REGISTRY,
  FIELD_KIND_REGISTRY,
} from './tokens';

function buildDocumentTypeRegistry(): DocumentTypeRegistry {
  const registry = new DocumentTypeRegistry();
  // Adding a document type is exactly this one line — a descriptor, registered. No controller, no
  // service, no frontend screen of its own.
  registry.register(buildQuoteDescriptor());
  return registry;
}

function buildFieldKindRegistry(): FieldKindRegistry {
  const registry = new FieldKindRegistry();
  registerCoreFieldKinds(registry);
  return registry;
}

function buildActionRegistry(clientsService: ClientsService, mailService: MailService): ActionRegistry {
  const registry = new ActionRegistry();
  registerQuoteActions(registry, { clientsService, mailService });
  // "convert-to-invoice" is intentionally left unregistered here — see quote-actions.ts.
  return registry;
}

/**
 * Where a THIRD PARTY's extra actions get attached to an EXISTING type — none of this touches the
 * type's own descriptor factory above. Adding "duplicate" to quotes is exactly this one line, the
 * same way registering the quote type itself is exactly one line in buildDocumentTypeRegistry.
 */
function buildActionExtensionRegistry(actionRegistry: ActionRegistry): ActionExtensionRegistry {
  const registry = new ActionExtensionRegistry();
  registerDuplicateExtension('quote', registry, actionRegistry);
  return registry;
}

function buildEntityReferenceRegistry(clientsService: ClientsService): EntityReferenceRegistry {
  const registry = new EntityReferenceRegistry();
  registry.register('client', buildClientReferenceProvider(clientsService));
  return registry;
}

/**
 * Wires the document descriptor system: five small, framework-agnostic registries (so they unit
 * test as plain classes — see their .spec.ts files) turned into singleton providers here, plus the
 * one controller/service that reads them. Registering a new document type, attaching a third-party
 * action to an existing one, or wiring a new entity reference means editing one factory above;
 * nothing else in this module changes.
 */
@Module({
  imports: [ClientsModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    MailService,
    { provide: DOCUMENT_TYPE_REGISTRY, useFactory: buildDocumentTypeRegistry },
    { provide: FIELD_KIND_REGISTRY, useFactory: buildFieldKindRegistry },
    { provide: ACTION_REGISTRY, useFactory: buildActionRegistry, inject: [ClientsService, MailService] },
    {
      provide: ACTION_EXTENSION_REGISTRY,
      useFactory: buildActionExtensionRegistry,
      inject: [ACTION_REGISTRY],
    },
    {
      provide: ENTITY_REFERENCE_REGISTRY,
      useFactory: buildEntityReferenceRegistry,
      inject: [ClientsService],
    },
  ],
})
export class DocumentsModule {}
