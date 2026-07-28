/**
 * Provider unit tests — identifier checks and response mapping.
 * Every HTTP call is mocked with a payload captured from the real registry.
 */
import { AustraliaAbrProvider, isValidAbn, unwrapJsonp } from './au.provider';
import { BrazilCnpjProvider, isValidCnpj } from './br.provider';
import { ColombiaRuesProvider } from './co.provider';
import { CzechAresProvider, isValidIco } from './cz.provider';
import { DenmarkCvrProvider } from './dk.provider';
import { FinlandPrhProvider, formatBusinessId } from './fi.provider';
import { FranceProvider, isValidSiren, toFrenchQueryKey } from './fr.provider';
import { UkCompaniesHouseProvider } from './gb.provider';
import { GleifProvider, isLei } from './gleif.provider';
import { IsraelRegistrarProvider } from './il.provider';
import { NorwayBrregProvider } from './no.provider';
import { PeruSunatProvider, isValidRuc } from './pe.provider';
import { PeppolDirectoryProvider } from './peppol-directory.provider';
import { PolandWykazProvider, isValidNip, parsePolishAddress } from './pl.provider';
import { RomaniaAnafProvider } from './ro.provider';
import { SlovakRpoProvider } from './sk.provider';
import { TaiwanGcisProvider, fromMinguoDate, isValidBan } from './tw.provider';
import { VietnamTaxCodeProvider } from './vn.provider';
import { ViesProvider, parseViesAddress } from './vies.provider';

function mockJson(payload: unknown, init: Partial<Response> = {}) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    ...init,
  } as Response);
}

afterEach(() => jest.restoreAllMocks());

describe('identifier checks', () => {
  it('validates SIREN with the Luhn checksum', () => {
    expect(isValidSiren('552081317')).toBe(true); // L'Oréal
    expect(isValidSiren('552081318')).toBe(false);
    expect(isValidSiren('55208131')).toBe(false);
  });

  it('validates IČO with the mod-11 checksum', () => {
    expect(isValidIco('45274649')).toBe(true); // ČEZ
    expect(isValidIco('45274648')).toBe(false);
  });

  it('validates NIP with the mod-11 checksum', () => {
    expect(isValidNip('5260250274')).toBe(true); // Ministerstwo Finansów
    expect(isValidNip('5260250275')).toBe(false);
  });

  it('validates CNPJ, RUC and ABN', () => {
    expect(isValidCnpj('19.131.243/0001-97')).toBe(true);
    expect(isValidCnpj('19131243000198')).toBe(false);
    expect(isValidRuc('20131312955')).toBe(true); // SUNAT
    expect(isValidRuc('20131312954')).toBe(false);
    expect(isValidAbn('51 824 753 556')).toBe(true); // CSIRO
    expect(isValidAbn('51824753557')).toBe(false);
  });

  it('normalizes Finnish business ids to 1234567-8', () => {
    expect(formatBusinessId('01120389')).toBe('0112038-9');
    expect(formatBusinessId('0112038-9')).toBe('0112038-9');
    expect(formatBusinessId('123')).toBeNull();
  });

  it('accepts SIRET, SIREN and VAT for France', () => {
    expect(toFrenchQueryKey({ countryCode: 'FR', scheme: 'LEGAL_ID', value: '552 081 317 00018' })).toBe(
      '55208131700018',
    );
    expect(toFrenchQueryKey({ countryCode: 'FR', scheme: 'LEGAL_ID', value: '552081317' })).toBe('552081317');
    expect(toFrenchQueryKey({ countryCode: 'FR', scheme: 'VAT', value: 'FR03552081317' })).toBe('552081317');
    expect(toFrenchQueryKey({ countryCode: 'FR', scheme: 'LEGAL_ID', value: 'abc' })).toBeNull();
  });
});

