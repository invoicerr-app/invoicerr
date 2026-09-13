/**
 * The transport resolver itself — the piece `send-divergence.spec.ts` MOCKS.
 *
 * This test exists because a mutation test made it necessary: by making this resolver fall back
 * to `'email'` when nothing is configured — precisely the silent fallback the product forbids —
 * the divergence suite stayed GREEN. It mocks this module, so it proves the action blocks when
 * told "no transport", and nothing about what this module actually answers.
 *
 * It wasn't the product that was wrong, it was the coverage: nobody was testing the nineteen
 * lines that decide. That's done here.
 */
import prisma from '@/prisma/prisma.service';
import { getCompanyInvoiceTransportId } from './company-transport';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: jest.fn() } },
}));

describe('getCompanyInvoiceTransportId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when the company has chosen no transport — never a default', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ invoiceTransportId: null });
    await expect(getCompanyInvoiceTransportId('co-1')).resolves.toBeNull();
  });

  it('returns null for an empty string too — "" is not a transport anyone registered', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ invoiceTransportId: '' });
    await expect(getCompanyInvoiceTransportId('co-1')).resolves.toBeNull();
  });

  it('returns null when the company does not exist, instead of throwing', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(getCompanyInvoiceTransportId('nope')).resolves.toBeNull();
  });

  it('returns the transport the company actually chose', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ invoiceTransportId: 'email' });
    await expect(getCompanyInvoiceTransportId('co-1')).resolves.toBe('email');
  });

  it('scopes the read to the company it was asked about', async () => {
    (prisma.company.findUnique as jest.Mock).mockResolvedValue({ invoiceTransportId: null });
    await getCompanyInvoiceTransportId('co-42');
    expect(prisma.company.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'co-42' } }),
    );
  });
});
