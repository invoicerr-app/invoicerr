/**
 * P2-T08 (A4) — BT-23, the French "cadre de facturation", cardinality 1..1.
 *
 * Machine translation of the statutory mention 8° bis of CGI ann. II art. 242 nonies A: the
 * category of operation — goods, services, or both — mandatory from 2026-09-01, limitative values
 * `B1 S1 M1 B2 S2 M2 B4 S4 M4 S5 S6 B7 S7`. An invoice without a valid BT-23 fails the PPF's
 * functional controls.
 *
 * The defect: @e-invoice-eu/core emits `M1` HARDCODED, from the UBL ProfileID. Every French invoice
 * therefore declared itself "mixte" whatever it contained — a pure services invoice claiming to
 * carry goods, and vice versa. The value was present and wrong on two thirds of the cases, which is
 * why a presence check would not have caught it.
 */
import { applyFrenchBusinessProcess, frenchBusinessProcessCode } from './providers';

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

  it('handles the prefix-less namespace style superpdp uses', () => {
    const noPrefix =
      `<CrossIndustryInvoice><ExchangedDocumentContext>` +
      `<BusinessProcessSpecifiedDocumentContextParameter><ID>M1</ID>` +
      `</BusinessProcessSpecifiedDocumentContextParameter></ExchangedDocumentContext></CrossIndustryInvoice>`;
    expect(applyFrenchBusinessProcess(noPrefix, 'B1')).toContain('<ID>B1</ID>');
  });
});
