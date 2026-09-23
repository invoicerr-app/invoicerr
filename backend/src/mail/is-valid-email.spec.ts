import { isValidEmailAddress } from './is-valid-email';

describe('isValidEmailAddress', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmailAddress('replies@example.com')).toBe(true);
  });

  it('accepts an address with a subdomain and a plus tag', () => {
    expect(isValidEmailAddress('billing+invoices@mail.example.co.uk')).toBe(true);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmailAddress('  replies@example.com  ')).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['missing @', 'replies-example.com'],
    ['missing domain', 'replies@'],
    ['missing local part', '@example.com'],
    ['no dot in the domain', 'replies@example'],
    ['a space inside', 'replies @example.com'],
    ['two @', 'a@b@example.com'],
  ])('rejects %s ("%s")', (_label, value) => {
    expect(isValidEmailAddress(value)).toBe(false);
  });
});
