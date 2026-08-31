import { Module } from '@nestjs/common';

import { ClientsModule } from '@/modules/clients/clients.module';
import { ClientsService } from '@/modules/clients/clients.service';
import { MailService } from '@/mail/mail.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerConvertToInvoiceAction } from './actions/convert-to-invoice';
import { registerDuplicateExtension } from './actions/duplicate-extension';
import { registerExpenseActions } from './actions/expense-actions';
import { registerInvoiceActions } from './actions/invoice-actions';
import { registerQuoteActions } from './actions/quote-actions';
import { registerCreditNoteActions } from './actions/credit-note-actions';
import { ContributionRegistry } from './contributions/contribution-registry';
import { registerInvoiceContributions } from './contributions/invoice-contributions';
import { CountryFieldOverlayCatalog } from './country-fields/registry';
import { VatRateCatalog } from './vat-rates/registry';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from './descriptors/expense.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { buildClientReferenceProvider } from './references/client-reference.provider';
import { buildDocumentReferenceProvider } from './references/document-reference.provider';
import { EntityReferenceRegistry } from './references/reference-registry';
import { buildEmailTransport } from './transports/email-transport';
import { TransportRegistry } from './transports/transport-registry';
import {
  ACTION_EXTENSION_REGISTRY,
  ACTION_REGISTRY,
  CONTRIBUTION_REGISTRY,
  COUNTRY_FIELD_OVERLAY_REGISTRY,
  DOCUMENT_TYPE_REGISTRY,
  ENTITY_REFERENCE_REGISTRY,
  FIELD_KIND_REGISTRY,
  TRANSPORT_REGISTRY,
  VAT_RATE_CATALOG_REGISTRY,
} from './tokens';

function buildDocumentTypeRegistry(): DocumentTypeRegistry {
  const registry = new DocumentTypeRegistry();
  // Adding a document type is exactly this one line — a descriptor, registered. No controller, no
  // service, no frontend screen of its own. The credit note (THIRD type) proves it again; the
  // expense (FOURTH — migrated OUT of its own former bespoke module, see expense.descriptor.ts)
  // proves it once more, this time for a type that used to be something else entirely.
  registry.register(buildQuoteDescriptor());
  registry.register(buildInvoiceDescriptor());
  registry.register(buildCreditNoteDescriptor());
  registry.register(buildExpenseDescriptor());
  return registry;
}

/** The WIDGET contribution side of the same registration discipline — see
 *  contributions/contribution-registry.ts. Only the invoice contributes today (the model
 *  contribution, contributions/invoice-contributions.ts); adding another type's is exactly one more
 *  line here, the same shape `buildActionRegistry` below already has. */
function buildContributionRegistry(): ContributionRegistry {
  const registry = new ContributionRegistry();
  registerInvoiceContributions(registry);
  return registry;
}

function buildFieldKindRegistry(): FieldKindRegistry {
  const registry = new FieldKindRegistry();
  registerCoreFieldKinds(registry);
  return registry;
}

/**
 * The invoice's ONLY transport today. Registered exactly like a third party would register their
 * own (TransportRegistry.register) — nothing about invoice-actions.ts treats "email" specially.
 * `typeRegistry`/`referenceRegistry` are what let it compose+attach a PDF (see
 * actions/send-document-email.ts) — NEITHER depends on ACTION_REGISTRY, so wiring them here (and into
 * buildActionRegistry below, for the quote's OWN send) never creates a circular dependency, even
 * though ACTION_REGISTRY is where the send actions that call into this machinery are registered.
 */
function buildTransportRegistry(
  clientsService: ClientsService,
  mailService: MailService,
  typeRegistry: DocumentTypeRegistry,
  referenceRegistry: EntityReferenceRegistry,
): TransportRegistry {
  const registry = new TransportRegistry();
  registry.register(
    'email',
    'Email',
    buildEmailTransport({ clientsService, mailService, typeRegistry, referenceRegistry }),
  );
  return registry;
}

function buildActionRegistry(
  clientsService: ClientsService,
  mailService: MailService,
  transportRegistry: TransportRegistry,
  typeRegistry: DocumentTypeRegistry,
  referenceRegistry: EntityReferenceRegistry,
): ActionRegistry {
  const registry = new ActionRegistry();
  registerQuoteActions(registry, { clientsService, mailService, typeRegistry, referenceRegistry });
  registerConvertToInvoiceAction(registry);
  registerInvoiceActions(registry, { transportRegistry });
  registerCreditNoteActions(registry);
  registerExpenseActions(registry);
  // "record-payment" (invoice) is intentionally left unregistered here — see invoice-actions.ts.
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
  // The invoice's "origin" field (multi-target: quote OR another invoice) and the credit note's
  // "invoice" field are what needed these: a 'reference' field pointing at another document TYPE's
  // own instances rather than at a business entity from an existing service. One factory, called
  // once per typeId — see references/document-reference.provider.ts's own comment on why this used
  // to be one file hard-coded to "quote" and is now generic instead of duplicated.
  registry.register('quote', buildDocumentReferenceProvider('quote', 'Quote', clientsService));
  registry.register('invoice', buildDocumentReferenceProvider('invoice', 'Invoice', clientsService));
  return registry;
}

/**
 * Wires the document descriptor system: six small, framework-agnostic registries (so they unit test
 * as plain classes — see their .spec.ts files) turned into singleton providers here, plus the one
 * controller/service that reads them. Registering a new document type, attaching a third-party
 * action to an existing one, wiring a new entity reference, or registering a new transport means
 * editing one factory above; nothing else in this module changes.
 */
@Module({
  imports: [ClientsModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    MailService,
    { provide: DOCUMENT_TYPE_REGISTRY, useFactory: buildDocumentTypeRegistry },
    { provide: FIELD_KIND_REGISTRY, useFactory: buildFieldKindRegistry },
    {
      provide: TRANSPORT_REGISTRY,
      useFactory: buildTransportRegistry,
      // DOCUMENT_TYPE_REGISTRY/ENTITY_REFERENCE_REGISTRY: no circular dependency — see
      // buildTransportRegistry's own comment above.
      inject: [ClientsService, MailService, DOCUMENT_TYPE_REGISTRY, ENTITY_REFERENCE_REGISTRY],
    },
    {
      provide: ACTION_REGISTRY,
      useFactory: buildActionRegistry,
      inject: [
        ClientsService,
        MailService,
        TRANSPORT_REGISTRY,
        DOCUMENT_TYPE_REGISTRY,
        ENTITY_REFERENCE_REGISTRY,
      ],
    },
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
    { provide: CONTRIBUTION_REGISTRY, useFactory: buildContributionRegistry },
    // The country FIELD overlay (add/modify/remove) and the VAT rate catalog — see
    // country-fields/registry.ts and vat-rates/registry.ts. Both default-construct from their own
    // shipped data files (data/all.ts) the exact same way CountryPolicyCatalog already does for
    // country-policy's own data — no factory function needed, there is nothing to inject.
    { provide: COUNTRY_FIELD_OVERLAY_REGISTRY, useValue: new CountryFieldOverlayCatalog() },
    { provide: VAT_RATE_CATALOG_REGISTRY, useValue: new VatRateCatalog() },
  ],
})
export class DocumentsModule {}