describe('address parsing', () => {
  it('splits a VIES address into street / postal code / city', () => {
    expect(parseViesAddress('VIA EMILIA EST 1163 \n41122 MODENA MO\n')).toEqual({
      address: 'VIA EMILIA EST 1163',
      postalCode: '41122',
      city: 'MODENA MO',
    });
    expect(parseViesAddress('ul. Świętokrzyska 12, 00-916 Warszawa')).toEqual({
      address: 'ul. Świętokrzyska 12',
      postalCode: '00-916',
      city: 'Warszawa',
    });
    expect(parseViesAddress(undefined)).toEqual({});
  });

  it('splits the Polish register address', () => {
    expect(parsePolishAddress('ŚWIĘTOKRZYSKA 12, 00-916 WARSZAWA')).toEqual({
      address: 'ŚWIĘTOKRZYSKA 12',
      postalCode: '00-916',
      city: 'WARSZAWA',
    });
  });
});

describe('ViesProvider', () => {
  const provider = new ViesProvider();

  it('maps a valid VAT number with a disclosed name', async () => {
    mockJson({
      isValid: true,
      userError: 'VALID',
      name: 'FERRARI S.P.A.',
      address: 'VIA EMILIA EST 1163 \n41122 MODENA MO\n',
    });
    const company = await provider.lookup({ countryCode: 'IT', scheme: 'VAT', value: 'IT00159560366' });
    expect(company).toMatchObject({
      name: 'FERRARI S.P.A.',
      VAT: 'IT00159560366',
      city: 'MODENA MO',
      vatRegistered: true,
    });
  });

  it('still confirms the number when the member state hides the name', async () => {
    mockJson({ isValid: true, userError: 'VALID', name: '---', address: '---' });
    const company = await provider.lookup({ countryCode: 'DE', scheme: 'VAT', value: 'DE811115368' });
    expect(company).toMatchObject({ name: 'DE811115368', VAT: 'DE811115368', vatRegistered: true });
    expect(company?.legalName).toBeUndefined();
  });

  it('returns null for an invalid number and raises on a saturated member state', async () => {
    mockJson({ isValid: false, userError: 'INVALID' });
    await expect(
      provider.lookup({ countryCode: 'NL', scheme: 'VAT', value: 'NL000000000B01' }),
    ).resolves.toBeNull();

    mockJson({ isValid: false, userError: 'MS_MAX_CONCURRENT_REQ' });
    await expect(
      provider.lookup({ countryCode: 'FR', scheme: 'VAT', value: 'FR44732829320' }),
    ).rejects.toThrow(/MS_MAX_CONCURRENT_REQ/);
  });

  it('addresses Greece as EL and rejects non-EU countries', () => {
    expect(provider.supports({ countryCode: 'GR', scheme: 'VAT', value: 'EL094014249' })).toBe(true);
    expect(provider.supports({ countryCode: 'US', scheme: 'VAT', value: '123456789' })).toBe(false);
    expect(provider.supports({ countryCode: 'FR', scheme: 'LEGAL_ID', value: '55208131700018' })).toBe(false);
  });
});

describe('FranceProvider', () => {
  const provider = new FranceProvider();

  it('maps the head office of a SIRET query', async () => {
    mockJson({
      results: [
        {
          siren: '552081317',
          nom_complet: "L'OREAL",
          nom_raison_sociale: 'L OREAL',
          date_creation: '1909-01-01',
          siege: {
            siret: '55208131700018',
            adresse: '14 RUE ROYALE',
            code_postal: '75008',
            libelle_commune: 'PARIS',
          },
        },
      ],
    });
    const company = await provider.lookup({ countryCode: 'FR', scheme: 'LEGAL_ID', value: '55208131700018' });
    expect(company).toMatchObject({
      name: "L'OREAL",
      legalId: '55208131700018',
      legalIdScheme: 'SIRET',
      VAT: 'FR03552081317',
      city: 'PARIS',
      countryCode: 'FR',
    });
  });

  it('rejects a SIRET that is not the head office', async () => {
    mockJson({
      results: [{ siren: '552081317', nom_complet: "L'OREAL", siege: { siret: '55208131700018' } }],
    });
    await expect(
      provider.lookup({ countryCode: 'FR', scheme: 'LEGAL_ID', value: '55208131700026' }),
    ).resolves.toBeNull();
  });
});

