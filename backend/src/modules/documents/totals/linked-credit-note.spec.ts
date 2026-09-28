/**
 * Issue #507 - a LINKED credit note rendered its PDF with "Total 0.00" and its corrected lines as raw
 * row ids, and its covering email said "for a total of 0.00". `totals/linked-credit-note.ts` is now
 * the one rule every one of those reads, the same one settlement and the XML export read.
 *
 * What is proven here, against the REAL `renderDocumentInstance` / `sendDocumentInstanceEmail`
 * pipeline (only Prisma, the corrected invoice's lookup, Chromium and the mail transport are
 * replaced at their entry points):
 *  - the credited total equals, to the cent, what `settlement/credits.ts` takes off the invoice,
 *    with a per-line discount that only the INVOICE's descriptor knows how to apply;
 *  - the PDF's HTML lists the corrected line's description, quantity and price, never its row id,
 *    and names the corrected invoice by number and date;
 *  - the email built from that render states the same amount;
 *  - a FREE credit note keeps pricing its own lines.
 */
import { type MockedFunction, vi } from 'vitest';

import prisma from '@/prisma/prisma.service';

import { DocumentInstanceResult } from '../actions/action-registry';
import { getCompanyDocumentEmailTemplates } from '../actions/company-email-templates';
import { sendDocumentInstanceEmail } from '../actions/send-document-email';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import { findOwnedDocument } from '../persistence';
import { EntityReferenceRegistry } from '../references/reference-registry';
import { renderDocumentInstance } from '../rendering/render-instance-pdf';
import { renderPdf } from '../rendering/render-pdf';
import { creditsForInvoiceFromNotes } from '../settlement/credits';
import { computeDocumentTotals } from './compute-totals';
import {
  linkedCreditNotePricingData,
  linkedCreditNoteTotals,
  resolveLinkedCreditNote,
} from './linked-credit-note';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: vi.fn() }, client: { findFirst: vi.fn() } },
}));
vi.mock('../persistence', async () => {
  const actual = await vi.importActual<typeof import('../persistence')>('../persistence');
  return { ...actual, findOwnedDocument: vi.fn() };
});
vi.mock('../rendering/render-pdf');
vi.mock('../company-custom-fields/persistence', () => ({
  resolveDocumentCustomFieldDescriptors: vi.fn().mockResolvedValue([]),
}));
vi.mock('../payment-methods/persistence', () => ({
  resolveEnabledPaymentMethodPresentations: vi.fn().mockResolvedValue([]),
}));
vi.mock('../actions/company-email-templates');

const mockedFindOwnedDocument = findOwnedDocument as MockedFunction<typeof findOwnedDocument>;
const mockedRenderPdf = renderPdf as MockedFunction<typeof renderPdf>;
const mockedCompanyFindUnique = prisma.company.findUnique as unknown as MockedFunction<
  () => Promise<unknown>
>;

const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();
const CREDIT_NOTE_DESCRIPTOR = buildCreditNoteDescriptor();
const COMPANY_ID = 'company-507';

const INVOICE: DocumentInstanceResult = {
  id: 'invoice-507',
  typeId: 'invoice',
  status: 'sent',
  displayNumber: 'INV-2026-0042',
  createdAt: new Date('2026-08-30T10:00:00Z'),
  updatedAt: new Date('2026-08-30T10:00:00Z'),
  data: {
    client: 'client-507',
    issueDate: '2026-08-30',
    currency: 'EUR',
    lines: [
      { $rowId: 'row-kept-0001', description: 'Conseil', quantity: 1, unitPrice: 500, vatRate: '20' },
      // 2 x 300 at 10% off: net 540.00, VAT 108.00, gross 648.00 - a discount only the INVOICE's
      // descriptor declares, so a total computed any other way lands on 720.00 instead.
      {
        $rowId: 'row-credited-0002',
        description: 'Formation annulee',
        quantity: 2,
        unitPrice: 300,
        vatRate: '20',
        discountPercent: 10,
      },
    ],
  },
};

function creditNote(overrides: Partial<DocumentInstanceResult> = {}): DocumentInstanceResult {
  return {
    id: 'credit-note-507',
    typeId: 'credit-note',
    status: 'sent',
    number: 1,
    displayNumber: 'CREDIT-NOTE-2026-0001',
    createdAt: new Date('2026-09-20T10:00:00Z'),
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    data: {
      invoice: INVOICE.id,
      correctedLines: ['row-credited-0002'],
      issueDate: '2026-09-20',
      currency: 'EUR',
      reason: 'Session cancelled by the client',
      lines: [],
    },
    ...overrides,
  };
}

