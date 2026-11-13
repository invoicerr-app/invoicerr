import { describe, expect, it } from 'vitest';

import { detectVendorExport, normalizeHeader } from './vendor-export-map';
import { VendorExportProfile } from './vendor-export.types';

/** Two invented profiles: the real ones arrive with each tool's mapping. */
function profile(id: string, kind: VendorExportProfile['kind'], signature: string[][]): VendorExportProfile {
  return { id, vendor: 'abby', vendorLabel: 'Test', kind, label: id, signature, columns: {}, required: [] };
}

const SPECIFIC = profile('specific', 'clients', [['raison sociale'], ['email', 'e mail']]);
const GENERAL = profile('general', 'clients', [['nom'], ['email', 'e mail']]);
const INVOICES = profile('invoices', 'invoices', [['n de facture', 'numero'], ['montant ttc']]);
const PROFILES = [SPECIFIC, GENERAL, INVOICES];

describe('header normalization', () => {
  it('drops a balanced parenthetical annotation and keeps an unbalanced one', () => {
    expect(normalizeHeader('Montant (HT)')).toBe('montant');
    expect(normalizeHeader('N° (de) facture')).toBe('n facture');
    expect(normalizeHeader('Total (TTC')).toBe('total ttc');
  });

  it('ignores accents, case and punctuation', () => {
    expect(normalizeHeader('  N° de Facture ')).toBe('n de facture');
    expect(normalizeHeader('E-mail')).toBe('e mail');
    expect(normalizeHeader('Téléphone')).toBe('telephone');
  });

  it('stays linear on a long run of unclosed parentheses', () => {
    const header = `${'('.repeat(50_000)}x`;
    const started = performance.now();
    expect(normalizeHeader(header)).toBe('x');
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe('vendor export detection', () => {
  it('recognises a profile when every signature group has one of its spellings', () => {
    expect(detectVendorExport('clients', ['Nom', 'E-mail', 'Ville'], PROFILES)?.id).toBe('general');
    expect(detectVendorExport('invoices', ['N° de facture', 'Montant TTC'], PROFILES)?.id).toBe('invoices');
  });

  it('returns the first matching profile, so the more specific one declared first wins', () => {
    const headers = ['Raison sociale', 'Nom', 'Email'];
    expect(detectVendorExport('clients', headers, PROFILES)?.id).toBe('specific');
  });

  it('does not claim a file when one signature group is missing', () => {
    expect(detectVendorExport('clients', ['Nom', 'Ville'], PROFILES)).toBeUndefined();
    expect(detectVendorExport('clients', ['name', 'email', 'phone'], PROFILES)).toBeUndefined();
  });

  it('only matches profiles of the requested export type', () => {
    expect(detectVendorExport('clients', ['Numéro', 'Montant TTC'], PROFILES)).toBeUndefined();
    expect(detectVendorExport('invoices', ['Nom', 'Email'], PROFILES)).toBeUndefined();
  });

  it('ignores empty header cells', () => {
    expect(detectVendorExport('clients', ['', 'Nom', '  ', 'Email'], PROFILES)?.id).toBe('general');
  });
});
