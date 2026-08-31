/**
 * facturx-provider.ts — root TODO item 10's promised follow-through on TODO_ISSUES.md's Factur-X
 * entry. `rendering/render-instance-pdf.ts` is MOCKED (the same discipline `email-transport.spec.ts`
 * already holds for the identical reason: real Puppeteer has no business in a unit spec) — but it
 * hands back a REAL, valid PDF built with `pdf-lib` rather than a fake byte string, because
 * `@e-invoice-eu/core`'s Factur-X embedder genuinely PARSES and manipulates the PDF it is given (PDF/
 * A-3 attachments, XMP metadata) — a non-PDF buffer would make even the SUCCESS case throw for a
 * reason that has nothing to do with this provider's own logic. Everything else — the semantic
 * bridge, the REAL vendored EN 16931 Schematron, the REAL Factur-X embed — runs for real.
 */
import { PDFDocument } from 'pdf-lib';

import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { DocumentFormatParty } from './format-provider';
import { buildFacturxFormatProvider } from './facturx-provider';

jest.mock('../rendering/render-instance-pdf');

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

/** Same fixture `providers.spec.ts` uses for the CII/UBL providers — a seller the vendored
 *  Schematron actually accepts (VAT + SIRET on file). */
const SELLER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  email: 'contact@dupont-consulting.example',
  phone: '+33102030405',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'FR12345678901' },
    { scheme: 'LEGAL_ID', value: '12345678900017' },
  ],
};

const BUYER: DocumentFormatParty = {
  name: 'Acme GmbH',
  address: 'Friedrichstraße 42',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  notes: 'Merci de votre confiance.',
  lines: [{ description: 'Conseil stratégique', quantity: 10, unit: 'hour', unitPrice: 1200, vatRate: '20' }],
};

/** BR-Z-02 bait — a zero-rated line with NO seller VAT identifier at all: the same reproduction
 *  `pitfalls.spec.ts` already proves against the raw bridge, used here to prove the PROVIDER refuses
 *  to embed it. */
const INVALID_DATA = {
  client: 'client-1',
  issueDate: '2026-08-30',
  dueDate: '2026-09-30',
  currency: 'EUR',
  lines: [{ description: 'Prestation exonérée', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '0' }],
};
const SELLER_NO_VAT: DocumentFormatParty = { ...SELLER, partyIdentifiers: [] };

async function fakeRealPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return Buffer.from(await doc.save());
}

describe('facturx-provider — embed a CII gated the SAME way cii-provider.ts gates it', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
      pdf: await fakeRealPdf(),
      totals: {
        currency: 'EUR',
        lines: [],
        netMinor: 0,
        vatMinor: 0,
        grossMinor: 0,
        vatBreakdown: [],
        warnings: [],
      },
      referenceLabels: {},
      companyName: SELLER.name,
    });
  });

  const provider = buildFacturxFormatProvider({ referenceRegistry: new EntityReferenceRegistry() });

  it('declares itself correctly for the format registry / download-xml param', () => {
    expect(provider.id).toBe('facturx');
    expect(provider.mime).toBe('application/pdf');
  });

  it('a VALID document: embeds a real PDF/A-3, starting with the %PDF magic bytes', async () => {
    const document = {
      id: 'doc-1',
      data: VALID_DATA,
      displayNumber: 'INV-2026-0001',
      status: 'sent',
      createdAt: new Date(),
    };

    const result = await provider.build(descriptor, document, SELLER, BUYER, 'company-1');

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
    expect(Buffer.from(result.bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(renderInstancePdf.renderDocumentInstance).toHaveBeenCalledWith(
      { referenceRegistry: expect.any(EntityReferenceRegistry) },
      'company-1',
      descriptor,
      document,
    );
  }, 30_000);

  it('an INVALID document (BR-Z-02: zero-rated line, no seller VAT id): NEVER embeds — no PDF is even attempted', async () => {
    const document = {
      id: 'doc-2',
      data: INVALID_DATA,
      displayNumber: 'INV-2026-0002',
      status: 'sent',
      createdAt: new Date(),
    };

    const result = await provider.build(descriptor, document, SELLER_NO_VAT, BUYER, 'company-1');

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.join(' ')).toContain('BR-Z-02');
    // The failure branch returns the CII bytes (for diagnosis), never a PDF — and the human PDF
    // renderer is never even reached once the CII gate has already failed.
    expect(Buffer.from(result.bytes.slice(0, 5)).toString()).not.toBe('%PDF-');
    expect(renderInstancePdf.renderDocumentInstance).not.toHaveBeenCalled();
  }, 30_000);

  it('throws rather than silently building without a companyId (unreachable via documents.service.ts, never trusted alone)', async () => {
    const document = {
      id: 'doc-3',
      data: VALID_DATA,
      displayNumber: 'INV-2026-0003',
      status: 'sent',
      createdAt: new Date(),
    };
    await expect(provider.build(descriptor, document, SELLER, BUYER)).rejects.toThrow(/requires a companyId/);
  });
});
