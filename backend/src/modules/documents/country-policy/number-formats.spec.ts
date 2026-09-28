/**
 * Issue #496 - the per-(country, document type) number formats: the shipped catalog, its load-time
 * gate, and how a company's running series composes with it. The catalog is read from the REAL data
 * files (`data/all.ts`), never a copy, so a data edit that breaks a rule fails here.
 */
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from '../descriptors/expense.descriptor';
import { buildGoodsReceiptDescriptor } from '../descriptors/goods-receipt.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildPurchaseOrderDescriptor } from '../descriptors/purchase-order.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { buildReceivedInvoiceDescriptor } from '../descriptors/received-invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { parseAtcudPattern } from '../numbering/atcud';
import { resolveNumberFormatFor } from '../numbering/company-number-format';
import { formatDocumentNumber } from '../numbering/format-number';
import { ALL_COUNTRY_POLICY_FILES } from './data/all';
import {
  assertValidNumberFormats,
  constraintsFor,
  numberViolations,
  patternViolations,
  WORST_CASE_SEQUENCE_NUMBER,
} from './number-formats';
import { CountryPolicyCatalog } from './registry';
import { CountryDocumentPolicyFile, CountryNumberFormats } from './schema';

const DESCRIPTORS: DocumentTypeDescriptor[] = [
  buildQuoteDescriptor(),
  buildInvoiceDescriptor(),
  buildCreditNoteDescriptor(),
  buildExpenseDescriptor(),
  buildReceivedInvoiceDescriptor(),
  buildPurchaseOrderDescriptor(),
  buildGoodsReceiptDescriptor(),
];
const NUMBERED_TYPE_IDS = DESCRIPTORS.filter((d) => d.numbering).map((d) => d.id);

function render(pattern: string, number: number): string {
  return formatDocumentNumber(pattern, { number, date: new Date(2026, 8, 28) });
}

describe('country-policy numberFormats - the shipped catalog (issue #496)', () => {
  it('every shipped country declares exactly one format for every document type that is numbered, and nothing else', () => {
    expect(NUMBERED_TYPE_IDS.sort()).toEqual([
      'credit-note',
      'goods-receipt',
      'invoice',
      'purchase-order',
      'quote',
    ]);
    for (const f of ALL_COUNTRY_POLICY_FILES) {
      const typeIds = (f.numberFormats?.formats ?? []).map((x) => x.typeId).sort();
      expect(typeIds, f.countryCode).toEqual([...NUMBERED_TYPE_IDS].sort());
    }
  });

  it('every shipped format satisfies its own constraints at the worst case, and every constraint carries provenance', () => {
    for (const f of ALL_COUNTRY_POLICY_FILES) {
      const formats = f.numberFormats as CountryNumberFormats;
      for (const format of formats.formats) {
        expect(
          patternViolations(format.pattern, constraintsFor(formats, format)),
          `${f.countryCode} ${format.typeId}`,
        ).toEqual([]);
      }
      for (const c of formats.constraints) {
        expect(['legal', 'unverified']).toContain(c.provenance.kind);
      }
    }
  });

  it("FR: invoice and credit-note numbers fit Chorus Pro B2G (20) and the platforms' character set, at number 999999", () => {
    for (const typeId of ['invoice', 'credit-note']) {
      const resolved = resolveNumberFormatFor('FR', typeId, null);
      const worst = render(resolved.pattern, WORST_CASE_SEQUENCE_NUMBER);
      expect(worst.length).toBeLessThanOrEqual(20);
      expect(worst).toMatch(/^[A-Za-z0-9 +_/-]+$/);
      expect(resolved.constraints.map((c) => c.id)).toEqual(
        expect.arrayContaining(['fr-cgi-242-nonies-a', 'fr-einvoicing-g1-05', 'fr-chorus-pro-b2g-20']),
      );
    }
  });

  it("IT: the credit-note number fits FatturaPA's <Numero> (20 Basic Latin, at least one digit) - the TD04 case of issue #496", () => {
    const resolved = resolveNumberFormatFor('IT', 'credit-note', null);
    expect(resolved.pattern).toBe('CN-{year}-{number:4}');
    expect(render(resolved.pattern, 1)).toBe('CN-2026-0001');
    expect(render(resolved.pattern, WORST_CASE_SEQUENCE_NUMBER).length).toBeLessThanOrEqual(20);
    // The pre-#496 default is exactly what the constraint refuses.
    expect(
      numberViolations('CREDIT-NOTE-2026-0001', resolved.constraints).map((v) => v.constraintId),
    ).toEqual(['it-fatturapa-numero-string20']);
  });

  it('PT: invoice and credit-note formats are ATCUD-compatible out of the box, one multi-year series', () => {
    expect(resolveNumberFormatFor('PT', 'invoice', null).pattern).toBe('FT A/{number}');
    expect(resolveNumberFormatFor('PT', 'credit-note', null).pattern).toBe('NC A/{number}');
    for (const typeId of ['invoice', 'credit-note']) {
      const { pattern } = resolveNumberFormatFor('PT', typeId, null);
      expect(parseAtcudPattern(pattern), pattern).toBeDefined();
      expect(pattern).not.toContain('{year}');
    }
  });

  it('a type no source constrains says so, in words, instead of silently carrying no constraint', () => {
    for (const f of ALL_COUNTRY_POLICY_FILES) {
      for (const format of f.numberFormats?.formats ?? []) {
        if (format.constrainedBy.length === 0)
          expect(format.unconstrained?.trim().length).toBeGreaterThan(40);
      }
    }
  });
});

