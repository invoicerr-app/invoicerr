import {
  FONT_CATALOG,
  fontCatalogEntry,
  fontFaceCssFor,
  fontStackFor,
  isBrandingFontKey,
} from './font-catalog';

describe('branding font catalog', () => {
  it('has exactly 5 families, each with a 400 and a 700 weight file', () => {
    expect(FONT_CATALOG).toHaveLength(5);
    for (const entry of FONT_CATALOG) {
      const weights = entry.weights.map((w) => w.weight).sort();
      expect(weights).toEqual([400, 700]);
    }
  });

  describe('isBrandingFontKey', () => {
    it('is true for every catalog key', () => {
      for (const entry of FONT_CATALOG) {
        expect(isBrandingFontKey(entry.key)).toBe(true);
      }
    });

    it('is false for an unrecognized string, undefined, or null', () => {
      expect(isBrandingFontKey('comic-sans')).toBe(false);
      expect(isBrandingFontKey(undefined)).toBe(false);
      expect(isBrandingFontKey(null)).toBe(false);
    });
  });

  describe('fontStackFor', () => {
    it('returns "<cssFamily>", <fallback stack> for a known key', () => {
      const entry = fontCatalogEntry('inter')!;
      expect(fontStackFor('inter')).toBe(`"${entry.cssFamily}", ${entry.fallbackStack}`);
    });

    it('returns null for an unknown/absent key', () => {
      expect(fontStackFor('not-a-real-font')).toBeNull();
      expect(fontStackFor(undefined)).toBeNull();
      expect(fontStackFor(null)).toBeNull();
    });
  });

  describe('fontFaceCssFor', () => {
    it('embeds one @font-face rule per weight, as a data: URI, for a known key', () => {
      const css = fontFaceCssFor('inter');
      expect(css).toContain('@font-face');
      expect((css.match(/@font-face/g) || []).length).toBe(2);
      expect(css).toContain('font-weight: 400');
      expect(css).toContain('font-weight: 700');
      expect(css).toContain('InvoicerrBrandInter');
      expect(css).toContain('data:font/woff2;base64,');
      expect(css).not.toContain('http');
      expect(css).not.toContain('file://');
    });

    it('produces DIFFERENT @font-face CSS for two different families (not a copy-paste bug)', () => {
      expect(fontFaceCssFor('inter')).not.toBe(fontFaceCssFor('lora'));
    });

    it('returns "" for an unknown/absent key — never throws', () => {
      expect(fontFaceCssFor('not-a-real-font')).toBe('');
      expect(fontFaceCssFor(undefined)).toBe('');
      expect(fontFaceCssFor(null)).toBe('');
    });

    it('is cached — a second call for the same key returns the identical string', () => {
      expect(fontFaceCssFor('dmSans')).toBe(fontFaceCssFor('dmSans'));
    });
  });

  describe('every catalog entry resolves real, readable font files', () => {
    it.each(FONT_CATALOG.map((entry) => entry.key))('%s embeds non-empty @font-face CSS', (key) => {
      // A non-empty result here proves the bundled .woff2 files under rendering/fonts/<dir>/ are
      // actually present and readable from THIS test's own working directory — the same guarantee
      // `nest-cli.json`'s asset copy has to uphold for `dist/` (see fonts/LICENSES.md's own header).
      expect(fontFaceCssFor(key).length).toBeGreaterThan(0);
    });
  });
});