describe('CzechAresProvider', () => {
  it('maps the ARES payload', async () => {
    mockJson({
      ico: '45274649',
      obchodniJmeno: 'ČEZ, a. s.',
      dic: 'CZ45274649',
      datumVzniku: '1992-05-06',
      sidlo: {
        nazevStatu: 'Česká republika',
        nazevObce: 'Praha',
        nazevKraje: 'Hlavní město Praha',
        psc: 14000,
        textovaAdresa: 'Duhová 1444/2, Michle, 14000 Praha 4',
      },
    });
    const company = await new CzechAresProvider().lookup({
      countryCode: 'CZ',
      scheme: 'LEGAL_ID',
      value: '45274649',
    });
    expect(company).toMatchObject({
      name: 'ČEZ, a. s.',
      legalId: '45274649',
      legalIdScheme: 'ICO',
      VAT: 'CZ45274649',
      postalCode: '14000',
      city: 'Praha',
      countryCode: 'CZ',
    });
  });
});

describe('SlovakRpoProvider', () => {
  it('picks the entries currently in force', async () => {
    mockJson({
      results: [
        {
          identifiers: [{ value: '35697270', validFrom: '1996-09-03' }],
          fullNames: [
            { value: 'GLOBTEL GSM a.s.', validFrom: '1996-12-20', validTo: '1997-10-23' },
            { value: 'Orange Slovensko, a.s.', validFrom: '2002-04-01' },
          ],
          addresses: [
            {
              street: 'Prievozská',
              buildingNumber: '6/A',
              postalCodes: ['82109'],
              municipality: { value: 'Bratislava' },
              validFrom: '1999-10-13',
              validTo: '2012-07-31',
            },
            {
              street: 'Metodova',
              buildingNumber: '8',
              postalCodes: ['82108'],
              municipality: { value: 'Bratislava' },
              validFrom: '2012-08-01',
              country: { value: 'Slovenská republika' },
            },
          ],
        },
      ],
    });
    const company = await new SlovakRpoProvider().lookup({
      countryCode: 'SK',
      scheme: 'LEGAL_ID',
      value: '35697270',
    });
    expect(company).toMatchObject({
      name: 'Orange Slovensko, a.s.',
      address: 'Metodova 8',
      postalCode: '82108',
      city: 'Bratislava',
    });
  });
});

describe('PolandWykazProvider', () => {
  const provider = new PolandWykazProvider();

  it('maps an active VAT taxpayer', async () => {
    mockJson({
      result: {
        subject: {
          name: 'MINISTERSTWO FINANSÓW',
          nip: '5260250274',
          statusVat: 'Czynny',
          workingAddress: 'ŚWIĘTOKRZYSKA 12, 00-916 WARSZAWA',
          registrationLegalDate: '1996-01-01',
        },
      },
    });
    const company = await provider.lookup({ countryCode: 'PL', scheme: 'LEGAL_ID', value: '526-025-02-74' });
    expect(company).toMatchObject({
      name: 'MINISTERSTWO FINANSÓW',
      legalId: '5260250274',
      VAT: 'PL5260250274',
      city: 'WARSZAWA',
      vatRegistered: true,
    });
  });

  it('returns null when the register has no such NIP', async () => {
    mockJson({ result: { subject: null } });
    await expect(
      provider.lookup({ countryCode: 'PL', scheme: 'LEGAL_ID', value: '5260250274' }),
    ).resolves.toBeNull();
  });
});

describe('RomaniaAnafProvider', () => {
  it('maps the ANAF payload and its VAT flag', async () => {
    mockJson({
      found: [
        {
          date_generale: {
            cui: 14399840,
            denumire: 'DANTE INTERNATIONAL SA',
            data_inregistrare: '2002-01-23',
            adresa: 'BUCUREŞTI',
          },
          inregistrare_scop_Tva: { scpTVA: true },
          stare_inactiv: { statusInactivi: false },
          adresa_sediu_social: {
            sdenumire_Strada: 'Şos. Virtuţii',
            snumar_Strada: '148',
            scod_Postal: '60787',
            sdenumire_Localitate: 'Sector 6 Mun. Bucureşti',
            sdenumire_Judet: 'MUNICIPIUL BUCUREŞTI',
          },
        },
      ],
    });
    const company = await new RomaniaAnafProvider().lookup({
      countryCode: 'RO',
      scheme: 'LEGAL_ID',
      value: 'RO14399840',
    });
    expect(company).toMatchObject({
      name: 'DANTE INTERNATIONAL SA',
      legalId: '14399840',
      VAT: 'RO14399840',
      postalCode: '60787',
      state: 'MUNICIPIUL BUCUREŞTI',
      vatRegistered: true,
    });
  });
});

