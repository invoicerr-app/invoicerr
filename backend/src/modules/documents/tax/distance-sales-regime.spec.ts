/**
 * INTRA-COMMUNITY DISTANCE SALES — the EUR 10 000 threshold of Directive 2006/112/EC art. 59c, and
 * what the engine may and may not conclude without it.
 *
 * Before this file existed, a cross-border B2C sale of goods inside the EU was taxed in the BUYER's
 * member state from the first euro, unconditionally and silently: a French seller invoicing a German
 * consumer got 19% whatever its turnover, whatever it had opted into, `warnings` empty. That is only
 * half of the Directive. Art. 33(a) does put the place of supply where the transport ENDS — but art.
 * 59c(1) disapplies it (and art. 58, the same rule for telecommunications/broadcasting/electronic
 * services) while the seller is established in a single member state and "the total value, exclusive
 * of VAT, of the supplies referred to in point (b) does not in the current calendar year exceed EUR
 * 10 000 […] nor did it do so in the course of the preceding calendar year", leaving art. 32 — the
 * place where transport BEGINS, i.e. the seller's own country — to govern. France transposes both
 * halves at CGI art. 258 A, I, 1°: a distance sale dispatched from France is deemed NOT to be located
 * in France only when "a) La valeur totale prévue au 1 du II de l'article 259 D […] est dépassée
 * pendant l'année civile en cours ou l'a été pendant l'année civile précédente ; b) Ou l'assujetti a
 * fait usage de l'option prévue soit au 2 du II de l'article 259 D, soit dans les conditions prévues
 * au 3 de l'article 59 quater de la directive 2006/112/CE" — below the threshold and without the
 * option, it stays a French sale at French rates.
 *
 * Neither limb is knowable from an invoice: the ceiling is a running total across every member state
 * and every sale the business makes (including sales made outside this application), and the option
 * (art. 59c(3), "which shall in any event cover two calendar years") is a legal act. So the seller
 * DECLARES which regime it is under, once — `Company.distanceSalesRegime`, threaded to the engine as
 * `PartyTaxProfile.distanceSalesRegime` — and a seller that has declared nothing is REFUSED by name
 * rather than taxed on a guess.
 *
 * Every case below fails against the code as it stood before that field existed: the ORIGIN ones
 * because the destination rate was applied regardless, the block ones because nothing blocked, the
 * warning one because the OSS branch said nothing at all.
 */
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';
import { TrustFlagVatValidator } from './classification';
import {
  parseDistanceSalesRegime,
  resolveInvoiceCrossBorderTax,
  UndeclaredDistanceSalesRegimeError,
  UnsupportedOssDestinationError,
} from './resolve-invoice-tax';
import { determineLineTax } from './tax-engine';
import { ALL_TAX_SYSTEM_FILES } from './tax-systems/data/all';
import { defaultTaxSystemRegistry, TaxSystemRegistry } from './tax-systems/registry';
import { DistanceSalesRegime, DocumentLine, PartyTaxProfile, SupplyType } from './types';

const vat = new TrustFlagVatValidator();
const prof = (cc: string) => defaultTaxSystemRegistry.resolve(cc)!;

function seller(country: string, regime?: DistanceSalesRegime): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role: 'B2B',
    identifiers: [],
    ...(regime ? { distanceSalesRegime: regime } : {}),
  };
}

function consumer(country: string): PartyTaxProfile {
  return { legalName: `${country} consumer`, countryCode: country, role: 'B2C', identifiers: [] };
}

function line(supplyType: SupplyType, rateHint?: number): DocumentLine {
  return {
    id: 'l1',
    description: 'item',
    quantity: 1,
    unitNetMinor: 4000,
    supplyType,
    taxRateHint: rateHint,
  };
}

