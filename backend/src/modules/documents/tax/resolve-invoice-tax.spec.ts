import {
  applyTaxResult,
  extractCurrency,
  extractIssueDate,
  ForeignVatRateError,
  resolveInvoiceCrossBorderTax,
  UnresolvedBuyerCountryError,
  UnresolvedSellerCountryError,
  UnsupportedOssDestinationError,
} from './resolve-invoice-tax';
import { DocumentTaxResult } from './tax-engine';
import { ALL_TAX_SYSTEM_FILES } from './tax-systems/data/all';
import { TaxSystemRegistry } from './tax-systems/registry';

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

// The DELICATE HALF this defect's fix required (see resolve-invoice-tax.ts's own header, "ONE
// exception"): a DOMESTIC seller under a non-STANDARD tax scheme must still see the exemption, while
// a seller with no scheme (or 'STANDARD') must stay COMPLETELY untouched — same object reference, not
// merely deep-equal. `tax-engine.spec.ts` already proves the underlying ENGINE branch
// (`domesticVat`'s FRANCHISE_BASE case) in isolation; these tests prove the WIRING actually reaches it
// for a real domestic send, which is exactly the gap that let an exempt company be charged VAT.
describe('resolveInvoiceCrossBorderTax — domestic seller under a non-STANDARD tax scheme (franchise/exempt)', () => {
  it('FR→FR, seller taxScheme FRANCHISE_BASE: every line is rewritten to 0%, category E, art. 293 B mention', () => {
    const data = dataWithLines([
      { description: 'Consulting', quantity: 2, unitPrice: 500, vatRate: '20' },
      { description: 'More consulting', quantity: 1, unitPrice: 100, vatRate: '10' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', taxScheme: 'FRANCHISE_BASE' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.crossBorder).toBe(false); // still a DOMESTIC invoice, never treated as cross-border
    expect(result.data).not.toBe(data); // this IS a rewrite, unlike the ordinary domestic no-op
    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines[0].vatRate).toBe('0');
    expect(lines[0].__crossBorderCategory).toBe('E');
    expect(lines[1].vatRate).toBe('0');
    expect(lines[1].__crossBorderCategory).toBe('E');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.code)).toContain('FR_293B');
    expect(mentions.map((m) => m.text)).toContain('TVA non applicable, art. 293 B du CGI');
    // Deduplicated document-level, exactly like the cross-border branch does — not once per line.
    expect(mentions).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it('PT→PT, seller taxScheme FRANCHISE_BASE: the CIVA art. 57.º n.º 2 wording, never the generic one', () => {
    const data = dataWithLines([{ description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '23' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'PT', taxScheme: 'FRANCHISE_BASE' },
      buyer: { countryCode: 'PT' },
      data,
    });
    const lines = result.data.lines as Record<string, unknown>[];
    expect(lines[0].vatRate).toBe('0');
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.text)).toContain('IVA - regime de isenção');
  });

  it('DE→DE, seller taxScheme FRANCHISE_BASE: the GENERIC mention — no sourced German wording exists yet', () => {
    const data = dataWithLines([{ description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '19' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'DE', taxScheme: 'FRANCHISE_BASE' },
      buyer: { countryCode: 'DE' },
      data,
    });
    const mentions = result.data.__crossBorderMentions as { code: string; text: string }[];
    expect(mentions.map((m) => m.code)).toContain('FRANCHISE');
    expect(mentions.map((m) => m.text)).toContain('VAT exempt — small business scheme');
  });

  it('a seller country with NO known VAT/GST tax system (US) is left COMPLETELY untouched, with a named warning — never a silent guess', () => {
    const data = dataWithLines([{ description: 'x', quantity: 1, unitPrice: 100, vatRate: '37' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'US', taxScheme: 'FRANCHISE_BASE' },
      buyer: { countryCode: 'US' },
      data,
    });
    expect(result.crossBorder).toBe(false);
    expect(result.data).toBe(data); // same reference — nothing this catalog can safely rewrite
    expect(result.warnings.join(' ')).toMatch(/no VAT\/GST tax system is known for its own country/);
  });

  // NON-REGRESSION — DoD's own requirement: an ORDINARY (non-exempt) domestic seller must be
  // completely unaffected by any of the above, including the SAME OBJECT REFERENCE, not merely deep
  // equality — the exact guarantee `ResolveInvoiceCrossBorderTaxResult.data`'s own doc comment makes.
  it('a NORMAL seller (no taxScheme at all) is byte-identical to before this fix — same object reference', () => {
    const data = dataWithLines([{ description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '20' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.data).toBe(data);
    expect((result.data.lines as Record<string, unknown>[])[0].vatRate).toBe('20');
  });

  it('a seller explicitly marked taxScheme STANDARD is treated exactly like no scheme at all — same object reference', () => {
    const data = dataWithLines([{ description: 'Consulting', quantity: 1, unitPrice: 500, vatRate: '20' }]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR', taxScheme: 'STANDARD' },
      buyer: { countryCode: 'FR' },
      data,
    });
    expect(result.data).toBe(data);
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

// USER DECISION (2026-09-01, "the seller's own unresolved country used to silently fall back to
// 'FR'", now RESOLVED) — symmetric to the buyer block above: this function used to fall
// back to `'FR'` for an unresolvable SELLER country, the SAME class of bug the buyer block already
// exists to prevent. MUTATION TARGET: reinstating `?? 'FR'` on `sellerCC`
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

// OSS follow-up (2026-09-01): DE used to be the textbook example of "no destination
// rate table" — the OSS gate's own error message names it verbatim (see resolve-invoice-tax.ts's own
// header, "OSS with no destination rate table"). Germany's real standard VAT rate (19%) was read
// from the European Commission's TEDB (`tax-systems/data/de.json`'s own `provenance`) along
// with all 26 other EU member states — DE no longer blocks. The BLOCK MECHANISM itself is still
// exercised below, via dependency injection, against a registry that genuinely has no destination
// file — proving the gate did not get weakened, only the real-world DE gap got closed.
describe('resolveInvoiceCrossBorderTax — FR→DE B2C GOODS: OSS now resolves a REAL destination rate', () => {
  it('19% (DE’s real TEDB-sourced standard rate), category S, never the seller’s own 20%', () => {
    const data = dataWithLines([
      { description: 'Widgets', quantity: 1, unitPrice: 100, vatRate: '20', supplyType: 'GOODS' },
    ]);
    const result = resolveInvoiceCrossBorderTax({
      seller: { countryCode: 'FR' },
      buyer: { countryCode: 'DE' },
      data,
    });
    expect(result.crossBorder).toBe(true);
    const line = (result.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('19'); // DE's real standard rate, never FR's 20% and never invented
    expect(line.__crossBorderCategory).toBe('S');
    expect(result.warnings).toEqual([]);
  });

  it('re-resolving the already-resolved 19% OSS line is stable (idempotence — the same property the B2B paths already prove)', () => {
    const draft = dataWithLines([
      { description: 'Widgets', quantity: 2, unitPrice: 500, vatRate: '20', supplyType: 'GOODS' },
    ]);
    const parties = { seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' } };
    const firstPass = resolveInvoiceCrossBorderTax({ ...parties, data: draft });
    const secondPass = resolveInvoiceCrossBorderTax({ ...parties, data: firstPass.data });
    expect(secondPass.data).toEqual(firstPass.data);
    const line = (secondPass.data.lines as Record<string, unknown>[])[0];
    expect(line.vatRate).toBe('19');
  });

  it('FR→DE B2B (valid VAT) is UNCHANGED — the OSS branch never fires for B2B, reverse charge still applies', () => {
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
    expect(line.vatRate).toBe('0'); // intra-Community supply, never DE's 19% and never OSS
    expect(line.__crossBorderCategory).toBe('K');
  });
});

// The block mechanism itself, proven independently of whether any REAL country happens to be
// uncatalogued today: a registry built from a subset of files (FR only) has no DE profile, so the
// exact same gate `resolve-invoice-tax.ts` holds for the real (uncatalogued) case still fires here —
// this is what stays true even with the real-world DE/EU gap closed entirely.
describe('resolveInvoiceCrossBorderTax — the OSS block itself still fires for ANY uncatalogued destination', () => {
  it('a registry with no DE file (dependency-injected) still blocks FR→DE B2C GOODS, named', () => {
    const frOnly = ALL_TAX_SYSTEM_FILES.filter((f) => f.countryCode === 'FR');
    const registry = new TaxSystemRegistry(frOnly);
    const data = dataWithLines([
      { description: 'Widgets', quantity: 1, unitPrice: 100, vatRate: '20', supplyType: 'GOODS' },
    ]);
    expect(() =>
      resolveInvoiceCrossBorderTax(
        { seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' }, data },
        { taxSystemRegistry: registry },
      ),
    ).toThrow(UnsupportedOssDestinationError);
    expect(() =>
      resolveInvoiceCrossBorderTax(
        { seller: { countryCode: 'FR' }, buyer: { countryCode: 'DE' }, data },
        { taxSystemRegistry: registry },
      ),
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
 * The SURGICAL FIX: the resolved treatment is now PERSISTED at "sending"
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
    // send_failed retry's own preflight actually see.
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

describe('extractIssueDate', () => {
  it("reads the invoice's own issueDate, never the server clock", () => {
    const result = extractIssueDate({ issueDate: '2026-03-15' });
    expect(result.toISOString().slice(0, 10)).toBe('2026-03-15');
  });

  it('falls back to now for a missing issueDate', () => {
    const before = Date.now();
    const result = extractIssueDate({});
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back to now for an unparseable issueDate rather than propagating an Invalid Date', () => {
    const result = extractIssueDate({ issueDate: 'not-a-date' });
    expect(Number.isNaN(result.getTime())).toBe(false);
  });
});

describe('extractCurrency', () => {
  it("reads the invoice's own currency, uppercased", () => {
    expect(extractCurrency({ currency: 'pln' })).toBe('PLN');
    expect(extractCurrency({ currency: 'USD' })).toBe('USD');
  });

  it('falls back to EUR for a missing or blank currency — same default compute-totals.ts uses', () => {
    expect(extractCurrency({})).toBe('EUR');
    expect(extractCurrency({ currency: '   ' })).toBe('EUR');
    expect(extractCurrency({ currency: 42 })).toBe('EUR');
  });
});

describe('applyTaxResult — invariant guards against a misaligned or malformed DocumentTaxResult', () => {
  function fakeResult(lines: DocumentTaxResult['lines']): DocumentTaxResult {
    return { lines, reportingFlags: [], mentions: [], buyerSelfAssess: false };
  }

  const oneComponentTreatment = {
    components: [
      { taxSystem: 'VAT' as const, name: 'VAT', category: 'S' as const, rate: 20, jurisdiction: 'FR' },
    ],
    buyerSelfAssess: false,
    reportingFlags: [],
    mentions: [],
  };

  it('rewrites a row from its matching single-component treatment — the ordinary case', () => {
    const rows = [{ description: 'x' }];
    const result = fakeResult([{ lineId: '0', treatment: oneComponentTreatment }]);

    const { rows: clonedRows } = applyTaxResult(rows, result);

    expect(clonedRows[0].vatRate).toBe('20');
    expect(clonedRows[0].__crossBorderCategory).toBe('S');
  });

  it('refuses (never silently drops a row) when the engine returns fewer/more line results than rows', () => {
    const rows = [{ description: 'a' }, { description: 'b' }];
    const result = fakeResult([{ lineId: '0', treatment: oneComponentTreatment }]); // only 1, for 2 rows

    expect(() => applyTaxResult(rows, result)).toThrow(/returned 1 line result\(s\) for 2 invoice line/);
  });

  it('refuses (never TypeErrors on an empty array) when a treatment has ZERO components', () => {
    const rows = [{ description: 'x' }];
    const result = fakeResult([{ lineId: '0', treatment: { ...oneComponentTreatment, components: [] } }]);

    expect(() => applyTaxResult(rows, result)).toThrow(/returned 0 tax component\(s\) for line 1/);
  });

  it('refuses (never silently under-taxes with only the first) when a treatment has TWO components', () => {
    const rows = [{ description: 'x' }];
    const twoComponents = {
      ...oneComponentTreatment,
      components: [...oneComponentTreatment.components, { ...oneComponentTreatment.components[0], rate: 5 }],
    };
    const result = fakeResult([{ lineId: '0', treatment: twoComponents }]);

    expect(() => applyTaxResult(rows, result)).toThrow(/returned 2 tax component\(s\) for line 1/);
  });
});
