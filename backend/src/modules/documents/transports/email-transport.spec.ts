import { BadRequestException } from '@nestjs/common';

import { buildEmailTransport } from './email-transport';

/**
 * The built-in "email" transport in isolation — the one path invoice-actions.ts's "send" reaches
 * when a company has configured `invoiceTransportId: "email"`. It resolves the recipient itself from
 * the document's `client` field (unlike the quote's own send-by-email mechanism, which takes a
 * user-typed `recipient` param) — see this file's own header comment for why that split is correct.
 */
describe('buildEmailTransport', () => {
  it("emails the document text to the referenced client's contact email", async () => {
    const clientsService = {
      getClientById: jest.fn().mockResolvedValue({ id: 'client-1', contactEmail: 'client-1@example.com' }),
    };
    const mailService = { sendMail: jest.fn().mockResolvedValue({ message: 'Email sent successfully' }) };

    const transport = buildEmailTransport(clientsService as never, mailService as never);
    const result = await transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: { client: 'client-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
      text: 'Please find your invoice below.',
    });

    expect(clientsService.getClientById).toHaveBeenCalledWith('company-1', 'client-1');
    expect(mailService.sendMail).toHaveBeenCalledWith({
      to: 'client-1@example.com',
      subject: 'Invoice doc-1',
      text: 'Please find your invoice below.',
    });
    expect(result.message).toMatch(/client-1@example\.com/);
  });

  it('refuses to send when the client has no contact email on file — never silently drops the delivery', async () => {
    const clientsService = {
      getClientById: jest.fn().mockResolvedValue({ id: 'client-1', contactEmail: null }),
    };
    const mailService = { sendMail: jest.fn() };

    const transport = buildEmailTransport(clientsService as never, mailService as never);
    const action = transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: { client: 'client-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
      text: 'Please find your invoice below.',
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  it('refuses when the document has no client set at all', async () => {
    const clientsService = { getClientById: jest.fn() };
    const mailService = { sendMail: jest.fn() };

    const transport = buildEmailTransport(clientsService as never, mailService as never);
    const action = transport.send({
      companyId: 'company-1',
      document: {
        id: 'doc-1',
        typeId: 'invoice',
        status: 'draft',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      label: 'Invoice',
      text: 'Please find your invoice below.',
    });

    await expect(action).rejects.toBeInstanceOf(BadRequestException);
    expect(clientsService.getClientById).not.toHaveBeenCalled();
  });
});
