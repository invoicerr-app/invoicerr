import { readdirSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { defaultRegistry } from './registry';

/**
 * Dynamic coverage test: reads docs/compliance/*.md and asserts EVERY documented jurisdiction is
 * wired to a real (non-fallback) profile. This fails automatically if a new country spec is added
 * without a matching profile — "tous les pays câblés", enforced by CI.
 */
const docsDir = resolvePath(__dirname, '../../../../docs/compliance');
const codes = readdirSync(docsDir)
  .filter((f) => /^[A-Za-z]{2}-/.test(f)) // country files like "FR-France.md"; skips README.md etc.
  .map((f) => f.split('-')[0].toUpperCase());

describe('Country coverage', () => {
  it('discovers the documented jurisdictions', () => {
    expect(codes.length).toBeGreaterThanOrEqual(77);
  });

  it.each(codes)('%s is wired to a non-fallback profile', (code) => {
    expect(defaultRegistry.has(code)).toBe(true);
    expect(defaultRegistry.resolve(code).isFallback).toBe(false);
  });

  it('every resolved profile has a regime and a tax system (shape sanity, post-delegation)', () => {
    for (const code of codes) {
      const { profile } = defaultRegistry.resolve(code);
      expect(profile.regime.length).toBeGreaterThan(0);
      expect(profile.taxSystem).toBeDefined();
      expect(profile.lifecycle.length).toBeGreaterThan(0);
    }
  });

  it('exposes the full wired country list', () => {
    expect(defaultRegistry.countries().length).toBeGreaterThanOrEqual(78);
  });
});
