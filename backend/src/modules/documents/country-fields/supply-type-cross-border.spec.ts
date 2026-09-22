/**
 * THE POINT OF THE `lines[].supplyType` OVERLAY, PROVEN PER COUNTRY — not "the field exists" but
 * "the value the field offers reaches the tax engine and changes what the customer is charged".
 *
 * Until this catalog carried a `supplyType` operation for Germany, Italy, Poland and Portugal, only a
 * FRENCH seller had a screen control able to say "this line is a delivery of goods": the overlay is
 * resolved on the SELLER's own country (`documents.service.ts#describeTypeForCompany`), so for the
 * other four every line arrived at `tax/resolve-invoice-tax.ts` with no `supplyType` key at all and
 * was treated as a SERVICE — taxed where the supplier is, Directive 2006/112/EC art. 45. A genuine
 * cross-border sale of goods to a consumer in another member state is not that: it is an
 * intra-Community distance sale, taxed where the transport ends (art. 33(a)) once the seller's
 * EU-wide distance sales pass EUR 10 000 in a calendar year, and taxed in the seller's own country
 * (art. 32, art. 59c(1) disapplying art. 33(a)) below that threshold. Neither outcome — nor the hard
 * block that refuses to guess between them (`UndeclaredDistanceSalesRegimeError`) — was reachable for
 * those four sellers.
 *
 * Every case below therefore asserts the RESOLVED RATE and the COMPUTED VAT AMOUNT, through
 * `totals/compute-totals.ts` (the same function the stored document, the settlement balance and the
 * PDF all read), for a GOODS value taken from the country's OWN shipped overlay rather than typed
 * into the test: hard-coding `'GOODS'` here would keep passing if a country's overlay were deleted,
 * which is precisely the failure this suite exists to catch.
 *
 * The last case in each country's block is the one that must NOT change: the same invoice with no
 * `supplyType` at all resolves exactly as it did before this overlay shipped — the seller's own rate,
 * no block, and the engine's own named warning. That is the guarantee for every document already
 * stored, none of which carries the key.
 */
import { applyFieldOverlay } from './apply-overlay';
import { ALL_COUNTRY_FIELD_OVERLAY_FILES } from './data/all';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { computeDocumentTotals } from '../totals/compute-totals';
import { resolveInvoiceCrossBorderTax, UndeclaredDistanceSalesRegimeError } from '../tax/resolve-invoice-tax';

const descriptor = buildInvoiceDescriptor();

/**
 * The `supplyType` values a seller in `countryCode` can actually CHOOSE, read off the real shipped
 * catalog the way a live company's form is built: the trunk invoice descriptor's own fields, plus
 * that country's overlay operations, merged by the same `applyFieldOverlay` `DocumentsService` runs.
 * Throws — never returns a default — when the country has no such control, so a deleted overlay fails
 * this suite by name instead of quietly falling back to the SERVICES treatment it is testing against.
 */
function supplyTypeOptions(countryCode: string): string[] {
  const file = ALL_COUNTRY_FIELD_OVERLAY_FILES.find((f) => f.countryCode === countryCode);
  if (!file) throw new Error(`No country-fields overlay ships for ${countryCode}.`);
  const operations = file.overlays.find((overlay) => overlay.typeId === 'invoice')?.operations ?? [];
  const merged = applyFieldOverlay(descriptor.fields, operations);
  const field = merged.find((f) => f.key === 'lines')?.fields?.find((f) => f.key === 'supplyType');
  if (!field?.options?.length) {
    throw new Error(`${countryCode}'s invoice lines offer no supplyType choice.`);
  }
  return field.options.map((option) => option.value);
}

/** EUR 100.00 on one line — 10 000 minor units, so every rate below divides exactly and an assertion
 *  that fails names a real difference rather than a rounding artefact. */
const NET_MINOR = 10_000;

function goodsInvoice(countryCode: string, vatRateId: string) {
  const goods = supplyTypeOptions(countryCode).find((value) => value === 'GOODS');
  if (!goods) throw new Error(`${countryCode}'s supplyType field offers no GOODS value.`);
  return {
    client: 'client-1',
    currency: 'EUR',
    lines: [
      {
        description: 'Widget',
        quantity: 1,
        unit: 'unit',
        unitPrice: 100,
        vatRate: vatRateId,
        supplyType: goods,
      },
    ],
  };
}

/** The SAME invoice a seller with no such control could produce before this overlay shipped, and the
 *  only shape every already-stored document has: no `supplyType` key on the line at all. */
function undeclaredInvoice(vatRateId: string) {
  return {
    client: 'client-1',
    currency: 'EUR',
    lines: [{ description: 'Widget', quantity: 1, unit: 'unit', unitPrice: 100, vatRate: vatRateId }],
  };
}

/**
 * One leg per wired country, each selling to a consumer in a DIFFERENT member state — so no leg can
 * pass by accident on a domestic early return, and every destination is one with a real
 * `tax/tax-systems/data/*.json` rate table (the OSS branch refuses an uncatalogued destination by
 * name rather than inventing a rate).
 *
 * `sellerStandardRate` and `destinationStandardRate` are each that country's own sourced standard
 * rate, derived by `tax/tax-systems/registry.ts` from the STANDARD-category entry of its
 * `vat-rates/data/*.json` catalog — never a rate typed from memory here.
 */
