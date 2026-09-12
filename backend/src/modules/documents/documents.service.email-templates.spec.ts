import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ActionExtensionRegistry } from './actions/action-extensions';
import { ActionRegistry } from './actions/action-registry';
import * as companyEmailTemplates from './actions/company-email-templates';
import { ContributionRegistry } from './contributions/contribution-registry';
import { buildCreditNoteDescriptor } from './descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from './descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from './descriptors/quote.descriptor';
import { DocumentTypeRegistry } from './descriptors/type-registry';
import { FieldKindRegistry, registerCoreFieldKinds } from './descriptors/field-kinds';
import { DocumentsService } from './documents.service';
import { EntityReferenceRegistry } from './references/reference-registry';
import { TransportRegistry } from './transports/transport-registry';

// The JSON-column boundary, mocked at its own entry point (`actions/company-email-templates.ts`) — the
// same discipline documents.service.spec.ts already applies to it, so these tests prove the service's
// own resolution/validation rather than a re-implementation of Prisma. That module's OWN read/merge/
// sanitize behaviour is proven separately, against an in-memory row, in company-email-templates.spec.ts.
jest.mock('./actions/company-email-templates');
// `resolveCompanyName` is the one direct Prisma read these methods make.
jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { company: { findUnique: jest.fn(async () => ({ name: 'Acme Corp' })) } },
}));

function buildService() {
  const typeRegistry = new DocumentTypeRegistry();
  typeRegistry.register(buildQuoteDescriptor());
  typeRegistry.register(buildInvoiceDescriptor());
  typeRegistry.register(buildCreditNoteDescriptor());

  const fieldKindRegistry = new FieldKindRegistry();
  registerCoreFieldKinds(fieldKindRegistry);

  const service = new DocumentsService(
    typeRegistry,
    fieldKindRegistry,
    new ActionRegistry(),
    new ActionExtensionRegistry(),
    new EntityReferenceRegistry(),
    new TransportRegistry(),
    new ContributionRegistry(),
  );

  return { service };
}

const setTemplate = companyEmailTemplates.setCompanyDocumentEmailTemplate as jest.Mock;
const clearTemplate = companyEmailTemplates.clearCompanyDocumentEmailTemplate as jest.Mock;
const getTemplates = companyEmailTemplates.getCompanyDocumentEmailTemplates as jest.Mock;

