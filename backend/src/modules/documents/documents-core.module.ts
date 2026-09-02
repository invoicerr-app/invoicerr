import { Module } from '@nestjs/common';

import { ArticlesModule } from '@/modules/articles/articles.module';
import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsModule } from '@/modules/clients/clients.module';
import { ClientsService } from '@/modules/clients/clients.service';
import { CompanyModule } from '@/modules/company/company.module';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import { SigningCertificatesService } from '@/modules/company/signing-certificates/signing-certificates.service';
import { MailService } from '@/mail/mail.service';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import { registerConvertToInvoiceAction } from './actions/convert-to-invoice';
import { registerDuplicateExtension } from './actions/duplicate-extension';
import { registerExpenseActions } from './actions/expense-actions';
import { registerInvoiceActions } from './actions/invoice-actions';
import { registerQuoteActions } from './actions/quote-actions';
import { registerRequestDepositAction } from './actions/request-deposit';
import { registerCreditNoteActions } from './actions/credit-note-actions';
import { registerReceivedInvoiceActions } from './actions/received-invoice-actions';
import { B2gRoutingBootUpsertService } from './b2g-routing/boot-upsert.service';
import { AuthorityStatusPollerRegistry } from './conformity/authority-status-poller';
import { ConformitySweepRunner } from './conformity/conformity-sweep-runner';
import { buildAnafStatusPoller } from './conformity/pollers/anaf-status-poller';
import { buildChorusProStatusPoller } from './conformity/pollers/chorus-pro-status-poller';
import { buildFaceStatusPoller } from './conformity/pollers/face-status-poller';
import { buildKsefStatusPoller } from './conformity/pollers/ksef-status-poller';
import { buildPdpStatusPoller } from './conformity/pollers/pdp-status-poller';
import { buildPeppolStatusPoller } from './conformity/pollers/peppol-status-poller';
import { ContributionRegistry } from './contributions/contribution-registry';
import { registerCreditNoteContributions } from './contributions/credit-note-contributions';
import { registerExpenseContributions } from './contributions/expense-contributions';
import { registerInvoiceContributions } from './contributions/invoice-contributions';
import { registerQuoteContributions } from './contributions/quote-contributions';
import { registerReceivedInvoiceContributions } from './contributions/received-invoice-contributions';
import { CountryFieldOverlayCatalog } from './country-fields/registry';
import { VatRateCatalog } from './vat-rates/registry';
import { DocumentsService } from './documents.service';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from './descriptors/expense.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { buildReceivedInvoiceDescriptor } from './descriptors/received-invoice.descriptor';
import { DocumentQueueDispatcher } from './queue/document-queue.dispatcher';
import { DocumentQueueModule } from './queue/document-queue.module';
import { DocumentScheduleSweepRunner } from './schedules/schedule-sweep-runner';
import { DocumentSchedulesService } from './schedules/schedules.service';
import { ShareLinksService } from './share-links/share-links.service';
import { buildArticleReferenceProvider } from './references/article-reference.provider';
import { buildClientReferenceProvider } from './references/client-reference.provider';
import { buildDocumentReferenceProvider } from './references/document-reference.provider';
import { EntityReferenceRegistry } from './references/reference-registry';
import { buildAnafTransport } from './transports/anaf-transport';
import { buildChorusProTransport } from './transports/chorus-pro-transport';
import { buildEmailTransport } from './transports/email-transport';
import { buildFaceTransport } from './transports/face-transport';
import { buildKsefTransport } from './transports/ksef-transport';
import { buildPdpTransport } from './transports/pdp-transport';
import { buildPeppolTransport } from './transports/peppol-transport';
import { buildSdiTransport } from './transports/sdi-transport';
import { TransportRegistry } from './transports/transport-registry';
import { ciiFormatProvider } from './formats/cii-provider';
import { buildFacturaeFormatProvider } from './formats/national/facturae-provider';
import { buildFacturxFormatProvider } from './formats/facturx-provider';
import { FormatProviderRegistry } from './formats/format-registry';
import { fa3FormatProvider } from './formats/national/fa3-provider';
import { fatturapaFormatProvider } from './formats/national/fatturapa-provider';
import { peppolBisFormatProvider } from './formats/peppol-bis-provider';
import { ublFormatProvider } from './formats/ubl-provider';
import { xrechnungFormatProvider } from './formats/xrechnung-provider';
import {
  ACTION_EXTENSION_REGISTRY,
  ACTION_REGISTRY,
  CONTRIBUTION_REGISTRY,
  COUNTRY_FIELD_OVERLAY_REGISTRY,
  DOCUMENT_TYPE_REGISTRY,
  ENTITY_REFERENCE_REGISTRY,
  FIELD_KIND_REGISTRY,
  FORMAT_PROVIDER_REGISTRY,
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
  // Root TODO item 18 ("réception de factures") — the FIFTH type, and the first in the "L'entrée"
  // category: see received-invoice.descriptor.ts for the full reasoning.
  registry.register(buildReceivedInvoiceDescriptor());
  return registry;
}

