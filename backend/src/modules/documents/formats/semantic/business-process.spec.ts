/**
 * REPRISE quasi verbatim de `compliance/providers/format/bt23-business-process.spec.ts`
 * (git tag `avant-refonte-documents`) — seul l'import a changé. `frenchBusinessProcessCode`/
 * `applyFrenchBusinessProcess` are proven here in isolation; the country-conditional WIRING
 * (`resolveFrenchBusinessProcessCode`, sourced from `../../content-requirements/`) is proven below,
 * and end to end (real CII/UBL/Factur-X output) in `../providers.spec.ts` and
 * `../facturx-provider.spec.ts` — see `business-process.ts`'s own header for the full wiring.
 */
import {
  applyFrenchBusinessProcess,
  applyFrenchBusinessProcessInObject,
  frenchBusinessProcessCode,
  resolveFrenchBusinessProcessCode,
} from './business-process';

const LIMITATIVE = ['B1', 'S1', 'M1', 'B2', 'S2', 'M2', 'B4', 'S4', 'M4', 'S5', 'S6', 'B7', 'S7'];

describe('frenchBusinessProcessCode — the category comes from what the invoice contains', () => {
  it('goods only → B1', () => {
    expect(frenchBusinessProcessCode(['GOODS'])).toBe('B1');
  });

  it('services only → S1 — the case the hardcoded M1 got wrong', () => {
    expect(frenchBusinessProcessCode(['SERVICES'])).toBe('S1');
  });

  it('both → M1', () => {
    expect(frenchBusinessProcessCode(['GOODS', 'SERVICES'])).toBe('M1');
    expect(frenchBusinessProcessCode(['SERVICES', 'GOODS'])).toBe('M1');
  });

  it('no supply type → M1, the only value that asserts nothing false about the content', () => {
    expect(frenchBusinessProcessCode([])).toBe('M1');
  });

  it('every derived value is in the limitative list', () => {
    for (const supplies of [['GOODS'], ['SERVICES'], ['GOODS', 'SERVICES'], []] as const) {
      expect(LIMITATIVE).toContain(frenchBusinessProcessCode(supplies));
    }
  });
});

describe('applyFrenchBusinessProcess — cardinality 1..1', () => {
  const withBt23 = (id: string) =>
    `<rsm:CrossIndustryInvoice><rsm:ExchangedDocumentContext>` +
    `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${id}</ram:ID>` +
    `</ram:BusinessProcessSpecifiedDocumentContextParameter>` +
    `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID>` +
    `</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext></rsm:CrossIndustryInvoice>`;

  it('rewrites the hardcoded M1 to the derived category', () => {
    const out = applyFrenchBusinessProcess(withBt23('M1'), 'S1');
    expect(out).toContain('<ram:ID>S1</ram:ID>');
    expect(out).not.toContain('<ram:ID>M1</ram:ID>');
  });

  it('leaves the guideline parameter alone — only BT-23 is rewritten', () => {
    const out = applyFrenchBusinessProcess(withBt23('M1'), 'B1');
    expect(out).toContain('urn:cen.eu:en16931:2017');
  });

  it('inserts BT-23 when absent — 1..1 means it cannot be left out', () => {
    const without =
      `<rsm:CrossIndustryInvoice><rsm:ExchangedDocumentContext>` +
      `<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID>` +
      `</ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext></rsm:CrossIndustryInvoice>`;
    const out = applyFrenchBusinessProcess(without, 'S1');
    expect(out).toContain('BusinessProcessSpecifiedDocumentContextParameter');
    expect(out).toContain('<ram:ID>S1</ram:ID>');
  });

  it('handles the prefix-less namespace style some CTC receivers use', () => {
    const noPrefix =
      `<CrossIndustryInvoice><ExchangedDocumentContext>` +
      `<BusinessProcessSpecifiedDocumentContextParameter><ID>M1</ID>` +
      `</BusinessProcessSpecifiedDocumentContextParameter></ExchangedDocumentContext></CrossIndustryInvoice>`;
    expect(applyFrenchBusinessProcess(noPrefix, 'B1')).toContain('<ID>B1</ID>');
  });
});

