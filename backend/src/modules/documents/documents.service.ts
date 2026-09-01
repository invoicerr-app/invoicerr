import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { SigningCertificatesService } from '@/modules/company/signing-certificates/signing-certificates.service';
import { signRenderedPdfIfConfigured } from './signing/sign-instance-pdf';
import { renderDocumentInstance } from './rendering/render-instance-pdf';
import { computeDocumentTotals, DocumentTotals } from './totals/compute-totals';
import prisma from '@/prisma/prisma.service';

import {
  ArchiveVerificationResult,
  DocumentArchiveResult,
  listDocumentArchives,
  verifyDocumentArchive,
} from './archive/persistence';
import { ActionExtensionRegistry } from './actions/action-extensions';
import { DocumentAuthorityEventResult, listAuthorityEvents } from './conformity/authority-events.persistence';
import { ActionRegistry, ActionResult } from './actions/action-registry';
import { collectWidgets } from './contributions/collect-widgets';
import { ContributionRegistry } from './contributions/contribution-registry';
import { Widget } from './contributions/widgets';
import {
  evaluateCountryPolicy,
  resolveAvailableDocumentTypes,
  resolveCompanyCountryCode,
} from './country-policy/country-policy';
import {
  resolveRequiredIdentifiers,
  RequiredIdentifiersDecision,
} from './country-identifiers/country-identifiers';
import { PartyType } from './country-identifiers/schema';
import { applyFieldOverlay } from './country-fields/apply-overlay';
import { CountryFieldOverlayCatalog } from './country-fields/registry';
import { applyCompanyFieldView } from './descriptors/company-view';
import { FieldKindRegistry } from './descriptors/field-kinds';
import {
  checkTransitionResult,
  findUndeclaredStatusInstances,
  validateLifecycle,
} from './descriptors/lifecycle';
import { DocumentTypeRegistry, UnknownDocumentTypeError } from './descriptors/type-registry';
import {
  DocumentActionDescriptor,
  DocumentTypeDescriptor,
  isActionAvailable,
  WidgetLocation,
} from './descriptors/types';
import { validateAgainstDescriptor } from './descriptors/validate';
import { RunActionDto } from './dto/documents.dto';
import { FormatProviderRegistry, UnknownFormatError } from './formats/format-registry';
import { DocumentFormatBuildResult, DocumentFormatProvider } from './formats/format-provider';
import { companyToFormatParty, clientToFormatParty } from './formats/party-snapshot';
import { SemanticBuildError } from './formats/semantic/build-semantic-invoice';
import { takeDocumentNumberForTransition } from './numbering/take-number';
import { findOwnedDocument, listDocuments } from './persistence';
import { buildUpcomingSchedulesWidget } from './schedules/schedule-widgets';
import { listSchedules } from './schedules/schedule.persistence';
import { computeSettlement, DocumentSettlement } from './settlement/compute-settlement';
import {
  DocumentCreditResult,
  resolveCreditsForDocument,
  toSettlementCreditInputs,
} from './settlement/credits';
import { DocumentPaymentResult, listPayments } from './settlement/payments';
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
import { isInvoiceTaxBlockError, resolveInvoiceCrossBorderTax } from './tax/resolve-invoice-tax';
import { TransportRegistry } from './transports/transport-registry';
import { VatRateCatalog } from './vat-rates/registry';
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

/** One action, as `describeTypeForCompany` hands it to the frontend — the plain declared shape PLUS
 *  an optional, country-policy-derived reason it is currently blocked. See that method's own doc
 *  comment for why this is a separate VIEW type rather than a change to `DocumentActionDescriptor`
 *  itself. Declared as an `extends`, not an `&` intersection, specifically so the narrower `actions`
 *  array below resolves to THIS element type when a caller reads `.actions` — an intersection of two
 *  differently-elemented array types does not simplify the way an interface override does. */
export interface DocumentActionDescriptorView extends DocumentActionDescriptor {
  policyBlockedReason?: string;
  /**
   * The country policy's own per-status narrowing (country-policy/schema.ts's
   * `DocumentActionRuleFact.statuses`, surfaced via `evaluateCountryPolicy`'s own
   * `restrictedToStatuses`) — carried as ITS OWN fact, deliberately NEVER folded into
   * `availableWhen` above. See lifecycle.ts's own closing comment ("A note on what deliberately does
   * NOT live in this file") for the real bug that shipped the day this WAS folded in: `availableWhen:
   * 'always'` means "every existing status, AND a brand-new record"; a country restricting it to,
   * say, `['draft']` must narrow only the EXISTING-status half — a never-saved record has no status
   * for the country's rule to have an opinion about (the same reasoning `runAction`'s own per-status
   * 409 check already holds). The frontend's `isActionAvailable` (types.ts, mirrored from this
   * field's shape) is what composes the two facts back together for rendering — the exact same
   * composition `runAction` performs server-side, right next to its own `availableWhen` check.
   */
  policyRestrictedToStatuses?: string[];
}

