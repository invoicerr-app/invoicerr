import { Test, TestingModule } from '@nestjs/testing';
import { RequiredFieldsController } from './required-fields.controller';
import { defaultRegistry } from '../profiles/registry';

describe('RequiredFieldsController', () => {
  let controller: RequiredFieldsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequiredFieldsController],
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
});
