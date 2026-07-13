/**
 * M-4 (COMPLIANCE_AUDIT.md) — PL faktura korygująca, DB-wiring layer.
 *
 * national-format-validation.spec.ts proves the FA_VAT builder itself (national/fa-vat.ts) emits a
 * valid KOR document when handed an `InvoiceRenderData.correction` block — but that block has to be
 * populated somewhere. This spec proves the OTHER half: InvoiceRenderingService.fetchRenderData()
 * (private, exercised here via the public renderFaVat()) reads Invoice.correctsInvoiceId, follows it
 * to the corrected Invoice's most recent ComplianceDocument, and turns its KSEF_NUMBER
 * ComplianceAuthorityId row into `InvoiceRenderData.correction.originalKsefNumber` — the exact
 * linkage InvoicesService.correctInvoice() relies on when it wires a correction's ComplianceDocument
 * (externalRef → the correction's own invoice id, per the M-4 fix in invoices.service.ts).
 *
 * Prisma is mocked (same pattern as pdf-links.service.spec.ts) — no DB required.
 */
import prisma from '@/prisma/prisma.service';
import { validateXsd } from '@/compliance/schemas/validate';
import { InvoiceRenderingService } from './invoice-rendering.service';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    invoice: {
      findUnique: jest.fn(),
    },
  },
}));

const findUnique = prisma.invoice.findUnique as jest.Mock;

function baseInvoiceRow(overrides: Record<string, any> = {}) {
  return {
    id: 'inv-correction-1',
    rawNumber: 'FV-2025-0100-KOR',
    number: null,
    issuedAt: new Date('2025-07-01T09:00:00Z'),
    createdAt: new Date('2025-07-01T09:00:00Z'),
    paymentMethod: null,
    paymentDetails: null,
    discountRate: 0,
    notes: 'Wrong VAT rate on line 1',
    company: {
      name: 'Kowalski sp. z o.o.',
      description: null,
      foundedAt: null,
      currency: 'PLN',
      address: 'ul. Marszałkowska 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'Poland',
      phone: null,
      email: null,
      partyIdentifiers: [{ scheme: 'VAT', value: 'PL1234567890' }],
    },
    client: {
      type: 'COMPANY',
      name: 'Nowak Trading Sp. z o.o.',
      description: null,
      foundedAt: null,
      contactFirstname: null,
      contactLastname: null,
      contactEmail: null,
      contactPhone: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'ul. Złota 5',
      city: 'Kraków',
      postalCode: '31-010',
      country: 'Poland',
      partyIdentifiers: [{ scheme: 'VAT', value: 'PL9876543210' }],
    },
    items: [{ name: 'Usługi IT', quantity: 1, unitPrice: 100, vatRate: 23, type: 'SERVICE' }],
    correctsInvoice: null,
    ...overrides,
  };
}

