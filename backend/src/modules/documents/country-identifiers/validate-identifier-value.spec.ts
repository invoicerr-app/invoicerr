/**
 * The REAL decision code — only the Prisma CLIENT is mocked, same discipline as
 * `country-identifiers.spec.ts`'s own header: this is where "refuses a mismatch, exempts VAT,
 * grandfathers an unchanged legacy value, and never enforces an undeclared pattern" is proven
 * against the real branching logic.
 */
import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { assertIdentifierValueMatchesPattern } from './validate-identifier-value';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    countryIdentifierRequirement: { findUnique: jest.fn() },
  },
}));

const findRequirement = prisma.countryIdentifierRequirement.findUnique as jest.Mock;

const IT_SDI_FACT = {
  pattern: '^[A-Za-z0-9]{7}$',
  label: 'Codice Destinatario (SdI)',
  helpText: '7-character code the Sistema di Interscambio assigns on request to a non-PA recipient.',
};

describe('assertIdentifierValueMatchesPattern', () => {
  beforeEach(() => jest.clearAllMocks());

  // The measured defect, reproduced directly against the real branching logic: a 3-character
  // IT_SDI value, which `fatturapa-provider.ts`'s own `/^[A-Za-z0-9]{7}$/` would also reject, must
  // now be refused HERE — at write time — rather than stored and left to fail silently downstream.
  it("refuses a 3-character IT_SDI against Italy's 7-character pattern, naming the scheme, the shape in words, and the value received", async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'IT_SDI', value: 'ABC' }),
    ).rejects.toThrow(BadRequestException);

    try {
      await assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'IT_SDI', value: 'ABC' });
      throw new Error('expected a rejection');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('IT_SDI'); // the scheme
      expect(message).toContain(IT_SDI_FACT.helpText); // the shape, in words — never the raw regex
      expect(message).not.toContain('[A-Za-z0-9]'); // the raw regex must never reach the user
      expect(message).toContain('"ABC"'); // the value actually received
    }
  });

  it('accepts a 7-character value that matches the declared pattern', async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'IT_SDI', value: 'ABCDEFG' }),
    ).resolves.toBeUndefined();
  });

  it('DECISION 3 — no declared pattern at all means anything goes, never a refusal', async () => {
    findRequirement.mockResolvedValue({ pattern: null, label: 'Partita IVA', helpText: null });

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'VAT', value: 'anything' }),
    ).resolves.toBeUndefined();
    // VAT is exempt anyway (see the next describe block) — this also covers a genuinely
    // pattern-less non-VAT scheme, since the mock never distinguishes by scheme.
  });

  it('a country with no row at all for this scheme means no requirement to enforce', async () => {
    findRequirement.mockResolvedValue(null);

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'ZZ', scheme: 'LEGAL_ID', value: 'whatever' }),
    ).resolves.toBeUndefined();
    expect(findRequirement).toHaveBeenCalledWith({
      where: { countryCode_scheme: { countryCode: 'ZZ', scheme: 'LEGAL_ID' } },
      select: { pattern: true, label: true, helpText: true },
    });
  });

  it('DECISION 2 — a value UNCHANGED from what is already on file is never re-validated, even if it fails the pattern', async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({
        countryCode: 'IT',
        scheme: 'IT_SDI',
        value: 'ABC', // already on file, already bad — grandfathered
        previousValue: 'ABC',
      }),
    ).resolves.toBeUndefined();
    expect(findRequirement).not.toHaveBeenCalled(); // never even asked — nothing changed to check
  });

  it('a CHANGED value is re-validated even though something was already on file', async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({
        countryCode: 'IT',
        scheme: 'IT_SDI',
        value: 'XYZ', // still bad, but DIFFERENT from what was on file
        previousValue: 'ABC',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('a brand-new identifier (no previousValue at all) is validated', async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'IT_SDI', value: 'BAD' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('an empty value is never refused here — presence is `required`s concern, not this one', async () => {
    findRequirement.mockResolvedValue(IT_SDI_FACT);

    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: 'IT', scheme: 'IT_SDI', value: '   ' }),
    ).resolves.toBeUndefined();
    expect(findRequirement).not.toHaveBeenCalled();
  });

  it('no country code at all means nothing to resolve a requirement against — never a refusal', async () => {
    await expect(
      assertIdentifierValueMatchesPattern({ countryCode: undefined, scheme: 'IT_SDI', value: 'ABC' }),
    ).resolves.toBeUndefined();
    expect(findRequirement).not.toHaveBeenCalled();
  });

  describe('VAT is exempt — tax/vat-syntax.ts owns VAT syntax exclusively', () => {
    it('never even asks the catalog for scheme "VAT", regardless of what pattern DE declares', async () => {
      // DE VAT declares `^DE\d{9}$` in the real catalog — a value that fails even that weaker
      // regex must still never be refused HERE; `clients.service.ts`'s own `validateVat` call is
      // the one and only gate for this scheme, with its own "warn, don't refuse" failure mode.
      await expect(
        assertIdentifierValueMatchesPattern({ countryCode: 'DE', scheme: 'VAT', value: 'not-a-vat-number' }),
      ).resolves.toBeUndefined();
      expect(findRequirement).not.toHaveBeenCalled();
    });
  });
});
