import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { VendorExportMappingError, mapVendorClientExport, vendorLanguageCode } from './vendor-export-map';
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import { VendorExportProfile } from './vendor-export.types';
import { readVendorExportFile } from './vendor-export-workbook';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
const profileById = (id: string) => {
  const found = VENDOR_EXPORT_PROFILES.find((profile) => profile.id === id);
  if (!found) throw new Error(`no profile ${id}`);
  return found;
};
const TIIME_CLIENTS = profileById('tiime-clients');

async function tiimeClientGrid() {
  const upload = await readVendorExportFile(fixture('tiime-clients.xlsx'));
  return upload.workbooks[0].grid;
}

describe('mapping a Tiime client export', () => {
  it('maps a company row onto the client import row, the printed country kept beside its code', async () => {
    const mapped = mapVendorClientExport(TIIME_CLIENTS, await tiimeClientGrid());
    expect(mapped[0]).toEqual({
      rowNumber: 2,
      status: 'mapped',
      row: {
        rowNumber: 2,
        type: 'COMPANY',
        kind: 'BUSINESS',
        name: 'RTS Forth',
        contactFirstname: undefined,
        contactLastname: undefined,
        contactEmail: 'rts-forth@tiime.fr',
        contactPhone: '0612345678',
        address: '4 avenue du Stand',
        addressLine2: undefined,
        postalCode: '74000',
        city: 'Annecy',
        state: undefined,
        country: 'FR',
        countryCode: 'FR',
        currency: undefined,
        language: null,
        identifiers: undefined,
      },
    });
  });

  it('carries the SIREN/SIRET column as the LEGAL_ID identifier the French client form requires', async () => {
    const mapped = mapVendorClientExport(TIIME_CLIENTS, await tiimeClientGrid());
    expect(mapped[2].row.identifiers).toEqual([{ scheme: 'LEGAL_ID', value: '89960956400013' }]);
    expect(mapped[13].row).toMatchObject({
      name: 'METHYLENE PRODUCTIONS',
      identifiers: [{ scheme: 'LEGAL_ID', value: '81446755100010' }],
    });
  });

  it('trims the trailing spaces Tiime leaves in a name', async () => {
    const mapped = mapVendorClientExport(TIIME_CLIENTS, await tiimeClientGrid());
    expect(mapped[8].row.name).toBe('DUPONT Alix');
    expect(mapped[11].row.name).toBe('testets');
  });

  it('flags a second row with the same email as a duplicate of the first', async () => {
    const mapped = mapVendorClientExport(TIIME_CLIENTS, await tiimeClientGrid());
    expect(mapped[9]).toMatchObject({
      rowNumber: 11,
      status: 'duplicate',
      duplicateOfRow: 10,
      duplicateMatchedOn: 'email',
    });
  });

  it('maps every one of the 14 rows, leaving country checks to the client import preview', async () => {
    const mapped = mapVendorClientExport(TIIME_CLIENTS, await tiimeClientGrid());
    expect(mapped).toHaveLength(14);
    expect(mapped.filter((row) => row.status === 'mapped')).toHaveLength(13);
    // No country printed: the row is still sent, and the import preview names what is missing.
    expect(mapped[11].row).toMatchObject({ country: undefined, countryCode: undefined });
  });

  it('refuses a file whose required "nom" column was removed', async () => {
    const grid = await tiimeClientGrid();
    const without = { headers: grid.headers.map((h) => (h === 'nom' ? 'x' : h)), rows: grid.rows };
    expect(() => mapVendorClientExport(TIIME_CLIENTS, without)).toThrow(VendorExportMappingError);
    expect(() => mapVendorClientExport(TIIME_CLIENTS, without)).toThrow('"nom"');
  });

  it('refuses an invoice profile', async () => {
    const grid = await tiimeClientGrid();
    expect(() => mapVendorClientExport(profileById('tiime-invoices'), grid)).toThrow(
      'is not a client export',
    );
  });
});

