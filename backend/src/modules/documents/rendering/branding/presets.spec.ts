import { isBrandingFontKey } from './font-catalog';
import { BRANDING_PRESETS, brandingPresetById } from './presets';

describe('branding presets', () => {
  it('has 4 presets (Classic, Modern, Minimal, Bold), each with a unique id', () => {
    expect(BRANDING_PRESETS).toHaveLength(4);
    const ids = BRANDING_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every preset points at a valid hex color and a real font-catalog key', () => {
    for (const preset of BRANDING_PRESETS) {
      expect(preset.accentColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(isBrandingFontKey(preset.font)).toBe(true);
    }
  });

  describe('brandingPresetById', () => {
    it('resolves a known id', () => {
      expect(brandingPresetById('classic')?.label).toBe('Classic');
    });

    it('is undefined for an unknown/absent id', () => {
      expect(brandingPresetById('not-a-real-preset')).toBeUndefined();
      expect(brandingPresetById(undefined)).toBeUndefined();
      expect(brandingPresetById(null)).toBeUndefined();
    });
  });
});
