/**
 * Proves `./all.ts` reads and validates `countries/data/*.json` faithfully (issue #603 step 6: the
 * single composed loader every one of the 14 sections now goes through). Four angles:
 *
 * - deep equality against an INDEPENDENT, from-scratch `readFileSync` + `JSON.parse` of the same
 *   files, never through `./all.ts` itself - the strongest version of the "the loader doesn't alter
 *   or invent a fact" proof `countries/compose.spec.ts` held at step 1 against a second TypeScript
 *   loader fed by the SAME files; this one is independent of any loader at all;
 * - a drop-in invariant: every `*.json` actually sitting in this directory is loaded, no more, no
 *   fewer - the same discovery guarantee every one of the 14 catalogs' own (now-removed) per-country
 *   loader used to hold for its own directory, moved here because this is the one directory that
 *   discovery happens in now;
 * - a country file dropped in at runtime needs zero code change (the literal "adding a country means
 *   creating one file" proof, moved from `domestic-reverse-charge/data/all.spec.ts`, generalized to
 *   the single merged file);
 * - the load-time validation gate on a malformed section, moved from
 *   `correction-routes/data/all.spec.ts` (an invented eighth country, mocked at the `node:fs`
 *   boundary) - proving this loader still refuses to load a section with no legal provenance, and
 *   that a mismatched `countryCode` (file-level or section-level) is refused too.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ComposedCountryView, COMPOSED_COUNTRY_SECTION_KEYS } from '../compose';
import { formDriftsFrom } from '../../country-identifiers/schema';
import { ALL_COMPOSED_COUNTRY_FILES, loadComposedCountryFilesFrom } from './all';

const DATA_DIR = __dirname;

function independentlyParsedFiles(): Record<string, ComposedCountryView> {
  const out: Record<string, ComposedCountryView> = {};
  for (const name of readdirSync(DATA_DIR)) {
    if (!/^[a-z]{2}\.json$/.test(name)) continue;
    const cc = name.slice(0, -'.json'.length).toUpperCase();
    out[cc] = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf-8'));
  }
  return out;
}

describe('countries/data: ALL_COMPOSED_COUNTRY_FILES matches an independent read of the same files', () => {
  it('every loaded country is byte-for-byte what is actually on disk - no field added, dropped or altered', () => {
    const independent = independentlyParsedFiles();
    expect(ALL_COMPOSED_COUNTRY_FILES.length).toBe(Object.keys(independent).length);
    for (const view of ALL_COMPOSED_COUNTRY_FILES) {
      expect(view).toStrictEqual(independent[view.countryCode]);
    }
  });

  it('every section key actually present on disk is one COMPOSED_COUNTRY_SECTION_KEYS declares - no stray key silently ignored', () => {
    const independent = independentlyParsedFiles();
    for (const [cc, raw] of Object.entries(independent)) {
      const keys = Object.keys(raw).filter((k) => k !== 'countryCode');
      for (const key of keys) {
        expect(COMPOSED_COUNTRY_SECTION_KEYS as readonly string[]).toContain(key);
      }
      void cc;
    }
  });
});

describe('countries/data: every *.json on disk is actually loaded (drop-in invariant)', () => {
  it('ALL_COMPOSED_COUNTRY_FILES covers exactly the country files present in this directory, no more, no fewer', () => {
    const onDisk = readdirSync(DATA_DIR)
      .filter((name) => /^[a-z]{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, '').toUpperCase())
      .sort();
    const loaded = ALL_COMPOSED_COUNTRY_FILES.map((f) => f.countryCode).sort();
    expect(loaded).toEqual(onDisk);
  });
});

// The literal "adding a country means creating ONE file" proof: drop a new file into an isolated
// temporary directory (never the real, shipped one, which other specs read concurrently) and show
// `loadComposedCountryFilesFrom` picks it up, with no change to `all.ts` or this spec's own import.
describe('countries/data: a country file dropped in at runtime needs no code change', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-all-spec-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('discovers a brand-new zz.json with zero changes to all.ts or this test file', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: {
          countryCode: 'ZZ',
          kind: 'VAT',
          provenance: { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-02' },
        },
      }),
      'utf-8',
    );

    const files = loadComposedCountryFilesFrom(tmpDir);

    expect(files.map((f) => f.countryCode)).toEqual(['ZZ']);
    const zz = files.find((f) => f.countryCode === 'ZZ')!;
    expect(zz.taxSystem.kind).toBe('VAT');
    expect(zz.policy).toBeUndefined(); // no other section present - never defaulted
  });

  it('a dropped-in file whose taxSystem section has no provenance is refused at load time, same as a shipped one would be', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: { countryCode: 'ZZ', kind: 'VAT' },
      }),
      'utf-8',
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/no valid provenance/);
  });

  it('a dropped-in file whose top-level countryCode does not match its own filename is refused at load time', () => {
    writeFileSync(join(tmpDir, 'zz.json'), JSON.stringify({ countryCode: 'YY' }), 'utf-8');

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/declares countryCode "YY", expected "ZZ"/);
  });

  it('a dropped-in file whose section countryCode disagrees with its own file-level countryCode is refused at load time', () => {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        taxSystem: {
          countryCode: 'YY',
          kind: 'VAT',
          provenance: { kind: 'legal', sourceText: 'Fixture.', sourceCheckedAt: '2026-10-02' },
        },
      }),
      'utf-8',
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"taxSystem.countryCode" \("YY"\) must match/);
  });
});

describe('countries/data: invoice identifier requirements are checked at load time', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-invoice-requirements-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRule(rule: Record<string, unknown>): void {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        identifiers: { countryCode: 'ZZ', schemes: [], invoiceRequirements: [rule] },
      }),
      'utf-8',
    );
  }

  const provenance = { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-23' };

  it('loads a rule with a party, a scheme, a known condition and a provenance', () => {
    writeRule({
      party: 'BUYER',
      scheme: 'VAT',
      when: { buyerEstablishment: ['OTHER_UNION_MEMBER'] },
      provenance,
    });

    const [zz] = loadComposedCountryFilesFrom(tmpDir);

    expect(zz.identifiers?.invoiceRequirements).toHaveLength(1);
  });

  it('refuses a rule with no provenance', () => {
    writeRule({ party: 'SELLER', scheme: 'VAT' });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/no valid provenance/);
  });

  it('refuses a rule for a party that is neither the seller nor the buyer', () => {
    writeRule({ party: 'CARRIER', scheme: 'VAT', provenance });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/party "CARRIER"/);
  });

  it('refuses a condition value no code knows how to evaluate, instead of never matching it', () => {
    writeRule({ party: 'BUYER', scheme: 'VAT', when: { buyerEstablishment: ['ANYWHERE'] }, provenance });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/buyerEstablishment.*"ANYWHERE"/);
  });

  it('refuses a condition on an axis no code knows how to evaluate', () => {
    writeRule({ party: 'BUYER', scheme: 'VAT', when: { invoiceTotalAbove: [150] }, provenance });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/invoiceTotalAbove/);
  });
});

describe('countries/data: the forms require what every invoice requires', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-form-drift-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const provenance = { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-23' };
  const legalId = (facts: Record<string, unknown> = {}) => ({
    scheme: 'LEGAL_ID',
    appliesTo: 'BOTH',
    label: 'Fixture number',
    required: false,
    provenance,
    ...facts,
  });
  const domesticCompanyBuyer = { buyerType: ['COMPANY'], buyerEstablishment: ['DOMESTIC'] };

  function writeIdentifiers(schemes: unknown[], invoiceRequirements: unknown[]): void {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({ countryCode: 'ZZ', identifiers: { countryCode: 'ZZ', schemes, invoiceRequirements } }),
      'utf-8',
    );
  }

  it('refuses a scheme every domestic business buyer must carry that a company client may leave empty', () => {
    writeIdentifiers(
      [legalId()],
      [{ party: 'BUYER', scheme: 'LEGAL_ID', when: domesticCompanyBuyer, provenance }],
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"LEGAL_ID".*BUYER.*COMPANY/);
  });

  it('refuses a scheme every seller must carry that the company settings may leave empty', () => {
    writeIdentifiers([legalId()], [{ party: 'SELLER', scheme: 'LEGAL_ID', provenance }]);

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"LEGAL_ID".*SELLER.*COMPANY/);
  });

  it('refuses a scheme every invoice requires that the file does not declare', () => {
    writeIdentifiers([], [{ party: 'SELLER', scheme: 'LEGAL_ID', provenance }]);

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"LEGAL_ID".*not declared/);
  });

  it('names every drift of the file in one refusal', () => {
    writeIdentifiers(
      [legalId({ required: true, requiredFor: ['COMPANY'] })],
      [
        { party: 'SELLER', scheme: 'VAT', provenance },
        { party: 'BUYER', scheme: 'LEGAL_ID', when: { buyerType: ['INDIVIDUAL'] }, provenance },
      ],
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"VAT"[\s\S]*"LEGAL_ID".*INDIVIDUAL/);
  });

  it('treats a condition listing every value of its axis as no condition', () => {
    writeIdentifiers(
      [legalId()],
      [
        {
          party: 'SELLER',
          scheme: 'LEGAL_ID',
          when: { sellerVatRegime: ['STANDARD', 'FRANCHISE_BASE'] },
          provenance,
        },
      ],
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/"LEGAL_ID".*SELLER.*COMPANY/);
  });

  it('loads a file whose forms require every scheme its invoices always require, per party type', () => {
    writeIdentifiers(
      [legalId({ required: true, requiredFor: ['COMPANY'] })],
      [
        { party: 'SELLER', scheme: 'LEGAL_ID', provenance },
        { party: 'BUYER', scheme: 'LEGAL_ID', when: domesticCompanyBuyer, provenance },
      ],
    );

    expect(() => loadComposedCountryFilesFrom(tmpDir)).not.toThrow();
  });

  it.each([
    ['a seller under one VAT regime', { party: 'SELLER', when: { sellerVatRegime: ['STANDARD'] } }],
    ['a seller invoicing one type of buyer', { party: 'SELLER', when: { buyerType: ['COMPANY'] } }],
    [
      'a buyer in another member state',
      { party: 'BUYER', when: { buyerEstablishment: ['OTHER_UNION_MEMBER'] } },
    ],
    [
      'a buyer of a seller under one VAT regime',
      { party: 'BUYER', when: { sellerVatRegime: ['FRANCHISE_BASE'] } },
    ],
  ])('leaves the field optional when the rule binds only %s', (_label, rule) => {
    writeIdentifiers([legalId()], [{ scheme: 'LEGAL_ID', provenance, ...rule }]);

    expect(() => loadComposedCountryFilesFrom(tmpDir)).not.toThrow();
  });

  it.each(
    Object.entries(independentlyParsedFiles()).filter(([, file]) => file.identifiers),
  )('shipped %s.json: no drift', (_countryCode, file) => {
    expect(formDriftsFrom(file.identifiers!)).toEqual([]);
  });
});

describe('countries/data: an empty catalogue directory is refused', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-all-spec-empty-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws instead of returning no country, so a boot never reseeds every catalogue to nothing', () => {
    writeFileSync(join(tmpDir, 'README.md'), 'not a country file', 'utf-8');

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/no country file/);
  });
});

describe('countries/data: the company profile and the seller conditions that read it are checked at load time', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-company-profile-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const provenance = { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-25' };
  const sizeCategory = {
    key: 'sizeCategory',
    label: 'Size category',
    values: [
      { value: 'LARGE', label: 'Large' },
      { value: 'SMALL', label: 'Small' },
    ],
    provenance,
  };

  function writeCountry(companyProfile: unknown, seller?: unknown): void {
    writeFileSync(
      join(tmpDir, 'zz.json'),
      JSON.stringify({
        countryCode: 'ZZ',
        ...(companyProfile === undefined ? {} : { companyProfile }),
        channelPolicy: {
          countryCode: 'ZZ',
          facts: [
            {
              providerId: 'fixture-channel',
              requirement: 'mandated',
              mandatedFrom: '2030-01-01',
              ...(seller === undefined ? {} : { scope: { seller } }),
              provenance,
            },
          ],
        },
      }),
      'utf-8',
    );
  }

  it('loads a mandate whose seller condition names a declared attribute and value', () => {
    writeCountry({ countryCode: 'ZZ', attributes: [sizeCategory] }, { sizeCategory: ['SMALL'] });

    const [zz] = loadComposedCountryFilesFrom(tmpDir);

    expect(zz.companyProfile?.attributes.map((attribute) => attribute.key)).toEqual(['sizeCategory']);
    expect(zz.channelPolicy?.facts[0].scope?.seller).toEqual({ sizeCategory: ['SMALL'] });
  });

  it('refuses a seller condition when the country declares no company profile', () => {
    writeCountry(undefined, { sizeCategory: ['SMALL'] });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(
      /names attribute "sizeCategory", which this country's "companyProfile" does not declare/,
    );
  });

  it('refuses a seller condition on an attribute the profile does not declare', () => {
    writeCountry({ countryCode: 'ZZ', attributes: [sizeCategory] }, { headcount: ['SMALL'] });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(/names attribute "headcount"/);
  });

  it('refuses a seller condition on a value the attribute does not declare', () => {
    writeCountry({ countryCode: 'ZZ', attributes: [sizeCategory] }, { sizeCategory: ['MEDIUM'] });

    expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(
      /seller condition "sizeCategory" names value "MEDIUM".*expected one of LARGE, SMALL/,
    );
  });

  it('refuses a profile with no attribute, a duplicate attribute, an attribute with no value or no provenance', () => {
    const cases: [unknown, RegExp][] = [
      [{ countryCode: 'ZZ', attributes: [] }, /"attributes" must be a non-empty array/],
      [
        { countryCode: 'ZZ', attributes: [sizeCategory, sizeCategory] },
        /attribute "sizeCategory" is declared twice/,
      ],
      [
        { countryCode: 'ZZ', attributes: [{ ...sizeCategory, values: [] }] },
        /attribute "sizeCategory" declares no "values"/,
      ],
      [
        { countryCode: 'ZZ', attributes: [{ ...sizeCategory, provenance: undefined }] },
        /attribute "sizeCategory" has no valid provenance/,
      ],
      [{ countryCode: 'YY', attributes: [sizeCategory] }, /"companyProfile.countryCode" \("YY"\) must match/],
    ];
    for (const [companyProfile, error] of cases) {
      writeCountry(companyProfile);
      expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(error);
    }
  });
});

describe('countries/data: askedWhen and the code lists are checked at load time', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'countries-data-conditions-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const provenance = { kind: 'legal', sourceText: 'Fixture statutory text.', sourceCheckedAt: '2026-10-25' };
  const sizeCategory = {
    key: 'sizeCategory',
    label: 'Size category',
    values: [
      { value: 'LARGE', label: 'Large' },
      { value: 'SMALL', label: 'Small' },
    ],
    provenance,
  };
  const list = {
    id: 'exemptionCodes',
    label: 'Why a line carries no VAT',
    provenance,
    entries: [{ code: 'N1', label: 'Excluded' }],
  };

  function writeCountry(section: Record<string, unknown>): void {
    writeFileSync(join(tmpDir, 'zz.json'), JSON.stringify({ countryCode: 'ZZ', ...section }), 'utf-8');
  }

  it('loads an attribute asked under a condition and a country code list', () => {
    writeCountry({
      companyProfile: {
        countryCode: 'ZZ',
        attributes: [
          sizeCategory,
          {
            key: 'debitsOption',
            label: 'Option for debits',
            values: [{ value: 'YES', label: 'Yes' }],
            askedWhen: { sizeCategory: ['LARGE'] },
            provenance,
          },
        ],
      },
      codeLists: { countryCode: 'ZZ', lists: [list] },
    });

    const [zz] = loadComposedCountryFilesFrom(tmpDir);

    expect(zz.companyProfile?.attributes[1].askedWhen).toEqual({ sizeCategory: ['LARGE'] });
    expect(zz.codeLists?.lists.map((candidate) => candidate.id)).toEqual(['exemptionCodes']);
  });

  it('refuses an empty code list, a duplicate list id, and a list with a mismatched countryCode', () => {
    const cases: [unknown, RegExp][] = [
      [{ countryCode: 'ZZ', lists: [] }, /#codeLists: "lists" must be a non-empty array/],
      [
        { countryCode: 'ZZ', lists: [{ ...list, entries: [] }] },
        /list "exemptionCodes" declares no "entries"/,
      ],
      [{ countryCode: 'ZZ', lists: [list, list] }, /list "exemptionCodes" is declared twice/],
      [{ countryCode: 'YY', lists: [list] }, /"codeLists.countryCode" \("YY"\) must match/],
    ];
    for (const [codeLists, error] of cases) {
      writeCountry({ codeLists });
      expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(error);
    }
  });

  it('refuses an askedWhen on an unknown attribute and on an unknown value', () => {
    const cases: [Record<string, string[]>, RegExp][] = [
      [
        { headcount: ['LARGE'] },
        /"askedWhen" names attribute "headcount", which this country's "companyProfile" does not declare/,
      ],
      [
        { sizeCategory: ['HUGE'] },
        /"askedWhen" "sizeCategory" names value "HUGE".*expected one of LARGE, SMALL/,
      ],
    ];
    for (const [askedWhen, error] of cases) {
      writeCountry({
        companyProfile: {
          countryCode: 'ZZ',
          attributes: [
            sizeCategory,
            {
              key: 'debitsOption',
              label: 'Option for debits',
              values: [{ value: 'YES', label: 'Yes' }],
              askedWhen,
              provenance,
            },
          ],
        },
      });
      expect(() => loadComposedCountryFilesFrom(tmpDir)).toThrow(error);
    }
  });
});