/** The WIDGET contribution side of the same registration discipline — see
 *  contributions/contribution-registry.ts. The invoice was the first to contribute (the model
 *  contribution, contributions/invoice-contributions.ts); the expense, the quote and the credit note
 *  (statistics only — see its own descriptor and contribution file for why) followed, each exactly
 *  one more line here, the same shape `buildActionRegistry` below already has. */
function buildContributionRegistry(): ContributionRegistry {
  const registry = new ContributionRegistry();
  registerInvoiceContributions(registry);
  registerExpenseContributions(registry);
  registerQuoteContributions(registry);
  registerCreditNoteContributions(registry);
  registerReceivedInvoiceContributions(registry);
  return registry;
}

function buildFieldKindRegistry(): FieldKindRegistry {
  const registry = new FieldKindRegistry();
  registerCoreFieldKinds(registry);
  return registry;
}

/**
 * The invoice's "download-xml" action's own registry — same registration shape as
 * `buildTransportRegistry` above (a plugin adds a jurisdiction's syntax by registering ONE more
 * provider here, never by touching `documents.service.ts#downloadDocumentFormat`). Only the two
 * EN 16931 base syntaxes this ticket built (item 12) are registered today — see
 * `formats/format-registry.ts`'s own header for what stays deliberately unbranched (Peppol BIS,
 * XRechnung — item 16). Factur-X (`facturx-provider.ts`) is the THIRD, added by item 10 (wave 1) —
 * see that file's own header for the reuse `TODO_ISSUES.md` used to flag as not-yet-done. `fa3` (PL,
 * `national/fa3-provider.ts`) and `fatturapa` (IT, `national/fatturapa-provider.ts`) are the FOURTH
 * and FIFTH, added by item 10 (wave 2) — both TRANSPORT-only by default (see `ksef-transport.ts`/
 * `sdi-transport.ts`), registered here too so `download-xml` can also offer them directly (see that
 * action's own `syntax` param options). Neither needs a companyId or any extra dependency, so
 * (unlike `facturx`) they are plain objects, not factories.
 *
 * `peppol-bis` and `xrechnung` (root TODO item 26, wave: "Peppol/Allemagne") are the SIXTH and
 * SEVENTH — both UBL-syntax EN 16931 profiles judged by the base Schematron PLUS their own vendored
 * delta (see each provider's own header for exactly which BR-DE-* / PEPPOL-EN16931-R* rules that
 * delta enforces and how). Neither needs a companyId either, so both are plain objects too.
 *
 * `facturae` (ES, `national/facturae-provider.ts`) is the EIGHTH — Spain's B2G channel FACe's own
 * payload (`transports/face-transport.ts`, `b2g-routing/data/es.json`). Unlike `fa3`/`fatturapa`, it
 * DOES need a dependency (`signingCertificates` — root TODO item 13's own port, the first real
 * consumer of the XAdES provider, see that provider's own header) so it is a factory, the same shape
 * `facturx`'s own `referenceRegistry` dependency already established here.
 */