describe('TaxEngine — intra-Community distance sales: the seller’s declared regime decides the place of supply', () => {
  it('FR→DE B2C goods, seller under the threshold (ORIGIN): taxed in FR at FR’s own rate, never DE’s 19%', () => {
    const t = determineLineTax(
      seller('FR', 'ORIGIN'),
      consumer('DE'),
      line('GOODS'),
      prof('FR'),
      vat,
      prof('DE'),
    );
    // Art. 59c(1) disapplies art. 33(a); art. 32 puts the supply where dispatch begins.
    expect(t.components[0].jurisdiction).toBe('FR');
    expect(t.components[0].rate).toBe(20);
    expect(t.components[0].category).toBe('S');
    // No One-Stop-Shop return is due on a supply taxed in the seller's own country: it goes on the
    // seller's ordinary domestic VAT return.
    expect(t.reportingFlags).not.toContain('OSS');
    expect(t.buyerSelfAssess).toBe(false);
  });

  it('FR→DE B2C goods, ORIGIN, on a REDUCED French rate: the seller’s own 5.5% survives (CGI art. 278-0 bis), never flattened to 20%', () => {
    const t = determineLineTax(
      seller('FR', 'ORIGIN'),
      consumer('DE'),
      line('GOODS', 5.5),
      prof('FR'),
      vat,
      prof('DE'),
    );
    expect(t.components[0].jurisdiction).toBe('FR');
    expect(t.components[0].rate).toBe(5.5);
  });

  it('FR→DE B2C goods, seller above the threshold or opted in (DESTINATION): taxed in DE at 19%, OSS flagged — unchanged from before', () => {
    const t = determineLineTax(
      seller('FR', 'DESTINATION'),
      consumer('DE'),
      line('GOODS'),
      prof('FR'),
      vat,
      prof('DE'),
    );
    expect(t.components[0].jurisdiction).toBe('DE');
    expect(t.components[0].rate).toBe(19);
    expect(t.reportingFlags).toContain('OSS');
  });

  it('a DESTINATION seller’s chosen reduced rate is NOT carried across the border — the destination’s own rate governs, art. 33(a)', () => {
    const t = determineLineTax(
      seller('FR', 'DESTINATION'),
      consumer('DE'),
      line('GOODS', 5.5),
      prof('FR'),
      vat,
      prof('DE'),
    );
    // DE's standard rate, not FR's 5.5% and not DE's own 7% (which this engine cannot select — see
    // `ossDestinationVat`'s own comment on the missing product classification).
    expect(t.components[0].rate).toBe(19);
    expect(t.components[0].jurisdiction).toBe('DE');
  });

  it('the regime never touches a B2C SERVICE — taxed where the supplier is either way (art. 45)', () => {
    const origin = determineLineTax(
      seller('FR', 'ORIGIN'),
      consumer('DE'),
      line('SERVICES'),
      prof('FR'),
      vat,
      prof('DE'),
    );
    const destination = determineLineTax(
      seller('FR', 'DESTINATION'),
      consumer('DE'),
      line('SERVICES'),
      prof('FR'),
      vat,
      prof('DE'),
    );
    expect(origin.components[0]).toEqual(destination.components[0]);
    expect(origin.components[0].jurisdiction).toBe('FR');
    expect(origin.components[0].rate).toBe(20);
  });

  it('the regime never touches a B2B sale — a validated VAT number still means intra-Community supply at 0%', () => {
    const b2b: PartyTaxProfile = {
      legalName: 'DE Co',
      countryCode: 'DE',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'DE136695976', validated: true }],
    };
    const t = determineLineTax(seller('FR', 'ORIGIN'), b2b, line('GOODS'), prof('FR'), vat, prof('DE'));
    expect(t.components[0].category).toBe('K');
    expect(t.components[0].rate).toBe(0);
  });
});

function dataWithLines(lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { client: 'client-1', currency: 'EUR', lines, ...extra };
}

const BOOK_LINE = {
  description: 'Livre',
  quantity: 1,
  unit: 'unit',
  unitPrice: 40,
  vatRate: 'fr-reduced', // 5.5% — the seller's own catalogued rate (CGI art. 278-0 bis)
  supplyType: 'GOODS',
};

describe('resolveInvoiceCrossBorderTax — an undeclared distance-sales regime is refused, never guessed', () => {
  it('FR→DE B2C GOODS with no declared regime blocks, named, and says what the seller has to decide', () => {
    const data = dataWithLines([BOOK_LINE]);
    const call = () =>
      resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' }, data });
    expect(call).toThrow(UndeclaredDistanceSalesRegimeError);
    expect(call).toThrow(/EUR 10 000/);
    expect(call).toThrow(/art\. 59c\(1\)/);
  });

  it('the block is NARROW: the same invoice as a SERVICE is resolved without any declaration at all', () => {
    const data = dataWithLines([{ ...BOOK_LINE, supplyType: 'SERVICES' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      data,
    });
    expect(result.crossBorder).toBe(true);
    expect((result.data.lines as Record<string, unknown>[])[0].vatRate).toBe('5.5');
  });

  it('the block is NARROW: a DOMESTIC FR→FR invoice never asks for a declaration (same object reference)', () => {
    const data = dataWithLines([BOOK_LINE]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.data).toBe(data);
  });

  it('the block is NARROW: a B2B buyer with a confirmed VAT number never asks for a declaration', () => {
    const data = dataWithLines([BOOK_LINE]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: 'DE136695976', validationStatus: 'VALID' },
      data,
    });
    expect((result.data.lines as Record<string, unknown>[])[0].__crossBorderCategory).toBe('K');
  });

  it('an ORIGIN seller needs NO destination rate table — the uncatalogued-destination block is asked only of a DESTINATION seller', () => {
    const frOnly = new TaxSystemRegistry(ALL_TAX_SYSTEM_FILES.filter((f) => f.countryCode === 'FR'));
    const data = dataWithLines([BOOK_LINE]);
    const origin = resolveInvoiceCrossBorderTax(
      { seller: { countryCode: 'FR', distanceSalesRegime: 'ORIGIN' }, buyer: { countryCode: 'DE' }, data },
      { taxSystemRegistry: frOnly },
    );
    expect((origin.data.lines as Record<string, unknown>[])[0].vatRate).toBe('5.5');
    expect(() =>
      resolveInvoiceCrossBorderTax(
        {
          seller: { countryCode: 'FR', distanceSalesRegime: 'DESTINATION' },
          buyer: { countryCode: 'DE' },
          data,
        },
        { taxSystemRegistry: frOnly },
      ),
    ).toThrow(UnsupportedOssDestinationError);
  });
});

