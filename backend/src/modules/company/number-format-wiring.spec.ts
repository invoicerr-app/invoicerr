/**
 * The actual defect this wave fixes, proven end to end: before it, the "Number formats" card in
 * Settings → Company wrote `Company.quoteNumberFormat`/`invoiceNumberFormat` (dead columns nothing
 * reads — see `Company.numberFormats`'s own schema.prisma comment), while numbering itself
 * (`documents/numbering/take-number.ts`) only ever reads `Company.numberFormats`. A test that only
 * asserts a value round-trips through `PUT /api/company/number-format` would prove nothing about
 * that gap — see this file's own name. This proves the FULL path instead: the exact write
 * `CompanyService#updateNumberFormat` performs (what the settings card's `PUT
 * /api/company/number-format` call — and, for `atcud.settings.tsx`, its own identical call — end up
 * running) followed by the exact read `documents.service.ts#runAction` performs when it actually
 * numbers a document (`takeDocumentNumberForTransition`), asserting the number an issued document
 * carries — in `DocumentInstance.displayNumber` itself, not just a function's return value — is the
 * pattern the settings screen saved.
 */
jest.mock('../webhooks/webhook-dispatcher.service', () => ({
  WebhookDispatcherService: jest.fn(),
}));

import { CompanyService } from './company.service';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { takeDocumentNumberForTransition } from '../documents/numbering/take-number';
import prisma from '@/prisma/prisma.service';

const fakeWebhookDispatcher = {
  dispatch: jest.fn().mockResolvedValue(undefined),
} as unknown as WebhookDispatcherService;

describe('The "Number formats" settings card actually drives numbering (not just Company.numberFormats)', () => {
  let service: CompanyService;
  let companyId: string;

  beforeAll(() => {
    service = new CompanyService(fakeWebhookDispatcher);
  });

  beforeEach(async () => {
    const company = await prisma.company.create({
      data: {
        name: 'Number Format Wiring Co',
        foundedAt: new Date('2020-01-01'),
        address: '1 rue de Test',
        postalCode: '75000',
        city: 'Paris',
        country: 'France',
        countryCode: 'FR',
        phone: '+33100000000',
        email: `number-format-wiring-${Date.now()}-${Math.random()}@example.com`,
      },
      select: { id: true },
    });
    companyId = company.id;
  });

  afterEach(async () => {
    // Cascades to DocumentInstance/DocumentNumberSequence rows (both declare `onDelete: Cascade`
    // on their companyId relation).
    await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
  });

  it('a pattern saved through the settings screen is the pattern a newly issued invoice actually carries', async () => {
    // Exactly what the settings card's PUT /api/company/number-format call runs.
    await service.updateNumberFormat(companyId, 'invoice', 'CUSTOM-{year}-{number:3}');

    const doc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sending', data: {} },
      select: { id: true },
    });

    // Exactly what documents.service.ts#runAction calls to actually number a document on send.
    const result = await takeDocumentNumberForTransition(companyId, 'invoice', doc.id);

    const expected = `CUSTOM-${new Date().getFullYear()}-001`;
    expect(result?.displayNumber).toBe(expected);

    // What is actually IN THE DATABASE, not just what the function returned — a value round-tripping
    // through the API response proves nothing about what an issued document ends up carrying.
    const row = await prisma.documentInstance.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.displayNumber).toBe(expected);
    expect(row.number).toBe(1);
  });

  it("the SAME company's quote pattern is independent — the card writes per type, not one shared value", async () => {
    await service.updateNumberFormat(companyId, 'invoice', 'INV-CUSTOM-{number:2}');
    await service.updateNumberFormat(companyId, 'quote', 'DEVIS-{number:2}');

    const invoiceDoc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sending', data: {} },
      select: { id: true },
    });
    const quoteDoc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'quote', status: 'sending', data: {} },
      select: { id: true },
    });

    const invoiceResult = await takeDocumentNumberForTransition(companyId, 'invoice', invoiceDoc.id);
    const quoteResult = await takeDocumentNumberForTransition(companyId, 'quote', quoteDoc.id);

    expect(invoiceResult?.displayNumber).toBe('INV-CUSTOM-01');
    expect(quoteResult?.displayNumber).toBe('DEVIS-01');
  });

  it('before the card is ever used, a fresh company gets the shipped default — never the dead legacy column', async () => {
    // This company's dead `invoiceNumberFormat` column still defaults to "INV-{year}-{number:4}"
    // (schema.prisma) — the exact confusion this whole task exists to close. Numbering must ignore it.
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.invoiceNumberFormat).toBe('INV-{year}-{number:4}');

    const doc = await prisma.documentInstance.create({
      data: { companyId, typeId: 'invoice', status: 'sending', data: {} },
      select: { id: true },
    });
    const result = await takeDocumentNumberForTransition(companyId, 'invoice', doc.id);

    expect(result?.displayNumber).toBe(`INVOICE-${new Date().getFullYear()}-0001`);
  });
});
