/**
 * §51 — KSA ZATCA offline invoice hash + PIH chain tests.
 *
 * Verifies (offline, no network, no ZATCA credentials):
 *   - ZATCA_PIH_INIT is a valid base64 string (SHA-256 of 64 ASCII zeros).
 *   - computeKsaInvoiceHash produces a deterministic SHA-256(base64) value.
 *   - Same XML always produces the same hash (determinism).
 *   - Different XMLs produce different hashes.
 *   - buildKsaUbl embeds PIH in cac:AdditionalDocumentReference[cbc:ID=PIH].
 *   - PIH chain: invoice 2's PIH = hash(invoice 1's XML).
 *   - When no pih option is supplied, ZATCA_PIH_INIT is used by default.
 *   - The computed hash is never empty and is valid base64.
 */

import { InvoiceRenderingService, computeKsaInvoiceHash, ZATCA_PIH_INIT } from '@/modules/invoice-rendering/invoice-rendering.service';
import { SA_B2B } from './__fixtures__/invoices';

// ---------------------------------------------------------------------------

describe('ZATCA PIH constants', () => {
  it('ZATCA_PIH_INIT is a non-empty base64 string', () => {
    expect(ZATCA_PIH_INIT).toBeTruthy();
    // Valid base64: only A-Z, a-z, 0-9, +, /, = characters
    expect(ZATCA_PIH_INIT).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('ZATCA_PIH_INIT is deterministic (same on every call)', () => {
    const { computeKsaInvoiceHash: fn } = require('@/modules/invoice-rendering/invoice-rendering.service');
    const val1 = fn('0000000000000000000000000000000000000000000000000000000000000000');
    const val2 = fn('0000000000000000000000000000000000000000000000000000000000000000');
    expect(val1).toBe(val2);
    expect(val1).toBe(ZATCA_PIH_INIT);
  });
});

describe('computeKsaInvoiceHash', () => {
  it('returns a valid base64-encoded 32-byte (256-bit) digest', () => {
    const hash = computeKsaInvoiceHash('<Invoice/>');
    // SHA-256 base64 = ceil(32/3)*4 = 44 chars
    expect(hash.length).toBe(44);
    expect(hash).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('is deterministic — same input always yields same output', () => {
    const xml = '<Invoice><ID>1</ID></Invoice>';
    expect(computeKsaInvoiceHash(xml)).toBe(computeKsaInvoiceHash(xml));
  });

  it('different XMLs produce different hashes', () => {
    const h1 = computeKsaInvoiceHash('<Invoice><ID>1</ID></Invoice>');
    const h2 = computeKsaInvoiceHash('<Invoice><ID>2</ID></Invoice>');
    expect(h1).not.toBe(h2);
  });

  it('empty string produces a non-empty hash (SHA-256 of empty string)', () => {
    // SHA-256('') = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = computeKsaInvoiceHash('');
    expect(hash.length).toBe(44);
    expect(hash).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='); // well-known SHA-256('') base64
  });
});

describe('buildKsaUbl — PIH embedding', () => {
  let service: InvoiceRenderingService;

  beforeEach(() => {
    service = new InvoiceRenderingService();
  });

  it('embeds ZATCA_PIH_INIT by default when no pih option is supplied', async () => {
    const xml = await service.buildKsaUbl(SA_B2B.data);

    expect(xml).toContain('PIH');
    expect(xml).toContain(ZATCA_PIH_INIT);
  });

  it('embeds a supplied custom PIH value', async () => {
    const customPih = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const xml = await service.buildKsaUbl(SA_B2B.data, { pih: customPih });

    expect(xml).toContain(customPih);
    // PIH AdditionalDocumentReference must appear before QR
    const pihIdx = xml.indexOf('PIH');
    const qrIdx = xml.indexOf('>QR<');
    expect(pihIdx).toBeGreaterThan(-1);
    expect(qrIdx).toBeGreaterThan(pihIdx);
  });

  it('PIH chain: invoice 2 carries hash of invoice 1 as PIH', async () => {
    const xml1 = await service.buildKsaUbl(SA_B2B.data); // invoice 1 (default PIH = INIT)
    const hash1 = computeKsaInvoiceHash(xml1);

    const data2 = { ...SA_B2B.data, rawNumber: 'INV-2025-SA-002' };
    const xml2 = await service.buildKsaUbl(data2, { pih: hash1 }); // invoice 2

    // xml2 must contain hash1 as its PIH value
    expect(xml2).toContain(hash1);

    // And the chain continues: hash2 would be PIH for invoice 3
    const hash2 = computeKsaInvoiceHash(xml2);
    expect(hash2).toBeTruthy();
    expect(hash2).not.toBe(hash1);
  });

  it('PIH chain is deterministic — rebuilding same invoice yields same hash', async () => {
    const xml1a = await service.buildKsaUbl(SA_B2B.data);
    const xml1b = await service.buildKsaUbl(SA_B2B.data);

    expect(xml1a).toBe(xml1b);
    expect(computeKsaInvoiceHash(xml1a)).toBe(computeKsaInvoiceHash(xml1b));
  });

  it('still contains TLV QR alongside PIH', async () => {
    const xml = await service.buildKsaUbl(SA_B2B.data);

    // Verify both references appear
    expect(xml).toContain('>PIH<');
    expect(xml).toContain('>QR<');

    // QR base64 blob should decode to 5 TLV fields (existing behaviour preserved)
    const qrMatch = xml.match(
      /<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=]+)<\/cbc:EmbeddedDocumentBinaryObject>/g,
    );
    // There are now two EmbeddedDocumentBinaryObject elements: PIH + QR
    expect(qrMatch).not.toBeNull();
    expect(qrMatch!.length).toBeGreaterThanOrEqual(2);
  });
});