/**
 * THE MUTATION TARGET, priced in minor units end to end: the review's own example — a French seller,
 * a German consumer, one EUR 40 book entered at the seller's catalogued 5.5% rate. The rate is only
 * half the claim; the VAT AMOUNT the customer is actually charged is the other half, so the resolved
 * data is run through `totals/compute-totals.ts` — the same function the stored document, the
 * settlement balance and the PDF all read — rather than multiplied out by hand here.
 */
describe('resolveInvoiceCrossBorderTax → computeDocumentTotals: what the German consumer is actually charged', () => {
  const descriptor = buildInvoiceDescriptor();

  it('ORIGIN (under the EUR 10 000 threshold): 5.5% French VAT — 220 minor on a 4 000 minor base, 4 220 gross', () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', distanceSalesRegime: 'ORIGIN' },
      buyer: { countryCode: 'DE' },
      data: dataWithLines([BOOK_LINE]),
    });
    expect((resolved.data.lines as Record<string, unknown>[])[0].vatRate).toBe('5.5');

    const totals = computeDocumentTotals(descriptor, resolved.data);
    expect(totals.netMinor).toBe(4000);
    expect(totals.vatMinor).toBe(220);
    expect(totals.grossMinor).toBe(4220);
    expect(totals.vatBreakdown).toEqual([{ ratePercent: 5.5, baseMinor: 4000, vatMinor: 220 }]);
  });

  it('DESTINATION (threshold crossed, or opted in): 19% German VAT — 760 minor, 4 760 gross, and the 540-minor gap between the two regimes is exactly the defect', () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', distanceSalesRegime: 'DESTINATION' },
      buyer: { countryCode: 'DE' },
      data: dataWithLines([BOOK_LINE]),
    });
    expect((resolved.data.lines as Record<string, unknown>[])[0].vatRate).toBe('19');

    const totals = computeDocumentTotals(descriptor, resolved.data);
    expect(totals.netMinor).toBe(4000);
    expect(totals.vatMinor).toBe(760);
    expect(totals.grossMinor).toBe(4760);
    // 760 - 220 = 540 minor units (EUR 5.40) charged to a consumer on ONE book, on a regime the
    // seller never declared and may not be under. Multiply by a catalogue and a year.
    expect(totals.vatMinor - 220).toBe(540);
  });

  it('DESTINATION says out loud that only the destination’s STANDARD rate could be resolved — the branch used to return no warning at all', () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', distanceSalesRegime: 'DESTINATION' },
      buyer: { countryCode: 'DE' },
      data: dataWithLines([BOOK_LINE]),
    });
    // A book is 7% in Germany (UStG § 12 Abs. 2 with Anlage 2), not 19% — but nothing on an invoice
    // line says "this is a book", so the engine cannot know and must not pretend. It states what it
    // applied instead of applying it silently.
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toMatch(/STANDARD VAT rate \(19%\)/);
    expect(resolved.warnings[0]).toMatch(/reduced rates are not modelled/);
  });

  it('ORIGIN emits no such warning — there is no destination rate involved to caveat', () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', distanceSalesRegime: 'ORIGIN' },
      buyer: { countryCode: 'DE' },
      data: dataWithLines([BOOK_LINE]),
    });
    expect(resolved.warnings).toEqual([]);
  });
});

describe('parseDistanceSalesRegime — a stored value is never generously interpreted', () => {
  it('accepts exactly the two declared values', () => {
    expect(parseDistanceSalesRegime('ORIGIN')).toBe('ORIGIN');
    expect(parseDistanceSalesRegime('DESTINATION')).toBe('DESTINATION');
  });

  it('treats null, blank, lowercase and anything else as NOT DECLARED — which blocks, never defaults', () => {
    expect(parseDistanceSalesRegime(null)).toBeUndefined();
    expect(parseDistanceSalesRegime(undefined)).toBeUndefined();
    expect(parseDistanceSalesRegime('')).toBeUndefined();
    expect(parseDistanceSalesRegime('origin')).toBeUndefined();
    expect(parseDistanceSalesRegime('OSS')).toBeUndefined();
    expect(parseDistanceSalesRegime(1)).toBeUndefined();
  });
});