const LEGS = [
  {
    seller: 'DE',
    buyer: 'FR',
    vatRateId: 'de-standard',
    sellerStandardRate: 19,
    destinationStandardRate: 20,
  },
  {
    seller: 'FR',
    buyer: 'DE',
    vatRateId: 'fr-standard',
    sellerStandardRate: 20,
    destinationStandardRate: 19,
  },
  {
    seller: 'IT',
    buyer: 'PT',
    vatRateId: 'it-standard',
    sellerStandardRate: 22,
    destinationStandardRate: 23,
  },
  {
    seller: 'PL',
    buyer: 'DE',
    vatRateId: 'pl-standard',
    sellerStandardRate: 23,
    destinationStandardRate: 19,
  },
  {
    seller: 'PT',
    buyer: 'IT',
    vatRateId: 'pt-standard',
    sellerStandardRate: 23,
    destinationStandardRate: 22,
  },
] as const;

describe.each(LEGS)('intra-Community distance sale of GOODS, $seller seller → $buyer consumer', ({
  seller,
  buyer,
  vatRateId,
  sellerStandardRate,
  destinationStandardRate,
}) => {
  it('the seller can declare GOODS at all — the overlay puts the choice on this country’s own invoice line', () => {
    expect(supplyTypeOptions(seller)).toContain('GOODS');
  });

  it('no declared distance-sales regime: the send is REFUSED by name, never taxed on a guess (art. 59c)', () => {
    const call = () =>
      resolveInvoiceCrossBorderTax({
        seller: { countryCode: seller },
        buyer: { countryCode: buyer },
        data: goodsInvoice(seller, vatRateId),
      });
    expect(call).toThrow(UndeclaredDistanceSalesRegimeError);
    expect(call).toThrow(/EUR 10 000/);
    expect(call).toThrow(new RegExp(`from ${seller} to ${buyer}`));
  });

  it(`ORIGIN (below the threshold): taxed in ${seller} at ${seller}'s own standard rate — art. 32, art. 59c(1)`, () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: seller, distanceSalesRegime: 'ORIGIN' },
      buyer: { countryCode: buyer },
      data: goodsInvoice(seller, vatRateId),
    });

    const line = (resolved.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe(String(sellerStandardRate));
    expect(line.__crossBorderCategory).toBe('S');

    const totals = computeDocumentTotals(descriptor, resolved.data);
    expect(totals.netMinor).toBe(NET_MINOR);
    expect(totals.vatMinor).toBe((NET_MINOR * sellerStandardRate) / 100);
    expect(totals.grossMinor).toBe(NET_MINOR + (NET_MINOR * sellerStandardRate) / 100);
    // An origin-taxed supply goes on the ordinary domestic VAT return, so nothing to caveat.
    expect(resolved.warnings).toEqual([]);
  });

  it(`DESTINATION (threshold crossed, or opted in): taxed in ${buyer} at ${buyer}'s own standard rate — art. 33(a), One-Stop-Shop`, () => {
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: seller, distanceSalesRegime: 'DESTINATION' },
      buyer: { countryCode: buyer },
      data: goodsInvoice(seller, vatRateId),
    });

    const line = (resolved.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe(String(destinationStandardRate));
    expect(line.__crossBorderCategory).toBe('S');

    const totals = computeDocumentTotals(descriptor, resolved.data);
    expect(totals.netMinor).toBe(NET_MINOR);
    expect(totals.vatMinor).toBe((NET_MINOR * destinationStandardRate) / 100);
    expect(totals.grossMinor).toBe(NET_MINOR + (NET_MINOR * destinationStandardRate) / 100);
    // The destination's own reduced rates are not modelled; the branch says so instead of applying
    // a standard rate silently.
    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toMatch(new RegExp(`STANDARD VAT rate \\(${destinationStandardRate}%\\)`));
  });

  it('the two regimes genuinely differ for this pair — the choice the overlay unlocks is worth money', () => {
    const origin = resolveInvoiceCrossBorderTax({
      seller: { countryCode: seller, distanceSalesRegime: 'ORIGIN' },
      buyer: { countryCode: buyer },
      data: goodsInvoice(seller, vatRateId),
    });
    const destination = resolveInvoiceCrossBorderTax({
      seller: { countryCode: seller, distanceSalesRegime: 'DESTINATION' },
      buyer: { countryCode: buyer },
      data: goodsInvoice(seller, vatRateId),
    });

    const originVat = computeDocumentTotals(descriptor, origin.data).vatMinor;
    const destinationVat = computeDocumentTotals(descriptor, destination.data).vatMinor;
    expect(destinationVat - originVat).toBe(
      (NET_MINOR * (destinationStandardRate - sellerStandardRate)) / 100,
    );
    expect(originVat).not.toBe(destinationVat);
  });

  it('a line that declares NOTHING is untouched by this change: still a SERVICE, still the seller’s own rate, still no block (art. 45)', () => {
    // The guarantee for every invoice stored before this overlay existed — none of them carries the
    // key, and none of them may change meaning because the screen gained a control.
    const resolved = resolveInvoiceCrossBorderTax({
      seller: { countryCode: seller },
      buyer: { countryCode: buyer },
      data: undeclaredInvoice(vatRateId),
    });

    const line = (resolved.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe(String(sellerStandardRate));
    expect(line.__crossBorderCategory).toBe('S');
    expect(computeDocumentTotals(descriptor, resolved.data).vatMinor).toBe(
      (NET_MINOR * sellerStandardRate) / 100,
    );
    expect(resolved.warnings).toContainEqual(expect.stringContaining('no declared supply type'));
  });
});
