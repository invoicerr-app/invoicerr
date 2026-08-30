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

import { ActionExtensionRegistry } from './actions/action-extensions';
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
import { DocumentTypeRegistry, UnknownDocumentTypeError } from './descriptors/type-registry';
import {
  DocumentActionDescriptor,
  DocumentTypeDescriptor,
  isActionAvailable,
  WidgetLocation,
} from './descriptors/types';
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
import { VatRateCatalog } from './vat-rates/registry';
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

/** One action, as `describeTypeForCompany` hands it to the frontend — the plain declared shape PLUS
 *  an optional, country-policy-derived reason it is currently blocked. See that method's own doc
 *  comment for why this is a separate VIEW type rather than a change to `DocumentActionDescriptor`
 *  itself. Declared as an `extends`, not an `&` intersection, specifically so the narrower `actions`
 *  array below resolves to THIS element type when a caller reads `.actions` — an intersection of two
 *  differently-elemented array types does not simplify the way an interface override does. */
export interface DocumentActionDescriptorView extends DocumentActionDescriptor {
  policyBlockedReason?: string;
}

export interface DocumentTypeDescriptorView extends Omit<DocumentTypeDescriptor, 'actions'> {
  actions: DocumentActionDescriptorView[];
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
      for (const countryCode of this.countryFieldOverlayCatalog.countries()) {
        applyFieldOverlay(descriptor.fields, this.countryFieldOverlayCatalog.operationsFor(countryCode, id));
      }
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
    return collectWidgets({
      companyId,
      location,
      typeRegistry: this.typeRegistry,
      contributionRegistry: this.contributionRegistry,
    });
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
        return decision.allowed ? action : { ...action, policyBlockedReason: decision.reason };
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
   *  - action declared but not available for the record's current status -> 409
   *  - action declared, available, but no implementation registered -> 501, clearly worded
   *  - document data or the action's own params don't match their descriptors -> 400, per-field
   *
   * This is the ONLY place an action actually runs — the HTTP controller has no other route that
   * reaches an ActionHandler — so this check is what makes "what the screen refuses, the API
   * refuses" true by construction rather than by the frontend and backend happening to agree: a
   * scripted client hitting this endpoint directly goes through the exact same policy check a click
   * would have.
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