describe('assertValidNumberFormats - the load-time gate', () => {
  function withFormats(numberFormats: CountryNumberFormats): CountryDocumentPolicyFile {
    return { countryCode: 'XX', rules: [], numberFormats };
  }
  const provenance = { kind: 'unverified' as const, resolutionNote: 'test' };
  const runningSeries = { summary: 'kept', onViolation: 'switch', provenance };

  it('refuses a shipped format its own constraints refuse at the worst case', () => {
    expect(() =>
      assertValidNumberFormats(
        withFormats({
          constraints: [
            { id: 'max-20', appliesTo: ['credit-note'], summary: 's', maxLength: 20, provenance },
          ],
          formats: [
            {
              typeId: 'credit-note',
              pattern: 'CREDIT-NOTE-{year}-{number:4}',
              constrainedBy: ['max-20'],
              rationale: 'r',
            },
          ],
          runningSeries,
        }),
        'test',
      ),
    ).toThrow(/breaks its own constraints.*max-20/);
  });

  it('refuses a constraint a format silently leaves out', () => {
    expect(() =>
      assertValidNumberFormats(
        withFormats({
          constraints: [{ id: 'max-20', appliesTo: ['invoice'], summary: 's', maxLength: 20, provenance }],
          formats: [
            {
              typeId: 'invoice',
              pattern: 'F-{number}',
              constrainedBy: [],
              unconstrained: 'u',
              rationale: 'r',
            },
          ],
          runningSeries,
        }),
        'test',
      ),
    ).toThrow(/does not list it/);
  });

  it('refuses a format with no constraint and no "unconstrained" statement', () => {
    expect(() =>
      assertValidNumberFormats(
        withFormats({
          constraints: [],
          formats: [{ typeId: 'quote', pattern: 'Q-{number}', constrainedBy: [], rationale: 'r' }],
          runningSeries,
        }),
        'test',
      ),
    ).toThrow(/no constraint and no "unconstrained"/);
  });

  it('refuses a constraint with no provenance', () => {
    expect(() =>
      assertValidNumberFormats(
        withFormats({
          constraints: [{ id: 'c', appliesTo: ['quote'], summary: 's', provenance: undefined as never }],
          formats: [{ typeId: 'quote', pattern: 'Q-{number}', constrainedBy: ['c'], rationale: 'r' }],
          runningSeries,
        }),
        'test',
      ),
    ).toThrow(/no valid provenance/);
  });
});

describe('resolveNumberFormatFor - the running series (issue #496)', () => {
  it('keeps a running series that satisfies every constraint', () => {
    const resolved = resolveNumberFormatFor('FR', 'invoice', { invoice: 'FAC-{year}-{number:5}' });
    expect(resolved).toMatchObject({ pattern: 'FAC-{year}-{number:5}', source: 'running-series' });
    expect(resolved.countryPattern).toBe('INVOICE-{year}-{number:4}');
  });

  it('reports the country format, not a "running series", when the running series IS the country format', () => {
    expect(resolveNumberFormatFor('FR', 'invoice', { invoice: 'INVOICE-{year}-{number:4}' }).source).toBe(
      'country-policy',
    );
  });

  it('drops a running series that breaks a constraint, naming what it broke', () => {
    const resolved = resolveNumberFormatFor('FR', 'credit-note', {
      'credit-note': 'CREDIT-NOTE-{year}-{number:4}',
    });
    expect(resolved.pattern).toBe('CN-{year}-{number:4}');
    expect(resolved.source).toBe('country-policy');
    expect(resolved.supersededRunningSeries?.violations.map((v) => v.constraintId)).toContain(
      'fr-chorus-pro-b2g-20',
    );
  });

  it('drops a Portuguese running series that cannot carry an ATCUD', () => {
    const resolved = resolveNumberFormatFor('PT', 'invoice', { invoice: 'INVOICE-{year}-{number:4}' });
    expect(resolved.pattern).toBe('FT A/{number}');
    expect(resolved.supersededRunningSeries?.violations.map((v) => v.constraintId)).toContain(
      'pt-at-faq-4310',
    );
  });

  it('keeps a Portuguese per-year ATCUD series a company already runs', () => {
    expect(resolveNumberFormatFor('PT', 'invoice', { invoice: 'FT {year}/{number:4}' })).toMatchObject({
      pattern: 'FT {year}/{number:4}',
      source: 'running-series',
    });
  });

  it('a German running series is never dropped for its characters or length - no German rule constrains them', () => {
    expect(
      resolveNumberFormatFor('DE', 'invoice', { invoice: 'RE {year} / Kunde Nr. {number:8}' }).source,
    ).toBe('running-series');
  });

  it('a broken legacy pattern (no {number}) falls back to the country format instead of failing', () => {
    const resolved = resolveNumberFormatFor('DE', 'invoice', { invoice: 'RE-{year}' });
    expect(resolved.pattern).toBe('INVOICE-{year}-{number:4}');
    expect(resolved.supersededRunningSeries?.violations[0].constraintId).toBe('pattern');
  });

  it('refuses a country with no catalog - there is no fallback format', () => {
    expect(() => resolveNumberFormatFor('US', 'invoice', null)).toThrow(/No document number format/);
    expect(() => resolveNumberFormatFor(undefined, 'invoice', null)).toThrow(/could not be resolved/);
    expect(() =>
      resolveNumberFormatFor(
        'FR',
        'invoice',
        null,
        new CountryPolicyCatalog([{ countryCode: 'FR', rules: [] }]),
      ),
    ).toThrow(/No document number format/);
  });
});
