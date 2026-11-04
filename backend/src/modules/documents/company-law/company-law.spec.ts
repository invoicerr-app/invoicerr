import {
  CompanyLawCatalog,
  companyLawSettings,
  demoCompanyLaw,
  normalizeCompanyLawDetails,
} from './company-law';
import { assertValidCompanyLawSection, CompanyLawDemo, CountryCompanyLawFile } from './schema';

function demo(overrides: Partial<CompanyLawDemo> = {}): CompanyLawDemo {
  return {
    legalFormByNameSuffix: { Ltd: 'XX_LTD' },
    values: { shareCapital: { amount: '10000', currency: 'EUR' } },
    ...overrides,
  };
}

function section(overrides: Partial<CountryCompanyLawFile> = {}): CountryCompanyLawFile {
  return {
    countryCode: 'XX',
    legalFormLabel: 'Legal form',
    legalForms: [{ code: 'XX_LTD', name: 'Limited company', designation: 'Ltd' }],
    fields: [{ key: 'shareCapital', kind: 'money', label: 'Share capital' }],
    mentions: [
      {
        id: 'xx-capital',
        documentTypes: ['invoice'],
        legalForms: ['XX_LTD'],
        required: true,
        template: {
          en: '{legalForm}, capital {shareCapital}',
          fr: '{legalForm}, capital {shareCapital}',
          it: '{legalForm}, capitale {shareCapital}',
          pl: '{legalForm}, kapitał {shareCapital}',
          de: '{legalForm}, Kapital {shareCapital}',
          pt: '{legalForm}, capital {shareCapital}',
        },
        provenance: { kind: 'legal', sourceText: 'Some act, art. 1: "..."', sourceCheckedAt: '2026-10-25' },
      },
    ],
    ...overrides,
  };
}

describe('a country companyLaw section is refused at load time when', () => {
  it('a mention has no template for one of the languages a document renders in', () => {
    const file = section();
    delete (file.mentions[0].template as Partial<Record<string, string>>).pt;

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(/no "pt" template/);
  });

  it('a template quotes a field the section does not declare', () => {
    const file = section({ fields: [] });

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(
      /undeclared field "\{shareCapital\}"/,
    );
  });

  it('a mention names a legal form the section does not declare', () => {
    const file = section();
    file.mentions[0].legalForms = ['XX_PLC'];

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(/undeclared legal form "XX_PLC"/);
  });

  it('a legal form code does not carry its country, so it could mean another form elsewhere', () => {
    const file = section();
    file.legalForms[0].code = 'LTD';
    file.mentions[0].legalForms = ['LTD'];

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(/must start with "XX_"/);
  });

  it('a legal form declares a hasRegisterEntry that is not a boolean', () => {
    const file = section();
    file.legalForms[0].hasRegisterEntry = 'yes' as unknown as boolean;

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(
      /hasRegisterEntry that is not a boolean/,
    );
  });

  it('a mention carries no source', () => {
    const file = section();
    file.mentions[0].provenance = { kind: 'legal', sourceText: '', sourceCheckedAt: '2026-10-25' };

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(/quotes no sourceText/);
  });

  it('the demo cityProvinces is not a city-to-province map', () => {
    const file = section({ demo: demo({ cityProvinces: 'MI' as unknown as Record<string, string> }) });

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(
      /demo\.cityProvinces must map a city to a province/,
    );
  });

  it('the demo cityProvinces maps a city to no province', () => {
    const file = section({ demo: demo({ cityProvinces: { Milano: '' } }) });

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(
      /demo\.cityProvinces maps "Milano" to no province/,
    );
  });

  it('the demo uses {province} but declares no cityProvinces', () => {
    const file = section({
      fields: [
        { key: 'shareCapital', kind: 'money', label: 'Share capital' },
        { key: 'registerOfficeProvince', kind: 'text', label: 'Province' },
      ],
      demo: demo({ values: { registerOfficeProvince: '{province}' } }),
    });

    expect(() => assertValidCompanyLawSection(file, 'xx.json')).toThrow(
      /demo uses \{province\} but declares no cityProvinces/,
    );
  });
});

