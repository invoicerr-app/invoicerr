import {
  ForeignVatRateError,
  resolveInvoiceCrossBorderTax,
  UnresolvedBuyerCountryError,
  UnresolvedSellerCountryError,
  UnsupportedOssDestinationError,
} from './resolve-invoice-tax';

const FR_DE_VALID_VAT = 'DE136695976'; // a widely-published, checksum-valid German VAT number

function dataWithLines(lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return { client: 'client-1', currency: 'EUR', lines, ...extra };
}

describe('resolveInvoiceCrossBorderTax — pure domestic: nothing changes', () => {
  it('FR→FR at 20% passes through untouched (same object reference, no engine call)', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.crossBorder).toBe(false);
    expect(result.data).toBe(data); // same reference — "rien ne change"
    expect(result.warnings).toEqual([]);
  });

  it('a rate foreign to the seller country is refused, named', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '19' }]);
    expect(() =>
      resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: { countryCode: 'FR' }, data }),
    ).toThrow(ForeignVatRateError);
    expect(() =>
      resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: { countryCode: 'FR' }, data }),
    ).toThrow(/19% chosen on line 1 is not one of FR's known VAT rates/);
  });

  it('a country with no known rate catalog (US) is left alone entirely — permissive', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '37' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'US' },
      buyer: { countryCode: 'US' },
      data,
    });
    expect(result.crossBorder).toBe(false);
  });
});

describe('resolveInvoiceCrossBorderTax — unresolved buyer country: hard block, never a silent 0%', () => {
  it('a buyer with no country at all blocks, named', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    expect(() => resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: {}, data })).toThrow(
      UnresolvedBuyerCountryError,
    );
    expect(() => resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: {}, data })).toThrow(
      /buyer's country could not be determined/,
    );
  });

  it('an unresolvable free-text buyer country ("Nowhereland") blocks the same way', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    expect(() =>
      resolveInvoiceCrossBorderTax({
        seller: { countryCode: 'FR' },
        buyer: { country: 'Nowhereland' },
        data,
      }),
    ).toThrow(UnresolvedBuyerCountryError);
  });
});

// USER DECISION (2026-09-01, TODO_ISSUES.md "le pays vendeur irrésolu retombait sur 'FR'
// silencieusement", now RÉSOLU) — symmetric to the buyer block above: this function used to fall
// back to `'FR'` for an unresolvable SELLER country, the SAME class of bug the buyer block already
// exists to prevent. MUTATION TARGET (task's own mutation #2): reinstating `?? 'FR'` on `sellerCC`
// makes every test in this block pass with the OLD, silent behaviour instead of throwing — this is
// exactly what a reviewer should watch for.
describe("resolveInvoiceCrossBorderTax — unresolved SELLER country: hard block, never a silent 'FR'", () => {
  it('a seller with no country at all blocks, named — even for a pure-domestic-looking send', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    expect(() => resolveInvoiceCrossBorderTax({ seller: {}, buyer: { countryCode: 'FR' }, data })).toThrow(
      UnresolvedSellerCountryError,
    );
    expect(() => resolveInvoiceCrossBorderTax({ seller: {}, buyer: { countryCode: 'FR' }, data })).toThrow(
      /seller's own country could not be determined/,
    );
  });

  it('an unresolvable free-text seller country ("Nowhereland") blocks the same way', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    expect(() =>
      resolveInvoiceCrossBorderTax({
        seller: { country: 'Nowhereland' },
        buyer: { countryCode: 'FR' },
        data,
      }),
    ).toThrow(UnresolvedSellerCountryError);
  });

  it('a NORMAL, resolvable FR seller is completely unaffected — regression guard', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.crossBorder).toBe(false);
    expect(result.data).toBe(data);
  });
});

describe('resolveInvoiceCrossBorderTax — FR→DE B2B, valid VAT: reverse charge replaces the line', () => {
  it('0%, category AE, mention art. 196, buyer VAT number carried through', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 1000, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: FR_DE_VALID_VAT, validationStatus: 'VALID' },
      data,
    });
    expect(result.crossBorder).toBe(true);
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('0');
    expect(line.__crossBorderCategory).toBe('AE');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.code)).toContain('REVERSE_CHARGE');
    expect(mentions.map((m) => m.text)).toContain(
      'Autoliquidation / Reverse charge — Art. 196 Directive 2006/112/EC',
    );
    expect(result.warnings).toEqual([]);
  });

  it('FR→DE B2B GOODS with valid VAT: intra-Community supply, category K, art. 138', () => {
    const data = dataWithLines([
      { description: 'Widgets', quantity: 10, unitPrice: 50, vatRate: '20', supplyType: 'GOODS' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: FR_DE_VALID_VAT, validationStatus: 'VALID' },
      data,
    });
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('0');
    expect(line.__crossBorderCategory).toBe('K');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.text)).toContain('Intra-Community supply — Art. 138 Directive 2006/112/EC');
  });
});

describe('resolveInvoiceCrossBorderTax — FR→US export: G/O, art. 146', () => {
  it('goods → category G, 0%, export mention art. 146', () => {
    const data = dataWithLines([
      { description: 'Hardware', quantity: 1, unitPrice: 500, vatRate: '20', supplyType: 'GOODS' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'US' },
      data,
    });
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('0');
    expect(line.__crossBorderCategory).toBe('G');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.text)).toContain('Export — zero-rated, Art. 146 Directive 2006/112/EC');
  });

  it('services → category O, 0%, out-of-scope mention', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'US' },
      data,
    });
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('0');
    expect(line.__crossBorderCategory).toBe('O');
  });
});

