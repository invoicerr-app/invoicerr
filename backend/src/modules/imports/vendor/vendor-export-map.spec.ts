import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectVendorExport,
  mapVendorClientExport,
  normalizeHeader,
  VendorExportMappingError,
  vendorLanguageCode,
} from './vendor-export-map';
import { unsupportedVendorExport } from './vendor-export-profiles';
import { VendorExportGrid, VendorExportProfile } from './vendor-export.types';

/** Invented profiles, so the detection rules are tested apart from any tool's real columns. */
function profile(id: string, kind: VendorExportProfile['kind'], signature: string[][]): VendorExportProfile {
  return { id, vendor: 'abby', vendorLabel: 'Test', kind, label: id, signature, columns: {}, required: [] };
}

const SPECIFIC = profile('specific', 'clients', [['raison sociale'], ['email', 'e mail']]);
const GENERAL = profile('general', 'clients', [['nom'], ['email', 'e mail']]);
const INVOICES = profile('invoices', 'invoices', [['n de facture', 'numero'], ['montant ttc']]);
const PROFILES = [SPECIFIC, GENERAL, INVOICES];

describe('header normalization', () => {
  it('drops a balanced parenthetical annotation and keeps an unbalanced one', () => {
    expect(normalizeHeader('Montant (HT)')).toBe('montant');
    expect(normalizeHeader('N° (de) facture')).toBe('n facture');
    expect(normalizeHeader('Total (TTC')).toBe('total ttc');
  });

  it('ignores accents, case and punctuation', () => {
    expect(normalizeHeader('  N° de Facture ')).toBe('n de facture');
    expect(normalizeHeader('E-mail')).toBe('e mail');
    expect(normalizeHeader('Téléphone')).toBe('telephone');
  });

  it('stays linear on a long run of unclosed parentheses', () => {
    const header = `${'('.repeat(50_000)}x`;
    const started = performance.now();
    expect(normalizeHeader(header)).toBe('x');
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('vendor export detection', () => {
  it('recognises a profile when every signature group has one of its spellings', () => {
    expect(detectVendorExport('clients', ['Nom', 'E-mail', 'Ville'], PROFILES)?.id).toBe('general');
    expect(detectVendorExport('invoices', ['N° de facture', 'Montant TTC'], PROFILES)?.id).toBe('invoices');
  });

  it('returns the first matching profile, so the more specific one declared first wins', () => {
    const headers = ['Raison sociale', 'Nom', 'Email'];
    expect(detectVendorExport('clients', headers, PROFILES)?.id).toBe('specific');
  });

  it('does not claim a file when one signature group is missing', () => {
    expect(detectVendorExport('clients', ['Nom', 'Ville'], PROFILES)).toBeUndefined();
    expect(detectVendorExport('clients', ['name', 'email', 'phone'], PROFILES)).toBeUndefined();
  });

  it('only matches profiles of the requested export type', () => {
    expect(detectVendorExport('clients', ['Numéro', 'Montant TTC'], PROFILES)).toBeUndefined();
    expect(detectVendorExport('invoices', ['Nom', 'Email'], PROFILES)).toBeUndefined();
  });

  it('ignores empty header cells', () => {
    expect(detectVendorExport('clients', ['', 'Nom', '  ', 'Email'], PROFILES)?.id).toBe('general');
  });
});

const FIXTURES = join(__dirname, '__fixtures__');

/**
 * The fixtures are two small rows without quoted cells, so a split is enough. The production path
 * parses real quoted CSV in the browser; this reader only has to be honest about the delimiter.
 */
function fixture(name: string): VendorExportGrid {
  const lines = readFileSync(join(FIXTURES, name), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const [header, ...rows] = lines;
  return {
    headers: header.split(',').map((value) => value.trim()),
    rows: rows.map((row) => row.split(',').map((value) => value.trim())),
  };
}

function mapFixture(grid: VendorExportGrid, expectedProfile: string) {
  const profile = detectVendorExport('clients', grid.headers);
  expect(profile?.id).toBe(expectedProfile);
  return mapVendorClientExport(profile as VendorExportProfile, grid);
}

describe('Abby client exports', () => {
  it.each([
    ['abby-individuals', 'abby-clients.csv'],
    ['abby-organisations', 'abby-organisations.csv'],
  ])('recognises %s from its header row', (profileId, name) => {
    expect(detectVendorExport('clients', fixture(name).headers)?.id).toBe(profileId);
  });

  it('prefers the organisations profile when the export also carries Nom and Prénom', () => {
    const grid = fixture('abby-organisations.csv');
    expect(grid.headers).toEqual(expect.arrayContaining(['Nom', 'Prénom']));
    expect(detectVendorExport('clients', grid.headers)?.id).toBe('abby-organisations');
  });

  it('does not claim an Abby contact file as an invoice export, and says why there is none', () => {
    expect(detectVendorExport('invoices', fixture('abby-clients.csv').headers)).toBeUndefined();
    const unsupported = unsupportedVendorExport('abby', 'invoices');
    expect(unsupported?.reason).toContain('PDF files only');
    expect(unsupported?.source).toContain('aide.abby.fr');
    expect(unsupportedVendorExport('abby', 'clients')).toBeUndefined();
  });

  it('maps an individual onto the client import row', () => {
    const [first, second] = mapFixture(fixture('abby-clients.csv'), 'abby-individuals');
    expect(first.status).toBe('mapped');
    expect(first.row).toEqual({
      rowNumber: 2,
      type: 'INDIVIDUAL',
      kind: 'BUSINESS',
      name: '',
      contactFirstname: 'Marie',
      contactLastname: 'Dupont',
      contactEmail: 'marie.dupont@example.test',
      contactPhone: '0611223344',
      address: '12 rue des Lilas',
      addressLine2: undefined,
      postalCode: '69003',
      city: 'Lyon',
      state: undefined,
      country: 'FR',
      countryCode: 'FR',
      currency: 'EUR',
      language: 'fr',
      identifiers: undefined,
    });
    expect(second.row.addressLine2).toBe('Bâtiment B');
  });

  it('maps an organisation as a company, keeping its contact names', () => {
    const [first] = mapFixture(fixture('abby-organisations.csv'), 'abby-organisations');
    expect(first.status).toBe('mapped');
    expect(first.row).toMatchObject({
      type: 'COMPANY',
      name: 'Atelier Horizon',
      contactFirstname: 'Alice',
      contactLastname: 'Durand',
      contactEmail: 'contact@atelier-horizon.example',
      countryCode: 'FR',
      currency: 'EUR',
      language: null,
    });
  });

  it('keeps the printed country name when a country code exists too', () => {
    const grid = fixture('abby-clients.csv');
    grid.rows[0][grid.headers.indexOf('Pays de facturation')] = 'France';
    grid.headers.push('Code pays');
    for (const row of grid.rows) row.push('FR');
    const [first] = mapFixture(grid, 'abby-individuals');
    expect(first.row).toMatchObject({ country: 'France', countryCode: 'FR' });
  });

  it('reads the VAT number as a VAT identifier', () => {
    const grid = fixture('abby-organisations.csv');
    grid.headers.push('Numéro de TVA');
    grid.rows[0].push('FR12345678901');
    grid.rows[1].push('');
    const [first, second] = mapFixture(grid, 'abby-organisations');
    expect(first.row.identifiers).toEqual([{ scheme: 'VAT', value: 'FR12345678901' }]);
    expect(second.row.identifiers).toBeUndefined();
  });

  it('marks a repeated client as a duplicate of the earlier row, naming the rule that matched', () => {
    const grid = fixture('abby-clients.csv');
    grid.rows = [grid.rows[0], [...grid.rows[0]]];
    const rows = mapFixture(grid, 'abby-individuals');
    expect(rows[1]).toMatchObject({ status: 'duplicate', duplicateOfRow: 2, duplicateMatchedOn: 'email' });
  });

  it('flags a second row by name and country when the rows carry no email', () => {
    const grid = fixture('abby-organisations.csv');
    const email = grid.headers.indexOf('Emails');
    grid.rows = [grid.rows[0], [...grid.rows[0]]];
    for (const row of grid.rows) row[email] = '';
    const rows = mapFixture(grid, 'abby-organisations');
    expect(rows[1]).toMatchObject({
      status: 'duplicate',
      duplicateOfRow: 2,
      duplicateMatchedOn: 'name_country',
    });
  });

  it('does not let a rejected row claim an identity, so the next row still imports', () => {
    const grid = fixture('abby-organisations.csv');
    grid.rows = [[...grid.rows[0]], [...grid.rows[0]]];
    grid.rows[0][grid.headers.indexOf('Raison sociale')] = '';
    grid.rows[0][grid.headers.indexOf('Nom')] = '';
    grid.rows[0][grid.headers.indexOf('Prénom')] = '';
    const rows = mapFixture(grid, 'abby-organisations');
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].errors?.[0]).toEqual({
      key: 'imports.vendor.companyNoName',
      params: { row: 2, column: 'raison sociale' },
    });
    expect(rows[1].status).toBe('mapped');
  });

  it('rejects an individual with neither a first nor a last name', () => {
    const grid = fixture('abby-clients.csv');
    grid.rows[0][grid.headers.indexOf('Nom')] = '';
    grid.rows[0][grid.headers.indexOf('Prénom')] = '';
    const [first, second] = mapFixture(grid, 'abby-individuals');
    expect(first.status).toBe('rejected');
    expect(first.errors?.[0].key).toBe('imports.vendor.clientNoName');
    expect(second.status).toBe('mapped');
  });

  it('rejects a truncated row instead of shifting its columns, and skips blank rows', () => {
    const grid = fixture('abby-clients.csv');
    grid.rows[0] = grid.rows[0].slice(0, 4);
    grid.rows.push(grid.headers.map(() => ''));
    const rows = mapFixture(grid, 'abby-individuals');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rowNumber: 2, status: 'rejected' });
    expect(rows[0].errors?.[0].key).toBe('imports.vendor.truncatedRow');
  });

  it('refuses a recognised file whose required column is missing, as a whole', () => {
    const profile = detectVendorExport(
      'clients',
      fixture('abby-organisations.csv').headers,
    ) as VendorExportProfile;
    const grid: VendorExportGrid = {
      headers: ['Emails', 'Adresse de facturation'],
      rows: [['a@b.test', 'x']],
    };
    expect(() => mapVendorClientExport(profile, grid)).toThrow(VendorExportMappingError);
    expect(() => mapVendorClientExport(profile, grid)).toThrow('"raison sociale"');
  });

  it('refuses to read an invoice profile as a client export', () => {
    const invoices: VendorExportProfile = { ...profile('inv', 'invoices', [['numero']]) };
    expect(() => mapVendorClientExport(invoices, { headers: ['Numero'], rows: [] })).toThrow(
      VendorExportMappingError,
    );
  });

  it('turns a printed language label into a code the render layer knows, or nothing', () => {
    expect(vendorLanguageCode('Français')).toBe('fr');
    expect(vendorLanguageCode('EN')).toBe('en');
    expect(vendorLanguageCode('Klingon')).toBeUndefined();
    expect(vendorLanguageCode('')).toBeUndefined();
  });
});
