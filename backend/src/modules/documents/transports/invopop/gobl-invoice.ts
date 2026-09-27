/**
 * The invoice → GOBL bridge, and THE finding of this integration.
 *
 * Every other structured transport in this module deposits an EN 16931 artifact one of
 * `formats/*-provider.ts` already builds: Factur-X for "pdp"/"chorus-pro", FA(3) for "ksef",
 * FatturaPA for "sdi"/"sdi-pec". Invopop accepts NONE of those on the way in. Its API speaks GOBL
 * (`gobl.org`), a JSON pivot model of its own, and the CONVERSION to the local syntax is a step
 * INSIDE the workflow the platform runs - Invopop produces the XML, the integrator does not. So this
 * transport needs a conversion step no other transport needs, and it lives here rather than in
 * `formats/`: `FormatProviderRegistry` holds EN 16931 SYNTAXES gated by the Schematron
 * (`formats/vendored/validate-schematron.ts`), and GOBL is neither a syntax nor gated by that
 * Schematron. Making GOBL a first-class `formats/` provider (so a company could download one) would
 * be its own piece of work; nothing here depends on it.
 *
 * WHAT IS DELIBERATELY NOT COMPUTED HERE. GOBL builds every total itself, and its own documentation
 * is explicit that totals supplied on input "are recalculated and silently replaced", with no error
 * on a mismatch. This builder therefore sends the raw facts only - quantity, unit price, discount
 * percentage, VAT percentage - and NEVER a `totals` block. The check that the platform's arithmetic
 * agrees with this product's own is not made here (a pure function cannot know what the platform
 * decided) but in `invopop-transport.ts`, against the built document that comes BACK, which is the
 * only place the comparison is worth anything. Verified live 2026-09-24.
 *
 * VAT AS A PERCENTAGE, NOT A RATE KEY. GOBL accepts either `{"cat":"VAT","rate":"standard"}` (a key
 * whose meaning the regime resolves for that country on that date) or `{"cat":"VAT","percent":"20.0%"}`
 * (the number itself). This builder sends the PERCENTAGE, taken from `totals.lines[i].vatRatePercent`
 * - the rate this product already resolved through its own `vat-rates/` catalog and, on a
 * cross-border document, through `tax/resolve-invoice-tax.ts`. Sending the key instead would hand the
 * rate decision to a second engine and make an invoice's tax depend on which of the two answered,
 * which is exactly the kind of silent divergence this repository's tax engine exists to prevent.
 * Confirmed live: `percent: "20.0%"` comes back resolved to `key: "standard"` for FR, `"0.0%"` to
 * `key: "zero"` - the platform maps the number onto its own key, never the reverse.
 */
import { decimalsFor } from '@/utils/financial';
import { guessCountryCode } from '@/utils/country-name-to-iso';

import { SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';

export const GOBL_INVOICE_SCHEMA = 'https://gobl.org/draft-0/bill/invoice';

/** The mime this transport archives its deposited artifact under - GOBL is JSON, not XML. */
export const GOBL_MIME = 'application/json';

/**
 * `item.unit` is a CLOSED GOBL key list (`org/unit`), while this product's own `unit` line field is
 * deliberately free text ("How the quantity is counted - e.g. hour, day, kg, unit", see
 * `descriptors/invoice.descriptor.ts`, which explains why it is not a closed code list here).
 * Verified live 2026-09-24: `"hour"` is REJECTED with `GOBL-ORG-ITEM-04` ("item unit must be valid")
 * and takes the whole deposit down with it, while `"h"`, `"day"`, `"kg"`, `"unit"`, `"item"` and
 * `"piece"` are accepted.
 *
 * So the free text is translated through this table and, when it matches nothing, the unit is OMITTED
 * rather than guessed at or passed through. Omitting costs a descriptive attribute; passing through
 * an unrecognised string costs the entire invoice. Deliberately small and English-only: it covers the
 * values this product's own help text proposes, and nothing is invented for a language or an
 * abbreviation nobody has actually seen typed.
 */
const UNIT_KEYS: Record<string, string> = {
  h: 'h',
  hr: 'h',
  hour: 'h',
  hours: 'h',
  d: 'day',
  day: 'day',
  days: 'day',
  wk: 'wk',
  week: 'wk',
  weeks: 'wk',
  mon: 'mon',
  month: 'mon',
  months: 'mon',
  yr: 'yr',
  year: 'yr',
  years: 'yr',
  g: 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  t: 't',
  ton: 't',
  tons: 't',
  tonne: 't',
  tonnes: 't',
  l: 'l',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  m: 'm',
  metre: 'm',
  metres: 'm',
  meter: 'm',
  meters: 'm',
  m2: 'm2',
  m3: 'm3',
  km: 'km',
  kwh: 'kwh',
  unit: 'unit',
  units: 'unit',
  item: 'item',
  items: 'item',
  piece: 'piece',
  pieces: 'piece',
  pair: 'pair',
  pairs: 'pair',
  dozen: 'dozen',
  service: 'service',
  job: 'job',
  day_rate: 'rate',
};

/** Maps one free-text unit onto a GOBL unit key, or `undefined` when nothing matches - see above. */
export function goblUnitKey(unit: string | null | undefined): string | undefined {
  if (!unit) return undefined;
  return UNIT_KEYS[unit.trim().toLowerCase()];
}

/** One line's raw facts, read straight off the document's own `data.lines[i]` plus the resolved rate. */
export interface GoblLineInput {
  description: string;
  quantity: number;
  unit?: string | null;
  /** BT-146 - the price the user typed, in major units. Never a value re-derived from a total. */
  unitPrice: number;
  /** Already constrained to [0, 100] by the 'number' field kind. Absent or 0 emits no discount. */
  discountPercent?: number | null;
  /**
   * The VAT percentage this product ALREADY resolved (`totals.lines[i].vatRatePercent`). `null` emits
   * NO `taxes` array at all on that line - an unresolved rate is not a 0% rate, and inventing one
   * here would be inventing a tax treatment. The platform's own validation then says so.
   */
  vatRatePercent: number | null;
}

export interface GoblInvoiceInput {
  /** The document's `displayNumber` - this product numbers its own invoices (`numbering/`). */
  code: string;
  /** ISO date, `YYYY-MM-DD`. */
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  seller: SemanticPartyInput;
  buyer: SemanticPartyInput;
  lines: GoblLineInput[];
  notes?: string | null;
}

/** GOBL amounts are decimal STRINGS whose trailing zeros set the precision - never JSON numbers. */
function amount(value: number, currency: string): string {
  return value.toFixed(decimalsFor(currency));
}

/**
 * A percentage as GOBL writes one. One decimal place, matching what the platform itself returns
 * (`"20.0%"`), so a round trip does not look like a change of value.
 */
function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * The party's VAT identifier, if it has one. The country prefix is left ON: GOBL strips and
 * normalises it itself (verified live - `FR11123456782` comes back as `{country: "FR", code:
 * "11123456782"}`), so stripping it here would be a second, redundant normaliser free to disagree
 * with the platform's.
 */
function vatIdentifier(party: SemanticPartyInput): string | undefined {
  const found = party.partyIdentifiers?.find((id) => id.scheme?.toUpperCase() === 'VAT');
  return found?.value?.trim() || undefined;
}

/**
 * Maps one party. `tax_id` carries the country even when no VAT identifier is on file, because the
 * country is what selects the GOBL tax REGIME and therefore every rule the platform will apply. A
 * party with neither gets no `tax_id` at all and the platform's own validation names what is missing
 * - deliberately not a refusal invented here, which would have to duplicate every regime's rules to
 * be accurate.
 */
function toGoblParty(party: SemanticPartyInput): Record<string, unknown> {
  const countryCode = guessCountryCode(party.country ?? undefined);
  const vat = vatIdentifier(party);

  const out: Record<string, unknown> = { name: party.name };

  if (countryCode) {
    out.tax_id = vat ? { country: countryCode, code: vat } : { country: countryCode };
  }

  if (party.address || party.city || party.postalCode || countryCode) {
    const address: Record<string, unknown> = {};
    if (party.address) address.street = party.address;
    if (party.addressLine2) address.street_extra = party.addressLine2;
    if (party.city) address.locality = party.city;
    if (party.postalCode) address.code = party.postalCode;
    if (countryCode) address.country = countryCode;
    out.addresses = [address];
  }

  if (party.email) out.emails = [{ addr: party.email }];
  if (party.phone) out.telephones = [{ num: party.phone }];

  return out;
}

/**
 * Builds the GOBL `bill/invoice` document this transport deposits. Pure: no DB, no network, no clock
 * - everything it emits comes from its arguments, which is what lets `gobl-invoice.spec.ts` pin the
 * whole shape without a sandbox.
 */
export function buildGoblInvoice(input: GoblInvoiceInput): Record<string, unknown> {
  const currency = input.currency.toUpperCase();

  const lines = input.lines.map((line) => {
    const item: Record<string, unknown> = {
      name: line.description,
      price: amount(line.unitPrice, currency),
    };
    const unit = goblUnitKey(line.unit);
    if (unit) item.unit = unit;

    const out: Record<string, unknown> = { quantity: String(line.quantity), item };

    if (line.discountPercent && line.discountPercent > 0) {
      out.discounts = [{ percent: percent(line.discountPercent) }];
    }
    if (line.vatRatePercent !== null && line.vatRatePercent !== undefined) {
      out.taxes = [{ cat: 'VAT', percent: percent(line.vatRatePercent) }];
    }
    return out;
  });

  const doc: Record<string, unknown> = {
    $schema: GOBL_INVOICE_SCHEMA,
    code: input.code,
    issue_date: input.issueDate,
    currency,
    supplier: toGoblParty(input.seller),
    customer: toGoblParty(input.buyer),
    lines,
  };

  // The seller's IBAN (BT-84) and the due date (BT-9) both live under GOBL's `payment` block. Emitted
  // only when the facts exist: an empty `payment` object is a property the platform would have to
  // validate for no reason.
  const payment: Record<string, unknown> = {};
  if (input.dueDate) {
    payment.terms = { due_dates: [{ date: input.dueDate, percent: '100%' }] };
  }
  if (input.seller.iban) {
    payment.instructions = { key: 'credit-transfer', credit_transfer: [{ iban: input.seller.iban }] };
  }
  if (Object.keys(payment).length > 0) doc.payment = payment;

  if (input.notes?.trim()) {
    doc.notes = [{ key: 'general', text: input.notes.trim() }];
  }

  return doc;
}
