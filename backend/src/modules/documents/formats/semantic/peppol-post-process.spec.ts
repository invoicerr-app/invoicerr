/**
 * Unit-level proof for `mergePeppolNotesInObject` in isolation — the shape-level complement to
 * `peppol-bis-provider.spec.ts`'s own master proof, which judges the SAME function through the real
 * build pipeline and the real vendored Schematron. This file only checks the object mutation itself:
 * given the exact shape `@e-invoice-eu/core`'s UBL formatter hands a `postProcessor` (verified
 * directly against the vendored dependency — see this function's own header), does it merge
 * correctly, preserve content verbatim, and leave everything else alone.
 */
import { mergePeppolNotesInObject } from './peppol-post-process';

describe('mergePeppolNotesInObject', () => {
  it('merges several notes into ONE, joined by newline, content preserved verbatim and in order', () => {
    const data = {
      Invoice: {
        'cbc:ID': 'INV-1',
        'cbc:Note': [
          '#PMT#Indemnité forfaitaire de 40 €.',
          '#PMD#Pénalités au taux de 12,40 % l’an.',
          '#AAB#Escompte pour paiement anticipé : néant',
        ],
      },
    };

    mergePeppolNotesInObject(data);

    expect(data.Invoice['cbc:Note']).toEqual([
      '#PMT#Indemnité forfaitaire de 40 €.\n#PMD#Pénalités au taux de 12,40 % l’an.\n#AAB#Escompte pour paiement anticipé : néant',
    ]);
    // Nothing else on the object is touched.
    expect(data.Invoice['cbc:ID']).toBe('INV-1');
  });

  it('a single note is left completely unchanged (already R002-compliant)', () => {
    const data = { Invoice: { 'cbc:Note': ['Merci pour votre confiance.'] } };
    mergePeppolNotesInObject(data);
    expect(data.Invoice['cbc:Note']).toEqual(['Merci pour votre confiance.']);
  });

  it('no note at all is a no-op', () => {
    const data = { Invoice: { 'cbc:ID': 'INV-2' } };
    mergePeppolNotesInObject(data);
    expect(data.Invoice).toEqual({ 'cbc:ID': 'INV-2' });
  });

  it('the user free-text note stays FIRST in the merged text, ahead of the country-mandated mentions', () => {
    const data = {
      Invoice: {
        'cbc:Note': ['Merci pour votre confiance.', '#PMT#Indemnité forfaitaire de 40 €.'],
      },
    };
    mergePeppolNotesInObject(data);
    expect(data.Invoice['cbc:Note']).toEqual([
      'Merci pour votre confiance.\n#PMT#Indemnité forfaitaire de 40 €.',
    ]);
  });

  it('operates on the CreditNote root key too (defensive — not reachable through peppol-bis-provider.ts today)', () => {
    const data = { CreditNote: { 'cbc:Note': ['a', 'b'] } };
    mergePeppolNotesInObject(data);
    expect(data.CreditNote['cbc:Note']).toEqual(['a\nb']);
  });

  it('neither Invoice nor CreditNote present — safe no-op', () => {
    const data = { SomethingElse: {} };
    expect(() => mergePeppolNotesInObject(data)).not.toThrow();
  });
});