describe('DocumentsService — per-document-type email templates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getTemplates.mockResolvedValue({});
    // The real setter returns what it stored (sanitized); the default here echoes the input, and the
    // tests that care about sanitization override it.
    setTemplate.mockImplementation(async (_companyId, _typeId, template) => template);
    clearTemplate.mockResolvedValue(undefined);
  });

  describe('listEmailTemplates', () => {
    it('covers EVERY registered type, with each one resolved to its own descriptor default', async () => {
      const { service } = buildService();

      const templates = await service.listEmailTemplates('company-1');

      expect(templates.map((t) => t.typeId).sort()).toEqual(['credit-note', 'invoice', 'quote']);
      const quote = templates.find((t) => t.typeId === 'quote')!;
      expect(quote.source).toBe('descriptor');
      expect(quote.subject).toBe(buildQuoteDescriptor().email?.subject);
      expect(quote.label).toBe('Quote');
    });

    it("reports the company's OWN template, and says so, for a type it overrode", async () => {
      getTemplates.mockResolvedValue({
        quote: { subject: 'Our own subject', body: 'Our own body', html: '<p>Our own body</p>' },
      });
      const { service } = buildService();

      const templates = await service.listEmailTemplates('company-1');
      const quote = templates.find((t) => t.typeId === 'quote')!;
      const invoice = templates.find((t) => t.typeId === 'invoice')!;

      expect(quote).toMatchObject({
        source: 'company',
        subject: 'Our own subject',
        body: 'Our own body',
        html: '<p>Our own body</p>',
      });
      // An override for one type never leaks onto another.
      expect(invoice.source).toBe('descriptor');
    });

    it('derives the vocabulary PER TYPE — the real company name, and only the keys that type has', async () => {
      const { service } = buildService();

      const templates = await service.listEmailTemplates('company-1');
      const quote = templates.find((t) => t.typeId === 'quote')!;
      const creditNote = templates.find((t) => t.typeId === 'credit-note')!;

      expect(quote.variables.companyName).toBe('Acme Corp');
      expect(Object.keys(quote.variables).sort()).toEqual([
        'companyName',
        'displayNumber',
        'recipientName',
        'totalGross',
        'typeLabel',
      ]);
      // A credit note points at an invoice rather than a client, and has no money lines of its own.
      expect(creditNote.variables).not.toHaveProperty('recipientName');
      expect(creditNote.variables).not.toHaveProperty('totalGross');
    });
  });

  describe('getEmailTemplate', () => {
    it('resolves one type the same way the list route does', async () => {
      const { service } = buildService();

      const template = await service.getEmailTemplate('company-1', 'invoice');

      expect(template.typeId).toBe('invoice');
      expect(template.source).toBe('descriptor');
      expect(template.variables.typeLabel).toBe('Invoice');
    });

    it('404s for a type nobody registered — never an empty template for a typo', async () => {
      const { service } = buildService();

      await expect(service.getEmailTemplate('company-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateEmailTemplate', () => {
    it("stores the template and reports it back as the company's own", async () => {
      const { service } = buildService();

      const result = await service.updateEmailTemplate('company-1', 'quote', {
        subject: '{typeLabel} {displayNumber}',
        body: 'Dear {recipientName}, total {totalGross}.',
        html: '<p>Dear {recipientName}</p>',
      });

      expect(setTemplate).toHaveBeenCalledWith('company-1', 'quote', {
        subject: '{typeLabel} {displayNumber}',
        body: 'Dear {recipientName}, total {totalGross}.',
        html: '<p>Dear {recipientName}</p>',
      });
      expect(result.warnings).toEqual([]);
      expect(result.template).toMatchObject({ typeId: 'quote', source: 'company' });
    });

    it('WARNS about an unknown placeholder and still stores — never rejects the save', async () => {
      const { service } = buildService();

      const result = await service.updateEmailTemplate('company-1', 'quote', {
        subject: 'Quote for {clientName}',
        body: 'Body',
      });

      // `{clientName}` is a typo for `{recipientName}`: reported, stored anyway. A typo in a subject
      // must never become the reason a customer stops receiving their quotes.
      expect(result.warnings).toEqual(['Unknown email template placeholder "{clientName}" left as-is.']);
      expect(setTemplate).toHaveBeenCalled();
    });

    it('does NOT warn about {totalGross} on a type whose total is structurally zero — the send fills it', async () => {
      const { service } = buildService();

      const result = await service.updateEmailTemplate('company-1', 'credit-note', {
        subject: '{typeLabel} {displayNumber}',
        body: 'Total {totalGross}.',
      });

      expect(result.warnings).toEqual([]);
    });

    it('reports warnings against what was ACTUALLY STORED, not against what was submitted', async () => {
      // Sanitization can change the html on the way in; the warnings must describe the stored value.
      setTemplate.mockResolvedValue({ subject: 'Subject', body: 'Body', html: '<p>{mystery}</p>' });
      const { service } = buildService();

      const result = await service.updateEmailTemplate('company-1', 'quote', {
        subject: 'Subject',
        body: 'Body',
        html: '<p>{mystery}</p><script>alert(1)</script>',
      });

      expect(result.warnings).toEqual(['Unknown email template placeholder "{mystery}" left as-is.']);
      expect(result.template.html).toBe('<p>{mystery}</p>');
    });

    it('refuses a blank subject, and stores nothing', async () => {
      const { service } = buildService();

      await expect(
        service.updateEmailTemplate('company-1', 'quote', { subject: '   ', body: 'Body' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(setTemplate).not.toHaveBeenCalled();
    });

    it('refuses a template with neither a text body nor an html one, and stores nothing', async () => {
      const { service } = buildService();

      await expect(
        service.updateEmailTemplate('company-1', 'quote', { subject: 'Subject', body: '  ', html: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(setTemplate).not.toHaveBeenCalled();
    });

    it('accepts an html-only template — the send derives the text part from it', async () => {
      const { service } = buildService();

      const result = await service.updateEmailTemplate('company-1', 'quote', {
        subject: 'Subject',
        html: '<p>Rich only</p>',
      });

      expect(setTemplate).toHaveBeenCalledWith('company-1', 'quote', {
        subject: 'Subject',
        body: '',
        html: '<p>Rich only</p>',
      });
      expect(result.template.html).toBe('<p>Rich only</p>');
    });

    it('404s for an unknown type before writing anything', async () => {
      const { service } = buildService();

      await expect(
        service.updateEmailTemplate('company-1', 'nope', { subject: 'S', body: 'B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(setTemplate).not.toHaveBeenCalled();
    });
  });

  describe('resetEmailTemplate', () => {
    it('drops the override and returns the descriptor default that now applies', async () => {
      getTemplates.mockResolvedValue({ quote: { subject: 'Our own', body: 'Our own' } });
      const { service } = buildService();

      const template = await service.resetEmailTemplate('company-1', 'quote');

      expect(clearTemplate).toHaveBeenCalledWith('company-1', 'quote');
      expect(template.source).toBe('descriptor');
      expect(template.subject).toBe(buildQuoteDescriptor().email?.subject);
    });

    it('404s for an unknown type without clearing anything', async () => {
      const { service } = buildService();

      await expect(service.resetEmailTemplate('company-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(clearTemplate).not.toHaveBeenCalled();
    });
  });
});
