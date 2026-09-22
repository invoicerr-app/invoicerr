import { BadRequestException } from '@nestjs/common';

import { parseAcceptLegalSlugs } from './legal.dto';

describe('parseAcceptLegalSlugs', () => {
  it('returns undefined for a missing body or a missing slugs field', () => {
    expect(parseAcceptLegalSlugs(undefined)).toBeUndefined();
    expect(parseAcceptLegalSlugs({})).toBeUndefined();
  });

  it('passes an array of strings through unchanged', () => {
    expect(parseAcceptLegalSlugs({ slugs: ['terms-of-service', 'privacy-policy'] })).toEqual([
      'terms-of-service',
      'privacy-policy',
    ]);
  });

  it('passes an empty array through unchanged', () => {
    expect(parseAcceptLegalSlugs({ slugs: [] })).toEqual([]);
  });

  it("rejects a bare string with a named 400 instead of letting it reach the service's own .filter and 500", () => {
    expect(() => parseAcceptLegalSlugs({ slugs: 'terms-of-service' } as never)).toThrow(BadRequestException);
  });

  it('rejects an array containing a non-string entry', () => {
    expect(() => parseAcceptLegalSlugs({ slugs: ['terms-of-service', 42] } as never)).toThrow(
      BadRequestException,
    );
  });

  it('rejects a non-array, non-string slugs value (e.g. an object)', () => {
    expect(() => parseAcceptLegalSlugs({ slugs: { not: 'an array' } } as never)).toThrow(BadRequestException);
  });
});