/** What settlement takes off the invoice for this note - the figure every other one must equal. */
function settlementCreditMinor(note: DocumentInstanceResult): number {
  const { credits } = creditsForInvoiceFromNotes(
    [note],
    INVOICE.id,
    INVOICE_DESCRIPTOR,
    INVOICE.data as Record<string, unknown>,
  );
  expect(credits).toHaveLength(1);
  return credits[0].amountMinor;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindOwnedDocument.mockImplementation(async (_companyId, typeId, id) => {
    if (typeId === 'invoice' && id === INVOICE.id) return INVOICE;
    throw new (await import('@nestjs/common')).NotFoundException(`Document "${id}" not found.`);
  });
  mockedRenderPdf.mockResolvedValue(Buffer.from('%PDF-507'));
  mockedCompanyFindUnique.mockResolvedValue({
    name: 'Avoir SAS',
    address: '1 Rue de la Paix',
    city: 'Paris',
    postalCode: '75001',
    country: 'France',
    iban: null,
    language: 'en',
    exemptVat: false,
    brandingAccentColor: null,
    brandingFont: null,
    brandingLogoId: null,
  });
  (
    getCompanyDocumentEmailTemplates as MockedFunction<typeof getCompanyDocumentEmailTemplates>
  ).mockResolvedValue({});
});

describe('the one rule for a linked credit note', () => {
  it('prices the selected invoice rows with the invoice descriptor, to the cent what settlement subtracts', async () => {
    const note = creditNote();
    const linked = await resolveLinkedCreditNote(COMPANY_ID, note.data as Record<string, unknown>);
    expect(linked).not.toBeNull();
    const totals = linkedCreditNoteTotals(linked!);
    expect(totals.grossMinor).toBe(64800);
    expect(totals.grossMinor).toBe(settlementCreditMinor(note));
    expect(totals.currency).toBe('EUR');
    expect((linked!.pricingData.lines as unknown[]).length).toBe(1);
  });

  it('is the same object settlement prices from (pure half)', () => {
    const data = linkedCreditNotePricingData(
      creditNote().data as Record<string, unknown>,
      INVOICE.data as Record<string, unknown>,
    );
    expect(computeDocumentTotals(INVOICE_DESCRIPTOR, data).grossMinor).toBe(
      settlementCreditMinor(creditNote()),
    );
  });

  it('answers null for a FREE credit note, which keeps its own lines', async () => {
    const free = { issueDate: '2026-09-20', currency: 'EUR', reason: 'Geste commercial', lines: [] };
    expect(await resolveLinkedCreditNote(COMPANY_ID, free)).toBeNull();
    expect(mockedFindOwnedDocument).not.toHaveBeenCalled();
  });
});

describe('renderDocumentInstance - a linked credit note', () => {
  it('prints the corrected line, never its row id, the corrected invoice number and date, and the credited total', async () => {
    const note = creditNote();
    const rendered = await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      COMPANY_ID,
      CREDIT_NOTE_DESCRIPTOR,
      note,
      'on-demand',
    );
    const html = mockedRenderPdf.mock.calls[0][0];

    expect(html).toContain('Formation annulee');
    expect(html, 'the corrected row id is an internal pointer, never printed').not.toContain(
      'row-credited-0002',
    );
    expect(html, 'the line the note does not correct is not listed').not.toContain('Conseil');
    expect(html).toContain('Corrects invoice INV-2026-0042 of 2026-08-30');
    expect(html).toContain('648.00 EUR');

    expect(rendered.totals.grossMinor).toBe(settlementCreditMinor(note));
  });

  it('a FREE credit note still prints its own lines and their own total', async () => {
    const free = creditNote({
      data: {
        issueDate: '2026-09-20',
        currency: 'EUR',
        reason: 'Geste commercial',
        lines: [{ description: 'Remise fidelite', quantity: 1, unitPrice: 50, vatRate: '20' }],
      },
    });
    const rendered = await renderDocumentInstance(
      { referenceRegistry: new EntityReferenceRegistry() },
      COMPANY_ID,
      CREDIT_NOTE_DESCRIPTOR,
      free,
      'on-demand',
    );
    const html = mockedRenderPdf.mock.calls[0][0];
    expect(rendered.totals.grossMinor).toBe(6000);
    expect(html).toContain('Remise fidelite');
    expect(html).not.toContain('Corrects invoice');
    expect(mockedFindOwnedDocument).not.toHaveBeenCalled();
  });
});

describe('sendDocumentInstanceEmail - a linked credit note', () => {
  it('states the credited amount in the email body, the same figure settlement takes off the invoice', async () => {
    const typeRegistry = new DocumentTypeRegistry();
    typeRegistry.register(CREDIT_NOTE_DESCRIPTOR);
    const sendForCompany = vi.fn().mockResolvedValue({ message: 'sent' });
    const note = creditNote({ status: 'sending' });

    await sendDocumentInstanceEmail(
      {
        typeRegistry,
        referenceRegistry: new EntityReferenceRegistry(),
        mailService: { sendForCompany } as never,
      },
      {
        companyId: COMPANY_ID,
        typeId: 'credit-note',
        document: note,
        recipient: 'client@example.com',
        label: 'Credit note',
      },
    );

    const body = sendForCompany.mock.calls[0][1].text as string;
    expect(settlementCreditMinor(creditNote())).toBe(64800);
    expect(body).toContain('for a total of 648.00');
  });
});
