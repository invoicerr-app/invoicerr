import { sanitizeEmailHtml } from './sanitize-email-html';

/**
 * The write-path filter, proven on the two things that actually matter: a hostile payload cannot
 * survive a round trip through it, and a LEGITIMATE template — including the `{placeholder}` tokens
 * the interpolation engine fills in later — is not mangled by it. See `sanitizeEmailHtml`'s own header
 * for why this runs at write time rather than at send time.
 */
describe('sanitizeEmailHtml', () => {
  it('strips script tags AND their content — never leaves the code as visible text', () => {
    const result = sanitizeEmailHtml('<p>Hello</p><script>alert(1)</script>');

    expect(result).toBe('<p>Hello</p>');
    expect(result).not.toContain('alert');
  });

  it('drops every event-handler attribute, without needing to name them', () => {
    const result = sanitizeEmailHtml(
      '<img src="https://x.test/a.png" onerror="alert(1)"><p onclick="x()">Hi</p>',
    );

    expect(result).not.toContain('onerror');
    expect(result).not.toContain('onclick');
    expect(result).toContain('src="https://x.test/a.png"');
    expect(result).toContain('Hi');
  });

  it('refuses a javascript: or data: URL while keeping an http(s)/mailto one', () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
    expect(sanitizeEmailHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')).not.toContain('data:');
    expect(sanitizeEmailHtml('<a href="https://ok.test/p">x</a>')).toContain('href="https://ok.test/p"');
    expect(sanitizeEmailHtml('<a href="mailto:a@b.test">x</a>')).toContain('mailto:a@b.test');
  });

  it('removes iframe/object/form entirely — an email body never carries one legitimately', () => {
    const result = sanitizeEmailHtml(
      '<iframe src="https://evil.test"></iframe><object data="x"></object><form action="/steal"><input name="card"></form>',
    );

    expect(result).not.toMatch(/iframe|object|form|input/);
  });

  it('keeps the prose of a disallowed WRAPPER tag rather than deleting the text with it', () => {
    expect(sanitizeEmailHtml('<marquee>Still readable</marquee>')).toContain('Still readable');
  });

  it('leaves {placeholder} tokens intact — in text and inside an href, so sanitizing can precede interpolation', () => {
    const result = sanitizeEmailHtml(
      '<p>Dear {recipientName}, total {totalGross}.</p><a href="{signatureUrl}">Sign</a>',
    );

    expect(result).toContain('Dear {recipientName}, total {totalGross}.');
    expect(result).toContain('href="{signatureUrl}"');
  });

  it('keeps inline style attributes — the only styling an email client reliably honors', () => {
    const result = sanitizeEmailHtml('<div style="background: #f8f9fa; padding: 15px;">x</div>');

    expect(result).toContain('style=');
    expect(result).toContain('#f8f9fa');
  });

  it('keeps the structural tags a real template is built from', () => {
    const result = sanitizeEmailHtml(
      '<h2>T</h2><p>p</p><strong>b</strong><ul><li>i</li></ul><table><tr><td>c</td></tr></table><hr><br>',
    );

    for (const fragment of ['<h2>', '<p>', '<strong>', '<ul>', '<li>', '<table>', '<td>', '<hr', '<br']) {
      expect(result).toContain(fragment);
    }
  });
});