describe('NorwayBrregProvider', () => {
  it('maps the Enhetsregisteret payload', async () => {
    mockJson({
      organisasjonsnummer: '923609016',
      navn: 'EQUINOR ASA',
      registrertIMvaregisteret: true,
      stiftelsesdato: '1972-09-18',
      konkurs: false,
      forretningsadresse: {
        adresse: ['Forusbeen 50'],
        postnummer: '4035',
        poststed: 'STAVANGER',
        land: 'Norge',
      },
    });
    const company = await new NorwayBrregProvider().lookup({
      countryCode: 'NO',
      scheme: 'LEGAL_ID',
      value: '923 609 016',
    });
    expect(company).toMatchObject({
      name: 'EQUINOR ASA',
      legalId: '923609016',
      VAT: 'NO923609016MVA',
      address: 'Forusbeen 50',
      city: 'STAVANGER',
      status: 'ACTIVE',
    });
  });
});

describe('DenmarkCvrProvider', () => {
  it('maps the CVR payload including the dd/mm - yyyy start date', async () => {
    mockJson({
      vat: 25313763,
      name: 'ARLA FOODS AMBA',
      address: 'Sønderhøj 14',
      zipcode: '8260',
      city: 'Viby J',
      startdate: '17/04 - 2000',
    });
    const company = await new DenmarkCvrProvider().lookup({
      countryCode: 'DK',
      scheme: 'LEGAL_ID',
      value: 'DK25313763',
    });
    expect(company).toMatchObject({
      name: 'ARLA FOODS AMBA',
      legalId: '25313763',
      VAT: 'DK25313763',
      city: 'Viby J',
    });
    expect(company?.foundedAt?.toISOString().slice(0, 10)).toBe('2000-04-17');
  });
});

describe('FinlandPrhProvider', () => {
  it('picks the current name and the visiting address', async () => {
    mockJson({
      companies: [
        {
          businessId: { value: '0112038-9', registrationDate: '1978-03-15' },
          names: [{ name: 'Nokia Oyj', type: '1', registrationDate: '1997-09-01' }],
          addresses: [
            {
              type: 1,
              street: 'Karakaari',
              buildingNumber: '7',
              postCode: '02610',
              postOffices: [
                { city: 'ESBO', languageCode: '2' },
                { city: 'ESPOO', languageCode: '1' },
              ],
            },
          ],
        },
      ],
    });
    const company = await new FinlandPrhProvider().lookup({
      countryCode: 'FI',
      scheme: 'LEGAL_ID',
      value: '0112038-9',
    });
    expect(company).toMatchObject({
      name: 'Nokia Oyj',
      legalId: '0112038-9',
      VAT: 'FI01120389',
      address: 'Karakaari 7',
      postalCode: '02610',
      city: 'ESPOO',
    });
  });
});

describe('UkCompaniesHouseProvider', () => {
  const provider = new UkCompaniesHouseProvider();

  it('stays dormant without an API key', () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    expect(provider.isConfigured()).toBe(false);
  });

  it('zero-pads numeric company numbers and maps the payload', async () => {
    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    const spy = mockJson({
      company_number: '00000006',
      company_name: 'MARINE AND GENERAL MUTUAL LIFE ASSURANCE SOCIETY',
      company_status: 'active',
      date_of_creation: '1862-01-01',
      registered_office_address: {
        address_line_1: '1 Some Street',
        locality: 'London',
        postal_code: 'EC1A 1AA',
      },
    });
    const company = await provider.lookup({ countryCode: 'GB', scheme: 'LEGAL_ID', value: '6' });
    expect(spy.mock.calls[0][0]).toContain('/company/00000006');
    expect(company).toMatchObject({
      legalId: '00000006',
      city: 'London',
      postalCode: 'EC1A 1AA',
      status: 'ACTIVE',
    });
    delete process.env.COMPANIES_HOUSE_API_KEY;
  });
});

