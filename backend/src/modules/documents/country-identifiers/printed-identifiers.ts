import { byCodeUnit } from '@/lib/compare';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { defaultTaxUnionRegistry } from '../tax/tax-unions/registry';
import { defaultCountryIdentifierRequirementsCatalog as catalog } from './registry';
import {
  BuyerEstablishment,
  InvoiceIdentifierCondition,
  InvoiceParty,
  PartyType,
  SellerVatRegime,
} from './schema';

export interface PrintedIdentifier {
  scheme: string;
  /** The party's own country's name for it; absent when that country's catalog has none. */
  label?: string;
  /** `null`: required on this invoice and not filled in. */
  value: string | null;
}

export interface IdentifierValue {
  scheme: string;
  value: string;
}

interface Party {
  countryCode: string | undefined;
  identifiers: readonly IdentifierValue[];
}

export interface PrintedPartyIdentifiersInput {
  seller: Party & { vatRegime: SellerVatRegime };
  buyer?: Party & { type: PartyType; vatRegistered?: boolean };
  /** Whether identifiers the seller's country requires on this invoice are listed even when empty. */
  includeMissingRequired: boolean;
}

export interface PrintedPartyIdentifiers {
  seller: PrintedIdentifier[];
  buyer: PrintedIdentifier[];
}

interface InvoiceContext {
  sellerVatRegime: SellerVatRegime;
  buyerType?: PartyType;
  buyerEstablishment?: BuyerEstablishment;
  buyerVatRegistered?: boolean;
}

const normalize = (countryCode: string | undefined) => countryCode?.trim().toUpperCase() || undefined;

/** Unknown only when a country is missing: a known foreign buyer outside the seller's union is `NON_UNION`. */
export function buyerEstablishmentOf(
  seller: string | undefined,
  buyer: string | undefined,
): BuyerEstablishment | undefined {
  if (!seller || !buyer) return undefined;
  if (seller === buyer) return 'DOMESTIC';
  const union = defaultTaxUnionRegistry.taxUnionOf(seller);
  return union && union === defaultTaxUnionRegistry.taxUnionOf(buyer) ? 'OTHER_UNION_MEMBER' : 'NON_UNION';
}

function axisMatches<T>(allowed: readonly T[] | undefined, actual: T | undefined): boolean {
  return !allowed || (actual !== undefined && allowed.includes(actual));
}

function conditionHolds(condition: InvoiceIdentifierCondition | undefined, context: InvoiceContext): boolean {
  return (
    axisMatches(condition?.sellerVatRegime, context.sellerVatRegime) &&
    axisMatches(condition?.buyerType, context.buyerType) &&
    axisMatches(condition?.buyerEstablishment, context.buyerEstablishment) &&
    axisMatches(condition?.buyerVatRegistered, context.buyerVatRegistered)
  );
}

function requiredSchemes(
  sellerCountry: string | undefined,
  party: InvoiceParty,
  context: InvoiceContext,
): Set<string> {
  const rules = sellerCountry ? catalog.invoiceRequirementsFor(sellerCountry) : [];
  return new Set(
    rules
      .filter((rule) => rule.party === party && conditionHolds(rule.when, context))
      .map((rule) => rule.scheme),
  );
}

function printedFor(
  countryCode: string | undefined,
  identifiers: readonly IdentifierValue[],
  required: Set<string>,
): PrintedIdentifier[] {
  const facts = countryCode ? catalog.schemesFor(countryCode) : [];
  const order = facts.map((fact) => fact.scheme);
  const rank = (scheme: string) => (order.includes(scheme) ? order.indexOf(scheme) : order.length);

  const values = new Map<string, string | null>();
  for (const scheme of required) values.set(scheme, null);
  for (const identifier of identifiers) {
    const value = identifier.value.trim();
    if (value) values.set(identifier.scheme, value);
  }

  return [...values.entries()]
    .toSorted(([a], [b]) => rank(a) - rank(b) || byCodeUnit(a, b))
    .map(([scheme, value]) => ({
      scheme,
      label: facts.find((fact) => fact.scheme === scheme)?.label,
      value,
    }));
}

/**
 * What a document prints for each party: every identifier it has filled in, plus, when asked, every
 * one the seller's country requires on this invoice that is still empty.
 */
export function printedPartyIdentifiers(input: PrintedPartyIdentifiersInput): PrintedPartyIdentifiers {
  const sellerCountry = normalize(input.seller.countryCode);
  const buyerCountry = normalize(input.buyer?.countryCode);
  const context: InvoiceContext = {
    sellerVatRegime: input.seller.vatRegime,
    buyerType: input.buyer?.type,
    buyerEstablishment: buyerEstablishmentOf(sellerCountry, buyerCountry),
    buyerVatRegistered: input.buyer?.vatRegistered,
  };
  const requiredFor = (party: InvoiceParty) =>
    input.includeMissingRequired ? requiredSchemes(sellerCountry, party, context) : new Set<string>();

  return {
    seller: printedFor(sellerCountry, input.seller.identifiers, requiredFor('SELLER')),
    buyer: input.buyer ? printedFor(buyerCountry, input.buyer.identifiers, requiredFor('BUYER')) : [],
  };
}

interface PartyRow {
  countryCode: string | null;
  country: string | null;
  partyIdentifiers?: readonly IdentifierValue[] | null;
}

const countryOf = (row: PartyRow) => row.countryCode || guessCountryCode(row.country);

/** The issuing company as an invoice's seller. */
export function invoiceSeller(
  company: PartyRow & { exemptVat: boolean },
): PrintedPartyIdentifiersInput['seller'] {
  return {
    countryCode: countryOf(company),
    vatRegime: company.exemptVat ? 'FRANCHISE_BASE' : 'STANDARD',
    identifiers: company.partyIdentifiers ?? [],
  };
}

/** A client as an invoice's buyer. */
export function invoiceBuyer(
  client: PartyRow & { type: PartyType; vatRegistered?: boolean },
): NonNullable<PrintedPartyIdentifiersInput['buyer']> {
  return {
    countryCode: countryOf(client),
    type: client.type,
    // A private client is never a VAT-registered business buyer, whatever value its row carries.
    vatRegistered: client.type === 'COMPANY' ? client.vatRegistered : false,
    identifiers: client.partyIdentifiers ?? [],
  };
}

export interface MissingInvoiceIdentifier {
  party: InvoiceParty;
  scheme: string;
  label: string;
}

/** Every identifier the seller's country requires on this invoice that is still empty, in print order. */
export function missingInvoiceIdentifiers(
  seller: PrintedPartyIdentifiersInput['seller'],
  buyer: PrintedPartyIdentifiersInput['buyer'],
): MissingInvoiceIdentifier[] {
  const printed = printedPartyIdentifiers({ seller, buyer, includeMissingRequired: true });
  const missing = (party: InvoiceParty, identifiers: PrintedIdentifier[]) =>
    identifiers
      .filter((identifier) => identifier.value === null)
      .map((identifier) => ({
        party,
        scheme: identifier.scheme,
        label: identifier.label ?? identifier.scheme,
      }));
  return [...missing('SELLER', printed.seller), ...missing('BUYER', printed.buyer)];
}
