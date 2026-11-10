import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  detectVendorExport,
  mapVendorExport,
  normalizeHeader,
  parseVendorAmount,
  parseVendorDate,
  parseVendorVatRate,
  VendorExportMappingError,
} from './vendor-export-map';
import { unsupportedVendorExport } from './vendor-export-profiles';
import { VendorExportGrid, VendorMappedClientRow, VendorMappedInvoiceRow } from './vendor-export.types';

const FIXTURES = join(__dirname, '__fixtures__');

/**
 * The fixtures are two to four small rows, so a split is enough. The production path parses real
 * quoted CSV in the browser; this reader only has to be honest about the fixture's own delimiter.
 */
function fixture(name: string, delimiter: string): VendorExportGrid {
  const lines = readFileSync(join(FIXTURES, name), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const [header, ...rows] = lines;
  return {
    headers: header.split(delimiter).map((cell) => cell.trim()),
    rows: rows.map((row) => row.split(delimiter).map((cell) => cell.trim())),
  };
}

function clients(profileId: string): VendorMappedClientRow[] {
  const grid =
    profileId === 'abby-individuals'
      ? fixture('abby-clients.csv', ',')
      : profileId === 'henrri-clients'
        ? fixture('henrri-clients.csv', ';')
        : fixture('tiime-clients.csv', ';');
  const profile = detectVendorExport('clients', grid.headers);
  expect(profile?.id).toBe(profileId);
  return mapVendorExport(profile!, grid) as VendorMappedClientRow[];
}

function invoices(profileId: string): VendorMappedInvoiceRow[] {
  const grid =
    profileId === 'henrri-invoices'
      ? fixture('henrri-invoices.csv', ';')
      : fixture('tiime-invoices.csv', ';');
  const profile = detectVendorExport('invoices', grid.headers);
  expect(profile?.id).toBe(profileId);
  return mapVendorExport(profile!, grid) as VendorMappedInvoiceRow[];
}

describe('header normalization', () => {
  it('drops a balanced parenthetical annotation and keeps an unbalanced one', () => {
    expect(normalizeHeader('Montant (HT)')).toBe('montant');
    expect(normalizeHeader('N° (de) facture')).toBe('n facture');
    expect(normalizeHeader('Total (TTC')).toBe('total ttc');
  });
});

describe('vendor export detection (issue #759)', () => {
  it.each([
    ['abby-individuals', 'clients', 'abby-clients.csv', ','],
    ['abby-organisations', 'clients', 'abby-organisations.csv', ','],
    ['henrri-clients', 'clients', 'henrri-clients.csv', ';'],
    ['tiime-clients', 'clients', 'tiime-clients.csv', ';'],
    ['henrri-invoices', 'invoices', 'henrri-invoices.csv', ';'],
    ['tiime-invoices', 'invoices', 'tiime-invoices.csv', ';'],
  ] as const)('recognises %s from its header row', (profileId, kind, name, delimiter) => {
    const grid = fixture(name, delimiter);
    expect(detectVendorExport(kind, grid.headers)?.id).toBe(profileId);
  });

  it('does not claim a file with an unknown header row', () => {
    expect(detectVendorExport('clients', ['name', 'email', 'phone'])).toBeUndefined();
    expect(detectVendorExport('invoices', ['Numéro', 'Date', 'Client', 'Montant TTC'])).toBeUndefined();
  });

  it('states plainly that Abby has no invoice export to read', () => {
    const unsupported = unsupportedVendorExport('abby', 'invoices');
    expect(unsupported?.reason).toContain('PDF files only');
    expect(unsupported?.source).toContain('aide.abby.fr');
    expect(detectVendorExport('invoices', ['Nom', 'Prénom', 'Emails'])).toBeUndefined();
  });
});

describe('client export mapping', () => {
  it('maps an Abby individual export onto the client import row', () => {
    const [first] = clients('abby-individuals');
    expect(first.status).toBe('mapped');
    expect(first.row).toMatchObject({
      type: 'INDIVIDUAL',
      kind: 'BUSINESS',
      name: '',
      contactFirstname: 'Marie',
      contactLastname: 'Dupont',
      contactEmail: 'marie.dupont@example.test',
      contactPhone: '0611223344',
      address: '12 rue des Lilas',
      postalCode: '69003',
      city: 'Lyon',
      countryCode: 'FR',
      currency: 'EUR',
      language: 'fr',
    });
  });

  it('maps an Abby organisations export as a company, keeping its contact names', () => {
    const grid = fixture('abby-organisations.csv', ',');
    const profile = detectVendorExport('clients', grid.headers)!;
    const [first] = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(first.row).toMatchObject({
      type: 'COMPANY',
      name: 'Atelier Horizon',
      contactFirstname: 'Alice',
      contactLastname: 'Durand',
      contactEmail: 'contact@atelier-horizon.example',
      countryCode: 'FR',
    });
  });

  it('prefers the organisations profile when the export also carries Nom and Prénom', () => {
    const grid = fixture('abby-organisations.csv', ',');
    expect(detectVendorExport('clients', grid.headers)?.id).toBe('abby-organisations');
    expect(grid.headers).toContain('Nom');
    expect(grid.headers).toContain('Prénom');
  });

  it('keeps the printed country name when a country code exists too', () => {
    const grid = fixture('abby-clients.csv', ',');
    const pays = grid.headers.indexOf('Pays de facturation');
    grid.rows[0][pays] = 'France';
    grid.headers.push('Code pays');
    for (const row of grid.rows) row.push('FR');
    const profile = detectVendorExport('clients', grid.headers)!;
    const [first] = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(first.row).toMatchObject({ country: 'France', countryCode: 'FR' });
  });

  it('maps a Henrri client list, keeping the company name and its contact', () => {
    const [company, individual] = clients('henrri-clients');
    expect(company.row).toMatchObject({
      type: 'COMPANY',
      name: 'Atelier Horizon',
      contactFirstname: 'Alice',
      contactLastname: 'Durand',
      countryCode: undefined,
      country: undefined,
    });
    expect(company.row.contactEmail).toBe('contact@atelier-horizon.example');
    expect(company.row.contactPhone).toBe('0666778899');
    expect(individual.row).toMatchObject({ type: 'INDIVIDUAL', contactLastname: 'Leroy' });
  });

  it('maps a Tiime client sheet and its VAT identifier', () => {
    const [first] = clients('tiime-clients');
    expect(first.row).toMatchObject({
      type: 'COMPANY',
      name: 'Studio Beta',
      contactFirstname: 'Sophie',
      contactLastname: 'Bernard',
      postalCode: '75011',
      city: 'Paris',
      countryCode: 'FR',
    });
    expect(first.row.identifiers).toEqual([{ scheme: 'VAT', value: 'FR12345678901' }]);
  });

  it('marks a repeated client as a duplicate of the earlier row, naming the rule that matched', () => {
    const grid = fixture('henrri-clients.csv', ';');
    grid.rows = [grid.rows[0], [...grid.rows[0]]];
    const profile = detectVendorExport('clients', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(rows[1]).toMatchObject({
      status: 'duplicate',
      duplicateOfRow: 2,
      duplicateMatchedOn: 'email',
    });
  });

  it('flags a second row by name and country when the rows carry no email', () => {
    const grid = fixture('henrri-clients.csv', ';');
    const email = grid.headers.indexOf('E-mail');
    grid.rows = [grid.rows[0], [...grid.rows[0]]].map((row) => {
      const copy = [...row];
      copy[email] = '';
      return copy;
    });
    const profile = detectVendorExport('clients', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(rows[1]).toMatchObject({
      status: 'duplicate',
      duplicateOfRow: 2,
      duplicateMatchedOn: 'name_country',
    });
  });

  it('does not let a rejected row claim an identity, so the next row still imports', () => {
    const grid = fixture('henrri-clients.csv', ';');
    const blanks = ['Raison sociale', 'Nom', 'Prénom'].map((header) => grid.headers.indexOf(header));
    grid.rows = [[...grid.rows[0]], [...grid.rows[0]]];
    // Row 2 loses every name cell: rejected, but its email is still readable.
    for (const index of blanks) grid.rows[0][index] = '';
    const profile = detectVendorExport('clients', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].errors?.[0].key).toBe('imports.vendor.companyNoName');
    expect(rows[1].status).toBe('mapped');
  });

  it('rejects a truncated client row instead of shifting its columns', () => {
    const grid = fixture('henrri-clients.csv', ';');
    grid.rows[0] = grid.rows[0].slice(0, 4);
    const profile = detectVendorExport('clients', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedClientRow[];
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].errors?.[0].key).toBe('imports.vendor.truncatedRow');
  });

  it('stops recognising a file whose signature column was removed', () => {
    const grid = fixture('henrri-clients.csv', ';');
    const index = grid.headers.indexOf('E-mail');
    grid.headers.splice(index, 1);
    grid.rows = grid.rows.map((row) => row.filter((_, i) => i !== index));
    expect(detectVendorExport('clients', grid.headers)).toBeUndefined();
  });
});

describe('invoice export mapping', () => {
  it('maps a Henrri sales journal row, deriving the line from its totals', () => {
    const [first] = invoices('henrri-invoices');
    expect(first.status).toBe('mapped');
    expect(first.row).toMatchObject({
      originalNumber: 'FA-2024-001',
      issueDate: '2024-03-15',
      dueDate: '2024-03-15',
      currency: 'EUR',
      clientName: 'Atelier Horizon',
      lineDescription: 'Conseil',
      lineQuantity: '1',
      lineUnit: 'unit',
      lineUnitPrice: '1000',
      lineVatRate: '20',
      originalFileName: 'FA-2024-001.pdf',
    });
  });

  it('maps a Tiime invoice list, keeping its due date', () => {
    const [first] = invoices('tiime-invoices');
    expect(first.row).toMatchObject({
      originalNumber: 'F-2024-010',
      issueDate: '2024-05-10',
      dueDate: '2024-06-09',
      clientName: 'Studio Beta',
      lineUnitPrice: '800',
      lineVatRate: '20',
    });
  });

  it('divides a printed total by the printed quantity instead of copying the total per unit', () => {
    const grid: VendorExportGrid = {
      headers: ['Numéro', 'Date', 'Client', 'Montant HT', 'Montant TVA', 'Montant TTC', 'Quantité'],
      rows: [['FA-Q-1', '15/03/2024', 'Atelier Horizon', '900,00', '180,00', '1080,00', '3']],
    };
    const profile = detectVendorExport('invoices', grid.headers)!;
    const [row] = mapVendorExport(profile, grid) as VendorMappedInvoiceRow[];
    expect(row.row.lineQuantity).toBe('3');
    expect(row.row.lineUnitPrice).toBe('300');
  });

  it('keeps a discounted total as one line when quantity times the share would not reproduce it', () => {
    const grid: VendorExportGrid = {
      headers: ['Numéro', 'Date', 'Client', 'Montant HT', 'Montant TVA', 'Montant TTC', 'Quantité'],
      rows: [
        ['FA-Q-2', '15/03/2024', 'Atelier Horizon', '180,00', '36,00', '216,00', '2'],
        ['FA-Q-3', '15/03/2024', 'Atelier Horizon', '800,00', '160,00', '960,00', '3'],
      ],
    };
    const profile = detectVendorExport('invoices', grid.headers)!;
    const [discounted, uneven] = mapVendorExport(profile, grid) as VendorMappedInvoiceRow[];
    // 180 for 2 units is 90 each: a 10 % discount on a printed 100, preserved exactly.
    expect(discounted.row).toMatchObject({ lineQuantity: '2', lineUnitPrice: '90' });
    // 800 / 3 is 266.67, which recomposes to 800.01: the total wins, on a single unit.
    expect(uneven.row).toMatchObject({ lineQuantity: '1', lineUnitPrice: '800' });
  });

  it('rejects a repeated invoice number and points at the earlier row', () => {
    const grid = fixture('tiime-invoices.csv', ';');
    grid.rows = [grid.rows[0], [...grid.rows[0]]];
    const profile = detectVendorExport('invoices', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedInvoiceRow[];
    expect(rows[1]).toMatchObject({ status: 'duplicate', duplicateOfRow: 2 });
  });

  it('does not let a rejected invoice claim a number, so the next row still imports', () => {
    const grid = fixture('tiime-invoices.csv', ';');
    const date = grid.headers.indexOf('Date');
    grid.rows = [[...grid.rows[0]], [...grid.rows[0]]];
    grid.rows[0][date] = '31/02/2024';
    const profile = detectVendorExport('invoices', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedInvoiceRow[];
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].errors?.[0].key).toBe('imports.vendor.invalidIssueDate');
    expect(rows[1].status).toBe('mapped');
  });

  it('rejects a truncated invoice row', () => {
    const grid = fixture('tiime-invoices.csv', ';');
    grid.rows[0] = grid.rows[0].slice(0, 5);
    const profile = detectVendorExport('invoices', grid.headers)!;
    const rows = mapVendorExport(profile, grid) as VendorMappedInvoiceRow[];
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].errors?.[0].key).toBe('imports.vendor.truncatedRow');
  });

  it('rejects an unreadable date or amount instead of guessing one', () => {
    expect(parseVendorDate('31/02/2024')).toBeUndefined();
    expect(parseVendorDate('03/15/2024')).toBeUndefined();
    expect(parseVendorDate('15/03/2024')).toBe('2024-03-15');
    expect(parseVendorAmount('1 234,56 €')).toBe(1234.56);
    expect(parseVendorAmount('1,234.56')).toBe(1234.56);
    expect(parseVendorAmount('not an amount')).toBeUndefined();
    expect(parseVendorVatRate('20 %')).toBe(20);
    expect(parseVendorVatRate('0,2')).toBe(20);
  });

  it('refuses a file missing a required invoice column at the file level', () => {
    const grid = fixture('tiime-clients.csv', ';');
    const index = grid.headers.indexOf('Nom');
    grid.headers.splice(index, 1);
    grid.rows = grid.rows.map((row) => row.filter((_, i) => i !== index));
    const profile = detectVendorExport('clients', grid.headers)!;
    expect(profile.id).toBe('tiime-clients');
    expect(() => mapVendorExport(profile, grid)).toThrow(VendorExportMappingError);
    expect(() => mapVendorExport(profile, grid)).toThrow(/missing the required column "nom"/i);
  });
});
