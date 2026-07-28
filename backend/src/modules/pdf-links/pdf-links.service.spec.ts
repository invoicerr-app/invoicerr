import prisma from '@/prisma/prisma.service';
import { PdfLinksService } from './pdf-links.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    pdfDownloadToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

describe('PdfLinksService', () => {
  let service: PdfLinksService;

  beforeEach(() => {
    service = new PdfLinksService();
    jest.clearAllMocks();
  });

  it('creates a token record scoped to the company/document and returns the raw token', async () => {
    (prisma.pdfDownloadToken.create as jest.Mock).mockResolvedValue({});

    const token = await service.createToken('company1', 'QUOTE', 'q1');

    expect(token).toEqual(expect.any(String));
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(prisma.pdfDownloadToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentType: 'QUOTE',
          documentId: 'q1',
          companyId: 'company1',
          tokenHash: expect.any(String),
        }),
      }),
    );

    const { tokenHash } = (prisma.pdfDownloadToken.create as jest.Mock).mock.calls[0][0].data;
    expect(tokenHash).not.toBe(token);
  });

  it('resolves a token to its record when not expired', async () => {
    const record = {
      documentType: 'QUOTE',
      documentId: 'q1',
      companyId: 'company1',
      expiresAt: new Date(Date.now() + 60_000),
    };
    (prisma.pdfDownloadToken.findUnique as jest.Mock).mockResolvedValue(record);

    const resolved = await service.resolveToken('sometoken');

    expect(resolved).toEqual(record);
  });

  it('returns null for an expired token', async () => {
    const record = {
      documentType: 'QUOTE',
      documentId: 'q1',
      companyId: 'company1',
      expiresAt: new Date(Date.now() - 60_000),
    };
    (prisma.pdfDownloadToken.findUnique as jest.Mock).mockResolvedValue(record);

    const resolved = await service.resolveToken('sometoken');

    expect(resolved).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    (prisma.pdfDownloadToken.findUnique as jest.Mock).mockResolvedValue(null);

    const resolved = await service.resolveToken('unknown');

    expect(resolved).toBeNull();
  });
});
