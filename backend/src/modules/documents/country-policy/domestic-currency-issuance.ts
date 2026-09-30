/**
 * Issue #558 (Algeria): the send-time enforcement of `CountryDocumentPolicyFile
 * .domesticInvoiceCurrency`: a country may require an invoice to be issued in its OWN official
 * currency whenever BOTH the seller and the buyer are established there. Algeria's own Banque
 * d'Algerie reglement n. 07-01, art. 5, is the first sourced example
 * (`data/dz.json`): "Toute facturation ou vente de biens et services sur le territoire douanier
 * national s'effectue en dinars algeriens sauf cas prevus par la reglementation en vigueur.".
 *
 * Deliberately its OWN small file, the same split `vat-currency/vat-currency-issuance.ts` and
 * `transports/channel-policy/mandate.ts` already hold one concern over: the pure "is this domestic,
 * does a rule apply, does the invoice's own currency violate it" logic lives here, independently
 * testable, and `actions/invoice-actions.ts`'s own "send" preflight is the only caller that wires it
 * to an actual company/client/document.
 *
 * WHY THIS BLOCKS OUTRIGHT, UNLIKE `vat-currency/`'s OWN PREFLIGHT: that feature prints a SECOND,
 * converted figure alongside a foreign-currency invoice, so the invoice's own currency is never wrong,
 * only incomplete. This fact is different in kind: a domestic Algerian sale issued in a currency
 * other than DZD is not merely missing a converted figure, it is the invoice itself violating a
 * currency-of-account law. There is nothing to compute or freeze onto the document the way a VAT
 * conversion is; the only honest response is to refuse the send and say so, exactly like
 * `atcud-issuance.ts#ensureAtcudIssuable` refuses BEFORE a sequence number can ever be spent
 * (`numbering/sequence.ts`'s own "never waste a number" header) rather than sending anyway.
 *
 * "DOMESTIC" IS DECIDED THE SAME WAY `transports/channel-policy/mandate.ts`'s OWN
 * `isDomestic`/`activeChannelMandateForOperation` DECIDE IT, not a second, independently-drifting
 * definition: an unresolved buyer country is treated as domestic (fail-CLOSED, the same "we could not
 * tell, so do not let an unknown client silently defeat a currency-of-account law" reasoning that
 * file's own header gives for the identical choice), and a resolved buyer country is compared,
 * case-insensitively, against the seller's own. Unlike a channel mandate, this fact carries no
 * `scope` of its own (`country-policy/schema.ts`'s `DomesticInvoiceCurrencyFact` is unconditional
 * once declared): there is only ever one question to ask, are seller and buyer the same country.
 */
import { BadRequestException } from '@nestjs/common';

import { resolveClientCountryCode, resolveCompanyCountryCode } from './country-policy';
import { CountryPolicyCatalog, defaultCountryPolicyCatalog } from './registry';
import { DomesticInvoiceCurrencyFact } from './schema';

/** Mirrors `transports/channel-policy/mandate.ts`'s own `isDomestic` exactly; see that function's
 *  own header for why an unresolved buyer country is treated as domestic rather than as "we don't
 *  know, so let it through". */
function isDomestic(sellerCountryCode: string, buyerCountryCode: string | undefined): boolean {
  const buyer = (buyerCountryCode ?? '').trim().toUpperCase();
  if (!buyer) return true;
  return buyer === sellerCountryCode.trim().toUpperCase();
}

export interface DomesticInvoiceCurrencyViolation {
  sellerCountryCode: string;
  requiredCurrency: string;
  invoiceCurrency: string;
  fact: DomesticInvoiceCurrencyFact;
}

/**
 * The pure decision: given a seller country, a (possibly unresolved) buyer country, and the
 * invoice's own submitted currency, is there a domestic-currency violation? Returns `undefined` for
 * every case this fact does not bind: no fact declared for the seller's country, or the operation
 * is not domestic, or the invoice's own currency already matches, so a caller never has to
 * re-derive "is this even relevant" on top of this function's own result.
 *
 * `catalog` defaults to the shipped singleton, overridable purely for tests, the same
 * constructor-injection testability `mandate.ts#activeChannelMandateFor`'s own `catalog` parameter
 * already establishes for this exact reason.
 */
