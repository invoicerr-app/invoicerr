import { StateMachinePreviewService } from './state-machine-preview.service';

describe('StateMachinePreviewService', () => {
  let service: StateMachinePreviewService;

  beforeEach(() => {
    service = new StateMachinePreviewService();
  });

  describe('countries()', () => {
    it('lists real (non-fallback) profile country codes, including FR', () => {
      const countries = service.countries();
      expect(Array.isArray(countries)).toBe(true);
      expect(countries.length).toBeGreaterThan(1);
      expect(countries).toContain('FR');
      // The FALLBACK sentinel country code must never leak into the selector list — it isn't a
      // real profile and offering it would be indistinguishable from a genuine jurisdiction.
      expect(countries).not.toContain('XX');
    });
  });

  describe('preview() — domestic pair', () => {
    it('FR→FR B2B after the 2026 mandate resolves a fully-sourced, non-fallback plan + graph', () => {
      const result = service.preview({
        supplierCountry: 'fr', // lower-case on purpose: case-insensitivity like the sibling endpoints
        buyerCountry: 'FR',
        buyerRole: 'B2B',
        issueDate: '2027-01-15',
      });

      expect(result.supplier).toMatchObject({
        requestedCountryCode: 'FR',
        resolvedCountryCode: 'FR',
        isFallback: false,
        confidence: 'OFFICIAL',
      });
      expect(result.buyer).toMatchObject({ resolvedCountryCode: 'FR', isFallback: false });
      expect(result.context.buyerRole).toBe('B2B');
      expect(result.context.supplyType).toBe('SERVICES');

      expect(result.plan.classification.crossBorder).toBe(false);
      expect(result.plan.confidence).toBe('OFFICIAL');
      expect(result.plan.channels.map((c) => c.type)).toContain('PDP');

      // The lifecycle graph is a real, assembled graph, not an empty shell.
      expect(result.graph.initial).toBe('DRAFT');
      expect(result.graph.states.length).toBeGreaterThan(1);
      expect(result.graph.states).toContain('DRAFT');
      expect(result.graph.transitions.length).toBeGreaterThan(0);
      for (const t of result.graph.transitions) {
        expect(result.graph.states).toContain(t.from);
        expect(result.graph.states).toContain(t.to);
        expect(t.trigger).toBeDefined();
      }
    });
  });

  describe('preview() — cross-border pair', () => {
    it('FR→DE B2B is flagged cross-border and still resolves without a fallback on either side', () => {
      const result = service.preview({
        supplierCountry: 'FR',
        buyerCountry: 'DE',
        buyerRole: 'B2B',
        issueDate: '2027-01-15',
      });

      expect(result.plan.classification.crossBorder).toBe(true);
      expect(result.supplier.isFallback).toBe(false);
      expect(result.buyer.isFallback).toBe(false);
      expect(result.plan.warnings).toEqual([]);
      expect(result.graph.transitions.length).toBeGreaterThan(0);
    });
  });

  describe('preview() — unknown country (no profile)', () => {
    it('does not throw for a buyer country with no compliance profile, and flags FALLBACK loudly', () => {
      const result = service.preview({
        supplierCountry: 'FR',
        buyerCountry: 'ZZ',
        buyerRole: 'B2B',
        issueDate: '2027-01-15',
      });

      expect(result.buyer).toMatchObject({
        requestedCountryCode: 'ZZ',
        isFallback: true,
        confidence: 'FALLBACK',
      });
      // Cross-border rules read both profiles, so an unresolved buyer degrades the WHOLE plan's
      // confidence — the page must not show a clean OFFICIAL result while a side is unverified.
      expect(result.plan.confidence).toBe('FALLBACK');
      expect(result.plan.warnings.some((w) => w.includes('ZZ'))).toBe(true);
      // Still a complete, well-formed graph — an unknown country must degrade the ANSWER, not crash it.
      expect(result.graph.states.length).toBeGreaterThan(0);
      expect(result.graph.transitions.length).toBeGreaterThan(0);
    });

    it('does not throw for a supplier country with no compliance profile either', () => {
      const result = service.preview({
        supplierCountry: 'ZZ',
        buyerCountry: 'FR',
        buyerRole: 'B2C',
        issueDate: '2027-01-15',
      });

      expect(result.supplier.isFallback).toBe(true);
      expect(result.plan.confidence).toBe('FALLBACK');
      expect(result.plan.channels.map((c) => c.type)).toEqual(['EMAIL']); // FALLBACK profile's default
    });
  });

  describe('preview() — validation', () => {
    it('throws when supplierCountry is missing', () => {
      expect(() => service.preview({ supplierCountry: '', buyerCountry: 'FR', buyerRole: 'B2B' })).toThrow();
    });

    it('throws when buyerCountry is missing', () => {
      expect(() => service.preview({ supplierCountry: 'FR', buyerCountry: '', buyerRole: 'B2B' })).toThrow();
    });

    it('throws on an invalid buyerRole', () => {
      expect(() =>
        service.preview({ supplierCountry: 'FR', buyerCountry: 'FR', buyerRole: 'NOT_A_ROLE' }),
      ).toThrow();
    });

    it('throws on an invalid supplyType', () => {
      expect(() =>
        service.preview({
          supplierCountry: 'FR',
          buyerCountry: 'FR',
          buyerRole: 'B2B',
          supplyType: 'NOT_A_SUPPLY',
        }),
      ).toThrow();
    });

    it('throws on an invalid issueDate', () => {
      expect(() =>
        service.preview({
          supplierCountry: 'FR',
          buyerCountry: 'FR',
          buyerRole: 'B2B',
          issueDate: 'not-a-date',
        }),
      ).toThrow();
    });

    it('defaults issueDate to now when omitted', () => {
      const result = service.preview({ supplierCountry: 'FR', buyerCountry: 'FR', buyerRole: 'B2B' });
      expect(new Date(result.context.issueDate).getTime()).not.toBeNaN();
    });
  });
});
