import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import JSZip = require('jszip');
import { describe, expect, it } from 'vitest';

import { detectVendorExport, normalizeHeader } from './vendor-export-map';
import { VENDOR_EXPORT_PROFILES } from './vendor-export-profiles';
import { VendorExportFileError, readVendorExportFile } from './vendor-export-workbook';

/**
 * The two fixtures are Tiime's own sample exports with every person's name, email, street, phone
 * and registration number replaced. Headers, cell types, number formats, dates, amounts and
 * statuses are byte for byte what Tiime produced.
 */
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '__fixtures__', name)));
const CLIENTS = fixture('tiime-clients.xlsx');
const INVOICES = fixture('tiime-invoices.xlsx');

async function zipOf(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function onlyGrid(bytes: Uint8Array) {
  const upload = await readVendorExportFile(bytes);
  expect(upload.workbooks).toHaveLength(1);
  return upload.workbooks[0].grid;
}

describe('reading a Tiime XLSX export', () => {
  it('keeps the client header row exactly as Tiime prints it', async () => {
    const grid = await onlyGrid(CLIENTS);
    expect(grid.headers).toEqual([
      'id',
      'nom',
      'email',
      'téléphone',
      'SIREN/SIRET',
      'adresse',
      "complément d'adresse",
      'ville',
      'code postal',
      'pays',
      'facturé TTC',
      'facturé HT',
      'encaissé',
      'encours',
      'statut',
    ]);
    expect(grid.rows).toHaveLength(14);
  });

  it('pads absent cells, keeps numbers exact and strings untouched', async () => {
    const grid = await onlyGrid(CLIENTS);
    for (const row of grid.rows) expect(row).toHaveLength(15);
    expect(grid.rows[0]).toEqual([
      '4303700',
      'RTS Forth',
      'rts-forth@tiime.fr',
      '0612345678',
      '',
      '4 avenue du Stand',
      '',
      'Annecy',
      '74000',
      'FR',
      '167820',
      '139850',
      '163620',
      '52200',
      'en retard',
    ]);
    // A phone stored as a number and a 14-digit SIRET never go through a float.
    expect(grid.rows[2][3]).toBe('33612345678');
    expect(grid.rows[2][4]).toBe('89960956400013');
    expect(grid.rows[1][10]).toBe('135081.4');
    // Trailing spaces are the tool's own; trimming is the mapping's job.
    expect(grid.rows[8][1]).toBe('DUPONT Alix ');
    expect(grid.rows[8][8]).toBe('1060');
    expect(grid.rows[13][14]).toBe('à jour');
  });

  it('turns a date-formatted cell into an ISO date and keeps the invoice headers verbatim', async () => {
    const grid = await onlyGrid(INVOICES);
    expect(grid.headers).toEqual([
      'id',
      'date de facture',
      'numéro de facture',
      'intitulé',
      'statut de la facture',
      'nom du client',
      'pays du client',
      'montant TTC ',
      'montant HT ',
      'Transaction(s) liée(s)',
      'Tags',
      'montant TVA 20%',
      'montant TVA 10%',
      'montant TVA 5.5%',
      'montant TVA 2.1%',
      'montant TVA 8.5%',
    ]);
    expect(grid.rows).toHaveLength(21);
    expect(grid.rows[0]).toEqual([
      '8656744',
      '2023-08-31',
      '40',
      'Mission X',
      'Payée',
      'RTS Forth',
      'France',
      '3000',
      '2500',
      'VIR RTS FORTH',
      '',
      '500',
      '0',
      '0',
      '0',
      '0',
    ]);
    expect(grid.rows[20][1]).toBe('2023-04-11');
  });

  it('carries no personal email address', async () => {
    for (const bytes of [CLIENTS, INVOICES]) {
      const grid = await onlyGrid(bytes);
      const cells = grid.rows.flat().join('\n');
      expect(cells).not.toMatch(/@(gmail|hotmail|yahoo|outlook|orange|free)\./i);
    }
  });
});

describe('reading a Tiime ZIP archive', () => {
  it('reads every workbook in it and lists the invoice PDFs', async () => {
    const archive = await zipOf({
      'export/clients.xlsx': CLIENTS,
      'export/factures.xlsx': INVOICES,
      'export/pdf/Facture-40.pdf': '%PDF-1.4',
      '__MACOSX/export/._clients.xlsx': 'metadata',
    });
    const upload = await readVendorExportFile(archive);
    expect(upload.workbooks.map((workbook) => workbook.fileName)).toEqual([
      'export/clients.xlsx',
      'export/factures.xlsx',
    ]);
    expect(upload.workbooks[1].grid.rows[0][1]).toBe('2023-08-31');
    expect(upload.pdfFiles).toEqual(['export/pdf/Facture-40.pdf']);
  });

  it('refuses an archive with no workbook', async () => {
    const archive = await zipOf({ 'Facture-40.pdf': '%PDF-1.4' });
    await expect(readVendorExportFile(archive)).rejects.toThrow('no XLSX export');
  });

  it('refuses a workbook entry that inflates past the upload cap', async () => {
    const archive = await zipOf({ 'bomb.xlsx': new Uint8Array(26 * 1024 * 1024) });
    await expect(readVendorExportFile(archive)).rejects.toThrow('too large');
  });

  it('refuses bytes that are not a zip, and a corrupt zip', async () => {
    await expect(readVendorExportFile(new TextEncoder().encode('nom;email\n'))).rejects.toBeInstanceOf(
      VendorExportFileError,
    );
    const corrupt = CLIENTS.slice(0, 200);
    await expect(readVendorExportFile(corrupt)).rejects.toBeInstanceOf(VendorExportFileError);
  });
});

describe('Tiime profiles on the real header rows', () => {
  it('detects each export as its own kind and not as the other', async () => {
    const clients = (await onlyGrid(CLIENTS)).headers;
    const invoices = (await onlyGrid(INVOICES)).headers;
    expect(detectVendorExport('clients', clients)?.id).toBe('tiime-clients');
    expect(detectVendorExport('invoices', invoices)?.id).toBe('tiime-invoices');
    expect(detectVendorExport('invoices', clients)).toBeUndefined();
    expect(detectVendorExport('clients', invoices)).toBeUndefined();
  });

  it('accounts for every real column, and declares no column Tiime does not print', async () => {
    const grids = { clients: await onlyGrid(CLIENTS), invoices: await onlyGrid(INVOICES) };
    for (const profile of VENDOR_EXPORT_PROFILES.filter((p) => p.vendor === 'tiime')) {
      const real = grids[profile.kind].headers.map(normalizeHeader);
      const declared = [
        ...Object.values(profile.columns).flat(),
        ...(profile.vatAmountColumns ?? []).flatMap((column) => column.headers),
        ...(profile.ignoredColumns ?? []),
      ].map((header) => normalizeHeader(header ?? ''));
      expect(new Set(declared)).toEqual(new Set(real));
      for (const field of profile.required) expect(profile.columns[field]).toBeDefined();
    }
  });

  it('declares one VAT column per rate Tiime prints', () => {
    const invoices = VENDOR_EXPORT_PROFILES.find((profile) => profile.id === 'tiime-invoices');
    expect(invoices?.vatAmountColumns?.map((column) => column.rate)).toEqual([
      '20',
      '10',
      '5.5',
      '2.1',
      '8.5',
    ]);
    expect(invoices?.fileTypes).toEqual(['xlsx', 'zip']);
  });
});