export function resolveDomesticInvoiceCurrencyViolation(
  sellerCountryCode: string | undefined,
  buyerCountryCode: string | undefined,
  invoiceCurrency: string | undefined,
  catalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
): DomesticInvoiceCurrencyViolation | undefined {
  if (!sellerCountryCode) return undefined;
  const fact = catalog.domesticInvoiceCurrencyFor(sellerCountryCode);
  if (!fact) return undefined;
  if (!isDomestic(sellerCountryCode, buyerCountryCode)) return undefined;

  const required = fact.currency.trim().toUpperCase();
  const actual = (invoiceCurrency ?? '').trim().toUpperCase();
  // No currency at all on the submitted data is a SEPARATE problem (the descriptor's own "currency"
  // field is required, validated before any action handler runs) - this function only ever refuses a
  // currency it can name as wrong, never a blank one it would have to guess about.
  if (!actual || actual === required) return undefined;

  return {
    sellerCountryCode: sellerCountryCode.trim().toUpperCase(),
    requiredCurrency: required,
    invoiceCurrency: actual,
    fact,
  };
}

/** `documents.controller.ts`'s response body carries this alongside a plain fallback `message` (never
 *  shown in the UI - see below) so the frontend can branch on a stable string the same way
 *  `portal-session.ts`'s own `BILLING_NO_COMPANY_CUSTOMER_CODE` already does for billing. */
export const DOMESTIC_INVOICE_CURRENCY_MISMATCH_CODE = 'DOMESTIC_INVOICE_CURRENCY_MISMATCH';

export interface DomesticInvoiceCurrencyMismatchParams {
  countryCode: string;
  requiredCurrency: string;
  invoiceCurrency: string;
}

/**
 * The raw catalog quote (`fact.provenance.sourceText`/`sourceCheckedAt`) and the bare ISO country
 * code never reach this message: two already-decided product rules (#554, #563) say user-facing text
 * lives in `frontend/src/locales/en/translation.json`, translated, with a country DISPLAY name, not a
 * developer-facing message pasted straight into a toast. This string is only ever a fallback for a
 * non-UI API consumer (a script reading the JSON body directly) or a log line; the frontend branches
 * on `code`/`params` below and renders its own translated copy instead of this `message`.
 */
function describeViolationForApi(violation: DomesticInvoiceCurrencyViolation): string {
  return (
    `Domestic invoices in ${violation.sellerCountryCode} must be issued in ` +
    `${violation.requiredCurrency}. This invoice is set to ${violation.invoiceCurrency}.`
  );
}

/**
 * The "send" preflight gate, see this file's own header. Resolves the seller's and buyer's own
 * countries the identical way `actions/invoice-actions.ts#resolveActiveInvoiceMandate` already does
 * for the channel-mandate check right next to this one in the same preflight chain, then defers the
 * actual decision to `resolveDomesticInvoiceCurrencyViolation` above. A no-op (no throw) for every
 * invoice this fact does not bind - the overwhelming majority, since only a country with a declared
 * `domesticInvoiceCurrency` fact (Algeria today) can ever produce a violation at all.
 */
export async function runDomesticInvoiceCurrencyPreflight(
  companyId: string,
  clientId: string | undefined,
  data: Record<string, unknown>,
  catalog: CountryPolicyCatalog = defaultCountryPolicyCatalog,
): Promise<void> {
  const sellerCountryCode = await resolveCompanyCountryCode(companyId);
  if (!sellerCountryCode) return;
  // Only resolve the buyer's own country (a second DB read) once the seller's own country even HAS
  // a fact to check against - a no-op company/country never pays for a lookup it cannot use.
  if (!catalog.domesticInvoiceCurrencyFor(sellerCountryCode)) return;
  const buyerCountryCode = await resolveClientCountryCode(companyId, clientId);
  const invoiceCurrency = typeof data.currency === 'string' ? data.currency : undefined;
  const violation = resolveDomesticInvoiceCurrencyViolation(
    sellerCountryCode,
    buyerCountryCode,
    invoiceCurrency,
    catalog,
  );
  if (!violation) return;
  const params: DomesticInvoiceCurrencyMismatchParams = {
    countryCode: violation.sellerCountryCode,
    requiredCurrency: violation.requiredCurrency,
    invoiceCurrency: violation.invoiceCurrency,
  };
  throw new BadRequestException({
    message: describeViolationForApi(violation),
    code: DOMESTIC_INVOICE_CURRENCY_MISMATCH_CODE,
    params,
  });
}
