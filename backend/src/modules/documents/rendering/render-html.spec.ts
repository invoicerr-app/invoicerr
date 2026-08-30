import { renderDocumentHtml } from './render-html';
import { DocumentTypeDescriptor } from '../descriptors/types';

describe('renderDocumentHtml', () => {
  const baseCompany = {
    name: 'Acme Corp',
    address: '123 Main St',
    city: 'Springfield',
    postalCode: '12345',
    country: 'USA',
  };

  const baseInstance = {
    id: 'doc-1',
    status: 'draft',
    data: {},
    createdAt: new Date('2026-08-30'),
  };

  describe('core field kinds', () => {
    it('renders text fields', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'title', kind: 'text', label: 'Title' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { title: 'Hello World' } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Hello World');
      expect(html).toContain('Title');
    });

    it('renders longText fields with line breaks preserved', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'notes', kind: 'longText', label: 'Notes' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: { notes: 'Line 1\nLine 2\nLine 3' },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Line 1');
      expect(html).toContain('Line 2');
      expect(html).toContain('pre');
    });

    it('renders number fields', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'quantity', kind: 'number', label: 'Quantity' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { quantity: 42 } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('42');
    });

    it('renders money fields with correct decimal places', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'amount', kind: 'money', label: 'Amount', currency: 'EUR' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { amount: 100.5 } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('100.50');
      expect(html).toContain('EUR');
    });

    it('renders money fields respecting JPY (0 decimal places)', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'amount', kind: 'money', label: 'Amount', currency: 'JPY' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { amount: 1000 } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('1000');
      expect(html).not.toContain('1000.00');
    });

    it('renders date fields in YYYY-MM-DD format', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'issueDate', kind: 'date', label: 'Issue Date' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: { issueDate: '2026-08-30' },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('2026-08-30');
    });

    it('renders boolean fields as Yes/No', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [
          { key: 'isPaid', kind: 'boolean', label: 'Is Paid' },
          { key: 'isPending', kind: 'boolean', label: 'Is Pending' },
        ],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: { isPaid: true, isPending: false },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Yes');
      expect(html).toContain('No');
    });

    it('renders select fields showing option labels', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [
          {
            key: 'status',
            kind: 'select',
            label: 'Status',
            options: [
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
            ],
          },
        ],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { status: 'sent' } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Sent');
      expect(html).not.toContain('sent');
    });

    it('renders reference fields using resolved labels', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { client: 'client-123' } },
        company: baseCompany,
        referenceLabels: { client: 'Acme Industries' },
      });

      expect(html).toContain('Acme Industries');
      expect(html).not.toContain('client-123');
    });

    it('renders reference fields with raw id when label not resolved', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { client: 'client-123' } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('client-123');
    });

    it('renders array fields as a table', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [
          {
            key: 'lines',
            kind: 'array',
            label: 'Line Items',
            fields: [
              { key: 'description', kind: 'text', label: 'Description' },
              { key: 'quantity', kind: 'number', label: 'Qty' },
            ],
          },
        ],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: {
            lines: [
              { description: 'Widget', quantity: 5 },
              { description: 'Gadget', quantity: 3 },
            ],
          },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Widget');
      expect(html).toContain('Gadget');
      expect(html).toContain('5');
      expect(html).toContain('3');
      expect(html).toContain('<table');
    });

    it('renders rowSelection as a simple list', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'selectedRows', kind: 'rowSelection', label: 'Selected' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: { selectedRows: ['row-1', 'row-2', 'row-3'] },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('row-1');
      expect(html).toContain('row-2');
      expect(html).toContain('row-3');
      expect(html).toContain('<ul');
      expect(html).toContain('<li');
    });
  });

  describe('unknown field kinds', () => {
    it('produces a visible marker for unknown kinds', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'custom', kind: 'plugin:unknown.type', label: 'Custom' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { custom: 'some value' } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('[unrendered field kind');
      expect(html).toContain('plugin:unknown.type');
      expect(html).toContain('custom');
    });

    it('does NOT silently skip unknown kinds', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'custom', kind: 'unknown.kind', label: 'Custom' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { custom: 'some value' } },
        company: baseCompany,
        referenceLabels: {},
      });

      // The marker MUST be present — test fails if someone silently skips unknown kinds
      expect(html).toMatch(/\[unrendered field kind/);
    });
  });

  describe('missing and empty values', () => {
    it('renders missing field values as em-dash', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'optional', kind: 'text', label: 'Optional' }],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: {} },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('—');
    });

    it('renders empty array as em-dash', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [
          {
            key: 'lines',
            kind: 'array',
            label: 'Lines',
            fields: [{ key: 'desc', kind: 'text', label: 'Desc' }],
          },
        ],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { lines: [] } },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('—');
      expect(html).not.toContain('<table');
    });
  });

  describe('XSS prevention', () => {
    it('escapes HTML in text values', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'title', kind: 'text', label: 'Title' }],
        actions: [],
      };

      const malicious = '<script>alert(1)</script>';
      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { title: malicious } },
        company: baseCompany,
        referenceLabels: {},
      });

      // The literal script tag must NOT appear
      expect(html).not.toContain('<script>');
      // But the text should be escaped and visible
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML in company name', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [],
        actions: [],
      };

      const malicious = '<img src=x onerror="alert(1)">';
      const html = renderDocumentHtml({
        descriptor,
        instance: baseInstance,
        company: { ...baseCompany, name: malicious },
        referenceLabels: {},
      });

      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;img');
    });

    it('escapes HTML in reference labels', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
        actions: [],
      };

      const malicious = '"><svg onload="alert(1)">';
      const html = renderDocumentHtml({
        descriptor,
        instance: { ...baseInstance, data: { client: 'id' } },
        company: baseCompany,
        referenceLabels: { client: malicious },
      });

      expect(html).not.toContain('<svg');
      expect(html).toContain('&lt;svg');
    });
  });

  describe('currencyField resolution', () => {
    it('resolves money currency from a sibling field', () => {
      const descriptor: DocumentTypeDescriptor = {
        id: 'test',
        label: 'Test',
        fields: [
          { key: 'currency', kind: 'text', label: 'Currency' },
          {
            key: 'unitPrice',
            kind: 'money',
            label: 'Unit Price',
            currencyField: 'currency',
          },
        ],
        actions: [],
      };

      const html = renderDocumentHtml({
        descriptor,
        instance: {
          ...baseInstance,
          data: { currency: 'CHF', unitPrice: 99.99 },
        },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('99.99');
      expect(html).toContain('CHF');
    });
  });

  describe('document numbering (numbering/)', () => {
    const numberedDescriptor: DocumentTypeDescriptor = {
      id: 'invoice',
      label: 'Invoice',
      fields: [],
      actions: [],
      numbering: { onEnterStatus: 'sent' },
    };
    const unnumberedDescriptor: DocumentTypeDescriptor = {
      id: 'expense',
      label: 'Expense',
      fields: [],
      actions: [],
    };

    it('shows the displayNumber, next to the type label, for a NUMBERED type that already has one', () => {
      const html = renderDocumentHtml({
        descriptor: numberedDescriptor,
        instance: { ...baseInstance, displayNumber: 'INVOICE-2026-0001' },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('INVOICE-2026-0001');
    });

    // THE rule this whole mechanism exists to hold: a document with no number NEVER shows a
    // fabricated one — see numbering/format-number.ts's own header on the historical bug this
    // guards against.
    it('shows the honest placeholder, NEVER a fabricated number, for a NUMBERED type with none yet', () => {
      const html = renderDocumentHtml({
        descriptor: numberedDescriptor,
        instance: { ...baseInstance, displayNumber: null },
        company: baseCompany,
        referenceLabels: {},
      });

      expect(html).toContain('Draft — no number yet');
      expect(html).not.toMatch(/INVOICE-\d{4}-0000/);
    });

    it('shows no number badge at all for a type that never declares `numbering` (e.g. "expense")', () => {
      const html = renderDocumentHtml({
        descriptor: unnumberedDescriptor,
        instance: baseInstance,
        company: baseCompany,
        referenceLabels: {},
      });

      // The `.document-number` CSS RULE is always in the stylesheet (see renderDocumentHtml's own
      // <style> block) — what must be absent is the ELEMENT that would use it.
      expect(html).not.toContain('class="document-number"');
      expect(html).not.toContain('no number yet');
    });
  });
});
