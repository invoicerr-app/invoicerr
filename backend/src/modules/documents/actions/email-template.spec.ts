import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildExpenseDescriptor } from '../descriptors/expense.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentTotals } from '../totals/compute-totals';
import {
  buildEmailTemplateParts,
  buildOtpEmailParts,
  buildSignatureRequestEmailParts,
  deriveTextFromHtml,
  describeDocumentEmailVocabulary,
  describeSendablePlaceholders,
  GENERIC_FALLBACK_EMAIL_TEMPLATE,
  renderEmailTemplate,
  resolveEmailTemplate,
  resolveEmailTemplateSource,
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

describe('renderEmailTemplate — the html part', () => {
  it('interpolates the html part alongside the text one, and reports no html when there is none', () => {
    const textOnly = renderEmailTemplate(
      { subject: 's', body: 'Hello {companyName}' },
      { companyName: 'Acme' },
    );
    expect(textOnly.body).toBe('Hello Acme');
    expect(textOnly).not.toHaveProperty('html');

    const both = renderEmailTemplate(
      { subject: 's', body: 'Hello {companyName}', html: '<p>Hello {companyName}</p>' },
      { companyName: 'Acme' },
    );
    expect(both.body).toBe('Hello Acme');
    expect(both.html).toBe('<p>Hello Acme</p>');
  });

  it('ESCAPES an interpolated value into the html part, while the text part keeps it raw', () => {
    const rendered = renderEmailTemplate(
      { subject: '{companyName}', body: 'Text: {companyName}', html: '<p>Rich: {companyName}</p>' },
      { companyName: '<script>alert(1)</script> & "Co"' },
    );

    // The template is filtered at write time; the VALUES substituted into it are a separate problem,
    // solved here — a company name carrying markup must read as text, never execute.
    expect(rendered.html).toBe('<p>Rich: &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;</p>');
    expect(rendered.html).not.toContain('<script>');
    // Text parts are not HTML and must not be mangled into entities.
    expect(rendered.body).toBe('Text: <script>alert(1)</script> & "Co"');
    expect(rendered.subject).toBe('<script>alert(1)</script> & "Co"');
  });

  it('DERIVES the text part from the html when the template carries no text body of its own', () => {
    const rendered = renderEmailTemplate(
      { subject: 'Code', body: '', html: '<p>Hello,</p><p>Your code: {otpCode}</p>' },
      { otpCode: '1234-5678' },
    );

    // Derived from the ALREADY-INTERPOLATED html, so the text part carries the real value too.
    expect(rendered.body).toBe('Hello,\nYour code: 1234-5678');
    expect(rendered.html).toBe('<p>Hello,</p><p>Your code: 1234-5678</p>');
  });

  it('reports an unknown placeholder found ONLY in the html part, once, without throwing', () => {
    const rendered = renderEmailTemplate({ subject: 's', body: 'b', html: '<p>{nope} {nope}</p>' }, {});

    expect(rendered.html).toBe('<p>{nope} {nope}</p>');
    expect(rendered.warnings).toEqual(['Unknown email template placeholder "{nope}" left as-is.']);
  });

  it('reports a placeholder unknown in BOTH parts only once — deduped across parts, not per part', () => {
    const rendered = renderEmailTemplate({ subject: '{nope}', body: '{nope}', html: '<p>{nope}</p>' }, {});

    expect(rendered.warnings).toEqual(['Unknown email template placeholder "{nope}" left as-is.']);
  });
});

describe('deriveTextFromHtml', () => {
  it('turns block ends and <br> into newlines, and list items into dashes — one line per bullet', () => {
    expect(deriveTextFromHtml('<h2>Title</h2><p>One<br>Two</p><ul><li>a</li><li>b</li></ul>')).toBe(
      'Title\nOne\nTwo\n\n- a\n- b',
    );
  });

  it('decodes the entities an email body realistically carries — &amp; last, so &amp;lt; stays text', () => {
    expect(deriveTextFromHtml('<p>A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;&nbsp;x</p>')).toBe(
      'A & B <tag> "q" \'s\' x',
    );
    expect(deriveTextFromHtml('<p>&amp;lt;notatag&amp;gt;</p>')).toBe('&lt;notatag&gt;');
  });

  it("collapses runaway blank lines rather than emitting the markup's own whitespace", () => {
    expect(deriveTextFromHtml('<div><p>a</p></div>\n\n\n<div><p>b</p></div>')).toBe('a\n\nb');
  });

  it('keeps the link target readable — a text reader still needs the URL', () => {
    expect(deriveTextFromHtml('<p>Open https://app.test/signature/abc to sign</p>')).toBe(
      'Open https://app.test/signature/abc to sign',
    );
  });

  // The URL of an <a> lives in an ATTRIBUTE: a plain tag-strip would leave the word "here" and no link
  // at all, which for a signature request is an email the text-only reader cannot act on.
  it("carries an <a href>'s URL into the text, not just its label", () => {
    expect(deriveTextFromHtml('<p>Open <a href="https://app.test/signature/abc">here</a> to sign</p>')).toBe(
      'Open here (https://app.test/signature/abc) to sign',
    );
  });

  it('emits the URL once when the label already IS the URL', () => {
    expect(deriveTextFromHtml('<p><a href="https://app.test/x">https://app.test/x</a></p>')).toBe(
      'https://app.test/x',
    );
  });

  it('keeps a still-uninterpolated placeholder href visible rather than dropping the link', () => {
    expect(deriveTextFromHtml('<p><a href="{signatureUrl}">Sign</a></p>')).toBe('Sign ({signatureUrl})');
  });
});

describe('describeDocumentEmailVocabulary — derived per type, never a fixed list', () => {
  const lineField = {
    key: 'lines',
    kind: 'array',
    label: 'Lines',
    fields: [
      { key: 'quantity', kind: 'number', label: 'Qty' },
      { key: 'unitPrice', kind: 'money', label: 'Unit price' },
    ],
  };

  it('offers totalGross ONLY for a type that has a real source of money', () => {
    const withMoney: DocumentTypeDescriptor = {
      id: 'invoice',
      label: 'Invoice',
      fields: [lineField],
      actions: [],
    };
    const withoutMoney: DocumentTypeDescriptor = {
      id: 'note',
      label: 'Note',
      fields: [{ key: 'text', kind: 'text', label: 'Text' }],
      actions: [],
    };

    expect(describeDocumentEmailVocabulary({ descriptor: withMoney, companyName: 'Acme' })).toHaveProperty(
      'totalGross',
    );
    // Not merely "zero for this instance": such a type totals zero by construction, so advertising the
    // placeholder would advertise a permanent "0.00".
    expect(
      describeDocumentEmailVocabulary({ descriptor: withoutMoney, companyName: 'Acme' }),
    ).not.toHaveProperty('totalGross');
  });

  it('offers recipientName ONLY for a type with a reference field targeting the client entity', () => {
    const withClient: DocumentTypeDescriptor = {
      id: 'quote',
      label: 'Quote',
      fields: [{ key: 'client', kind: 'reference', label: 'Client', entity: 'client' }],
      actions: [],
    };
    const withOtherReference: DocumentTypeDescriptor = {
      id: 'credit-note',
      label: 'Credit note',
      fields: [{ key: 'invoice', kind: 'reference', label: 'Invoice', entity: 'invoice' }],
      actions: [],
    };

    expect(describeDocumentEmailVocabulary({ descriptor: withClient, companyName: 'Acme' })).toHaveProperty(
      'recipientName',
    );
    expect(
      describeDocumentEmailVocabulary({ descriptor: withOtherReference, companyName: 'Acme' }),
    ).not.toHaveProperty('recipientName');
  });

  it('always offers displayNumber/typeLabel/companyName, with the REAL company name as the sample', () => {
    const vocabulary = describeDocumentEmailVocabulary({
      descriptor: { id: 'note', label: 'Note', fields: [], actions: [] },
      companyName: 'Acme Corp',
    });

    expect(Object.keys(vocabulary).sort()).toEqual(['companyName', 'displayNumber', 'typeLabel']);
    expect(vocabulary.companyName).toBe('Acme Corp');
    expect(vocabulary.typeLabel).toBe('Note');
  });

  // The SHIPPED types, through their real descriptors — the rules above, applied to what actually ships.
  it('derives the right vocabulary for each shipped type', () => {
    const keysFor = (descriptor: DocumentTypeDescriptor) =>
      Object.keys(describeDocumentEmailVocabulary({ descriptor, companyName: 'Acme' })).sort();

    // A quote and an invoice have both a client reference and money lines.
    expect(keysFor(buildQuoteDescriptor())).toEqual([
      'companyName',
      'displayNumber',
      'recipientName',
      'totalGross',
      'typeLabel',
    ]);
    expect(keysFor(buildInvoiceDescriptor())).toContain('totalGross');
    // A credit note points at an invoice, not a client, and has no money lines of its own
    // ('correctedLines' is a row selection). An expense has neither.
    expect(keysFor(buildCreditNoteDescriptor())).toEqual(['companyName', 'displayNumber', 'typeLabel']);
    expect(keysFor(buildExpenseDescriptor())).toEqual(['companyName', 'displayNumber', 'typeLabel']);
  });
});

describe('describeSendablePlaceholders — what VALIDATION checks against', () => {
  it('always includes totalGross, even where the vocabulary does not offer it', () => {
    const descriptor = buildCreditNoteDescriptor();

    expect(describeDocumentEmailVocabulary({ descriptor, companyName: 'Acme' })).not.toHaveProperty(
      'totalGross',
    );
    // The send substitutes it regardless, so validating against this set is what keeps the warning
    // honest: "the send would leave this as written", never "the editor does not offer this".
    expect(describeSendablePlaceholders({ descriptor, companyName: 'Acme' })).toHaveProperty('totalGross');
  });

  it('agrees with buildEmailTemplateParts on which KEYS exist, for every shipped type', () => {
    const totals: DocumentTotals = {
      currency: 'EUR',
      lines: [],
      netMinor: 0,
      vatMinor: 0,
      grossMinor: 0,
      vatBreakdown: [],
      warnings: [],
    };

    for (const descriptor of [
      buildQuoteDescriptor(),
      buildInvoiceDescriptor(),
      buildCreditNoteDescriptor(),
      buildExpenseDescriptor(),
    ]) {
      const clientField = descriptor.fields.find((f) => f.kind === 'reference' && f.entity === 'client');
      const sendParts = buildEmailTemplateParts({
        descriptor,
        displayNumber: 'X-1',
        companyName: 'Acme',
        totals,
        // A resolved label for whatever client-ish field the type has, so the optional key is present
        // whenever the type can have it at all.
        referenceLabels: clientField ? { [clientField.key]: 'Jane' } : {},
      });

      expect(Object.keys(describeSendablePlaceholders({ descriptor, companyName: 'Acme' })).sort()).toEqual(
        Object.keys(sendParts).sort(),
      );
    }
  });

  // The direct guard on the wart this split exists for: every SHIPPED default must save clean.
  it.each([
    ['quote', buildQuoteDescriptor()],
    ['invoice', buildInvoiceDescriptor()],
    ['credit-note', buildCreditNoteDescriptor()],
    ['expense', buildExpenseDescriptor()],
  ] as const)("%s's own shipped default template validates with no warnings", (_name, descriptor) => {
    const { warnings } = renderEmailTemplate(
      resolveEmailTemplate(descriptor, {}),
      describeSendablePlaceholders({ descriptor, companyName: 'Acme' }),
    );

    expect(warnings).toEqual([]);
  });
});

describe('resolveEmailTemplateSource', () => {
  const descriptor: DocumentTypeDescriptor = {
    id: 'quote',
    label: 'Quote',
    fields: [],
    actions: [],
    email: { subject: 's', body: 'b' },
  };

  it('names which of the three resolution steps won, so a screen never has to compare strings', () => {
    expect(resolveEmailTemplateSource(descriptor, { quote: { subject: 'x', body: 'y' } })).toBe('company');
    expect(resolveEmailTemplateSource(descriptor, {})).toBe('descriptor');
    expect(resolveEmailTemplateSource({ ...descriptor, email: undefined }, {})).toBe('generic');
  });

  it('agrees with resolveEmailTemplate on every one of those three cases', () => {
    const overrides = { quote: { subject: 'x', body: 'y' } };
    expect(resolveEmailTemplate(descriptor, overrides)).toBe(overrides.quote);
    expect(resolveEmailTemplate(descriptor, {})).toBe(descriptor.email);
    expect(resolveEmailTemplate({ ...descriptor, email: undefined }, {})).toBe(
      GENERIC_FALLBACK_EMAIL_TEMPLATE,
    );
  });
});

describe("the system families' vocabularies — built by a function, never a duplicated list", () => {
  it('builds the signature-request parts the sender substitutes', () => {
    expect(
      buildSignatureRequestEmailParts({
        appUrl: 'https://app.test',
        signatureUrl: 'https://app.test/signature/abc',
        signatureId: 'sig-1',
        signatureNumber: 'QUOTE-2026-0001',
      }),
    ).toEqual({
      appUrl: 'https://app.test',
      signatureUrl: 'https://app.test/signature/abc',
      signatureId: 'sig-1',
      signatureNumber: 'QUOTE-2026-0001',
    });
  });

  it('builds the verification-code parts, carrying the DISPLAY form of the code only', () => {
    expect(buildOtpEmailParts({ appUrl: 'https://app.test', otpCode: '1234-5678' })).toEqual({
      appUrl: 'https://app.test',
      otpCode: '1234-5678',
    });
  });
});