describe('client row rules shared by every tool', () => {
  const PROFILE: VendorExportProfile = {
    id: 'test-clients',
    vendor: 'abby',
    vendorLabel: 'Test',
    kind: 'clients',
    label: 'Test client export',
    signature: [],
    columns: {
      type: ['type'],
      name: ['nom'],
      contactFirstname: ['prenom'],
      contactLastname: ['nom de famille'],
      contactEmail: ['email'],
      country: ['pays'],
      vatNumber: ['tva'],
      registrationNumber: ['siret'],
      language: ['langue'],
      currency: ['devise'],
    },
    required: ['name'],
  };
  const HEADERS = [
    'type',
    'nom',
    'prenom',
    'nom de famille',
    'email',
    'pays',
    'tva',
    'siret',
    'langue',
    'devise',
  ];
  const map = (...rows: string[][]) => mapVendorClientExport(PROFILE, { headers: HEADERS, rows });

  it('reads an explicit type, and treats a row with only a last name as a person', () => {
    const [explicit, inferred] = map(
      ['Particulier', '', 'Ana', 'Lima', '', 'Portugal', '', '', '', ''],
      ['', '', '', 'Kowalski', '', 'PL', '', '', '', ''],
    );
    expect(explicit.row).toMatchObject({ type: 'INDIVIDUAL', name: '', contactLastname: 'Lima' });
    expect(explicit.row.countryCode).toBeUndefined();
    expect(inferred.row).toMatchObject({ type: 'INDIVIDUAL', countryCode: 'PL' });
  });

  it('rejects a company with no name and a person with neither name, as i18n keys', () => {
    const [company, person] = map(
      ['Société', '', '', '', 'a@example.com', 'FR', '', '', '', ''],
      ['particulier', '', '', '', 'b@example.com', 'FR', '', '', '', ''],
    );
    expect(company).toMatchObject({ status: 'rejected', errors: [{ key: 'imports.vendor.companyNoName' }] });
    expect(person).toMatchObject({ status: 'rejected', errors: [{ key: 'imports.vendor.clientNoName' }] });
  });

  it('strips spaces from VAT and SIRET, uppercases the currency and reads a language label', () => {
    const [row] = map([
      '',
      'Acme',
      '',
      '',
      '',
      'FR',
      'FR 12 345678901',
      '123 456 789 00012',
      'Français',
      'eur',
    ]);
    expect(row.row).toMatchObject({
      identifiers: [
        { scheme: 'VAT', value: 'FR12345678901' },
        { scheme: 'LEGAL_ID', value: '12345678900012' },
      ],
      currency: 'EUR',
      language: 'fr',
    });
  });

  it('drops a language label it does not know instead of storing it', () => {
    expect(vendorLanguageCode('Klingon')).toBeUndefined();
    expect(vendorLanguageCode('EN')).toBe('en');
    expect(vendorLanguageCode('')).toBeUndefined();
  });

  it('matches a duplicate on name and country when there is no email, and skips blank rows', () => {
    const rows = map(
      ['', 'Acme', '', '', '', 'FR', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', ''],
      ['', ' acme ', '', '', '', 'fr', '', '', '', ''],
      ['', 'Acme', '', '', '', 'DE', '', '', '', ''],
    );
    expect(rows.map((row) => [row.rowNumber, row.status])).toEqual([
      [2, 'mapped'],
      [4, 'duplicate'],
      [5, 'mapped'],
    ]);
    expect(rows[1]).toMatchObject({ duplicateOfRow: 2, duplicateMatchedOn: 'name_country' });
  });

  it('rejects a truncated row with where it stopped', () => {
    const [row] = map(['', 'Acme']);
    expect(row).toMatchObject({
      rowNumber: 2,
      status: 'rejected',
      errors: [{ key: 'imports.vendor.truncatedRow', params: { row: 2, headers: 10, cells: 2 } }],
    });
  });
});
