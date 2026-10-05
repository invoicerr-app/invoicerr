import { localizedMention } from './tax-engine';
import { LOCALIZABLE_SITUATIONS, LocalizableSituation } from './localized-mentions';
import { ALL_COMPOSED_COUNTRY_FILES } from '../countries/data/all';

const GENERIC: Record<LocalizableSituation, { code: string; text: string }> = {
  reverseCharge: {
    code: 'REVERSE_CHARGE',
    text: 'Autoliquidation / Reverse charge \u2014 Art. 196 Directive 2006/112/EC',
  },
  intraComm: {
    code: 'INTRA_COMMUNITY',
    text: 'Intra-Community supply \u2014 Art. 138 Directive 2006/112/EC',
  },
  exportGoods: { code: 'EXPORT', text: 'Export \u2014 zero-rated, Art. 146 Directive 2006/112/EC' },
  franchise: { code: 'FRANCHISE', text: 'VAT exempt \u2014 small business scheme' },
};

// The per-(situation, country) overrides exactly as `tax-engine.ts` held them before they moved into
// each country's data file.
const LEGACY_OVERRIDES: Partial<
  Record<LocalizableSituation, Record<string, { code: string; text: string }>>
> = {
  franchise: {
    FR: { code: 'FR_293B', text: 'TVA non applicable, art. 293 B du CGI' },
    PT: { code: 'PT_REGIME_ISENCAO', text: 'IVA - regime de isenção' },
  },
  reverseCharge: {
    PT: { code: 'PT_IVA_AUTOLIQUIDACAO', text: 'IVA - autoliquidação' },
    IT: { code: 'IT_INVERSIONE_CONTABILE', text: 'inversione contabile' },
    PL: { code: 'PL_ODWROTNE_OBCIAZENIE', text: 'odwrotne obciążenie' },
    DE: { code: 'DE_STEUERSCHULDNERSCHAFT', text: 'Steuerschuldnerschaft des Leistungsempfängers' },
  },
  exportGoods: {
    IT: { code: 'IT_OPERAZIONE_NON_IMPONIBILE_EXPORT', text: 'operazione non imponibile' },
  },
  intraComm: {
    IT: { code: 'IT_OPERAZIONE_NON_IMPONIBILE_ICS', text: 'operazione non imponibile' },
  },
};

function legacyResolve(situation: LocalizableSituation, countryCode: string) {
  return LEGACY_OVERRIDES[situation]?.[countryCode.toUpperCase()] ?? GENERIC[situation];
}

const COUNTRIES = ['FR', 'PT', 'IT', 'PL', 'DE', 'DZ', 'US', 'ES', 'BE', 'XX', ''];

describe('localizedMention: country data resolves exactly what the former in-code table did', () => {
  for (const situation of LOCALIZABLE_SITUATIONS) {
    it(`${situation}: identical code and text for every country, upper and lower case`, () => {
      for (const country of COUNTRIES) {
        for (const input of [country, country.toLowerCase()]) {
          expect(localizedMention(situation, input)).toEqual(legacyResolve(situation, input));
        }
      }
    });
  }

  it('the data declares exactly the legacy overrides, no more and no fewer', () => {
    const declared: Record<string, Record<string, { code: string; text: string }>> = {};
    for (const file of ALL_COMPOSED_COUNTRY_FILES) {
      for (const [situation, fact] of Object.entries(file.localizedMentions?.situations ?? {})) {
        declared[situation] ??= {};
        declared[situation][file.countryCode] = { code: fact.code, text: fact.text };
      }
    }
    expect(declared).toEqual(LEGACY_OVERRIDES);
  });

  it('every entry quotes its source', () => {
    for (const file of ALL_COMPOSED_COUNTRY_FILES) {
      for (const fact of Object.values(file.localizedMentions?.situations ?? {})) {
        expect(fact.source.length).toBeGreaterThan(10);
      }
    }
  });
});
