/**
 * DE + ES bespoke profile tests.
 *
 * Verifies:
 *   - DE profile resolves from defaultRegistry (bespoke takes precedence over archetype stub)
 *   - DE format is XRECHNUNG; channel is PEPPOL; confidence OFFICIAL; no clearance
 *   - DE receive syntax is XRECHNUNG (B2B receive mandate 2025+)
 *   - ES profile resolves; format is ES_FACTURAE; reporting includes SALES_PURCHASE_LEDGER (SII)
 *   - ES has OFFICIAL confidence; real-time reporting model from 2017
 *   - US + XX (fallback) still resolve correctly (no regression)
 */
import { defaultRegistry } from './registry';
import { DE } from './data/de';
import { ES } from './data/es';

describe('DE bespoke profile', () => {
  it('is resolved by the default registry with OFFICIAL confidence', () => {
    const r = defaultRegistry.resolve('DE');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('DE');
    expect(r.profile.confidence).toBe('OFFICIAL');
  });

  it('primary format is XRECHNUNG', () => {
    const r = defaultRegistry.resolve('DE');
    const fmt = r.profile.formats[r.profile.formats.length - 1]?.value;
    expect(fmt?.primary.syntax).toBe('XRECHNUNG');
  });

  it('mandatoryReceiveSyntax is XRECHNUNG', () => {
    expect(DE.mandatoryReceiveSyntax).toBe('XRECHNUNG');
  });

  it('transmission channel includes PEPPOL', () => {
    const channels = DE.transmission[0]?.value.channels ?? [];
    expect(channels.some((c) => c.type === 'PEPPOL')).toBe(true);
  });

  it('no clearance — post-audit regime, blocking=false', () => {
    for (const r of DE.regime) {
      expect(r.value.blocking).toBe(false);
      expect(r.value.model).toBe('POST_AUDIT');
    }
  });

  it('retention is 10 years (GoBD)', () => {
    expect(DE.archival[0]?.value.retentionYears).toBe(10);
  });

  it('requires VAT identifier with DE prefix pattern', () => {
    const vatId = DE.requiredIdentifiers.find((i) => i.scheme === 'VAT');
    expect(vatId).toBeDefined();
    expect(vatId?.pattern).toMatch(/DE/);
  });
});

describe('ES bespoke profile', () => {
  it('is resolved by the default registry with OFFICIAL confidence', () => {
    const r = defaultRegistry.resolve('ES');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('ES');
    expect(r.profile.confidence).toBe('OFFICIAL');
  });

  it('primary format is ES_FACTURAE from 2015', () => {
    // The last format rule (2015+) should be ES_FACTURAE
    const latestFmt = ES.formats[ES.formats.length - 1]?.value;
    expect(latestFmt?.primary.syntax).toBe('ES_FACTURAE');
    expect(latestFmt?.primary.version).toBe('3.2.2');
  });

  it('mandatoryReceiveSyntax is ES_FACTURAE', () => {
    expect(ES.mandatoryReceiveSyntax).toBe('ES_FACTURAE');
  });

  it('reporting includes SALES_PURCHASE_LEDGER (SII) from 2017', () => {
    const sii = ES.reporting.find((r) => r.value.kinds.includes('SALES_PURCHASE_LEDGER'));
    expect(sii).toBeDefined();
    expect(sii?.validFrom).toBe('2017-07-01');
  });

  it('transmission includes GOV_PORTAL_API with es-aeat after SII mandate', () => {
    const latest = ES.transmission[ES.transmission.length - 1]?.value;
    expect(latest?.channels.some((c) => c.type === 'GOV_PORTAL_API' && c.providerId === 'es-aeat')).toBe(true);
  });

  it('archival has SIGNED integrity (XAdES requirement)', () => {
    expect(ES.archival[0]?.value.integrity).toBe('SIGNED');
  });

  it('regime transitions from POST_AUDIT to REAL_TIME_REPORTING at 2017-07-01', () => {
    const rtReporting = ES.regime.find((r) => r.value.model === 'REAL_TIME_REPORTING');
    expect(rtReporting).toBeDefined();
    expect(rtReporting?.validFrom).toBe('2017-07-01');
  });

  it('requires NIF/CIF identifier', () => {
    const vat = ES.requiredIdentifiers.find((i) => i.scheme === 'VAT');
    expect(vat).toBeDefined();
    expect(vat?.required).toBe(true);
  });
});

describe('Existing profiles — no regression', () => {
  it('US still resolves correctly', () => {
    const r = defaultRegistry.resolve('US');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('US');
  });

  it('FR still resolves correctly', () => {
    const r = defaultRegistry.resolve('FR');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('FR');
    expect(r.profile.confidence).toBe('OFFICIAL');
  });

  it('PL still resolves correctly with KSeF channel', () => {
    const r = defaultRegistry.resolve('PL');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('PL');
  });

  it('IT still resolves correctly', () => {
    const r = defaultRegistry.resolve('IT');
    expect(r.isFallback).toBe(false);
    expect(r.profile.countryCode).toBe('IT');
  });

  it('unknown country XX falls back safely', () => {
    const r = defaultRegistry.resolve('XX');
    expect(r.isFallback).toBe(true);
  });
});