describe('the company settings ask, for each legal form, the values its mentions quote', () => {
  it('a French SAS is asked for its share capital and RCS city', () => {
    const sas = companyLawSettings('FR').legalForms.find((form) => form.code === 'FR_SAS');

    expect(sas?.fields).toEqual([
      { key: 'shareCapital', kind: 'money', label: 'Capital social', required: true },
      { key: 'registerCity', kind: 'text', label: 'Ville du greffe (RCS)', required: true },
    ]);
  });

  it('a French individual entrepreneur is offered the RCS city, never required, and no share capital', () => {
    const ei = companyLawSettings('FR').legalForms.find((form) => form.code === 'FR_EI');

    expect(ei?.fields).toEqual([
      { key: 'registerCity', kind: 'text', label: 'Ville du greffe (RCS)', required: false },
    ]);
  });

  it('an Italian S.r.l. is asked for the two extra FatturaPA facts, never required', () => {
    const srl = companyLawSettings('IT').legalForms.find((form) => form.code === 'IT_SRL');

    expect(srl?.fields).toEqual([
      {
        key: 'registerOffice',
        kind: 'text',
        label: 'Ufficio del registro delle imprese',
        required: true,
      },
      {
        key: 'registerNumber',
        kind: 'text',
        label: "Numero d'iscrizione al registro delle imprese",
        required: true,
      },
      {
        key: 'shareCapital',
        kind: 'money',
        label: 'Capitale sociale versato (da ultimo bilancio)',
        required: true,
      },
      {
        key: 'registerOfficeProvince',
        kind: 'text',
        label: "Sigla della provincia dell'ufficio del registro delle imprese (due lettere, e.g. MI)",
        required: false,
      },
      {
        key: 'liquidationStatus',
        kind: 'text',
        label: 'Stato di liquidazione: LN (non in liquidazione) o LS (in liquidazione)',
        required: false,
      },
    ]);
  });

  it('asks an Italian sole trader and an unlisted form for the register facts their entry carries', () => {
    const ditta = companyLawSettings('IT').legalForms.find((form) => form.code === 'IT_DITTA_INDIVIDUALE');
    const other = companyLawSettings('IT').legalForms.find((form) => form.code === 'IT_OTHER');
    const registerFacts = [
      {
        key: 'registerOfficeProvince',
        kind: 'text',
        label: "Sigla della provincia dell'ufficio del registro delle imprese (due lettere, e.g. MI)",
        required: false,
      },
      {
        key: 'liquidationStatus',
        kind: 'text',
        label: 'Stato di liquidazione: LN (non in liquidazione) o LS (in liquidazione)',
        required: false,
      },
    ];

    expect(ditta?.fields).toEqual(registerFacts);
    expect(other?.fields).toEqual(registerFacts);
  });

  it('asks an asked field for a form with a register entry even when no printed mention covers it', () => {
    const file = section({
      legalForms: [
        { code: 'XX_LTD', name: 'Limited company', designation: 'Ltd' },
        { code: 'XX_SOLE', name: 'Sole trader', designation: 'Sole trader', hasRegisterEntry: true },
      ],
      fields: [
        { key: 'shareCapital', kind: 'money', label: 'Share capital' },
        { key: 'registerProvince', kind: 'text', label: 'Register province', asked: true },
      ],
      mentions: [],
    });
    const settings = companyLawSettings('XX', new CompanyLawCatalog([file]));

    expect(settings.legalForms.find((form) => form.code === 'XX_LTD')?.fields).toEqual([]);
    expect(settings.legalForms.find((form) => form.code === 'XX_SOLE')?.fields).toEqual([
      { key: 'registerProvince', kind: 'text', label: 'Register province', required: false },
    ]);
  });

  it('a country with no companyLaw section asks for nothing', () => {
    expect(companyLawSettings('ES')).toEqual({ legalForms: [] });
  });
});

describe('the demo company-law values follow the city the demo seeds', () => {
  it('gives the province of the seeded city', () => {
    expect(demoCompanyLaw('IT', 'Torino Componenti SRL', 'Torino')).toEqual({
      legalForm: 'IT_SRL',
      values: {
        registerOffice: 'Torino',
        registerOfficeProvince: 'TO',
        registerNumber: '01234567890',
        shareCapital: { amount: '10000', currency: 'EUR' },
        liquidationStatus: 'LN',
      },
    });
  });

  it('follows every city the demo can draw', () => {
    const provinces = ['Milano', 'Torino', 'Bologna'].map(
      (city) => demoCompanyLaw('IT', 'Milano Servizi SRL', city)?.values?.registerOfficeProvince,
    );

    expect(provinces).toEqual(['MI', 'TO', 'BO']);
  });

  it('leaves the province out when the city is not in the demo table', () => {
    const details = demoCompanyLaw('IT', 'Torino Componenti SRL', 'Roma');

    expect(details?.values).not.toHaveProperty('registerOfficeProvince');
  });
});

describe('what a company submits is checked before it is stored', () => {
  it('keeps a legal form, text and an amount with its currency', () => {
    expect(
      normalizeCompanyLawDetails({
        legalForm: 'FR_SAS',
        values: { registerCity: ' Lyon ', shareCapital: { amount: '1000.50', currency: 'eur' } },
      }),
    ).toEqual({
      legalForm: 'FR_SAS',
      values: { registerCity: 'Lyon', shareCapital: { amount: '1000.50', currency: 'EUR' } },
    });
  });

  it('refuses an amount that is not a number', () => {
    expect(() =>
      normalizeCompanyLawDetails({ values: { shareCapital: { amount: '1 000', currency: 'EUR' } } }),
    ).toThrow(/shareCapital must be an amount/);
  });

  it('drops an empty value rather than storing it', () => {
    expect(normalizeCompanyLawDetails({ legalForm: '', values: { registerCity: '  ' } })).toEqual({
      legalForm: null,
      values: {},
    });
  });
});