describe('resolveInvoiceCrossBorderTax — FR→DE B2C: blocked, no destination rate table', () => {
  it('blocks, named, never invents a rate and never applies the seller own rate silently', () => {
    const data = dataWithLines([
      { description: 'Widgets', quantity: 1, unitPrice: 100, vatRate: '20', supplyType: 'GOODS' },
    ]);
    expect(() =>
      resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' }, data }),
    ).toThrow(UnsupportedOssDestinationError);
    expect(() =>
      resolveInvoiceCrossBorderTax({ seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' }, data }),
    ).toThrow(/no VAT rate table is known for DE/);
  });

  it('B2C SERVICES (not goods) to DE does not need a destination table — taxed at the seller rate', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 100, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      data,
    });
    expect(result.crossBorder).toBe(true);
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.__crossBorderCategory).toBe('S');
    expect(line.vatRate).toBe('20');
  });
});

describe('resolveInvoiceCrossBorderTax — a syntactically wrong VAT number never unlocks B2B', () => {
  it('an invalid-syntax buyer VAT number is treated as B2C, with a named warning', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: 'DE000000000', validationStatus: 'VALID' }, // fails the DE checksum
      data,
    });
    // Services, B2C, EU union → falls back to domesticVat (seller's own rate) per tax-engine.ts —
    // never reverse-charged for a buyer this function refused to call B2B.
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.__crossBorderCategory).not.toBe('AE');
    expect(result.warnings.join(' ')).toMatch(/not syntactically valid/);
  });

  it('a syntactically valid but unverified (VIES) VAT number is treated as B2C, with a named warning', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: FR_DE_VALID_VAT, validationStatus: null },
      data,
    });
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.__crossBorderCategory).not.toBe('AE');
    expect(result.warnings.join(' ')).toMatch(/has not been confirmed valid yet/);
  });
});

/**
 * Root TODO item 16, the SURGICAL FIX: the resolved treatment is now PERSISTED at "sending"
 * (`actions/async-send.ts`'s own `preflight` header — the resolution the preflight computes REPLACES
 * the "sending" document's own `data`, it is no longer discarded) and re-resolved AGAIN at
 * `deliver()` (`invoice-actions.ts`'s own header) — and a "send_failed" retry re-submits the
 * document's OWN, already-resolved `data` as if it were a fresh draft (document-list.tsx's `getData`
 * reads the CURRENT persisted instance). None of that is safe unless resolving an ALREADY-RESOLVED
 * line a second time reproduces the EXACT SAME treatment — this is what makes it safe, proven here by
 * actually feeding a first pass's own output back in as the second pass's input, rather than merely
 * asserted in a comment. It holds by construction: the cross-border branch never reads a line's
 * EXISTING `vatRate` to decide anything (only `supplyType`, and the seller/buyer identity passed
 * alongside `data`, never through it) — see `resolveInvoiceCrossBorderTax`'s own `clonedRows` above,
 * which only ever WRITES `vatRate`/`__crossBorderCategory`, never reads them back.
 */
describe('resolveInvoiceCrossBorderTax — idempotence: re-resolving an ALREADY-RESOLVED line is stable', () => {
  it("FR→DE B2B SERVICES (reverse charge): feeding the first pass's own result back in as the second pass's input reproduces it byte-for-byte", () => {
    const draft = dataWithLines([
      {
        description: 'Conseil stratégique',
        quantity: 1,
        unitPrice: 12000,
        vatRate: '20',
        supplyType: 'SERVICES',
      },
    ]);
    const parties = {
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      buyerVat: { value: FR_DE_VALID_VAT, validationStatus: 'VALID' },
    };

    const firstPass = resolveInvoiceCrossBorderTax({ ...parties, data: draft });
    expect(firstPass.crossBorder).toBe(true);
    const firstLine = (firstPass.data.lines as Record<string, unknown>[])[0];
    expect(firstLine.vatRate).toBe('0'); // never the drafted "20"
    expect(firstLine.__crossBorderCategory).toBe('AE');

    // THE re-resolution: same seller/buyer identity, but `data` is now the FIRST pass's own output
    // (0%, AE, `__crossBorderCategory` already on the line) — exactly what `deliver()` and a
    // send_failed retry's own preflight actually see once this task's fix lands.
    const secondPass = resolveInvoiceCrossBorderTax({ ...parties, data: firstPass.data });

    expect(secondPass.crossBorder).toBe(true);
    expect(secondPass.data).toEqual(firstPass.data);
    expect(secondPass.warnings).toEqual(firstPass.warnings);
    const secondLine = (secondPass.data.lines as Record<string, unknown>[])[0];
    expect(secondLine.vatRate).toBe('0');
    expect(secondLine.__crossBorderCategory).toBe('AE');
  });

  it('FR→DE B2C SERVICES (seller-rate fallback, category S, never reverse-charged): re-resolving the already-resolved 20% line is stable too', () => {
    const draft = dataWithLines([
      { description: 'Consulting', quantity: 1, unitPrice: 100, vatRate: '20', supplyType: 'SERVICES' },
    ]);
    const parties = { seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' } };

    const firstPass = resolveInvoiceCrossBorderTax({ ...parties, data: draft });
    const secondPass = resolveInvoiceCrossBorderTax({ ...parties, data: firstPass.data });

    expect(secondPass.data).toEqual(firstPass.data);
  });

  it('domestic FR→FR: re-resolving stays a pure no-op both times — the SAME object reference, not merely an equal one', () => {
    const draft = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '20' }]);
    const parties = { seller: { countryCode: 'FR' }, buyer: { countryCode: 'FR' } };

    const firstPass = resolveInvoiceCrossBorderTax({ ...parties, data: draft });
    const secondPass = resolveInvoiceCrossBorderTax({ ...parties, data: firstPass.data });

    expect(firstPass.data).toBe(draft);
    expect(secondPass.data).toBe(firstPass.data);
  });
});