describe('BrazilCnpjProvider', () => {
  it('maps the Receita Federal payload', async () => {
    mockJson({
      cnpj: '19131243000197',
      razao_social: 'OPEN KNOWLEDGE BRASIL',
      nome_fantasia: 'REDE PELO CONHECIMENTO LIVRE',
      logradouro: 'PAULISTA',
      numero: '37',
      municipio: 'SAO PAULO',
      uf: 'SP',
      cep: '01311902',
      data_inicio_atividade: '2013-10-03',
      descricao_situacao_cadastral: 'ATIVA',
    });
    const company = await new BrazilCnpjProvider().lookup({
      countryCode: 'BR',
      scheme: 'LEGAL_ID',
      value: '19.131.243/0001-97',
    });
    expect(company).toMatchObject({
      name: 'REDE PELO CONHECIMENTO LIVRE',
      legalName: 'OPEN KNOWLEDGE BRASIL',
      legalIdScheme: 'CNPJ',
      postalCode: '01311-902',
      state: 'SP',
      status: 'ACTIVE',
    });
  });
});

describe('PeruSunatProvider', () => {
  it('maps the SUNAT payload', async () => {
    mockJson({
      nombre: 'SUNAT',
      numeroDocumento: '20131312955',
      direccion: 'AV. GARCILASO DE LA VEGA NRO 1472',
      distrito: 'LIMA',
      departamento: 'LIMA',
      estado: 'ACTIVO',
    });
    const company = await new PeruSunatProvider().lookup({
      countryCode: 'PE',
      scheme: 'LEGAL_ID',
      value: '20131312955',
    });
    expect(company).toMatchObject({ name: 'SUNAT', legalIdScheme: 'RUC', city: 'LIMA', status: 'ACTIVE' });
  });
});

describe('AustraliaAbrProvider', () => {
  const provider = new AustraliaAbrProvider();

  it('unwraps the JSONP envelope', () => {
    expect(unwrapJsonp('callback({"Abn":"51824753556"})')).toEqual({ Abn: '51824753556' });
    expect(() => unwrapJsonp('not jsonp')).toThrow();
  });

  it('reports an unregistered GUID as a configuration problem', async () => {
    process.env.ABR_GUID = 'bad-guid';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        'callback({"Abn":"","Message":"The GUID entered is not recognised as a Registered Party"})',
    } as Response);
    await expect(
      provider.lookup({ countryCode: 'AU', scheme: 'LEGAL_ID', value: '51824753556' }),
    ).rejects.toThrow(/GUID/);
    delete process.env.ABR_GUID;
  });
});

describe('TaiwanGcisProvider', () => {
  const provider = new TaiwanGcisProvider();

  it('validates the 統一編號 checksum, including the "7" special case', () => {
    expect(isValidBan('22099131')).toBe(true); // TSMC
    expect(isValidBan('22099132')).toBe(false);
    expect(isValidBan('2209913')).toBe(false);
  });

  it('converts Minguo dates to the Gregorian calendar', () => {
    expect(fromMinguoDate('0760221')?.toISOString().slice(0, 10)).toBe('1987-02-21');
    expect(fromMinguoDate('not-a-date')).toBeUndefined();
  });

  it('maps the GCIS payload', async () => {
    mockJson([
      {
        Business_Accounting_NO: '22099131',
        Company_Name: '台灣積體電路製造股份有限公司',
        Company_Status_Desc: '核准設立',
        Company_Location: '新竹科學園區新竹市力行六路8號',
        Company_Setup_Date: '0760221',
      },
    ]);
    const company = await provider.lookup({ countryCode: 'TW', scheme: 'LEGAL_ID', value: '22099131' });
    expect(company).toMatchObject({
      name: '台灣積體電路製造股份有限公司',
      legalId: '22099131',
      legalIdScheme: 'BAN',
      VAT: '22099131',
      status: 'ACTIVE',
      countryCode: 'TW',
    });
    expect(company?.foundedAt?.toISOString().slice(0, 10)).toBe('1987-02-21');
  });

  it('marks a revoked company as inactive', async () => {
    mockJson([{ Business_Accounting_NO: '22099131', Company_Name: 'X', Company_Status_Desc: '撤銷' }]);
    const company = await provider.lookup({ countryCode: 'TW', scheme: 'LEGAL_ID', value: '22099131' });
    expect(company?.status).toBe('INACTIVE');
  });
});

