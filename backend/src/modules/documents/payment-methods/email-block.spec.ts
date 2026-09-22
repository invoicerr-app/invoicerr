import { appendPaymentMethodsToEmail } from './email-block';
import { PaymentMethodPresentation } from './types';

describe('appendPaymentMethodsToEmail', () => {
  it('returns body/html UNCHANGED when there are no presentations — no method enabled, or a type that never opts in', () => {
    const result = appendPaymentMethodsToEmail('Dear client,\n\nThanks.', '<p>Dear client,</p>', [], 'en');
    expect(result).toEqual({ body: 'Dear client,\n\nThanks.', html: '<p>Dear client,</p>' });
  });

  it('appends a text block, localized heading, one method per paragraph, its lines, then its link', () => {
    const presentations: PaymentMethodPresentation[] = [
      { id: 'bank_transfer', label: 'Bank transfer', lines: ['IBAN: FR1420041010050500013M02606'] },
      {
        id: 'paypal',
        label: 'PayPal',
        lines: ['PayPal e-mail: billing@acme.test'],
        link: 'https://www.paypal.com/cgi-bin/webscr?cmd=_xclick',
      },
    ];

    const result = appendPaymentMethodsToEmail('Dear client,\n\nThanks.', undefined, presentations, 'fr');

    expect(result.body).toBe(
      'Dear client,\n\nThanks.\n\n' +
        'Moyens de paiement\n\n' +
        'Bank transfer\nIBAN: FR1420041010050500013M02606\n\n' +
        'PayPal\nPayPal e-mail: billing@acme.test\nhttps://www.paypal.com/cgi-bin/webscr?cmd=_xclick',
    );
    // No pre-existing html part — this feature never invents one (every shipped default template is
    // text-only, see descriptors/*.descriptor.ts's own `email`).
    expect(result.html).toBeUndefined();
  });

  it('appends onto an EXISTING html part, HTML-escaping every user-supplied value', () => {
    const presentations: PaymentMethodPresentation[] = [
      { id: 'cheque', label: 'Cheque', lines: ['Payee: <script>alert(1)</script>'] },
    ];

    const result = appendPaymentMethodsToEmail('body', '<p>hello</p>', presentations, 'en');

    expect(result.html).toBe(
      '<p>hello</p>' +
        '<p><strong>Payment methods</strong></p>' +
        '<p><strong>Cheque</strong><br>Payee: &lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('renders a link as an anchor in html, escaped', () => {
    const presentations: PaymentMethodPresentation[] = [
      { id: 'paypal', label: 'PayPal', lines: [], link: 'https://www.paypal.com/cgi-bin/webscr?a=1&b=2' },
    ];
    const result = appendPaymentMethodsToEmail('body', '<p>hello</p>', presentations, 'en');
    expect(result.html).toContain(
      '<a href="https://www.paypal.com/cgi-bin/webscr?a=1&amp;b=2">' +
        'https://www.paypal.com/cgi-bin/webscr?a=1&amp;b=2</a>',
    );
  });

  it('a method with no lines and no link still gets its own heading paragraph (cash)', () => {
    const presentations: PaymentMethodPresentation[] = [{ id: 'cash', label: 'Cash', lines: [] }];
    const result = appendPaymentMethodsToEmail('body', undefined, presentations, 'en');
    expect(result.body).toBe('body\n\nPayment methods\n\nCash');
  });
});