function buildFormatProviderRegistry(
  referenceRegistry: EntityReferenceRegistry,
  signingCertificates: SigningCertificatesService,
): FormatProviderRegistry {
  const registry = new FormatProviderRegistry();
  registry.register(ciiFormatProvider);
  registry.register(ublFormatProvider);
  registry.register(buildFacturxFormatProvider({ referenceRegistry }));
  registry.register(fa3FormatProvider);
  registry.register(fatturapaFormatProvider);
  registry.register(peppolBisFormatProvider);
  registry.register(xrechnungFormatProvider);
  registry.register(buildFacturaeFormatProvider({ signingCredentials: signingCertificates }));
  return registry;
}

/**
 * The invoice's transports. "email" is registered exactly like a third party would register their
 * own (TransportRegistry.register) — nothing about invoice-actions.ts treats it specially.
 * `typeRegistry`/`referenceRegistry` are what let it compose+attach a PDF (see
 * actions/send-document-email.ts) — NEITHER depends on ACTION_REGISTRY, so wiring them here (and into
 * buildActionRegistry below, for the quote's OWN send) never creates a circular dependency, even
 * though ACTION_REGISTRY is where the send actions that call into this machinery are registered.
 *
 * "pdp" (root TODO item 10, wave 1 — `transports/pdp-transport.ts`) is the SECOND. It gets its own
 * `buildFacturxFormatProvider({ referenceRegistry })` instance rather than sharing the one
 * `FORMAT_PROVIDER_REGISTRY` already builds below: both are stateless closures over the exact same
 * pure function, so a second instance costs nothing and avoids making TRANSPORT_REGISTRY's own
 * factory depend on FORMAT_PROVIDER_REGISTRY's DI token for no reason beyond convenience.
 * `channelCredentials` (`ChannelCredentialsService`, `modules/company/channels/`) is what resolves
 * whether — and with what — a company actually connected PDP; `CompanyModule` is imported below
 * purely to make that injectable here, the same reuse `ClientsService`/`MailService` already get.
 *
 * "ksef" (PL, `transports/ksef-transport.ts`) and "sdi" (IT, `transports/sdi-transport.ts`) are the
 * THIRD and FOURTH — item 10, wave 2. Same reasoning as "pdp": each gets its OWN
 * `fa3FormatProvider`/`fatturapaFormatProvider` reference (both stateless, plain objects — see
 * `buildFormatProviderRegistry`'s own header) rather than sharing `FORMAT_PROVIDER_REGISTRY`'s
 * instance, for the identical "no reason to couple two registries" argument.
 *
 * "peppol" (`transports/peppol-transport.ts`) is the FIFTH — root TODO item 10's remainder / item 26
 * wave. Same reasoning again: its own `peppolBisFormatProvider` reference is the SAME stateless plain
 * object `buildFormatProviderRegistry` already registers under "peppol-bis" for `download-xml` — a
 * second reference to the identical object, not a second instance (there is nothing to construct: the
 * provider takes no dependency at all, unlike `facturx`'s own `referenceRegistry`-bound factory).
 *
 * `signingCertificates` (`SigningCertificatesService`, `modules/company/signing-certificates/`, root
 * TODO item 13) is threaded into "email" only — the one transport that hands a human-readable PDF to
 * someone (see `EmailTransportDeps.signingCertificates`'s own header); "pdp"/"ksef"/"sdi"/"peppol"
 * transmit XML/Factur-X formats built by `formats/*-provider.ts`, which this task deliberately does
 * NOT sign (see `sign-instance-pdf.ts`'s own header on why Factur-X's raw-PDF material is exempt).
 *
 * "chorus-pro" (`transports/chorus-pro-transport.ts`) is the SIXTH — this makes the channel the B2G
 * FR routing rule (`b2g-routing/data/fr.json`) has named since 3cb39f91 actually EXIST (that commit's
 * own thesis: "a rule may legitimately name a channel not implemented yet" — see this file's own
 * header for the full precedent). Same reasoning as "pdp": its own `facturxFormatProvider` instance,
 * same "stateless, no reason to couple two registries" argument.
 *
 * "anaf" (`transports/anaf-transport.ts`) is the SEVENTH — Romania's e-Factura, the wave `channel-
 * policy/data/ro.json` names (a REAL, sourced B2B mandate, see that file's own citation). Its own
 * payload is `ublFormatProvider` — the SAME stateless plain object `buildFormatProviderRegistry`
 * already registers under "ubl" for `download-xml` (a second reference, not a second instance, the
 * identical reasoning "peppol"'s own `peppolBisFormatProvider` reference already holds above) — see
 * that transport's own header, "THE PAYLOAD, HONESTLY", for what the base EN 16931 Schematron gate
 * does NOT additionally cover (Romania's own CIUS-RO extension, not vendored anywhere in this
 * checkout).
 */
