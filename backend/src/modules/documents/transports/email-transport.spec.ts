import { BadRequestException } from '@nestjs/common';

import * as companyEmailTemplates from '../actions/company-email-templates';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { DocumentTypeRegistry } from '../descriptors/type-registry';
import * as takeNumber from '../numbering/take-number';
import { EntityReferenceRegistry } from '../references/reference-registry';
import * as renderInstancePdf from '../rendering/render-instance-pdf';
import { buildEmailTransport } from './email-transport';

jest.mock('../actions/company-email-templates');
jest.mock('../numbering/take-number');
jest.mock('../rendering/render-instance-pdf');

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

  (renderInstancePdf.renderDocumentInstance as jest.Mock).mockResolvedValue({
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
  (companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock).mockResolvedValue({});
  (takeNumber.takeDocumentNumberForTransition as jest.Mock).mockResolvedValue(undefined);

  return { typeRegistry, referenceRegistry };
}

describe('buildEmailTransport', () => {
  afterEach(() => jest.resetAllMocks());

  it("emails the rendered PDF to the referenced client's contact email, through sendDocumentInstanceEmail", async () => {
    const clientsService = {
      getClientById: jest.fn().mockResolvedValue({ id: 'client-1', contactEmail: 'client-1@example.com' }),
    };
    const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };
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
    expect(mailService.sendMail).toHaveBeenCalledWith(
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

  it('refuses to send when the client has no contact email on file — never silently drops the delivery', async () => {
    const clientsService = {
      getClientById: jest.fn().mockResolvedValue({ id: 'client-1', contactEmail: null }),
    };
    const mailService = { sendMail: jest.fn() };
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
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('refuses when the document has no client set at all', async () => {
    const clientsService = { getClientById: jest.fn() };
    const mailService = { sendMail: jest.fn() };
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