describe('IsraelRegistrarProvider', () => {
  const provider = new IsraelRegistrarProvider();

  it('maps the Hebrew dataset columns and prefers the English name', async () => {
    const spy = mockJson({
      result: {
        records: [
          {
            'מספר חברה': 520043613,
            'שם חברה': 'רכבת ישראל בע~מ',
            'שם באנגלית': 'ISRAEL RAILWAYS LTD',
            'סטטוס חברה': 'פעילה',
            'תאריך התאגדות': '15/01/1998',
            'שם עיר': 'לוד',
            'שם רחוב': 'יוספטל גיורא',
            'מספר בית': '1',
            מיקוד: 7136801,
          },
        ],
      },
    });
    const company = await provider.lookup({ countryCode: 'IL', scheme: 'LEGAL_ID', value: '520043613' });
    expect(spy.mock.calls[0][0]).toContain('filters=');
    expect(company).toMatchObject({
      name: 'ISRAEL RAILWAYS LTD',
      legalName: 'רכבת ישראל בע~מ',
      legalId: '520043613',
      VAT: '520043613',
      address: 'יוספטל גיורא 1',
      postalCode: '7136801',
      city: 'לוד',
      status: 'ACTIVE',
    });
    expect(company?.foundedAt?.toISOString().slice(0, 10)).toBe('1998-01-15');
  });

  it('returns null when the dataset has no matching row', async () => {
    mockJson({ result: { records: [] } });
    await expect(
      provider.lookup({ countryCode: 'IL', scheme: 'LEGAL_ID', value: '999999999' }),
    ).resolves.toBeNull();
  });
});

describe('VietnamTaxCodeProvider', () => {
  const provider = new VietnamTaxCodeProvider();

  it('accepts 10 and 13 digit tax codes only', () => {
    expect(provider.supports({ countryCode: 'VN', scheme: 'LEGAL_ID', value: '0100109106' })).toBe(true);
    expect(provider.supports({ countryCode: 'VN', scheme: 'LEGAL_ID', value: '0100109106-001' })).toBe(true);
    expect(provider.supports({ countryCode: 'VN', scheme: 'LEGAL_ID', value: '12345' })).toBe(false);
  });

  it('maps the tax register payload', async () => {
    mockJson({
      code: '00',
      data: {
        id: '0100109106',
        name: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
        address: 'Lô D26 Khu đô thị mới Cầu Giấy, TP Hà Nội',
        status: 'NNT đang hoạt động',
      },
    });
    const company = await provider.lookup({ countryCode: 'VN', scheme: 'LEGAL_ID', value: '0100109106' });
    expect(company).toMatchObject({
      legalId: '0100109106',
      legalIdScheme: 'TAX_CODE',
      VAT: '0100109106',
      status: 'ACTIVE',
      countryCode: 'VN',
    });
  });
});