function buildTransportRegistry(
  clientsService: ClientsService,
  mailService: MailService,
  typeRegistry: DocumentTypeRegistry,
  referenceRegistry: EntityReferenceRegistry,
  channelCredentials: ChannelCredentialsService,
  signingCertificates: SigningCertificatesService,
): TransportRegistry {
  const registry = new TransportRegistry();
  registry.register(
    'email',
    'Email',
    buildEmailTransport({
      clientsService,
      mailService,
      typeRegistry,
      referenceRegistry,
      signingCertificates,
    }),
  );
  registry.register(
    'pdp',
    'PDP (France)',
    buildPdpTransport({
      channelCredentials,
      facturxFormatProvider: buildFacturxFormatProvider({ referenceRegistry }),
    }),
  );
  registry.register('ksef', 'KSeF (Poland)', buildKsefTransport({ channelCredentials, fa3FormatProvider }));
  registry.register('sdi', 'SdI (Italy)', buildSdiTransport({ channelCredentials, fatturapaFormatProvider }));
  registry.register(
    'peppol',
    'Peppol',
    buildPeppolTransport({ channelCredentials, peppolBisFormatProvider }),
  );
  // "chorus-pro" (France, B2G) — makes the channel the B2G FR routing rule
  // (`b2g-routing/data/fr.json`) has named since 3cb39f91 actually EXIST — see
  // `transports/chorus-pro-transport.ts`'s own header. Own `facturxFormatProvider` instance, same
  // "stateless, no reason to couple two registries" reasoning "pdp" above already holds.
  registry.register(
    'chorus-pro',
    'Chorus Pro (France)',
    buildChorusProTransport({
      channelCredentials,
      facturxFormatProvider: buildFacturxFormatProvider({ referenceRegistry }),
    }),
  );
  // "anaf" (Romania, e-Factura) — the seventh transport. Own reference to the SAME stateless
  // `ublFormatProvider` plain object `buildFormatProviderRegistry` already registers — see this
  // function's own header.
  registry.register(
    'anaf',
    'ANAF e-Factura (Romania)',
    buildAnafTransport({ channelCredentials, ublFormatProvider }),
  );
  // "face" (Spain, B2G) — makes the channel the B2G ES routing rule (`b2g-routing/data/es.json`)
  // names actually EXIST, the same "chorus-pro"/"anaf" precedent above. Own `facturaeFormatProvider`
  // instance (needs `signingCertificates` — root TODO item 13's XAdES port, see
  // `formats/national/facturae-provider.ts`'s own header), same "stateless factory, no reason to
  // couple two registries" reasoning every sibling transport above already holds.
  registry.register(
    'face',
    'FACe (Spain, B2G)',
    buildFaceTransport({
      channelCredentials,
      facturaeFormatProvider: buildFacturaeFormatProvider({ signingCredentials: signingCertificates }),
    }),
  );
  return registry;
}

