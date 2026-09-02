import { BadRequestException, NotImplementedException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import { decimalsFor, toMinor } from '@/utils/financial';

import {
  B2gClientRoutingDecision,
  B2gRoutingRuleView,
  resolveClientB2gRouting,
} from '../b2g-routing/b2g-routing';
import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { findOwnedDocument } from '../persistence';
import { DocumentEventPublisher } from '../queue/document-events';
import { DocumentActionQueueDispatcher } from '../queue/queue.constants';
import { computeSettlement, describeSettlement } from '../settlement/compute-settlement';
import { resolveCreditsForDocument, toSettlementCreditInputs } from '../settlement/credits';
import { listPayments, recordPayment } from '../settlement/payments';
import { isInvoiceTaxBlockError } from '../tax/resolve-invoice-tax';
import { resolveInvoiceCrossBorderTaxForCompany } from '../tax/load-and-resolve';
import { computeDocumentTotals } from '../totals/compute-totals';
import { ActiveChannelMandate, activeChannelMandateFor } from '../transports/channel-policy/mandate';
import { getCompanyInvoiceTransportId } from '../transports/company-transport';
import {
  DocumentTransport,
  TransportRegistry,
  UnknownTransportError,
} from '../transports/transport-registry';
import { runAsyncSendAction } from './async-send';
import { ActionRegistry } from './action-registry';
import { registerSaveDraftAction } from './generic-actions';

export interface InvoiceActionDeps {
  transportRegistry: TransportRegistry;
  queueDispatcher: DocumentActionQueueDispatcher;
  /** TODO_PRODUIT.md T1 / PLAN-V2 R8 — see `async-send.ts`'s own `RunAsyncSendInput.events` header. */
  events?: DocumentEventPublisher;
}

/**
 * Root TODO item 11, "canal imposé par pays" — resolves the issuing company's own COUNTRY and asks
 * whether it MANDATES a channel for an invoice issued on `issueDate` (`channel-policy/mandate.ts`,
 * evaluated against the invoice's own issue date, never the server's clock — see that file's own
 * header). Undefined for the overwhelming majority of companies today (only FR/pdp ships a mandate,
 * see `channel-policy/data/fr.json`) and for any company whose country cannot even be resolved —
 * exactly the same "no permissive fallback, but also no invented block" posture
 * `country-policy.ts`'s own `resolveCompanyCountryCode` callers already hold elsewhere in this module.
 */
async function resolveActiveInvoiceMandate(
  companyId: string,
  issueDate: string | undefined,
): Promise<{ countryCode: string; mandate: ActiveChannelMandate } | undefined> {
  const countryCode = await resolveCompanyCountryCode(companyId);
  if (!countryCode) return undefined;
  const mandate = activeChannelMandateFor(countryCode, issueDate);
  return mandate ? { countryCode, mandate } : undefined;
}

/** `${sourceText} (checked ${date})` — the one line every mandate-refusal message below reuses so the
 *  SOURCE is always named, never just the channel's id (see root TODO item 11's own task brief: "un
 *  message qui nomme le canal imposé, LA SOURCE de la règle, et ce qu'il faut faire"). */
function describeMandateSource(mandate: ActiveChannelMandate): string {
  return `"${mandate.provenance.sourceText}" (checked ${mandate.provenance.sourceCheckedAt})`;
}

/**
 * B2G routing (`b2g-routing/`) — a client marked GOVERNMENT (`Client.kind`) changes which channel an
 * invoice addressed to it must use, per THAT CLIENT's OWN country — never the seller's. This is a
 * DIFFERENT axis from root TODO item 11's own seller-country mandate just above: item 11 asks "does
 * the ISSUING COMPANY's country force a channel on every invoice it sends"; B2G routing asks "does
 * the RECIPIENT's status as a public body, in ITS OWN country, force a channel on THIS ONE invoice".
 *
 * ## PRECEDENCE — the exact reason this check runs FIRST in `resolveInvoiceTransport`, before the
 * seller-country mandate is even consulted
 *
 * A B2G rule, once it applies, decides the WHOLE question by itself — it does not merely add one more
 * constraint on top of the seller-country mandate or the company's free choice, it REPLACES them for
 * this invoice: `resolveClientB2gRouting`'s own `applies: true` short-circuits `resolveInvoiceTransport`
 * below entirely, so `activeChannelMandateFor` (item 11) is never even called for a government client,
 * regardless of what the ISSUING company's own country would otherwise mandate. This is deliberate,
 * not an oversight: a B2G obligation is a regime of the DESTINATION (directive 2014/55/UE itself binds
 * the RECEIVING contracting authority, never the seller's own country — see `b2g-routing/data/fr.json`'s
 * own EU-baseline note), so a French seller invoicing a German public body follows GERMANY's B2G rule,
 * never France's own seller-country PDP mandate, even though that seller would otherwise be bound by
 * it for every OTHER invoice it sends. Precedence, in order: (1) a B2G rule for the CLIENT's country,
 * when the client is GOVERNMENT; (2) failing that, the SELLER's own country mandate (item 11); (3)
 * failing that, the company's free transport choice. A BUSINESS client (the default, and every client
 * that predates this mechanism) sees NO change at all — `resolveClientB2gRouting` returns
 * `applies: false` and every line below this comment runs exactly as it did before this task.
 *
 * ## The three outcomes `resolveB2gInvoiceTransport` below can reach, all HONEST, never a silent B2B
 * fallback (the task's own explicit red line: "le mauvais canal vers un gouvernement est pire qu'un
 * blocage")
 *
 *  - the client's own country cannot be resolved to an ISO code at all → refused, naming the client
 *    and asking for an explicit country code;
 *  - the country resolves but has NO B2G rule declared (`b2g-routing/data/` has no file for it) →
 *    refused, naming the country and where to add one — never silently treated as an ordinary B2B
 *    send;
 *  - a rule exists: its `requiredClientIdentifiers` (e.g. a French SIRET) are checked against the
 *    client's own `PartyIdentifier`s FIRST — missing one refuses, naming the exact identifier, the
 *    screen to fill it in (the client's own edit form), and the rule's own sourced `why`; then its
 *    `requiredDocumentFields` marked `required: true` (e.g. Germany's Leitweg-ID, carried generically
 *    as `data.buyerReference`) are checked against THIS invoice's own submitted fields, same refusal
 *    shape; only once both pass is `rule.transportId` actually resolved against the live registry —
 *    a rule naming a channel not yet implemented (`"chorus-pro"`, `"zre-ozgre"` — see each shipped
 *    file's own header for why that is this model's own thesis, not a gap) refuses too, naming
 *    exactly that channel and citing the rule's own source.
 */
function b2gUnresolvedCountryMessage(decision: B2gClientRoutingDecision): string {
  return (
    'This client is marked as a government body, but its own country could not be resolved to a ' +
    `recognized ISO 3166-1 code ("${decision.clientCountryRaw ?? 'unknown'}") — set an explicit ` +
    'country code on the client (Clients → this client → Country) before sending it an invoice.'
  );
}

function b2gNoRuleMessage(decision: B2gClientRoutingDecision): string {
  return (
    `No B2G routing rule is declared for "${decision.countryCode}" — sending an invoice to a public-` +
    'sector body in this country is not covered yet. To unblock it, add ' +
    `backend/src/modules/documents/b2g-routing/data/${decision.countryCode!.toLowerCase()}.json ` +
    '(see fr.json/de.json/it.json in that directory for the format) and restart the backend so the ' +
    'boot upsert picks it up.'
  );
}

function b2gMissingIdentifierMessage(countryCode: string, rule: B2gRoutingRuleView, scheme: string): string {
  const requirement = rule.requiredClientIdentifiers.find((r) => r.scheme === scheme)!;
  return (
    `${countryCode} requires this government client to have a "${requirement.label}" ` +
    `(${requirement.scheme}) on file before an invoice can be sent to it — ${requirement.why} Add it ` +
    "on the client's own edit screen (Clients → this client → country-specific identifiers) before " +
    'sending.'
  );
}

function b2gMissingFieldMessage(
  countryCode: string,
  field: B2gRoutingRuleView['requiredDocumentFields'][number],
): string {
  return (
    `${countryCode} requires "${field.label}" on this invoice before it can be sent to a government ` +
    `client — ${field.why} Fill it in on the invoice form before sending.`
  );
}

function b2gTransportNotAvailableMessage(countryCode: string, rule: B2gRoutingRuleView): string {
  return (
    `${countryCode} routes invoices to government bodies through the "${rule.transportId}" channel — ` +
    `${rule.provenanceDescription}. That channel is not available in this deployment yet, so sending ` +
    'this invoice is blocked until it is — this is a known, named gap, never a silent fallback to ' +
    'another channel.'
  );
}

function b2gChannelNotReadyMessage(
  countryCode: string,
  rule: B2gRoutingRuleView,
  underlyingMessage: string,
): string {
  return (
    `${countryCode} routes invoices to government bodies through the "${rule.transportId}" channel — ` +
    `${rule.provenanceDescription}. This company already has "${rule.transportId}" available, but it ` +
    `is not ready yet: ${underlyingMessage}`
  );
}

function hasValue(value: unknown): boolean {
  return typeof value === 'string' ? value.trim() !== '' : value != null;
}

/**
 * The B2G half of `resolveInvoiceTransport` — see this file's own header just above for the full
 * precedence reasoning. Returns the transport a B2G rule FORCES, having already checked every
 * required client identifier and required document field; throws the exact named refusal otherwise.
 * `data` is the invoice's OWN submitted fields (needed only to check `requiredDocumentFields`) — may
 * be `undefined` at call sites that have no document data on hand yet (none today, but never assumed).
 */
/**
 * What `resolveInvoiceTransport` hands back — the transport to use, PLUS an optional `formatOverride`
 * forwarded verbatim onto `DocumentTransportContext` at the `deliver()` call site
 * (`transport-registry.ts`'s own header for the full contract). Only `resolveB2gInvoiceTransport`
 * below ever sets `formatOverride` (to `rule.formatSyntax`) — the seller-country mandate and the
 * company's own free-choice paths never do, since neither carries a per-invoice format decision of
 * its own the way a B2G rule does.
 */
interface ResolvedInvoiceTransport {
  transport: DocumentTransport;
  formatOverride?: string;
}

function resolveB2gInvoiceTransport(
  transportRegistry: TransportRegistry,
  decision: B2gClientRoutingDecision,
  data: Record<string, unknown> | undefined,
): ResolvedInvoiceTransport {
  if (!decision.rule) {
    logger.warn('Invoice "send" blocked: B2G client with no usable routing rule', {
      category: 'documents',
      details: { countryCode: decision.countryCode, clientCountryRaw: decision.clientCountryRaw },
    });
    throw new NotImplementedException(
      decision.countryCode ? b2gNoRuleMessage(decision) : b2gUnresolvedCountryMessage(decision),
    );
  }

  const rule = decision.rule;
  const countryCode = decision.countryCode!;

  if (decision.missingIdentifierSchemes.length > 0) {
    throw new BadRequestException(
      b2gMissingIdentifierMessage(countryCode, rule, decision.missingIdentifierSchemes[0]),
    );
  }

  const missingField = rule.requiredDocumentFields.find(
    (field) => field.required && !hasValue(data?.[field.field]),
  );
  if (missingField) {
    throw new BadRequestException(b2gMissingFieldMessage(countryCode, missingField));
  }

  try {
    // `formatOverride: rule.formatSyntax` — ALWAYS set here, regardless of which transport the rule
    // names: a fixed-format transport (chorus-pro/facturx, sdi/fatturapa, face/facturae, anaf/ubl)
    // never reads it at all, so setting it is inert for those (see `transport-registry.ts`'s own
    // header); "peppol" is the one transport today that DOES honor it, for Germany's own rule
    // (`b2g-routing/data/de.json`, `formatSyntax: "xrechnung"`) — see `peppol-transport.ts`'s own
    // header, "THE FORMAT OVERRIDE".
    return { transport: transportRegistry.resolve(rule.transportId), formatOverride: rule.formatSyntax };
  } catch (error) {
    if (error instanceof UnknownTransportError) {
      logger.warn('Invoice "send" blocked: B2G channel not implemented in this deployment', {
        category: 'documents',
        details: { countryCode, transportId: rule.transportId },
      });
      throw new NotImplementedException(b2gTransportNotAvailableMessage(countryCode, rule));
    }
    throw error;
  }
}

/** The company's configured transport is anything OTHER than the mandated one (including nothing
 *  configured at all) — see `resolveInvoiceTransport`'s own call site below. */
function mandateOverridesTransportMessage(
  countryCode: string,
  mandate: ActiveChannelMandate,
  configuredTransportId: string | null,
): string {
  const configuredClause = configuredTransportId
    ? `This company is currently configured to send invoices via "${configuredTransportId}"`
    : 'No transport is configured for this company';
  return (
    `${countryCode} requires invoices issued on or after ${mandate.mandatedFrom} to go through the ` +
    `"${mandate.providerId}" channel — ${describeMandateSource(mandate)}. ${configuredClause}. ` +
    `Connect "${mandate.providerId}" in company settings (Channels) and choose it as the invoice ` +
    'transport before sending.'
  );
}

/** The company already chose the mandated channel, but ITS OWN preflight (e.g. "PDP channel is not
 *  connected") refused — see `runInvoiceSendPreflight` below. `underlyingMessage` is that transport's
 *  own error text, folded in rather than replaced: the mandate context explains WHY this channel is
 *  non-negotiable, the transport's own message explains WHAT to fix about it. */
function mandateChannelNotReadyMessage(
  countryCode: string,
  mandate: ActiveChannelMandate,
  underlyingMessage: string,
): string {
  return (
    `${countryCode} requires invoices issued on or after ${mandate.mandatedFrom} to go through the ` +
    `"${mandate.providerId}" channel — ${describeMandateSource(mandate)}. This company already chose ` +
    `"${mandate.providerId}" as its invoice transport, but it is not ready yet: ${underlyingMessage}`
  );
}

/**
 * Resolves the ISSUING COMPANY's own configured transport, or throws the exact 501 this action
 * always has for "no transport" / "an unknown one" — shared between the two moments this now runs at
 * (see `registerInvoiceActions`'s own header): the phase-1 PREFLIGHT check (so a doomed send is
 * refused before anything is persisted or queued, never a job enqueued only to fail immediately) and
 * `deliver()` itself (re-resolved there too — the company's configuration could have changed between
 * the two calls, which a job replayed later must still honor, not a value cached from the first one).
 *
 * Root TODO item 11 adds ONE more check, BEFORE the company's own free choice is even consulted: does
 * the company's country MANDATE a different channel for an invoice issued on `issueDate`? A mandate,
 * once active, overrides `Company.invoiceTransportId` entirely — `transport-registry.ts`'s own header
 * ("nothing here... ever hard-codes which transport a company should use") still holds for every
 * country with NO mandate (the overwhelming majority today), but a country that DOES mandate a
 * channel has, by construction, already made that choice FOR the company; letting a mismatched
 * `invoiceTransportId` silently win would mean this product believed it did exactly what the company
 * asked while quietly sending a legally non-compliant invoice.
 *
 * B2G routing (`b2g-routing/`, see this file's own header just above `resolveB2gInvoiceTransport`)
 * adds a check that runs BEFORE even this one: when the invoice's `clientId` names a GOVERNMENT
 * client, `resolveClientB2gRouting` short-circuits this whole function — the seller-country mandate
 * below is never consulted at all for that invoice, precedence documented in full at this file's own
 * B2G section header.
 */
async function resolveInvoiceTransport(
  transportRegistry: TransportRegistry,
  companyId: string,
  issueDate: string | undefined,
  clientId: string | undefined,
  data: Record<string, unknown> | undefined,
): Promise<ResolvedInvoiceTransport> {
  const b2g = await resolveClientB2gRouting(companyId, clientId);
  if (b2g.applies) {
    return resolveB2gInvoiceTransport(transportRegistry, b2g, data);
  }

  const transportId = await getCompanyInvoiceTransportId(companyId);

  const activeMandate = await resolveActiveInvoiceMandate(companyId, issueDate);
  if (activeMandate && transportId !== activeMandate.mandate.providerId) {
    logger.warn('Invoice "send" blocked: overridden by a country channel mandate', {
      category: 'documents',
      details: {
        companyId,
        countryCode: activeMandate.countryCode,
        mandatedProviderId: activeMandate.mandate.providerId,
        configuredTransportId: transportId,
      },
    });
    throw new NotImplementedException(
      mandateOverridesTransportMessage(activeMandate.countryCode, activeMandate.mandate, transportId),
    );
  }

  if (!transportId) {
    logger.warn('Invoice "send" blocked: no transport configured for this company', {
      category: 'documents',
      details: { companyId },
    });
    throw new NotImplementedException(
      'No transport is configured for this company to send an invoice. ' +
        'Configure one in company settings before sending — there is no default channel.',
    );
  }

  try {
    // No `formatOverride` on this path — neither the seller-country mandate nor the company's own
    // free choice carries a per-invoice format decision the way a B2G rule does (see
    // `ResolvedInvoiceTransport`'s own header).
    return { transport: transportRegistry.resolve(transportId) };
  } catch (error) {
    if (error instanceof UnknownTransportError) {
      throw new NotImplementedException(
        `The transport "${transportId}" configured for this company is not available. ` +
          'Choose a different one in company settings before sending.',
      );
    }
    throw error;
  }
}

/**
 * The "send" action's OWN preflight closure — resolves the transport (mandate-aware, see
 * `resolveInvoiceTransport` above) and then runs that transport's OWN readiness check
 * (`DocumentTransport.preflight`, e.g. "are PDP credentials actually connected"). When a country
 * mandate is active and the company already chose the mandated channel but that channel itself is
 * not ready, the transport's own error (already loud, already named) is re-thrown WITH the mandate's
 * own context folded in — "le canal imposé non connecté → même refus nommé" (root TODO item 11's own
 * task brief): the refusal still names the channel, still names the source, still says what to do,
 * exactly like the "wrong transport entirely" case above, not a bare "not connected" with no country
 * context attached.
 */
async function runInvoiceSendPreflight(
  transportRegistry: TransportRegistry,
  companyId: string,
  issueDate: string | undefined,
  clientId: string | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const { transport } = await resolveInvoiceTransport(
    transportRegistry,
    companyId,
    issueDate,
    clientId,
    data,
  );
  try {
    await transport.preflight?.(companyId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // B2G routing takes precedence over the seller-country mandate here too — see this file's own
    // B2G section header. Checked FIRST, same order as `resolveInvoiceTransport` above.
    const b2g = await resolveClientB2gRouting(companyId, clientId);
    if (b2g.applies && b2g.rule) {
      throw new NotImplementedException(b2gChannelNotReadyMessage(b2g.countryCode!, b2g.rule, message));
    }

    const activeMandate = await resolveActiveInvoiceMandate(companyId, issueDate);
    if (activeMandate) {
      throw new NotImplementedException(
        mandateChannelNotReadyMessage(activeMandate.countryCode, activeMandate.mandate, message),
      );
    }
    throw error;
  }
}

/**
 * Root TODO item 16 ("transfrontalier") — runs at the EXACT SAME moment as the transport/mandate
 * checks above: phase-1 preflight, before the record is ever transitioned to "sending" and before
 * anything is numbered or enqueued (see `actions/async-send.ts`'s own header).
 *
 * ## The principle (carried over from the pre-refonte compliance engine)
 *
 * Fiscal treatment is re-resolved AT ISSUANCE, and the document that is ISSUED **is** the resolved
 * document — never the raw draft. The draft was the user's own entry (whatever `vatRate` they typed
 * or picked); the instant it leaves "draft" (or "send_failed") and enters "sending" it becomes a
 * legal fact, and that fact must be the RESOLVED one: what the buyer receives, what the archive
 * keeps, and what `computeDocumentTotals`/the settlement balance/the dashboard's "pending" total all
 * read back must be the SAME number, not three different views of "20%" vs. "0%, autoliquidation".
 *
 * Concretely: the RESOLVED `data` this function returns is handed back to `runAsyncSendAction`
 * (`actions/async-send.ts`'s own `preflight` header), which uses it — instead of the raw submission —
 * for the "sending" write AND the enqueued job payload. Only the HARD BLOCKS
 * (`resolve-invoice-tax.ts`'s own named errors — an unresolved buyer country, an uncatalogued OSS
 * destination, a rate foreign to the seller's own country) can stop a send here; nothing here is
 * discarded any more.
 *
 * `deliver()` below STILL re-resolves, on the exact same (already-resolved) `data` this produced —
 * deliberately: a worker can replay `deliver()` seconds or minutes after this ran, and the company's
 * transport/client data could have changed in that gap. Re-resolving an ALREADY-resolved cross-border
 * line must be — and is — perfectly stable (`resolve-invoice-tax.ts` never reads a line's existing
 * `vatRate` to decide the cross-border treatment, only `supplyType` plus the seller/buyer identity —
 * see that file's own idempotence proof, `resolve-invoice-tax.spec.ts`), which is what makes doing
 * it twice safe rather than a second chance to silently drift from what was just persisted.
 */
async function runInvoiceCrossBorderTaxPreflight(
  companyId: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    return (await resolveInvoiceCrossBorderTaxForCompany(companyId, data)).data;
  } catch (error) {
    if (isInvoiceTaxBlockError(error)) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/**
 * The invoice's OWN base descriptor, imported directly here rather than resolved through
 * `DocumentTypeRegistry` — deliberate, and only defensible because this file is ALREADY 100%
 * invoice-specific (every handler below hardcodes `'invoice'` as the typeId; unlike
 * generic-actions.ts, nothing here is meant to be reused by another type). It exists purely to feed
 * `computeDocumentTotals` the field SHAPE it needs to find the invoice's own `lines`/`currency` —
 * exactly the same shape `documents.service.ts`'s own `computeTotals` endpoint already uses (that one
 * reads the MERGED descriptor — native + third-party action extensions — which never touches invoice
 * FIELDS either, so this is no less faithful). Country field overlays are a no-op for every shipped
 * country today (country-fields/data/all.ts ships none) — the day one exists for the invoice, this is
 * the one spot that would need to start asking `DocumentTypeRegistry` instead.
 */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

/**
 * Registers the invoice type's action IMPLEMENTATIONS. "save-draft" is the exact same generic
 * mechanism the quote uses (generic-actions.ts) — persisting a draft's field values has nothing to do
 * with WHERE the document eventually travels, so sharing it is correct, unlike "send" below.
 *
 * "send" is DELIBERATELY NOT the quote's own send-by-email mechanism (quote-actions.ts) — an
 * invoice's transport is a fact about the ISSUING COMPANY, never about the invoice's country or the
 * buyer's: `resolveInvoiceTransport` above reads `Company.invoiceTransportId` and asks
 * TransportRegistry for whatever the company chose. Two outcomes are deliberately treated as the SAME
 * kind of failure as an action with no implementation at all (a clear 501, never a silent fallback to
 * email or anywhere else):
 *  - the company has not configured a transport yet (`invoiceTransportId` is null/empty);
 *  - the company configured one that is no longer registered (a plugin was removed, a typo).
 * Both cases mean "this invoice cannot actually be sent right now", which is exactly what 501 means
 * elsewhere in this module — see documents.service.ts's own NotImplementedException for an action
 * genuinely missing a handler. This handler IS registered (so DocumentsService finds it and validates
 * `data` before calling it); the block happens once inside it, deliberately worded so a user reads
 * WHY, the same discipline "export-accounting" now keeps proving for an action with no handler at all
 * (see invoice.descriptor.ts's own header — that role used to belong to "record-payment").
 *
 * As of TODO.md item 22, "send" is ASYNCHRONOUS — built on `runAsyncSendAction` (actions/async-send.ts),
 * the same two-phase engine the quote's and the credit note's own "send" use. The transport check
 * above becomes this action's `preflight`: it still runs BEFORE the record ever moves to "sending" and
 * BEFORE anything is queued, so an unconfigured company still gets an immediate 501 with nothing
 * persisted — exactly the behavior this action had before it became asynchronous. `deliver()`
 * re-resolves the transport rather than closing over the preflight's result: the two calls can be
 * seconds (or, after a retry, much longer) apart, and a job replayed later must honor whatever the
 * company's configuration says AT THAT TIME, not a value cached from when it was first enqueued.
 *
 * Root TODO item 11 ("canal imposé par pays") folds one more gate into this SAME preflight: a country
 * can now MANDATE a channel (`transports/channel-policy/data/*.json`, `requirement: 'mandated'`), not
 * merely suggest one — see `resolveInvoiceTransport`'s own header for how that overrides the
 * company's free choice once active, and `channel-policy/mandate.ts`'s header for why "active" is
 * decided by the INVOICE's own `issueDate`, never the server's clock. A country with no mandate (the
 * overwhelming majority — only FR/pdp ships one today) sees no behavior change at all.
 *
 * "record-payment" IS registered below — see its own comment for the currency/amount guards and what
 * it hands back. "export-accounting" stays declared on the descriptor (invoice.descriptor.ts) and
 * deliberately NOT registered here: a real accounting export needs a chart-of-accounts mapping and a
 * ledger format this branch does not build, the same discipline "record-payment" used to hold before
 * this task, and "convert-to-invoice" held the quote to before IT was implemented (see
 * quote-actions.ts) — this is now the live case documents.service.invoice.spec.ts proves the 501
 * mechanism against.
 */
export function registerInvoiceActions(registry: ActionRegistry, deps: InvoiceActionDeps): void {
  registerSaveDraftAction(registry, 'invoice');

  registry.register('invoice', 'send', async ({ companyId, documentId, data, params }) =>
    runAsyncSendAction({
      companyId,
      typeId: 'invoice',
      documentId,
      data,
      params,
      queueDispatcher: deps.queueDispatcher,
      events: deps.events,
      numberOnEnqueue: true, // invoice.descriptor.ts: numbering.onEnterStatus === 'sending'
      // Root TODO item 11: the country-mandate check runs as part of THIS preflight — see
      // `runInvoiceSendPreflight`'s own header. `data.issueDate` is the submitted field value at
      // ENQUEUE time; `descriptors/invoice.descriptor.ts` requires it, so by the time "send" can even
      // run the record already has one (validated at "save-draft").
      preflight: async () => {
        const issueDate = typeof data.issueDate === 'string' ? data.issueDate : undefined;
        const clientId = typeof data.client === 'string' ? data.client : undefined;
        await runInvoiceSendPreflight(deps.transportRegistry, companyId, issueDate, clientId, data);
        // Root TODO item 16 — see `runInvoiceCrossBorderTaxPreflight`'s own header. RETURNED (never
        // discarded): `runAsyncSendAction` persists exactly this as the "sending" document's own
        // `data`, so the record that just left "draft" already carries the resolved treatment, not
        // the user's raw entry.
        return runInvoiceCrossBorderTaxPreflight(companyId, data);
      },
      // No pre-built `text` here — the "email" transport (transports/email-transport.ts) composes
      // its own subject/body from invoice.descriptor.ts's `email` template (or a company override)
      // and attaches the PDF itself; see that file's own header and actions/send-document-email.ts
      // for the shared "compose + attach + send" mechanics. A hypothetical transport that still wants
      // plain text is free to build its own from `document`.
      //
      // `deliver`'s own `data` is the SAME value the enqueue call captured (`async-send.ts`'s own
      // header: "the retry IS the action itself"), never re-read from the database — the mandate this
      // re-resolves must judge the SAME issueDate the preflight already judged, not whatever the
      // document happens to hold by the time a worker gets to it. Since root TODO item 16, `data` here
      // is ALREADY the resolved value the preflight persisted (see `runInvoiceCrossBorderTaxPreflight`'s
      // own header) — resolving it again below is deliberately safe, not merely harmless: the ONLY
      // reachable-here-but-not-at-preflight case is a client/transport reconfiguration in the gap
      // between the two calls, which must still be judged fresh.
      deliver: async ({ companyId: c, document, data: deliverData }) => {
        const issueDate = typeof deliverData.issueDate === 'string' ? deliverData.issueDate : undefined;
        const clientId = typeof deliverData.client === 'string' ? deliverData.client : undefined;
        const { transport, formatOverride } = await resolveInvoiceTransport(
          deps.transportRegistry,
          c,
          issueDate,
          clientId,
          deliverData,
        );
        // Root TODO item 16 — RECOMPUTED here (never a value cached from the preflight call above,
        // same discipline `resolveInvoiceTransport`'s own re-resolution already holds): every
        // transport (email/pdp/ksef/sdi) reads `ctx.document.data` generically, so rewriting it HERE,
        // once, is what makes the PDF attached, the CII/UBL/Factur-X/FA(3)/FatturaPA exports built
        // from it, and the archived artefact all agree on the RESOLVED cross-border treatment — never
        // the originally-typed domestic-looking rate. A block reachable only here (never at
        // preflight — e.g. a client's country changed between the two calls) still fails loud, never
        // silently reverting to the stored rate. Re-resolving `deliverData` here even though it is
        // ALREADY resolved is exactly the idempotence `resolve-invoice-tax.ts` guarantees (it decides
        // the cross-border treatment from `supplyType` + seller/buyer identity, never from a line's
        // existing `vatRate`) — see `resolve-invoice-tax.spec.ts`'s own idempotence proof.
        let resolvedData = deliverData;
        try {
          resolvedData = (await resolveInvoiceCrossBorderTaxForCompany(c, deliverData)).data;
        } catch (error) {
          if (isInvoiceTaxBlockError(error)) throw new BadRequestException(error.message);
          throw error;
        }
        const documentForDelivery =
          resolvedData === deliverData ? document : { ...document, data: resolvedData };
        // `formatOverride` — see `ResolvedInvoiceTransport`'s own header and `transport-registry.ts`'s
        // own header: forwarded VERBATIM, exactly as the B2G rule (if any) named it, never invented or
        // adjusted here. Every transport except "peppol" ignores it entirely.
        return transport.send({
          companyId: c,
          document: documentForDelivery,
          label: 'Invoice',
          formatOverride,
        });
      },
    }),
  );

  // "recipient" defaults from the client (registerEmailRecipientDefaultFromClient, quote-actions.ts)
  // is the model for this: a best-effort pre-fill, read from the CURRENT record, never required for
  // the action to be usable at all (a resolver failing to run still opens the dialog, just empty).
  // Here it pre-fills `paidAt` with TODAY and `currency` with the invoice's OWN currency — the second
  // one is not a declared `param` a user fills in from nothing, it is what makes the `amount` field's
  // `currencyField: 'currency'` (invoice.descriptor.ts) show the right symbol from the moment the
  // dialog opens, without the invoice's `data` ever being reachable from the params dialog's own,
  // separate form.
  registry.registerParamsDefaults('invoice', 'record-payment', async ({ companyId, documentId }) => {
    if (!documentId) return {};
    const document = await findOwnedDocument(companyId, 'invoice', documentId);
    const currency = (document.data as Record<string, unknown> | null)?.currency;
    return {
      paidAt: new Date().toISOString(),
      ...(typeof currency === 'string' ? { currency } : {}),
    };
  });

  /**
   * Records a payment against an ALREADY-SENT invoice (availableWhen: ['sent'] — see
   * invoice.descriptor.ts) and hands back the invoice's up-to-date BALANCE. Three guards, in order:
   *  - `amount` must be strictly positive — `min` is deliberately NOT set on the field descriptor
   *    (which would only ever enforce `>= 0`, letting a bare 0 through as "structurally valid"); this
   *    handler is the one place that enforces the actual business rule, with one clear message;
   *  - `currency` must equal the invoice's own — no conversion (see this file's own header, and
   *    compute-settlement.ts's header on why a payment never silently changes the claim's own
   *    currency). Read off the PERSISTED document (`findOwnedDocument`), never the client-submitted
   *    `data`: the params-defaults resolver above pre-fills the params dialog's `currency` from the
   *    same source, but nothing stops a scripted client from posting a different one directly — the
   *    same "the API refuses exactly what the screen would refuse" discipline documents.service.ts's
   *    own `runAction` holds for country policy and status.
   *  - implicitly, `documentId` must exist: unreachable in practice (a never-saved record has no
   *    status for `availableWhen: ['sent']` to match) but never trusted alone — the same defensive
   *    posture "delete" (generic-actions.ts) already holds for the same shape of guarantee.
   *
   * Deliberately does NOT call `upsertDocument`: a payment does not change the invoice's own field
   * values or status (see invoice.descriptor.ts's lifecycle comment on why no `transitions` are
   * declared here) — `result.document` is the SAME, unchanged, freshly-read instance, which is also
   * exactly what `checkTransitionResult` (lifecycle.ts) expects for an action with no declared
   * transitions: whatever status it already was.
   */
  registry.register('invoice', 'record-payment', async ({ companyId, documentId, params }) => {
    if (!documentId) {
      throw new Error('Cannot record a payment on an invoice that has not been saved yet.');
    }

    const document = await findOwnedDocument(companyId, 'invoice', documentId);
    const documentData = (document.data ?? {}) as Record<string, unknown>;
    const documentCurrency = typeof documentData.currency === 'string' ? documentData.currency : undefined;
    if (!documentCurrency) {
      throw new BadRequestException(
        `Invoice "${documentId}" has no currency recorded — cannot record a payment against it.`,
      );
    }

    const amount = params.amount as number; // already proven a finite number by the 'money' kind.
    if (!(amount > 0)) {
      throw new BadRequestException('The payment amount must be greater than zero.');
    }

    const paymentCurrency = typeof params.currency === 'string' ? params.currency : documentCurrency;
    if (paymentCurrency !== documentCurrency) {
      throw new BadRequestException(
        `The payment currency ("${paymentCurrency}") does not match this invoice's own currency ` +
          `("${documentCurrency}") — recording a payment in a different currency isn't supported yet.`,
      );
    }

    const paidAt = typeof params.paidAt === 'string' ? new Date(params.paidAt) : new Date();
    const method = typeof params.method === 'string' ? params.method : undefined;
    const note = typeof params.note === 'string' ? params.note : undefined;

    await recordPayment({
      companyId,
      documentId,
      amountMinor: toMinor(amount, documentCurrency),
      currency: documentCurrency,
      method,
      paidAt,
      note,
    });

    const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, documentData);
    const payments = await listPayments(companyId, documentId);
    // CREDITS count towards this same balance (item 8, "le lettrage") — resolved here too, not just
    // in documents.service.ts's own GET .../settlement, so the balance THIS message states (and the
    // "settled" fact logged below) never contradicts what a follow-up read of the settlement screen
    // shows: an invoice already partly credited before this payment must not be reported as owing
    // more than it actually does.
    const { credits } = await resolveCreditsForDocument(
      companyId,
      'invoice',
      documentId,
      INVOICE_DESCRIPTOR,
      documentData,
    );
    const settlement = computeSettlement(totals.grossMinor, payments, toSettlementCreditInputs(credits));

    logger.info('Payment recorded against an invoice', {
      category: 'documents',
      details: {
        companyId,
        documentId,
        amountMinor: toMinor(amount, documentCurrency),
        currency: documentCurrency,
        decimals: decimalsFor(documentCurrency),
        settled: settlement.settled,
      },
    });

    return {
      document,
      changed: true,
      message: describeSettlement(settlement, documentCurrency),
    };
  });
}
