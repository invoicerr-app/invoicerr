import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { VendorExportGrid, VendorMappedInvoiceRow } from './vendor-export.types';
import { VendorImportService } from './vendor-import.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    client: { findMany: vi.fn() },
  },
}));

const findMany = prisma.client.findMany as Mock;

function invoiceGrid(clientName: string): VendorExportGrid {
  return {
    headers: ['Numéro', 'Date', 'Client', 'Montant HT', 'TVA', 'Montant TTC', 'Échéance'],
    rows: [['F-1', '10/05/2024', clientName, '800,00', '160,00', '960,00', '09/06/2024']],
  };
}

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
});

describe('VendorImportService', () => {
  it('leaves the generic import untouched when no vendor header matches', async () => {
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'clients', {
      headers: ['name', 'email'],
      rows: [['Acme', 'a@b.test']],
    });
    expect(result).toMatchObject({ detected: false, kind: 'clients' });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('maps a client export without touching the database', async () => {
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'clients', {
      headers: ['Nom', 'Prénom', 'Emails', 'Téléphone', 'Adresse de facturation'],
      rows: [['Dupont', 'Marie', 'marie@example.test', '0611223344', '12 rue des Lilas']],
    });
    expect(result).toMatchObject({ detected: true, vendor: 'abby', profileId: 'abby-individuals' });
    if (result.detected) {
      expect((result.rows as { row: { contactLastname: string } }[])[0].row.contactLastname).toBe('Dupont');
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('resolves an invoice client name to the one matching client', async () => {
    findMany.mockResolvedValue([{ id: 'client-1', name: 'Studio Beta', contacts: [] }]);
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'invoices', invoiceGrid('Studio Beta'));
    expect(result.detected).toBe(true);
    const row = (result as { rows: VendorMappedInvoiceRow[] }).rows[0];
    expect(row.status).toBe('mapped');
    expect(row.row.clientId).toBe('client-1');
  });

  it('resolves an individual invoice client by its primary contact name', async () => {
    findMany.mockResolvedValue([
      { id: 'client-2', name: '', contacts: [{ firstName: 'Paul', lastName: 'Leroy' }] },
    ]);
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'invoices', invoiceGrid('Leroy Paul'));
    const row = (result as { rows: VendorMappedInvoiceRow[] }).rows[0];
    expect(row.status).toBe('mapped');
    expect(row.row.clientId).toBe('client-2');
  });

  it('rejects an invoice whose client is not in the book, naming the import order', async () => {
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'invoices', invoiceGrid('Inconnu SARL'));
    const row = (result as { rows: VendorMappedInvoiceRow[] }).rows[0];
    expect(row.status).toBe('rejected');
    expect(row.errors?.[0]).toContain('Import the client list first');
  });

  it('rejects an invoice whose client name is ambiguous', async () => {
    findMany.mockResolvedValue([
      { id: 'client-1', name: 'Studio Beta', contacts: [] },
      { id: 'client-3', name: 'Studio Beta', contacts: [] },
    ]);
    const service = new VendorImportService();
    const result = await service.preview('company-1', 'invoices', invoiceGrid('Studio Beta'));
    const row = (result as { rows: VendorMappedInvoiceRow[] }).rows[0];
    expect(row.status).toBe('rejected');
    expect(row.errors?.[0]).toContain('several clients match');
  });
});