/**
 * Root TODO item 10's own named remainder — post-deposit conformity tracking (`conformity/`). Same
 * "a provider registers itself under an id" shape as `buildTransportRegistry` just above, this
 * registry's own read-side twin: "pdp", "ksef", "peppol" (generic AP `getStatus()` —
 * `conformity/pollers/peppol-status-poller.ts`), "chorus-pro" (`consulterCr` —
 * `conformity/pollers/chorus-pro-status-poller.ts`), and "anaf" (`stareMesaj` —
 * `conformity/pollers/anaf-status-poller.ts`) all register a poller; "sdi" does not (push-only
 * SOAP notifiche — see `conformity/authority-status-poller.ts`'s own header for why that is
 * permanent, not a gap to fill later).
 */
function buildAuthorityStatusPollerRegistry(
  channelCredentials: ChannelCredentialsService,
): AuthorityStatusPollerRegistry {
  const registry = new AuthorityStatusPollerRegistry();
  registry.register(buildPdpStatusPoller({ channelCredentials }));
  registry.register(buildKsefStatusPoller({ channelCredentials }));
  registry.register(buildPeppolStatusPoller({ channelCredentials }));
  // "chorus-pro" — `consulterCr`, the ONE status-consultation endpoint the repère's own client
  // carried (`chorus-pro/choruspro-client.ts`) — see `conformity/pollers/chorus-pro-status-poller.ts`'s
  // own header for what is, and is not, live-verified.
  registry.register(buildChorusProStatusPoller({ channelCredentials }));
  // "anaf" — `stareMesaj`, the repère's own status-consultation endpoint
  // (`anaf/anaf-client.ts`) — see `conformity/pollers/anaf-status-poller.ts`'s own header for what is,
  // and is not, live-verified.
  registry.register(buildAnafStatusPoller({ channelCredentials }));
  // "face" — `consultarFactura`, the repère's own status-consultation endpoint
  // (`face/face-client.ts`) — see `conformity/pollers/face-status-poller.ts`'s own header for what is,
  // and is not, live-verified.
  registry.register(buildFaceStatusPoller({ channelCredentials }));
  return registry;
}

/**
 * `queueDispatcher` (DocumentQueueDispatcher, queue/document-queue.dispatcher.ts) is what turns
 * "send" asynchronous for every type that has one (TODO.md item 22) — see actions/async-send.ts for
 * the shared two-phase engine every one of these registrations now goes through. Injecting the
 * CONCRETE class here (never `import type` — see this repo's own DI rule) is safe: it comes from
 * `DocumentQueueModule`, `@Global()` and imported below, so Nest resolves it the same way regardless
 * of which process (API or worker) this module boots in.
 *
 * `signingCertificates` (root TODO item 13) is threaded into the quote's own "send" only — see
 * `QuoteActionDeps.signingCertificates`'s own header; the invoice's "send" goes through
 * `TRANSPORT_REGISTRY` instead (see `buildTransportRegistry` above), never through this function.
 */
function buildActionRegistry(
  clientsService: ClientsService,
  mailService: MailService,
  transportRegistry: TransportRegistry,
  typeRegistry: DocumentTypeRegistry,
  referenceRegistry: EntityReferenceRegistry,
  queueDispatcher: DocumentQueueDispatcher,
  signingCertificates: SigningCertificatesService,
): ActionRegistry {
  const registry = new ActionRegistry();
  registerQuoteActions(registry, {
    clientsService,
    mailService,
    typeRegistry,
    referenceRegistry,
    queueDispatcher,
    signingCertificates,
  });
  registerConvertToInvoiceAction(registry);
  registerRequestDepositAction(registry);
  registerInvoiceActions(registry, { transportRegistry, queueDispatcher });
  registerCreditNoteActions(registry, { queueDispatcher });
  registerExpenseActions(registry);
  registerReceivedInvoiceActions(registry);
  // "record-payment" (invoice) IS registered — see registerInvoiceActions inside invoice-actions.ts.
  // "export-accounting" (invoice) is intentionally left unregistered here — see that file's header.
  return registry;
}