export interface DocumentTypeDescriptorView extends Omit<DocumentTypeDescriptor, 'actions'> {
  actions: DocumentActionDescriptorView[];
}

/** What `GET /documents/:id/settlement` hands back — see `DocumentsService.getSettlement`. Same
 *  "read side of a write" pairing `DocumentTotals` already has with `computeTotals`. `credits` and
 *  `warnings` are new (item 8, "le lettrage" — settlement/credits.ts): empty arrays for any type that
 *  isn't an invoice, never a missing/undefined field the frontend would have to guard against. */
export interface DocumentSettlementView {
  totals: DocumentTotals;
  payments: DocumentPaymentResult[];
  credits: DocumentCreditResult[];
  warnings: string[];
  settlement: DocumentSettlement;
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    @Inject(DOCUMENT_TYPE_REGISTRY) private readonly typeRegistry: DocumentTypeRegistry,
    @Inject(FIELD_KIND_REGISTRY) private readonly fieldKindRegistry: FieldKindRegistry,
    @Inject(ACTION_REGISTRY) private readonly actionRegistry: ActionRegistry,
    @Inject(ACTION_EXTENSION_REGISTRY) private readonly actionExtensionRegistry: ActionExtensionRegistry,
    @Inject(ENTITY_REFERENCE_REGISTRY) private readonly referenceRegistry: EntityReferenceRegistry,
    @Inject(TRANSPORT_REGISTRY) private readonly transportRegistry: TransportRegistry,
    @Inject(CONTRIBUTION_REGISTRY) private readonly contributionRegistry: ContributionRegistry,
    @Inject(COUNTRY_FIELD_OVERLAY_REGISTRY)
    private readonly countryFieldOverlayCatalog: CountryFieldOverlayCatalog = new CountryFieldOverlayCatalog(
      [],
    ),
    @Inject(VAT_RATE_CATALOG_REGISTRY)
    private readonly vatRateCatalog: VatRateCatalog = new VatRateCatalog([]),
    // Defaulted to an EMPTY registry, same discipline as `countryFieldOverlayCatalog`/
    // `vatRateCatalog` just above: the eight pre-existing `documents.service.*.spec.ts` files that
    // construct `DocumentsService` with positional args and stop before this one keep meaning
    // exactly what they always did (an empty registry only matters to `downloadDocumentFormat`,
    // which none of them exercise) — never a breaking change to add a new capability.
    @Inject(FORMAT_PROVIDER_REGISTRY)
    private readonly formatProviderRegistry: FormatProviderRegistry = new FormatProviderRegistry(),
    // Root TODO item 13 ("Signature électronique") — a plain concrete-class dependency, the same
    // pattern `ChannelsController`/`buildTransportRegistry` already use for `ChannelCredentialsService`
    // (no string token needed: Nest resolves a concrete class by its own type). Defaulted to a fresh
    // `SigningCertificatesService()` (no-arg constructor, same shape as `ChannelCredentialsService`)
    // for the exact same reason every registry default above exists: the pre-existing
    // `documents.service.*.spec.ts` files construct this service positionally and stop before this
    // param — `renderInstancePdf` only reaches it when `CREDENTIALS_ENCRYPTION_KEY` is set (none of
    // those specs set it), so the default is never actually exercised there.
    private readonly signingCertificates: SigningCertificatesService = new SigningCertificatesService(),
  ) {}

  /**
   * Forces every registered type's extension actions to be merged once at boot, so an id collision
   * between a type's own descriptor and a third party's extension (two different modules declaring
   * the same action id) fails loudly when the app starts — not on whichever request happens to hit
   * it first. This is the "booting the app is the real check of the wiring" rule applied to this
   * specific composition point.
   *
   * Also exercises every shipped country's FIELD overlay (country-fields/) against every registered
   * type here, once — a misconfigured overlay (a `path`/`key` that doesn't resolve — see
   * apply-overlay.ts) fails at boot the same way an action-id collision above does, never on
   * whichever company's first request happens to hit it. A no-op today (country-fields/data/all.ts
   * ships none), but it means the day a real file appears, THIS is what catches a typo in it.
   */
  onModuleInit(): void {
    for (const { id } of this.typeRegistry.list()) {
      const descriptor = this.mergedDescriptor(id);
      // Re-validates the FULL merged lifecycle (native actions + whatever a third-party extension
      // attached, e.g. "duplicate") once more here — DocumentTypeRegistry.register() (type-registry.ts)
      // already validated the type's OWN declaration the moment it registered, but an extension's
      // `availableWhen`/`transitions` (duplicate-extension.ts) are never seen by that call at all. A
      // second, independent gate, same discipline country-policy/schema.ts's assertValidProvenance
      // documents for its own concern.
      validateLifecycle(descriptor);
      for (const countryCode of this.countryFieldOverlayCatalog.countries()) {
        applyFieldOverlay(descriptor.fields, this.countryFieldOverlayCatalog.operationsFor(countryCode, id));
      }
    }

    // Fire-and-forget, deliberately: a DB round-trip has no business making the app wait to finish
    // booting, and — same discipline as every other check in this method — a data anomaly here is a
    // loud LOG, never something that takes the whole app down with it. `.catch()` below is what keeps
    // a query failure (e.g. a migration not yet applied) from becoming an unhandled rejection.
    this.warnAboutUndeclaredStatuses().catch((error) => {
      logger.error('Failed to check document instances for an undeclared lifecycle status', {
        category: 'documents',
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    });
  }

  /**
   * The "data migration" question the lifecycle mechanism raises, answered at every boot rather than
   * once by hand: every DISTINCT (typeId, status) pair actually persisted in `DocumentInstance`,
   * checked against each type's own declared `statuses` (findUndeclaredStatusInstances,
   * descriptors/lifecycle.ts). For the four shipped types today, every status any handler has ever
   * written (draft/sent) is exactly what their descriptors declare — verified by hand, not just by
   * this check — so this finds nothing to report on a fresh checkout. It exists for what comes
   * NEXT: a future descriptor change, or a stray manual DB edit, that leaves a status behind no
   * declaration covers must be a loud, named warning at boot, never a silent mismatch a user only
   * discovers when a screen renders oddly or an action refuses for a reason nobody can explain.
   */
  private async warnAboutUndeclaredStatuses(): Promise<void> {
    const instances = await prisma.documentInstance.findMany({
      select: { typeId: true, status: true },
      distinct: ['typeId', 'status'],
    });

    const violations = findUndeclaredStatusInstances((typeId) => {
      try {
        return this.mergedDescriptor(typeId);
      } catch {
        return undefined;
      }
    }, instances);

    for (const violation of violations) {
      logger.warn('A document instance carries a status its type never declares in its lifecycle', {
        category: 'documents',
        details: violation,
      });
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

  /**
   * Every widget declared for `location` (dashboard/statistics) by a document type the active
   * company's TYPE registry knows about — see contributions/collect-widgets.ts for the actual
   * assembly (declared-but-unimplemented handling included). Deliberately NOT filtered by the
   * country-action policy: a widget is an aggregate view, not an operation a country can forbid —
   * see country-policy/country-policy.ts's own header for the (separate) mechanism that DOES gate
   * actions.
   */
  async collectWidgets(companyId: string, location: WidgetLocation): Promise<Widget[]> {
    const widgets = await collectWidgets({
      companyId,
      location,
      typeRegistry: this.typeRegistry,
      contributionRegistry: this.contributionRegistry,
    });

    // "Upcoming recurrences" (root TODO item 5, point 6) — ADDED alongside every existing widget
    // above, never in place of them. Not a per-TYPE contribution (ContributionRegistry is keyed by
    // (typeId, location) because a type decides what it shows about ITSELF): this widget spans every
    // type at once, so it is wired here directly rather than through that registry — see
    // schedules/schedule-widgets.ts's own header.
    if (location === 'dashboard') {
      const schedules = await listSchedules(companyId);
      const typeLabels = Object.fromEntries(this.typeRegistry.list().map((d) => [d.id, d.label]));
      widgets.push(buildUpcomingSchedulesWidget(schedules, typeLabels));
    }

    return widgets;
  }

  /**
   * The document types the active company's COUNTRY makes available at all — what the frontend's
   * Documents sidebar group renders (see country-policy/country-policy.ts's
   * resolveAvailableDocumentTypes for the decision, and its own header for why this is a separate,
   * lighter-weight declaration than the per-ACTION policy `evaluateCountryPolicy` reads from the
   * database). `reason` is present, and `types` empty, when the country cannot be resolved or has no
   * document-type policy at all — never a silently empty list.
   */
  async listAvailableTypes(
    companyId: string,
  ): Promise<{ types: { id: string; label: string }[]; reason?: string }> {
    const decision = await resolveAvailableDocumentTypes(companyId);
    if (decision.typeIds.length === 0) {
      return { types: [], reason: decision.reason };
    }

    // A country file may name a typeId that isn't (or isn't yet) registered on this build — skipped
    // rather than thrown, the same defensive posture data-integrity.spec.ts-style checks exist to
    // catch at TEST time instead (see country-policy/data/all.spec.ts's own cross-check).
    const types = decision.typeIds
      .map((id) => {
        try {
          return this.typeRegistry.resolve(id);
        } catch {
          return undefined;
        }
      })
      .filter((descriptor): descriptor is DocumentTypeDescriptor => !!descriptor)
      .map(({ id, label }) => ({ id, label }));

    return { types };
  }

  /**
   * Which national identifier SCHEMES (e.g. "LEGAL_ID", "VAT") a party of `partyType` must supply
   * for `countryCode` — see country-identifiers/country-identifiers.ts's resolveRequiredIdentifiers
   * for the actual decision. Deliberately NOT scoped by `@ActiveCompany()` (see this controller's
   * own route and that function's header): the country in question is whatever the CALLER's own
   * country picker currently holds — a client being created, the active company's own settings
   * form, or the onboarding wizard before any company exists at all — never the active company's
   * country by construction.
   *
   * Any string other than "INDIVIDUAL" defaults to "COMPANY" rather than rejecting the request:
   * this endpoint's only two frontend callers pass a `ClientType`-shaped value, and a stray/omitted
   * query param is far more likely to mean "the company itself" (the onboarding/company-settings
   * callers never pass anything else) than to be a genuine third party type this catalog doesn't
   * know yet.
   */
  async listRequiredIdentifiers(
    countryCode: string,
    partyType: string,
  ): Promise<RequiredIdentifiersDecision> {
    const resolvedPartyType: PartyType = partyType === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'COMPANY';
    return resolveRequiredIdentifiers(countryCode, resolvedPartyType);
  }

  getType(typeId: string): DocumentTypeDescriptor {
    return this.mergedDescriptor(typeId);
  }

  /**
   * The descriptor a FRONTEND actually renders — `getType` above, but with:
   *  - each ACTION annotated with `policyBlockedReason` when the ACTIVE COMPANY's country policy
   *    refuses it (see country-policy/country-policy.ts's evaluateCountryPolicy);
   *  - each FIELD passed through the company's own field VIEW (descriptors/company-view.ts): the
   *    country field overlay (add/modify/remove — country-fields/) and the VAT rate catalog
   *    (vat-rates/) filling in a field like the invoice line's `vatRate`.
   *
   * Both are country-aware VIEWS layered on top of the plain descriptor, never a change to
   * `DocumentTypeDescriptor` itself: the descriptor stays pure declarative data (no company, no
   * country), and every other reader of `mergedDescriptor`/`getType` (row selection, the jest specs
   * that build a service with no company at all) is unaffected.
   *
   * `policyBlockedReason` is PLAIN TEXT, not an i18n key — same convention as `label`/`message`
   * elsewhere in this module — so the frontend can show it verbatim without knowing any country.
   * Absent entirely for an action the policy allows: the frontend never has to distinguish "allowed"
   * from "explicitly not blocked" here, only "has a reason" from "doesn't".
   */
  async describeTypeForCompany(companyId: string, typeId: string): Promise<DocumentTypeDescriptorView> {
    const descriptor = this.mergedDescriptor(typeId);
    const [decisions, countryCode] = await Promise.all([
      Promise.all(descriptor.actions.map((action) => evaluateCountryPolicy(companyId, typeId, action.id))),
      resolveCompanyCountryCode(companyId),
    ]);

    const fields = applyCompanyFieldView({
      typeId,
      fields: descriptor.fields,
      countryCode,
      fieldOverlayCatalog: this.countryFieldOverlayCatalog,
      vatRateCatalog: this.vatRateCatalog,
    });

    return {
      ...descriptor,
      fields,
      actions: descriptor.actions.map((action, index) => {
        const decision = decisions[index];
        if (!decision.allowed) return { ...action, policyBlockedReason: decision.reason };
        // The country policy allows the action but narrows it to specific statuses (schema.ts's
        // `DocumentActionRuleFact.statuses`) — carried as its OWN field, `policyRestrictedToStatuses`,
        // deliberately NEVER merged into `availableWhen` itself. See `DocumentActionDescriptorView`'s
        // own comment on that field for why folding the two together is the bug this shape replaced.
        if (decision.restrictedToStatuses) {
          return { ...action, policyRestrictedToStatuses: decision.restrictedToStatuses };
        }
        return action;
      }),
    };
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

  /**
   * The raw field values behind a `prefillFrom` field (descriptors/types.ts) — e.g. an article's
   * `name`/`unitPrice`/`vatRate`. `null` covers TWO honestly-distinct "nothing to prefill" cases the
   * caller does not need to tell apart (the frontend degrades the same way either way — the button
   * still opened the picker, it just filled nothing): the id doesn't resolve for this company, OR
   * the entity is real but its provider never implemented `getFields` at all (see that method's own
   * comment on reference-registry.ts for why that is a normal, unregistered-capability state, never
   * a bug). An unknown ENTITY NAME is a different kind of mistake (a typo in a descriptor, a stale
   * client) and still 404s, same as searchReferences/resolveReference above.
   */
  async getReferenceFields(
    companyId: string,
    entity: string,
    id: string,
  ): Promise<Record<string, unknown> | null> {
    const provider = this.resolveReferenceProvider(entity);
    if (!provider.getFields) return null;
    return provider.getFields(companyId, id);
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
   *  - the active company's country forbids this action, or has no policy at all -> 403, names the
   *    country and says what would unblock it (see country-policy/country-policy.ts)
   *  - action declared but not available for the record's current status -> 409 (the descriptor's
   *    own `availableWhen`, OR the country policy's own per-status narrowing — schema.ts's
   *    `DocumentActionRuleFact.statuses` — refuses it; both land on the same 409, never a second 403)
   *  - action declared, available, but no implementation registered -> 501, clearly worded
   *  - document data or the action's own params don't match their descriptors -> 400, per-field
   *
   * This is the ONLY place an action actually runs — the HTTP controller has no other route that
   * reaches an ActionHandler — so this check is what makes "what the screen refuses, the API
   * refuses" true by construction rather than by the frontend and backend happening to agree: a
   * scripted client hitting this endpoint directly goes through the exact same policy check a click
   * would have.
   *
   * Once a handler returns, `checkTransitionResult` (descriptors/lifecycle.ts) makes SURE the status
   * it actually persisted (if any, on THIS same record) is the one the type's own declared lifecycle
   * says it must be — a handler bug that persists an undeclared status is a thrown Error here, never
   * a phantom status quietly reaching the database.
   */
  async runAction(
    companyId: string,
    typeId: string,
    actionId: string,
    payload: RunActionDto,
  ): Promise<ActionResult> {
    const { descriptor, action } = this.resolveAction(typeId, actionId);

    const policyDecision = await evaluateCountryPolicy(companyId, typeId, actionId);
    if (!policyDecision.allowed) {
      throw new ForbiddenException(policyDecision.reason);
    }

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
    // The country policy's OWN per-status narrowing (schema.ts's `DocumentActionRuleFact.statuses`)
    // — a SEPARATE restriction from the descriptor's own `availableWhen` just checked above, composed
    // here rather than folded into `evaluateCountryPolicy`'s allowed/forbidden decision: the action
    // IS permitted by this country in principle (policyDecision.allowed is already true at this
    // point), just not from this particular status, which is exactly what a 409 already means for
    // the descriptor's own `availableWhen` — never a second, redundant 403.
    //
    // A brand-new, never-saved record (`currentStatus === undefined`) is NOT checked against this
    // restriction: there is no status yet for a country's per-status rule to have an opinion about —
    // the record's eventual status is entirely up to the type's own lifecycle (`transitions`), which
    // this restriction narrows only once a status actually exists to narrow. The descriptor's own
    // `availableWhen: 'always'` already treats a never-saved record as satisfied the exact same way.
    if (
      currentStatus !== undefined &&
      policyDecision.restrictedToStatuses &&
      !policyDecision.restrictedToStatuses.includes(currentStatus)
    ) {
      throw new ConflictException(
        `Action "${actionId}" of document type "${typeId}" is restricted by this company's country ` +
          `policy to status(es) ${policyDecision.restrictedToStatuses.join(', ')}, not "${currentStatus}".`,
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

    // The FIELDS this company's country actually gets — the same country-field-overlay +
    // VAT-rate-catalog view describeTypeForCompany hands the frontend (descriptors/company-view.ts).
    // Validating against the BASE descriptor.fields here would let a scripted client bypass whatever
    // a country's overlay added/required (or accept a value a REMOVEd field could no longer carry) —
    // the same "the API refuses exactly what the screen would refuse" discipline the country-policy
    // check right above already holds for actions, now held for fields too.
    const countryCode = await resolveCompanyCountryCode(companyId);
    const fields = applyCompanyFieldView({
      typeId,
      fields: descriptor.fields,
      countryCode,
      fieldOverlayCatalog: this.countryFieldOverlayCatalog,
      vatRateCatalog: this.vatRateCatalog,
    });

    const dataErrors = validateAgainstDescriptor(fields, payload.data ?? {}, this.fieldKindRegistry);
    // Cross-document existence for every 'rowSelection' field — a no-op for a type that declares
    // none (the loop inside just finds nothing), never a DB round-trip for the quote or the invoice.
    // See row-selection/resolve-row-selection.ts's header for why this is a SEPARATE, async pass
    // rather than one more FieldKindRegistry validator: it needs company-scoped persistence access
    // validateAgainstDescriptor's pure, synchronous kinds deliberately never get.
    const rowSelectionErrors = await validateRowSelections({
      companyId,
      descriptor: { ...descriptor, fields },
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
    const data = stampRowIds(fields, payload.data ?? {}, referencedArrayFieldKeys(this.typeRegistry, typeId));

    let result = await handler({
      companyId,
      typeId,
      documentId: payload.documentId,
      data,
      params: payload.params ?? {},
    });

    // See this method's own header comment on `checkTransitionResult` — a handler is no longer free
    // to persist an arbitrary status; whatever it actually wrote (on THIS same record) must match
    // what the type's own declared lifecycle says it should be.
    const violation = checkTransitionResult(
      descriptor,
      typeId,
      action,
      payload.documentId,
      currentStatus,
      result,
    );
    if (violation) {
      logger.error('Document action wrote a status outside its declared lifecycle', {
        category: 'documents',
        details: { typeId, actionId, ...violation },
      });
      throw new Error(
        `Action "${actionId}" of document type "${typeId}" wrote status "${violation.actualStatus}" but its ` +
          `declared lifecycle requires one of "${violation.expectedStatuses.join('", "')}" here — this is a ` +
          'handler bug, not something a request can trigger on its own.',
      );
    }

    // THE NUMBER (numbering/): taken the first time this record's now-persisted status actually
    // EQUALS the type's own declared `numbering.onEnterStatus` — never before (a draft has none) and
    // never again once one is set. Checking the RESULTING status against `onEnterStatus`, combined
    // with `number` still being null, is enough to mean "first time" WITHOUT re-deriving which
    // transition edge fired: `number` is never cleared once set (see `DocumentInstance`'s own schema
    // comment), so this exact check can never fire a second time for the same record no matter how
    // many different actions might be able to reach `onEnterStatus`. Scoped to `result.document`
    // being THIS SAME type (never a foreign record a side-effect action like "convert-to-invoice"
    // created) — the same guard `checkTransitionResult` just above already holds for its own concern.
    if (
      descriptor.numbering &&
      result.document &&
      result.document.typeId === typeId &&
      result.document.status === descriptor.numbering.onEnterStatus &&
      result.document.number == null
    ) {
      const numbered = await takeDocumentNumberForTransition(companyId, typeId, result.document.id);
      // `numbered` is undefined only if a concurrent request already numbered this exact record
      // between the in-memory check just above and the atomic DB write inside `takeDocumentNumber` —
      // see that function's own header. Nothing to do in that case: the record already has whatever
      // number that other request gave it, and this response simply doesn't carry it (the caller's
      // own next read of the record will).
      if (numbered) {
        result = { ...result, document: { ...result.document, ...numbered } };
      }
    }

    return result;
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

  /**
   * Computes totals (net, VAT, gross) for a document instance by parsing its lines and applying
   * VAT breakdown logic. Pure calculation, scoped by company.
   */
  async computeTotals(companyId: string, typeId: string, id: string): Promise<DocumentTotals> {
    const instance = await findOwnedDocument(companyId, typeId, id);
    const descriptor = this.mergedDescriptor(typeId);
    return computeDocumentTotals(descriptor, instance.data as Record<string, unknown>);
  }

  /**
   * A document instance's PAYMENT SETTLEMENT — totals, the payments recorded against it, and the
   * resulting balance (settlement/compute-settlement.ts). Same moulding as `computeTotals` just
   * above (find the owned instance, resolve its merged descriptor, compute) — this is the READ side
   * of "record-payment" (actions/invoice-actions.ts writes the `DocumentPayment` rows this reads
   * back). Works for ANY document type, not only the invoice: nothing here names one, the same way
   * `computeTotals` doesn't — a type simply has no payments recorded against it if it never declares
   * a "record-payment"-shaped action, and the settlement then trivially says "nothing paid". CREDITS
   * (item 8, "le lettrage") are resolved the same way — `resolveCreditsForDocument`
   * (settlement/credits.ts) is the one place that knows only "invoice" has any today; a quote or an
   * expense simply gets `credits: []` back, no special-casing needed here.
   */
  async getSettlement(companyId: string, typeId: string, id: string): Promise<DocumentSettlementView> {
    const instance = await findOwnedDocument(companyId, typeId, id);
    const descriptor = this.mergedDescriptor(typeId);
    const data = instance.data as Record<string, unknown>;
    const totals = computeDocumentTotals(descriptor, data);
    const payments = await listPayments(companyId, id);
    const { credits, warnings } = await resolveCreditsForDocument(companyId, typeId, id, descriptor, data);
    const settlement = computeSettlement(totals.grossMinor, payments, toSettlementCreditInputs(credits));
    return { totals, payments, credits, warnings, settlement };
  }

  /**
   * Renders a document instance as a PDF — a thin wrapper around
   * rendering/render-instance-pdf.ts's `renderDocumentInstance`, the shared composition the
   * document-SEND paths (actions/send-document-email.ts) now go through too, so an emailed PDF and
   * this "GET .../pdf" download are always byte-for-byte the same pipeline. This method supplies the
   * MERGED descriptor (native fields + third-party extension actions) — see that function's own
   * header for why the send paths deliberately do not.
   */
  async renderInstancePdf(companyId: string, typeId: string, id: string): Promise<Buffer> {
    const instance = await findOwnedDocument(companyId, typeId, id);
    const descriptor = this.mergedDescriptor(typeId);
    const { pdf } = await renderDocumentInstance(
      { referenceRegistry: this.referenceRegistry },
      companyId,
      descriptor,
      instance,
    );
    // Root TODO item 13 — signs PAdES-BES when (and only when) this company has an active,
    // applicable, non-expired certificate configured (`signing/sign-instance-pdf.ts`'s own header).
    // No certificate → `pdf` returned untouched, byte-for-byte (the invariant every pre-existing
    // `documents.service.*.spec.ts` and Cypress spec 19 already proves without knowing this call
    // exists). A configured-but-failing signature THROWS here, same as a Puppeteer failure would —
    // never a silently-unsigned document served to a company that turned signing on.
    return signRenderedPdfIfConfigured(this.signingCertificates, companyId, pdf);
  }

  /**
   * "GET .../formats/:syntax" — a normalized EN 16931 export (item 12, "formats normalisés"),
   * built and validated on demand, exactly like `renderInstancePdf` above (never cached — a small
   * document, cheap to rebuild, and this way an edited-then-resaved document can never serve a stale
   * export). NOT reached through `runAction`/`ActionRegistry` (see `invoice.descriptor.ts`'s own
   * comment on why "download-xml" is declared but never registered as a handler there) — this method
   * runs the SAME four gates by hand, in the SAME order `runAction` already documents, so a scripted
   * client hitting this endpoint directly is refused exactly the way the screen's own button would
   * be, never a looser check because the path is different:
   *
   *  1. country policy (403) — `evaluateCountryPolicy`, identical to `runAction`'s own check.
   *  2. status (409) — `isActionAvailable` against the descriptor's own `availableWhen` (only once
   *     the document is actually numbered — see `invoice.descriptor.ts`'s own comment on
   *     "download-xml"), PLUS the country policy's own per-status narrowing, same as `runAction`.
   *  3. implementation (501) — `FormatProviderRegistry.resolve(syntax)` throws `UnknownFormatError`
   *     for a syntax nobody registered a provider for (structurally always reachable — the
   *     descriptor's own `syntax` param is a closed `options` list of exactly the syntaxes THIS
   *     registry knows, so this only ever fires for a scripted client sending a value outside it).
   *  4. validation (400) — THE GATE THIS TICKET EXISTS FOR: the provider's own `build()` runs the
   *     real structural + Schematron checks (`formats/structural-check.ts` +
   *     `formats/vendored/validate-schematron.ts`) against the vendored EN 16931 ruleset. An invalid
   *     artifact is NEVER returned — this method throws instead, citing every violated rule (BR-*).
   *     `SemanticBuildError` (`formats/semantic/build-semantic-invoice.ts` — an unresolvable BT-151)
   *     is the narrower case where the bridge could not even ATTEMPT to build; both land on the same
   *     400, the same way `runAction`'s own data/param validation errors do.
   */
  async downloadDocumentFormat(
    companyId: string,
    typeId: string,
    id: string,
    syntax: string,
  ): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
    const { descriptor, action } = this.resolveAction(typeId, 'download-xml');

    const policyDecision = await evaluateCountryPolicy(companyId, typeId, 'download-xml');
    if (!policyDecision.allowed) {
      throw new ForbiddenException(policyDecision.reason);
    }

    const instance = await findOwnedDocument(companyId, typeId, id);

    if (!isActionAvailable(action, instance.status)) {
      // A dedicated message, not `runAction`'s generic one: "download-xml" refuses for exactly ONE
      // structural reason (no number yet — see invoice.descriptor.ts's own comment), so the 409 says
      // so directly rather than making the caller cross-reference `availableWhen` themselves. This IS
      // the "un brouillon sans numéro refuse en le disant" behavior this ticket asks for.
      throw new ConflictException(
        `Cannot download a normalized XML export of a document with status "${instance.status}" — an ` +
          'EN 16931 invoice requires a definitive invoice number (BT-1), only assigned once sending ' +
          'actually starts.',
      );
    }
    if (
      policyDecision.restrictedToStatuses &&
      !policyDecision.restrictedToStatuses.includes(instance.status)
    ) {
      throw new ConflictException(
        `Action "download-xml" of document type "${typeId}" is restricted by this company's country ` +
          `policy to status(es) ${policyDecision.restrictedToStatuses.join(', ')}, not "${instance.status}".`,
      );
    }

    let provider: DocumentFormatProvider;
    try {
      provider = this.formatProviderRegistry.resolve(syntax);
    } catch (error) {
      if (error instanceof UnknownFormatError) {
        throw new NotImplementedException(
          `Document format "${syntax}" is not implemented — known formats: ` +
            `${this.formatProviderRegistry
              .list()
              .map((f) => f.id)
              .join(', ')}.`,
        );
      }
      throw error;
    }

    const data = (instance.data ?? {}) as Record<string, unknown>;
    const clientId = typeof data.client === 'string' ? data.client : undefined;
    const [company, client] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, include: { partyIdentifiers: true } }),
      clientId
        ? prisma.client.findUnique({ where: { id: clientId }, include: { partyIdentifiers: true } })
        : Promise.resolve(null),
    ]);
    if (!company) {
      throw new NotFoundException(`Company "${companyId}" not found.`);
    }
    if (!client) {
      throw new BadRequestException(
        'Cannot build a normalized XML export: this invoice has no valid client on file.',
      );
    }

    // Root TODO item 16 ("transfrontalier") — invoice-only: the download is otherwise a generic
    // export shared by any future document type's own `download-xml`-style action. Reuses the
    // company/client rows ALREADY fetched above (with their `partyIdentifiers`) rather than a second
    // round trip through `tax/load-and-resolve.ts` — the pure resolver
    // (`tax/resolve-invoice-tax.ts`) is called directly. See `invoice-actions.ts`'s own `deliver()`
    // for why this same rewrite ALSO has to happen there (every transport, not just this download
    // button, must agree on the resolved treatment).
    let dataForBuild = data;
    if (typeId === 'invoice') {
      const buyerVatRow = client.partyIdentifiers.find((pi) => pi.scheme === 'VAT');
      try {
        dataForBuild = resolveInvoiceCrossBorderTax({
          seller: { country: company.country, countryCode: company.countryCode },
          buyer: { country: client.country, countryCode: client.countryCode },
          buyerVat: buyerVatRow
            ? { value: buyerVatRow.value, validationStatus: buyerVatRow.validationStatus }
            : undefined,
          data,
        }).data;
      } catch (error) {
        if (isInvoiceTaxBlockError(error)) {
          throw new BadRequestException({ message: error.message, errors: [error.message] });
        }
        throw error;
      }
    }
    const instanceForBuild = dataForBuild === data ? instance : { ...instance, data: dataForBuild };

    let buildResult: DocumentFormatBuildResult;
    try {
      buildResult = await provider.build(
        descriptor,
        instanceForBuild,
        companyToFormatParty(company),
        clientToFormatParty(client),
        companyId,
      );
    } catch (error) {
      if (error instanceof SemanticBuildError) {
        throw new BadRequestException({ message: error.message, errors: [error.message] });
      }
      throw error;
    }

    if (!buildResult.validation.valid) {
      // THE GATE — never served. Every string here cites the violated rule (BR-*), so the caller can
      // act on it rather than guess.
      throw new BadRequestException({
        message: `The generated ${provider.syntax} document failed EN 16931 validation and was not served.`,
        errors: buildResult.validation.errors,
      });
    }

    // Every provider so far is either XML (cii/ubl) or, since facturx-provider.ts, a PDF — deriving
    // the extension from `provider.mime` rather than hard-coding ".xml" is what keeps this switch
    // from needing a THIRD change (beyond format-registry.ts's own registration) for a PDF-producing
    // format the way Peppol/XRechnung (both still XML) would not have required at all.
    const extension = provider.mime === 'application/pdf' ? 'pdf' : 'xml';
    return {
      bytes: buildResult.bytes,
      mime: provider.mime,
      filename: `${instance.displayNumber ?? id}-${provider.id}.${extension}`,
    };
  }

  /**
   * "GET .../archives" — root TODO item 14 ("archivage légal ⚖"). Every archive written for this
   * document (`archive/archive-on-send.ts`, one row per successful delivery that produced at least
   * one artifact — see `DocumentArchive`'s own schema comment), most recent first. `findOwnedDocument`
   * first, the same tenant/existence check every other per-document read in this class already runs
   * — an archive is never listed for a document belonging to another company, or that doesn't exist.
   */
  async listDocumentArchives(
    companyId: string,
    typeId: string,
    id: string,
  ): Promise<DocumentArchiveResult[]> {
    await findOwnedDocument(companyId, typeId, id);
    return listDocumentArchives(companyId, id);
  }

  /**
   * "POST .../archives/:archiveId/verify" — RE-HASHES the bytes actually stored on disk and compares
   * them against the hash recorded at archive time (`archive/persistence.ts#verifyDocumentArchive`'s
   * own header). Never mutates the archive row — even a run that discovers real corruption only
   * REPORTS it, it does not record the verdict anywhere (see `DocumentArchive`'s own "immutable by
   * design" schema comment).
   */
  async verifyDocumentArchive(
    companyId: string,
    typeId: string,
    id: string,
    archiveId: string,
  ): Promise<ArchiveVerificationResult> {
    await findOwnedDocument(companyId, typeId, id);
    return verifyDocumentArchive(companyId, id, archiveId);
  }

  /**
   * "GET .../authority-events" — root TODO item 10's own named remainder (post-deposit conformity
   * tracking, `conformity/`). Every event journaled for this document, most recent first — see
   * `DocumentAuthorityEvent`'s own schema comment for why this is a plain read of an append-only log,
   * never a computed "current status". `findOwnedDocument` first, the same tenant/existence check
   * every other per-document read in this class already runs.
   */
  async listAuthorityEvents(
    companyId: string,
    typeId: string,
    id: string,
  ): Promise<DocumentAuthorityEventResult[]> {
    await findOwnedDocument(companyId, typeId, id);
    return listAuthorityEvents(companyId, id);
  }
}
