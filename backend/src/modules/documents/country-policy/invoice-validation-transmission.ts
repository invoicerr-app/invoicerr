/**
 * Issue #581 (owner's decision, 2026-10-01, after PR #602's own review): whether VALIDATING an
 * invoice performs the real transmission through a mandated channel, rather than only numbering and
 * locking it. TWO independent conditions, BOTH required:
 *
 *  1. the invoice's SELLER country declares `CountryDocumentPolicyFile.invoiceValidation` - an
 *     EXPLICIT per-country legal fact (`country-policy/schema.ts`'s own header explains why this is
 *     never inferred from condition 2 alone: a country could plausibly mandate a channel for
 *     ordinary sending while still treating "Validate" as a lesser, numbering-only act - the two are
 *     related but not the same legal question);
 *  2. the operation is actually bound by an ACTIVE channel mandate right now
 *     (`transports/channel-policy/mandate.ts#activeChannelMandateForOperation` - today's own
 *     issue date, this seller, this buyer).
 *
 * This reimplements the SAME mandate lookup `actions/invoice-actions.ts`'s own
 * `resolveActiveInvoiceMandate` already does for "send", DELIBERATELY, rather than importing it:
 * `documents.service.ts` (the generic, type-blind orchestrator) needs this exact decision too, for
 * the "will Validate transmit" read endpoint any action may register
 * (`actions/action-registry.ts#registerTransmissionPreview`), and `documents.service.ts` must never
 * import a specific type's own action-registration file - the same "generic engine, per-type data"
 * layering this whole module already respects everywhere else. `invoice-actions.ts` keeps its own
 * copy for the identical reason in reverse: `country-policy/` must never import FROM `actions/`,
 * which already depends on `country-policy/`. Both copies read the EXACT same two catalogs
 * (`country-policy.ts`'s own `resolveCompanyCountryCode`/`resolveClientCountryCode`,
 * `channel-policy/mandate.ts`'s own `activeChannelMandateForOperation`), so the two can never
 * honestly disagree about whether a mandate is active - only about what each one's own caller goes
 * on to do with that fact (actually send, versus merely preview whether Validate would).
 */
import { resolveClientCountryCode, resolveCompanyCountryCode } from './country-policy';
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from './registry';
import {
  activeChannelMandateForOperation,
  ChannelMandateOperation,
} from '../transports/channel-policy/mandate';
import { ChannelPolicyCatalog, defaultChannelPolicyCatalog } from '../transports/channel-policy/registry';

export interface InvoiceValidationTransmissionDecision {
  /** Whether Validate, for THIS exact operation, performs the real transmission - both conditions in
   *  this file's own header hold. `false` for every invoice this file does not bind, which is the
   *  overwhelming majority: validating stays a plain number-and-lock for them. */
  transmits: boolean;
  /** The channel's plain-English name (`invoiceValidation.channelLabel`, country-policy/schema.ts) -
   *  present only when `transmits` is true. Shown verbatim in the Validate confirmation dialog. */
  channelLabel?: string;
  /** The seller's own resolved country, when one could be resolved at all - handed back even when
   *  `transmits` is false, so a caller that wants to explain WHY (no country resolved, no fact for
   *  this country, no active mandate for this operation) never has to re-resolve it a second time. */
  sellerCountryCode?: string;
}

/**
 * The pure-enough decision (still reads the company/client countries, like every other preflight in
 * this module) - see this file's own header for the two conditions. `policyCatalog`/`channelCatalog`
 * default to the shipped singletons, overridable purely for tests, the same constructor-injection
 * testability `mandate.ts#activeChannelMandateFor`'s own `catalog` parameter already establishes.
 */
export async function resolveInvoiceValidationTransmission(
  companyId: string,
  issueDate: string | undefined,
  clientId: string | undefined,
  policyCatalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
  channelCatalog: ChannelPolicyCatalog = defaultChannelPolicyCatalog,
): Promise<InvoiceValidationTransmissionDecision> {
  const sellerCountryCode = await resolveCompanyCountryCode(companyId);
  if (!sellerCountryCode) return { transmits: false };

  // Condition 1 - checked BEFORE resolving the buyer's own country (a second DB read): a seller
  // country with no `invoiceValidation` fact at all can never transmit on validate, whatever the
  // buyer turns out to be, so there is nothing to gain from the lookup.
  const fact = policyCatalog.invoiceValidationFor(sellerCountryCode);
  if (!fact) return { transmits: false, sellerCountryCode };

  // Condition 2 - the SAME "is this operation bound by an active mandate right now" question "send"
  // itself asks, never a second, possibly-drifting definition of "active".
  const buyerCountryCode = await resolveClientCountryCode(companyId, clientId);
  const operation: ChannelMandateOperation = { sellerCountryCode, buyerCountryCode, issueDate };
  const mandate = activeChannelMandateForOperation(operation, channelCatalog);
  if (!mandate) return { transmits: false, sellerCountryCode };

  return { transmits: true, channelLabel: fact.channelLabel, sellerCountryCode };
}