describe('GleifProvider', () => {
  const provider = new GleifProvider();

  it('recognises an LEI and takes anything else as a registration number', () => {
    expect(isLei('5493001KJTIIGC8Y1R12')).toBe(true);
    expect(isLei('45274649')).toBe(false);
    expect(provider.supports({ countryCode: 'ZW', scheme: 'LEGAL_ID', value: '45274649' })).toBe(true);
    expect(provider.supports({ countryCode: 'ZW', scheme: 'LEGAL_ID', value: '12' })).toBe(false);
    expect(provider.supports({ countryCode: 'XYZ', scheme: 'LEGAL_ID', value: '45274649' })).toBe(false);
  });

  it('scopes the registration-number search to the country', async () => {
    const spy = mockJson({
      data: [
        {
          attributes: {
            lei: '529900S5R9YHJHYKKG94',
            entity: {
              legalName: { name: 'ČEZ, a. s.' },
              legalAddress: {
                addressLines: ['Duhová 2/1444'],
                city: 'Praha 4',
                region: 'CZ-10',
                country: 'CZ',
                postalCode: '140 53',
              },
              registeredAs: '45274649',
              status: 'ACTIVE',
              creationDate: '1992-05-05T22:00:00Z',
            },
          },
        },
      ],
    });
    const company = await provider.lookup({ countryCode: 'CZ', scheme: 'LEGAL_ID', value: '45274649' });
    expect(spy.mock.calls[0][0]).toContain('entity.legalAddress.country%5D=CZ');
    expect(company).toMatchObject({
      name: 'ČEZ, a. s.',
      legalId: '45274649',
      address: 'Duhová 2/1444',
      city: 'Praha 4',
      state: '10',
      postalCode: '140 53',
      countryCode: 'CZ',
      status: 'ACTIVE',
    });
  });

  it('reads a record straight from its LEI', async () => {
    const spy = mockJson({
      data: {
        attributes: {
          lei: '5493001KJTIIGC8Y1R12',
          entity: {
            legalName: { name: 'Bloomberg Finance L.P.' },
            legalAddress: { country: 'US' },
            status: 'ACTIVE',
          },
        },
      },
    });
    const company = await provider.lookup({
      countryCode: 'US',
      scheme: 'LEGAL_ID',
      value: '5493001KJTIIGC8Y1R12',
    });
    expect(spy.mock.calls[0][0]).toContain('/lei-records/5493001KJTIIGC8Y1R12');
    expect(company?.name).toBe('Bloomberg Finance L.P.');
  });

  it('returns null when the index has nothing for that country', async () => {
    mockJson({ data: [] });
    await expect(
      provider.lookup({ countryCode: 'ZW', scheme: 'LEGAL_ID', value: '45274649' }),
    ).resolves.toBeNull();
  });
});

describe('PeppolDirectoryProvider', () => {
  const provider = new PeppolDirectoryProvider();

  it('maps a participant and keeps only entities from the queried country', async () => {
    mockJson({
      matches: [
        {
          participantID: { scheme: 'iso6523-actorid-upis', value: '0184:25313763' },
          entities: [
            {
              name: [{ name: 'Arla Foods amba' }],
              countryCode: 'DK',
              geoInfo: 'DK',
              identifiers: [{ scheme: 'OrgNr', value: '25313763' }],
            },
          ],
        },
      ],
    });
    const company = await provider.lookup({ countryCode: 'DK', scheme: 'LEGAL_ID', value: '25313763' });
    expect(company).toMatchObject({
      name: 'Arla Foods amba',
      legalId: '25313763',
      legalIdScheme: 'OrgNr',
      countryCode: 'DK',
      status: 'ACTIVE',
    });
    // geoInfo that merely repeats the country is not a city.
    expect(company?.city).toBeUndefined();
  });

  it('ignores a match registered in another country', async () => {
    mockJson({
      matches: [
        {
          participantID: { value: '0184:25313763' },
          entities: [{ name: [{ name: 'Other' }], countryCode: 'SE' }],
        },
      ],
    });
    await expect(
      provider.lookup({ countryCode: 'DK', scheme: 'LEGAL_ID', value: '25313763' }),
    ).resolves.toBeNull();
  });
});

describe('ColombiaRuesProvider', () => {
  it('maps the RUES dataset row', async () => {
    mockJson([
      {
        razon_social: 'VIA BOGOTA S A S EN LIQUIDACION',
        numero_identificacion: '900373115',
        camara_comercio: 'BOGOTA',
        fecha_matricula: '20100803',
        estado_matricula: 'ACTIVA',
      },
    ]);
    const company = await new ColombiaRuesProvider().lookup({
      countryCode: 'CO',
      scheme: 'LEGAL_ID',
      value: '900.373.115-3',
    });
    expect(company).toMatchObject({
      name: 'VIA BOGOTA S A S EN LIQUIDACION',
      legalIdScheme: 'NIT',
      state: 'BOGOTA',
      status: 'ACTIVE',
      countryCode: 'CO',
    });
    expect(company?.foundedAt?.toISOString().slice(0, 10)).toBe('2010-08-03');
  });
});
