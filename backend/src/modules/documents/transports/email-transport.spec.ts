import { vi, type Mock } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import * as companyEmailTemplates from '../actions/company-email-templates';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as takeNumber from '../numbering/take-number';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { buildEmailTransport } from './email-transport';

vi.mock('../actions/company-email-templates');
vi.mock('../numbering/take-number');
vi.mock('../rendering/render-instance-pdf');

/**
 * The built-in "email" transport in isolation — the one path invoice-actions.ts's "send" reaches
 * when a company has configured `invoiceTransportId: "email"`. It resolves the recipient itself from
 * the document's `client` field (unlike the quote's own send-by-email mechanism, which takes a
 * user-typed `recipient` param) — see this file's own header comment for why that split is correct.
 *
 * `renderDocumentInstance`/`getCompanyDocumentEmailTemplates`/`takeDocumentNumberForTransition` are
 * mocked wholesale — real Prisma and real Puppeteer have no business running in this unit spec; the
 * ONE thing this file proves is that the transport resolves an address and then hands off to
 * `sendDocumentInstanceEmail` (actions/send-document-email.ts, its own coverage), not how that
 * function itself composes a message.
 */
function buildDeps() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildInvoiceDescriptor());
  const referenceRegistry = new EntityReferenceRegistry();

  (renderInstancePdf.renderDocumentInstance as Mock).mockResolvedValue({
    pdf: Buffer.from('%PDF-fake'),
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
    companyName: 'Test Co',
  });
  (companyEmailTemplates.getCompanyDocumentEmailTemplates as Mock).mockResolvedValue({});
  (takeNumber.takeDocumentNumberForTransition as Mock).mockResolvedValue(undefined);

  return { typeRegistry, referenceRegistry };
}

describe('buildEmailTransport', () => {
  afterEach(() => vi.resetAllMocks());

  it("emails the rendered PDF to the referenced client's contact email, through sendDocumentInstanceEmail", async () => {
    const clientsService = {
      getClientById: vi.fn().mockResolvedValue({ id: 'client-1', contactEmail: 'client-1@example.com' }),
    };
    const mailService = {
      sendForCompany: vi.fn().mockResolvedValue({ message: 'Email sent successfully' }),
    };
    const { typeRegistry, referenceRegistry } = buildDeps();

    const transport = buildEmailTransport({
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
    });
    const result = await transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: { client: 'client-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
    });

    expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-1');
    // Proves the hand-off into sendDocumentInstanceEmail actually happened (real PDF pipeline
    // mocked, real template interpolation NOT mocked) — the company name from the mocked render
    // result reaches the subject/body, and the attachment is the rendered PDF, not a bare text mail.
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        to: 'client-1@example.com',
        subject: expect.stringContaining('Test Co'),
        attachments: [
          expect.objectContaining({ filename: 'invoice-doc-1.pdf', contentType: 'application/pdf' }),
        ],
      }),
    );
    expect(result.message).toMatch(/client-1@example\.com/);
  });

  it("issue #499: a credit note goes to its corrected invoice's client, with the credit note itself attached", async () => {
    const clientsService = {
      getClientById: vi.fn().mockResolvedValue({ id: 'client-7', contactEmail: 'client-7@example.com' }),
    };
    const mailService = { sendForCompany: vi.fn().mockResolvedValue({ message: 'Email sent successfully' }) };
    const { typeRegistry, referenceRegistry } = buildDeps();
    typeRegistry.register(buildCreditNoteDescriptor());
    const creditNote = {
      id: 'cn-1',
      typeId: 'credit-note',
      status: 'sending',
      displayNumber: 'CN-2026-0001',
      data: { invoice: 'inv-1', correctedLines: ['r1'], issueDate: '2026-08-31', currency: 'EUR' },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const transport = buildEmailTransport({
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
    });
    expect(transport.deliversCreditNotes).toBe(true);
    const result = await transport.send({
      companyId: 'company-1',
      document: creditNote,
      label: 'Credit note',
      formatSource: {
        descriptor: buildInvoiceDescriptor(),
        document: { ...creditNote, data: { client: 'client-7', lines: [] } },
      },
    });

    // The buyer comes from the invoice-shaped source (a credit note has no client field)...
    expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-7');
    // ...and the PDF rendered and attached is the credit note's own, with its own descriptor.
    expect(renderInstancePdf.renderDocumentInstance).toHaveBeenCalledWith(
      expect.anything(),
      'company-1',
      expect.objectContaining({ id: 'credit-note' }),
      expect.objectContaining({ id: 'cn-1', data: creditNote.data }),
      'delivery',
    );
    expect(mailService.sendForCompany).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({
        to: 'client-7@example.com',
        attachments: [expect.objectContaining({ filename: 'CN-2026-0001.pdf' })],
      }),
    );
    expect(result.artifacts).toEqual([expect.objectContaining({ role: 'pdf', mime: 'application/pdf' })]);
  });

  it('refuses to send when the client has no contact email on file — never silently drops the delivery', async () => {
    const clientsService = {
      getClientById: vi.fn().mockResolvedValue({ id: 'client-1', contactEmail: null }),
    };
    const mailService = { sendForCompany: vi.fn() };
    const { typeRegistry, referenceRegistry } = buildDeps();

    const transport = buildEmailTransport({
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
    });
    const action = transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: { client: 'client-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    expect(mailService.sendForCompany).not.toHaveBeenCalled();
  });

  it('refuses when the document has no client set at all', async () => {
    const clientsService = { getClientById: vi.fn() };
    const mailService = { sendForCompany: vi.fn() };
    const { typeRegistry, referenceRegistry } = buildDeps();

    const transport = buildEmailTransport({
      clientsService: clientsService as never,
      mailService: mailService as never,
      typeRegistry,
      referenceRegistry,
    });
    const action = transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'sent',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    expect(clientsService.getClientById).not.toHaveBeenCalled();
  });
});