describe('resolveFrenchBusinessProcessCode — the country-conditional trigger', () => {
  it('a French seller, on or after the shipped content-requirement mandatedFrom (2026-09-01): resolves a code', () => {
    expect(resolveFrenchBusinessProcessCode('FR', '2026-09-01', ['GOODS'])).toBe('B1');
    expect(resolveFrenchBusinessProcessCode('FR', '2026-09-01', ['SERVICES'])).toBe('S1');
    expect(resolveFrenchBusinessProcessCode('FR', '2026-09-01', [])).toBe('M1');
  });

  it('a French seller BEFORE mandatedFrom: no code — the rule follows the invoice, not the server clock', () => {
    expect(resolveFrenchBusinessProcessCode('FR', '2026-08-31', ['GOODS'])).toBeUndefined();
  });

  // MUTATION TARGET: applying BT-23 unconditionally regardless of seller country would make this
  // (and every non-FR fixture in providers.spec.ts/facturx-provider.spec.ts) fail.
  it('a non-French seller: never resolves a code, whatever the supply types', () => {
    expect(resolveFrenchBusinessProcessCode('US', '2026-09-01', ['GOODS'])).toBeUndefined();
    expect(resolveFrenchBusinessProcessCode('DE', '2027-01-01', ['GOODS', 'SERVICES'])).toBeUndefined();
    expect(resolveFrenchBusinessProcessCode(undefined, '2027-01-01', ['GOODS'])).toBeUndefined();
  });
});

describe('applyFrenchBusinessProcessInObject — the object-level equivalent, for the Factur-X postProcessor', () => {
  it('inserts BT-23 as the ExchangedDocumentContext child, mirroring the CII destination', () => {
    const cii = {
      'rsm:CrossIndustryInvoice': {
        'rsm:ExchangedDocumentContext': {
          'ram:GuidelineSpecifiedDocumentContextParameter': { 'ram:ID': 'urn:cen.eu:en16931:2017' },
        },
      },
    };
    applyFrenchBusinessProcessInObject(cii, 'S1');
    expect(
      (cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocumentContext'] as Record<string, unknown>)[
        'ram:BusinessProcessSpecifiedDocumentContextParameter'
      ],
    ).toEqual({ 'ram:ID': 'S1' });
    // The guideline parameter is left alone — only BT-23 is rewritten, same as the string version.
    expect(
      (cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocumentContext'] as Record<string, unknown>)[
        'ram:GuidelineSpecifiedDocumentContextParameter'
      ],
    ).toEqual({ 'ram:ID': 'urn:cen.eu:en16931:2017' });
  });

  it('rewrites an EXISTING BusinessProcessSpecifiedDocumentContextParameter rather than duplicating it', () => {
    const cii = {
      'rsm:CrossIndustryInvoice': {
        'rsm:ExchangedDocumentContext': {
          'ram:BusinessProcessSpecifiedDocumentContextParameter': {
            'ram:ID': 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0',
          },
        },
      },
    };
    applyFrenchBusinessProcessInObject(cii, 'M1');
    expect(
      (cii['rsm:CrossIndustryInvoice']['rsm:ExchangedDocumentContext'] as Record<string, unknown>)[
        'ram:BusinessProcessSpecifiedDocumentContextParameter'
      ],
    ).toEqual({ 'ram:ID': 'M1' });
  });

  it('a no-op when there is no ExchangedDocumentContext to attach BT-23 to', () => {
    const cii: Record<string, unknown> = {};
    expect(() => applyFrenchBusinessProcessInObject(cii, 'B1')).not.toThrow();
    expect(cii).toEqual({});
  });
});
