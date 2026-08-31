import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentTotals } from '../totals/compute-totals';
import {
  buildEmailTemplateParts,
  GENERIC_FALLBACK_EMAIL_TEMPLATE,
  renderEmailTemplate,
  resolveEmailTemplate,
} from './email-template';

describe('renderEmailTemplate — pure interpolation', () => {
  it('interpolates every known {placeholder} in both subject and body', () => {
    const result = renderEmailTemplate(
      { subject: '{typeLabel} {displayNumber}', body: 'Dear {recipientName}, total {totalGross}.' },
      {
        typeLabel: 'Invoice',
        displayNumber: 'INV-2026-0001',
        recipientName: 'Acme',
        totalGross: '120.00 EUR',
      },
    );

    expect(result.subject).toBe('Invoice INV-2026-0001');
    expect(result.body).toBe('Dear Acme, total 120.00 EUR.');
    expect(result.warnings).toEqual([]);
  });

  it('substitutes a KNOWN placeholder even when its value is the empty string — never treated as unknown', () => {
    const result = renderEmailTemplate(
      { subject: '{typeLabel} {displayNumber}', body: 'x' },
      { typeLabel: 'Quote', displayNumber: '' },
    );

    expect(result.subject).toBe('Quote ');
    expect(result.warnings).toEqual([]);
  });

  it('leaves an UNKNOWN placeholder exactly as written, and reports it as a warning — never throws', () => {
    const result = renderEmailTemplate(
      { subject: '{typeLabel} {totallyMadeUp}', body: 'Body with {alsoUnknown} inside.' },
      { typeLabel: 'Invoice' },
    );

    expect(result.subject).toBe('Invoice {totallyMadeUp}');
    expect(result.body).toBe('Body with {alsoUnknown} inside.');
    expect(result.warnings).toEqual([
      'Unknown email template placeholder "{totallyMadeUp}" left as-is.',
      'Unknown email template placeholder "{alsoUnknown}" left as-is.',
    ]);
  });

  it('reports each DISTINCT unknown placeholder only ONCE, even if it repeats several times', () => {
    const result = renderEmailTemplate({ subject: '{oops} and {oops} again', body: '{oops} once more' }, {});

    expect(result.subject).toBe('{oops} and {oops} again');
    expect(result.body).toBe('{oops} once more');
    expect(result.warnings).toEqual(['Unknown email template placeholder "{oops}" left as-is.']);
  });

  it('is a pure function — the same input always produces the same output, no hidden state', () => {
    const template = { subject: '{a}', body: '{b}' };
    const parts = { a: '1', b: '2' };

    expect(renderEmailTemplate(template, parts)).toEqual(renderEmailTemplate(template, parts));
  });
});

describe('resolveEmailTemplate — company override > descriptor default > generic fallback', () => {
  const descriptor: DocumentTypeDescriptor = {
    id: 'quote',
    label: 'Quote',
    fields: [],
    actions: [],
    email: { subject: 'Descriptor subject', body: 'Descriptor body' },
  };

  it("uses the company's OWN override when one is set for this type — it takes priority over the descriptor default", () => {
    const resolved = resolveEmailTemplate(descriptor, {
      quote: { subject: 'Company override subject', body: 'Company override body' },
    });

    expect(resolved).toEqual({ subject: 'Company override subject', body: 'Company override body' });
  });

  it("falls back to the descriptor's own default when the company has no override for this type", () => {
    expect(resolveEmailTemplate(descriptor, {})).toEqual(descriptor.email);
    expect(resolveEmailTemplate(descriptor, null)).toEqual(descriptor.email);
    expect(resolveEmailTemplate(descriptor, undefined)).toEqual(descriptor.email);
    // An override for a DIFFERENT type never leaks onto this one.
    expect(resolveEmailTemplate(descriptor, { invoice: { subject: 'x', body: 'y' } })).toEqual(
      descriptor.email,
    );
  });

  it('falls back to the GENERIC fallback, visibly, when the type declares no email template of its own', () => {
    const noEmailDescriptor: DocumentTypeDescriptor = {
      id: 'plugin-type',
      label: 'Plugin',
      fields: [],
      actions: [],
    };

    expect(resolveEmailTemplate(noEmailDescriptor, {})).toBe(GENERIC_FALLBACK_EMAIL_TEMPLATE);
  });
});

describe('buildEmailTemplateParts', () => {
  const zeroTotals: DocumentTotals = {
    currency: 'EUR',
    lines: [],
    netMinor: 10000,
    vatMinor: 2000,
    grossMinor: 12000,
    vatBreakdown: [],
    warnings: [],
  };

  const quoteDescriptor: DocumentTypeDescriptor = {
    id: 'quote',
    label: 'Quote',
    fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
    actions: [],
  };

  it('always includes displayNumber/typeLabel/companyName/totalGross, formatted from compute-totals', () => {
    const parts = buildEmailTemplateParts({
      descriptor: quoteDescriptor,
      displayNumber: 'QUOTE-2026-0001',
      companyName: 'Acme Corp',
      totals: zeroTotals,
      referenceLabels: {},
    });

    expect(parts).toEqual(
      expect.objectContaining({
        displayNumber: 'QUOTE-2026-0001',
        typeLabel: 'Quote',
        companyName: 'Acme Corp',
        totalGross: '120.00 EUR',
      }),
    );
  });

  it('uses an empty string for displayNumber when the document has none yet — never "unknown"', () => {
    const parts = buildEmailTemplateParts({
      descriptor: quoteDescriptor,
      displayNumber: null,
      companyName: 'Acme Corp',
      totals: zeroTotals,
      referenceLabels: {},
    });

    expect(parts.displayNumber).toBe('');
  });

  it("resolves recipientName from the field targeting the 'client' entity, when its label resolved", () => {
    const parts = buildEmailTemplateParts({
      descriptor: quoteDescriptor,
      displayNumber: null,
      companyName: 'Acme Corp',
      totals: zeroTotals,
      referenceLabels: { client: 'Jane Doe' },
    });

    expect(parts.recipientName).toBe('Jane Doe');
  });

  it('omits recipientName entirely when the type has no field targeting "client" — a template using it degrades via renderEmailTemplate, not silently here', () => {
    const noClientDescriptor: DocumentTypeDescriptor = {
      id: 'credit-note',
      label: 'Credit note',
      fields: [{ key: 'invoice', kind: 'reference', label: 'Invoice', entity: 'invoice' }],
      actions: [],
    };

    const parts = buildEmailTemplateParts({
      descriptor: noClientDescriptor,
      displayNumber: null,
      companyName: 'Acme Corp',
      totals: zeroTotals,
      referenceLabels: { invoice: 'INV-1' },
    });

    expect(parts).not.toHaveProperty('recipientName');
  });

  it('formats totalGross with the currency-specific decimal count (e.g. JPY has none)', () => {
    const jpyTotals: DocumentTotals = { ...zeroTotals, currency: 'JPY', grossMinor: 1200 };
    const parts = buildEmailTemplateParts({
      descriptor: quoteDescriptor,
      displayNumber: null,
      companyName: 'Acme Corp',
      totals: jpyTotals,
      referenceLabels: {},
    });

    expect(parts.totalGross).toBe('1200 JPY');
  });
});