describe('InvoiceRenderingService.renderFaVat — M-4 faktura korygująca DB wiring', () => {
  let service: InvoiceRenderingService;

  beforeEach(() => {
    service = new InvoiceRenderingService();
    jest.clearAllMocks();
  });

  it('builds a KOR FA_VAT XML referencing the original via its stored KSeF number, and validates against the FA(2) XSD', async () => {
    findUnique.mockResolvedValue(
      baseInvoiceRow({
        correctsInvoice: {
          rawNumber: 'FV-2025-0099',
          number: null,
          issuedAt: new Date('2025-06-01T09:00:00Z'),
          createdAt: new Date('2025-06-01T09:00:00Z'),
          complianceDocuments: [
            {
              createdAt: new Date('2025-06-01T09:05:00Z'),
              authorityIds: [
                { scheme: 'KSEF_NUMBER', value: '1234567890-20250601-1A2B3C-4D5E6F-A1' },
                { scheme: 'UPO', value: 'https://api-test.ksef.mf.gov.pl/v2/upo' },
              ],
            },
          ],
        },
      }),
    );

    const xml = await service.renderFaVat('inv-correction-1');

    expect(xml).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
    expect(xml).toContain('<NrFaKorygowanej>FV-2025-0099</NrFaKorygowanej>');
    expect(xml).toContain('<DataWystFaKorygowanej>2025-06-01</DataWystFaKorygowanej>');
    expect(xml).toContain('<NrKSeFFaKorygowanej>1234567890-20250601-1A2B3C-4D5E6F-A1</NrKSeFFaKorygowanej>');
    expect(xml).toContain('<PrzyczynaKorekty>Wrong VAT rate on line 1</PrzyczynaKorekty>');

    const result = await validateXsd(xml, 'pl/schemat_FA2.xsd');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);

    // Proves the DB query actually follows correctsInvoiceId → complianceDocuments → authorityIds
    // (the exact chain InvoicesService.correctInvoice() depends on for the correction's ctx).
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-correction-1' },
        include: expect.objectContaining({
          correctsInvoice: expect.objectContaining({
            include: expect.objectContaining({
              complianceDocuments: expect.objectContaining({
                include: { authorityIds: true },
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('marks NrKSeFN when the original has no KSEF_NUMBER authority id (issued outside KSeF)', async () => {
    findUnique.mockResolvedValue(
      baseInvoiceRow({
        correctsInvoice: {
          rawNumber: 'FV-2024-0050',
          number: null,
          issuedAt: new Date('2024-01-15T09:00:00Z'),
          createdAt: new Date('2024-01-15T09:00:00Z'),
          complianceDocuments: [],
        },
      }),
    );

    const xml = await service.renderFaVat('inv-correction-1');
    expect(xml).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
    expect(xml).toContain('<NrKSeFN>1</NrKSeFN>');
    expect(xml).not.toContain('NrKSeFFaKorygowanej');

    const result = await validateXsd(xml, 'pl/schemat_FA2.xsd');
    expect(result.valid).toBe(true);
  });

  it('a plain (non-correction) invoice still renders RodzajFaktury=VAT — correctsInvoice is null', async () => {
    findUnique.mockResolvedValue(baseInvoiceRow());

    const xml = await service.renderFaVat('inv-correction-1');
    expect(xml).toContain('<RodzajFaktury>VAT</RodzajFaktury>');
    expect(xml).not.toContain('DaneFaKorygowanej');
    expect(xml).not.toContain('PrzyczynaKorekty');

    const result = await validateXsd(xml, 'pl/schemat_FA2.xsd');
    expect(result.valid).toBe(true);
  });

  it('issued in the FA(3) era, a correction is rendered and validated as FA(3)', async () => {
    findUnique.mockResolvedValue(
      baseInvoiceRow({
        issuedAt: new Date('2026-03-01T09:00:00Z'),
        createdAt: new Date('2026-03-01T09:00:00Z'),
        correctsInvoice: {
          rawNumber: 'FV-2026-0010',
          number: null,
          issuedAt: new Date('2026-02-15T09:00:00Z'),
          createdAt: new Date('2026-02-15T09:00:00Z'),
          complianceDocuments: [
            {
              createdAt: new Date('2026-02-15T09:05:00Z'),
              authorityIds: [{ scheme: 'KSEF_NUMBER', value: '1234567890-20260215-1A2B3C-4D5E6F-A1' }],
            },
          ],
        },
      }),
    );

    const xml = await service.renderFaVat('inv-correction-1');
    expect(xml).toContain('http://crd.gov.pl/wzor/2025/06/25/13775/');
    expect(xml).toContain('kodSystemowy="FA (3)"');
    expect(xml).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
    expect(xml).toContain('<NrKSeFFaKorygowanej>1234567890-20260215-1A2B3C-4D5E6F-A1</NrKSeFFaKorygowanej>');

    const result = await validateXsd(xml, 'pl/schemat_FA3.xsd');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
