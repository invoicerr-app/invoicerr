import { Test, TestingModule } from '@nestjs/testing';
import { RequiredFieldsController } from './required-fields.controller';
import { defaultRegistry } from '../profiles/registry';
import { VatRatesService } from '../tax-rates/vat-rates.service';

describe('RequiredFieldsController', () => {
  let controller: RequiredFieldsController;
  let ratesFor: jest.Mock;

  beforeEach(async () => {
    ratesFor = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequiredFieldsController],
      providers: [{ provide: VatRatesService, useValue: { ratesFor } }],
    }).compile();

    controller = module.get<RequiredFieldsController>(RequiredFieldsController);
  });

  it('returns VAT-only for a generic archetype-based country (e.g. DE)', () => {
    const result = controller.getRequiredFields('DE', 'COMPANY');
    expect(result.length).toBeGreaterThanOrEqual(1);
    const vat = result.find((r) => r.scheme === 'VAT');
    expect(vat).toBeDefined();
    expect(vat!.appliesTo).toBe('BOTH');
  });

  it('filters by partyType (COMPANY) for FR', () => {
    const all = defaultRegistry.resolve('FR').profile.requiredIdentifiers;
    const result = controller.getRequiredFields('FR', 'COMPANY');
    for (const r of result) {
      expect(r.appliesTo === 'BOTH' || r.appliesTo === 'COMPANY').toBe(true);
    }
    expect(result.length).toBeLessThanOrEqual(all.length);
  });

  it('filters by partyType (INDIVIDUAL) for MX', () => {
    const all = defaultRegistry.resolve('MX').profile.requiredIdentifiers;
    const result = controller.getRequiredFields('MX', 'INDIVIDUAL');
    for (const r of result) {
      expect(r.appliesTo === 'BOTH' || r.appliesTo === 'INDIVIDUAL').toBe(true);
    }
    expect(result.length).toBeLessThanOrEqual(all.length);
  });

  it('F-16/M-8: IT COMPANY includes optional IT_SDI (Codice Destinatario) and PEC', () => {
    const result = controller.getRequiredFields('IT', 'COMPANY');
    const sdi = result.find((r) => r.scheme === 'IT_SDI');
    const pec = result.find((r) => r.scheme === 'PEC');
    expect(sdi).toMatchObject({ appliesTo: 'COMPANY', required: false, pattern: '^[A-Za-z0-9]{7}$' });
    expect(pec).toMatchObject({ appliesTo: 'BOTH', required: false });
  });

  it('F-16/M-8: IT INDIVIDUAL includes PEC (BOTH) but not IT_SDI (COMPANY-only)', () => {
    const result = controller.getRequiredFields('IT', 'INDIVIDUAL');
    expect(result.find((r) => r.scheme === 'PEC')).toBeDefined();
    expect(result.find((r) => r.scheme === 'IT_SDI')).toBeUndefined();
  });

  it('returns empty array for FALLBACK (unknown country)', () => {
    const result = controller.getRequiredFields('ZZ', 'COMPANY');
    expect(result).toEqual([]);
  });

  it('throws on missing countryCode', () => {
    expect(() => controller.getRequiredFields('', 'COMPANY')).toThrow();
  });

  it('throws on invalid partyType', () => {
    expect(() => controller.getRequiredFields('FR', 'INVALID' as any)).toThrow();
  });

  describe('getVatRates', () => {
    it('throws on missing countryCode', async () => {
      await expect(controller.getVatRates('')).rejects.toThrow();
    });

    it('throws on an invalid "at" date', async () => {
      await expect(controller.getVatRates('FR', 'not-a-date')).rejects.toThrow();
    });

    it('a VAT country delegates to VatRatesService and returns its rates as-is', async () => {
      const fakeRates = [
        {
          id: 'fr-standard',
          rate: 20,
          label: 'Taux normal',
          category: 'STANDARD',
          confidence: 'OFFICIAL',
          source: 'CGI art. 278',
          sourceCheckedAt: new Date('2026-08-29'),
          notes: null,
        },
      ];
      ratesFor.mockResolvedValue(fakeRates);

      const result = await controller.getVatRates('FR');

      expect(ratesFor).toHaveBeenCalledWith('FR', expect.any(Date));
      expect(result).toEqual({
        countryCode: 'FR',
        resolvedCountryCode: 'FR',
        taxSystemKind: 'VAT',
        rates: fakeRates,
        unavailableReason: undefined,
      });
    });

    it('a VAT country with no sourced rates yet reports NO_CATALOG_YET, not an error', async () => {
      ratesFor.mockResolvedValue([]);
      const result = await controller.getVatRates('DE');
      expect(result.taxSystemKind).toBe('VAT');
      expect(result.rates).toEqual([]);
      expect(result.unavailableReason).toBe('NO_CATALOG_YET');
    });

    it('a SALES_TAX country (US) never calls the DB and reports DESTINATION_BASED_SYSTEM', async () => {
      const result = await controller.getVatRates('US');
      expect(ratesFor).not.toHaveBeenCalled();
      expect(result.taxSystemKind).toBe('SALES_TAX');
      expect(result.rates).toEqual([]);
      expect(result.unavailableReason).toBe('DESTINATION_BASED_SYSTEM');
    });

    it('an unknown country (fallback, taxSystem NONE) reports NOT_A_VAT_SYSTEM', async () => {
      const result = await controller.getVatRates('ZZ');
      expect(ratesFor).not.toHaveBeenCalled();
      expect(result.taxSystemKind).toBe('NONE');
      expect(result.unavailableReason).toBe('NOT_A_VAT_SYSTEM');
    });

    it('Monaco delegates to France transparently — no Monaco-specific code involved', async () => {
      ratesFor.mockResolvedValue([]);
      const result = await controller.getVatRates('MC');
      expect(result.countryCode).toBe('MC');
      expect(result.resolvedCountryCode).toBe('FR');
      expect(ratesFor).toHaveBeenCalledWith('FR', expect.any(Date));
    });

    it('is case-insensitive on countryCode, like the sibling endpoints', async () => {
      ratesFor.mockResolvedValue([]);
      const result = await controller.getVatRates('fr');
      expect(result.countryCode).toBe('FR');
      expect(result.resolvedCountryCode).toBe('FR');
    });
  });
});
