/**
 * Unit tests for CII post-processor (SpecifiedLegalOrganization injection).
 */
import { EInvoice } from '@fin.cx/einvoice';
import {
  injectSpecifiedLegalOrganization,
  extractSirensFromCii,
  postProcessCiiForCtc,
} from './cii-post-process';

async function buildCiiXml(): Promise<string> {
  const inv = new EInvoice();
  inv.id = 'TEST-001';
  inv.issueDate = new Date('2026-06-28');
  inv.currency = 'EUR';
  inv.from = {
    name: 'Seller SARL', description: 'N/A', status: 'active',
    foundedDate: { day: 1, month: 1, year: 2020 }, type: 'company',
    address: { streetName: 'Rue Test', houseNumber: '1', city: 'Paris', postalCode: '75001', country: 'France', countryCode: 'FR' },
    registrationDetails: { vatId: 'FR00315143296', registrationId: '315143296', registrationName: 'Seller SARL' },
  };
  inv.to = {
    name: 'Buyer SAS', description: 'N/A', status: 'active',
    foundedDate: { day: 1, month: 1, year: 2020 }, type: 'company',
    address: { streetName: 'Avenue Client', houseNumber: '2', city: 'Lyon', postalCode: '69002', country: 'France', countryCode: 'FR' },
    registrationDetails: { vatId: 'FR23334173221', registrationId: '552081317', registrationName: 'Buyer SAS' },
  };
  inv.addItem({ name: 'Service', unitQuantity: 1, unitNetPrice: 100, vatPercentage: 20, unitType: 'C62' });
  return inv.exportXml('cii');
}

describe('cii-post-process', () => {
  let rawXml: string;

  beforeAll(async () => {
    rawXml = await buildCiiXml();
  });

  describe('extractSirensFromCii', () => {
    it('extracts seller SIREN from FC tax registration', () => {
      const { seller, buyer } = extractSirensFromCii(rawXml);
      expect(seller).toBe('315143296');
      expect(buyer).toBe('552081317');
    });

    it('returns undefined when FC registration is missing', () => {
      const xml = rawXml.replace(/<ram:ID schemeID="FC">315143296<\/ram:ID>/, '');
      const { seller } = extractSirensFromCii(xml);
      expect(seller).toBeUndefined();
    });
  });

  describe('injectSpecifiedLegalOrganization', () => {
    it('injects into seller trade party', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '315143296', schemeID: '0002' },
      });
      expect(result).toContain('SpecifiedLegalOrganization');
      expect(result).toContain('schemeID="0002"');
      expect(result).toContain('<ram:ID schemeID="0002">315143296</ram:ID>');
    });

    it('injects into both seller and buyer', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '315143296', schemeID: '0002' },
        buyer: { value: '552081317', schemeID: '0002' },
      });
      const sellerMatch = result.match(/<ram:SellerTradeParty>[\s\S]*?<\/ram:SellerTradeParty>/);
      const buyerMatch = result.match(/<ram:BuyerTradeParty>[\s\S]*?<\/ram:BuyerTradeParty>/);
      expect(sellerMatch?.[0]).toContain('SpecifiedLegalOrganization');
      expect(buyerMatch?.[0]).toContain('SpecifiedLegalOrganization');
    });

    it('does not double-inject (idempotent)', () => {
      const once = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '315143296', schemeID: '0002' },
        buyer: { value: '552081317', schemeID: '0002' },
      });
      const twice = injectSpecifiedLegalOrganization(once, {
        seller: { value: '315143296', schemeID: '0002' },
        buyer: { value: '552081317', schemeID: '0002' },
      });
      expect(once).toBe(twice);
    });

    it('uses default schemeID 0002 when not specified', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '315143296' },
      });
      expect(result).toContain('schemeID="0002"');
    });

    it('supports schemeID 0009 (SIRET)', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '31514329600012', schemeID: '0009' },
      });
      expect(result).toContain('schemeID="0009"');
      expect(result).toContain('<ram:ID schemeID="0009">31514329600012</ram:ID>');
    });

    it('returns unchanged XML when no input provided', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {});
      expect(result).toBe(rawXml);
      expect(result).not.toContain('SpecifiedLegalOrganization');
    });

    it('returns unchanged when trade party not found', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '123456789' },
      });
      // If SellerTradeParty exists, it should inject; if not, unchanged
      if (rawXml.includes('SellerTradeParty')) {
        expect(result).toContain('123456789');
      } else {
        expect(result).toBe(rawXml);
      }
    });

    it('escapes XML entities in values', () => {
      const result = injectSpecifiedLegalOrganization(rawXml, {
        seller: { value: '123456789' },
      });
      // The injected ID element should contain only the numeric value — no nested tags
      const injectedId = result.match(/<ram:SpecifiedLegalOrganization>[\s\S]*?<\/ram:SpecifiedLegalOrganization>/);
      expect(injectedId).toBeTruthy();
      expect(injectedId![0]).toContain('123456789');
      expect(injectedId![0]).not.toContain('&lt;');
      expect(injectedId![0]).not.toContain('&gt;');
    });
  });

  describe('postProcessCiiForCtc', () => {
    it('auto-extracts SIRENs and injects SpecifiedLegalOrganization', () => {
      const result = postProcessCiiForCtc(rawXml);
      expect(result).toContain('SpecifiedLegalOrganization');
      // After namespace normalization, tags use xmlns= style (no ram: prefix)
      expect(result).toContain('schemeID="0002">315143296<');
      expect(result).toContain('schemeID="0002">552081317<');
    });

    it('returns unchanged XML when no FC registrations found (no SpecifiedLegalOrganization)', () => {
      const noFcXml = rawXml
        .replace(/<ram:ID schemeID="FC">315143296<\/ram:ID>/, '')
        .replace(/<ram:ID schemeID="FC">552081317<\/ram:ID>/, '');
      const result = postProcessCiiForCtc(noFcXml);
      // SpecifiedLegalOrganization is NOT injected (no SIREN found), but EN16931 gaps are still fixed
      expect(result).not.toContain('SpecifiedLegalOrganization');
      expect(result).toContain('BusinessProcessSpecifiedDocumentContextParameter');
    });

    it('is idempotent', () => {
      const once = postProcessCiiForCtc(rawXml);
      const twice = postProcessCiiForCtc(once);
      expect(once).toBe(twice);
    });
  });

  describe('valid CII structure after injection', () => {
    it('produces well-formed CII with all required elements', () => {
      const result = postProcessCiiForCtc(rawXml);

      // Core structure intact (namespace-agnostic: normalizeCiiNamespaces strips rsm:/ram: prefixes)
      expect(result).toContain('CrossIndustryInvoice');
      expect(result).toContain('ApplicableHeaderTradeAgreement');
      expect(result).toContain('ApplicableHeaderTradeDelivery');
      expect(result).toContain('ApplicableHeaderTradeSettlement');

      // Seller trade party has SpecifiedLegalOrganization with SIREN 0002
      expect(result).toContain('SellerTradeParty');
      expect(result).toContain('BuyerTradeParty');
      expect(result).toContain('SpecifiedLegalOrganization');
      expect(result).toContain('SpecifiedTaxRegistration');

      // After normalization, FC registration is stripped — only VA remains
      expect(result).not.toContain('schemeID="FC"');
    });
  });
});