/**
 * Where a THIRD PARTY's extra actions get attached to an EXISTING type — none of this touches the
 * type's own descriptor factory above. Adding "duplicate" to quotes is exactly this one line, the
 * same way registering the quote type itself is exactly one line in buildDocumentTypeRegistry.
 *
 * Only the invoice gets `dateRecalc`: recomputing `issueDate`/`dueDate` on a scheduled occurrence
 * (schedules/, root TODO item 5) is exactly what the invoice case needs — the quote has no
 * recurrence screen wired to it today, so there is no real caller yet to build a `dateRecalc` for
 * without inventing one. Nothing here wires "send" chaining onto "duplicate" — see
 * duplicate-extension.ts's own header ("Why 'then send' does NOT live here") for why that is now
 * schedule-sweep-runner.ts's job instead.
 */
function buildActionExtensionRegistry(actionRegistry: ActionRegistry): ActionExtensionRegistry {
  const registry = new ActionExtensionRegistry();
  registerDuplicateExtension('quote', registry, actionRegistry);
  registerDuplicateExtension('invoice', registry, actionRegistry, {
    dateRecalc: { anchorField: 'issueDate', dependentFields: ['dueDate'] },
  });
  return registry;
}

function buildEntityReferenceRegistry(
  clientsService: ClientsService,
  articlesService: ArticlesService,
): EntityReferenceRegistry {
  const registry = new EntityReferenceRegistry();
  registry.register('client', buildClientReferenceProvider(clientsService));
  // The catalog article picker (14-articles.cy.ts, quote/invoice line `prefillFrom`) — the only
  // provider that implements `getFields` today (see article-reference.provider.ts).
  registry.register('article', buildArticleReferenceProvider(articlesService));
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
 * The PROVIDERS-ONLY half of the documents module — no controllers — split out from
 * `DocumentsModule` for exactly the reason the pre-refonte compliance engine split its own
 * `ComplianceCoreModule` out (git tag `avant-refonte-documents`,
 * `compliance/compliance-core.module.ts`, referenced by this branch's own TODO.md item 22): so a
 * WORKER process (`DocumentsQueueWorkerModule`, queue/document-queue-worker.module.ts) can import
 * JUST this module and get the exact same DI-wired `DocumentsService`/`ActionRegistry`/etc. instances
 * the API process uses — never a second, parallel construction of the same registries.
 *
 * Imports `DocumentQueueModule` (`@Global()`, queue/document-queue.module.ts) so
 * `DocumentQueueDispatcher` is available to `buildActionRegistry`'s factory above — and, just as
 * importantly, so `DocumentQueueRedisRequiredGuard` (that module's own provider) runs its boot-time
 * Redis check in EVERY process that imports this Core module, API or worker alike: there is no way to
 * boot the documents system at all without also proving Redis is reachable.
 */
@Module({
  imports: [ClientsModule, ArticlesModule, DocumentQueueModule, CompanyModule],
  providers: [
    DocumentsService,
    MailService,
    // Recurrences (root TODO item 5) — `DocumentSchedulesService` is the CRUD half
    // (documents.controller.ts's `schedules/*` routes); `DocumentScheduleSweepRunner` is the
    // RUNTIME half the queue's own processor calls (queue/processors/document-action.processor.ts).
    // Both are plain classes (not string-tokened registries) resolved by Nest the same way
    // `DocumentsService`/`MailService` already are — nothing here needs a factory.
    DocumentSchedulesService,
    DocumentScheduleSweepRunner,
    // Root TODO item 24 — the CRUD half of a public download link (share-links/). Same shape as
    // `DocumentSchedulesService` right above (a plain class, resolved by Nest, reusing
    // `DocumentsService` for its own tenant-scoped 404s) — no factory needed.
    ShareLinksService,
    // B2G routing (b2g-routing/) — `OnModuleInit`, runs `upsertB2gRoutingRules` on EVERY process that
    // imports this Core module (API inline, or a scaled worker replica) — see that service's own
    // header for why this is registered here, unconditionally, rather than gated the way the queue's
    // own repeatable registration is behind `WORKER_INLINE`.
    B2gRoutingBootUpsertService,
    // Root TODO item 10's own named remainder (post-deposit conformity tracking, `conformity/`) —
    // `AuthorityStatusPollerRegistry` is this mechanism's read-side twin of `TRANSPORT_REGISTRY`
    // (registered as a plain class token, not a string one, the same choice `DocumentScheduleSweepRunner`
    // makes: nothing outside this module ever needs to `@Inject()` it by name — only
    // `ConformitySweepRunner`, resolved right below, constructor-injects it). `ConformitySweepRunner`
    // itself is the RUNTIME half the queue's own processor calls, the exact same split
    // `DocumentScheduleSweepRunner` already holds for the recurrence sweep.
    {
      provide: AuthorityStatusPollerRegistry,
      useFactory: buildAuthorityStatusPollerRegistry,
      inject: [ChannelCredentialsService],
    },
    ConformitySweepRunner,
    { provide: DOCUMENT_TYPE_REGISTRY, useFactory: buildDocumentTypeRegistry },
    { provide: FIELD_KIND_REGISTRY, useFactory: buildFieldKindRegistry },
    {
      provide: TRANSPORT_REGISTRY,
      useFactory: buildTransportRegistry,
      // DOCUMENT_TYPE_REGISTRY/ENTITY_REFERENCE_REGISTRY: no circular dependency — see
      // buildTransportRegistry's own comment above. ChannelCredentialsService/SigningCertificatesService
      // both come from CompanyModule (imported above) — no cycle either: CompanyModule imports
      // nothing from here.
      inject: [
        ClientsService,
        MailService,
        DOCUMENT_TYPE_REGISTRY,
        ENTITY_REFERENCE_REGISTRY,
        ChannelCredentialsService,
        SigningCertificatesService,
      ],
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
        DocumentQueueDispatcher,
        SigningCertificatesService,
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
      inject: [ClientsService, ArticlesService],
    },
    { provide: CONTRIBUTION_REGISTRY, useFactory: buildContributionRegistry },
    // The country FIELD overlay (add/modify/remove) and the VAT rate catalog — see
    // country-fields/registry.ts and vat-rates/registry.ts. Both default-construct from their own
    // shipped data files (data/all.ts) the exact same way CountryPolicyCatalog already does for
    // country-policy's own data — no factory function needed, there is nothing to inject.
    { provide: COUNTRY_FIELD_OVERLAY_REGISTRY, useValue: new CountryFieldOverlayCatalog() },
    { provide: VAT_RATE_CATALOG_REGISTRY, useValue: new VatRateCatalog() },
    {
      provide: FORMAT_PROVIDER_REGISTRY,
      useFactory: buildFormatProviderRegistry,
      inject: [ENTITY_REFERENCE_REGISTRY, SigningCertificatesService],
    },
  ],
  exports: [
    DocumentsService,
    DocumentSchedulesService,
    DocumentScheduleSweepRunner,
    ShareLinksService,
    AuthorityStatusPollerRegistry,
    ConformitySweepRunner,
    DOCUMENT_TYPE_REGISTRY,
    FIELD_KIND_REGISTRY,
    TRANSPORT_REGISTRY,
    ACTION_REGISTRY,
    ACTION_EXTENSION_REGISTRY,
    ENTITY_REFERENCE_REGISTRY,
    CONTRIBUTION_REGISTRY,
    COUNTRY_FIELD_OVERLAY_REGISTRY,
    VAT_RATE_CATALOG_REGISTRY,
    FORMAT_PROVIDER_REGISTRY,
  ],
})
export class DocumentsCoreModule {}
