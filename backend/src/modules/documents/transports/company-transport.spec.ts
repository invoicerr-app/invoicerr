/**
 * Le résolveur de transport lui-même — la pièce que `send-divergence.spec.ts` MOCKE.
 *
 * Ce test existe parce qu'un test de mutation l'a rendu nécessaire : en faisant retomber ce
 * résolveur sur `'email'` quand rien n'est configuré — précisément le repli silencieux que le
 * produit interdit — la suite de divergence est restée VERTE. Elle mocke ce module, donc elle
 * prouve que l'action bloque quand on lui dit « pas de transport », et rien de ce que ce module
 * répond réellement.
 *
 * Ce n'était pas le produit qui avait tort, c'était la couverture : personne ne testait les dix-neuf
 * lignes qui décident. C'est fait ici.
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
