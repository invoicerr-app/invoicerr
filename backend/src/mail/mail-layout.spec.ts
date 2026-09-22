import { wrapMailLayout } from './mail-layout';

describe('wrapMailLayout', () => {
  it('renders the title, body, signature and no CTA/footer when none is given', () => {
    const html = wrapMailLayout({ title: 'Hello', bodyHtml: '<p>Some prose.</p>' });

    expect(html).toBe('<h2>Hello</h2><p>Some prose.</p><p>Best regards,<br>The Invoicerr Team</p>');
  });

  it('renders the CTA button only when both ctaLabel and ctaUrl are given', () => {
    const withNeither = wrapMailLayout({ title: 'T', bodyHtml: '<p>B</p>' });
    const withUrlOnly = wrapMailLayout({ title: 'T', bodyHtml: '<p>B</p>', ctaUrl: 'https://x.test' });
    const withLabelOnly = wrapMailLayout({ title: 'T', bodyHtml: '<p>B</p>', ctaLabel: 'Go' });
    for (const html of [withNeither, withUrlOnly, withLabelOnly]) {
      expect(html).not.toContain('<a href=');
    }

    const withBoth = wrapMailLayout({
      title: 'T',
      bodyHtml: '<p>B</p>',
      ctaLabel: 'Sign document',
      ctaUrl: 'https://invoicerr.test/signature/abc',
    });
    expect(withBoth).toContain('<a href="https://invoicerr.test/signature/abc"');
    expect(withBoth).toContain('>Sign document</a>');
  });

  it('renders the footer under an <hr> only when given', () => {
    const withoutFooter = wrapMailLayout({ title: 'T', bodyHtml: '<p>B</p>' });
    expect(withoutFooter).not.toContain('<hr>');

    const withFooter = wrapMailLayout({
      title: 'T',
      bodyHtml: '<p>B</p>',
      footer: 'Sent from https://x.test',
    });
    expect(withFooter).toContain('<hr><p style="font-size: 12px; color: #666;">Sent from https://x.test</p>');
  });

  it('HTML-escapes title, ctaLabel, ctaUrl and footer, but leaves bodyHtml untouched', () => {
    const PAYLOAD = '<img src=x onerror=alert(1)>Acme "Corp" & Sons';
    const ESCAPED = '&lt;img src=x onerror=alert(1)&gt;Acme &quot;Corp&quot; &amp; Sons';

    const html = wrapMailLayout({
      title: PAYLOAD,
      // The caller's own markup is trusted verbatim — this is exactly what every template in
      // system-email-templates.ts already relies on for its surrounding <p>/<div> structure.
      bodyHtml: `<p>${PAYLOAD}</p>`,
      ctaLabel: PAYLOAD,
      ctaUrl: PAYLOAD,
      footer: PAYLOAD,
    });

    expect(html).toContain(`<h2>${ESCAPED}</h2>`);
    expect(html).toContain(`<p>${PAYLOAD}</p>`);
    expect(html).toContain(`href="${ESCAPED}"`);
    expect(html).toContain(`>${ESCAPED}</a>`);
    expect(html).toContain(`<p style="font-size: 12px; color: #666;">${ESCAPED}</p>`);
    // The raw payload appears exactly once — inside the trusted bodyHtml — never in the four escaped spots.
    expect(html.split(PAYLOAD).length - 1).toBe(1);
  });
});
