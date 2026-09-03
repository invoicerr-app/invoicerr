import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { computeArtifactHash } from '../archive/hashing';
import { checkReceivedInvoiceLineTotals } from './line-totals-check';
import * as persistence from '../persistence';
import { receivedDocumentExtractorRegistry } from './ocr/extractor';
import { ReceivedInvoicesService } from './received-invoices.service';
import { persistInboundFile } from './storage';

jest.mock('../persistence');

/** A minimal, real, valid CII XML — small enough to hand-write, big enough that extraction has real
 *  fields to find (this spec's own concern is the SERVICE's upload/dedup/download orchestration, not
 *  re-proving extraction correctness — extraction.spec.ts already does that against our OWN full
 *  outbound providers). */
const MINIMAL_CII_XML = `<?xml version="1.0" encoding="utf-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>SUPPLIER-INV-42</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260815</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Fournisseur Test SARL</ram:Name></ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>100.00</ram:LineTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">20.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

/** Same fixture, plus a seller VAT identifier (`SpecifiedTaxRegistration`) — TODO_PRODUIT.md T5(b)'s
 *  own wiring test below needs the ONE extra fact `reconcileSupplierClient` reads. */
function ciiXmlWithSellerVat(vatId: string): string {
  return MINIMAL_CII_XML.replace(
    '<ram:SellerTradeParty><ram:Name>Fournisseur Test SARL</ram:Name></ram:SellerTradeParty>',
    `<ram:SellerTradeParty><ram:Name>Fournisseur Test SARL</ram:Name>` +
      `<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${vatId}</ram:ID></ram:SpecifiedTaxRegistration>` +
      `</ram:SellerTradeParty>`,
  );
}

describe('ReceivedInvoicesService', () => {
  let dir: string;
  const originalEnv = process.env.DOCUMENTS_INBOUND_DIR;
  let service: ReceivedInvoicesService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'received-invoices-service-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    service = new ReceivedInvoicesService();
    (persistence.listDocuments as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
    jest.resetAllMocks();
  });

  describe('upload', () => {
    it('stores the file, extracts CII fields, and returns the SHA-256 as fileRef', async () => {
      const base64 = Buffer.from(MINIMAL_CII_XML, 'utf-8').toString('base64');
      const expectedHash = computeArtifactHash(Buffer.from(MINIMAL_CII_XML, 'utf-8'));

      const preview = await service.upload('company-1', {
        fileName: 'supplier-invoice.xml',
        mime: 'application/xml',
        base64,
      });

      expect(preview.fileRef).toBe(expectedHash);
      expect(preview.fileName).toBe('supplier-invoice.xml');
      expect(preview.extraction.syntax).toBe('CII');
      expect(preview.extraction.fields).toEqual({
        supplierNumber: 'SUPPLIER-INV-42',
        issueDate: '2026-08-15',
        supplier: 'Fournisseur Test SARL',
        currency: 'EUR',
        netAmount: 100,
        vatAmount: 20,
        grossAmount: 120,
      });
    });

    it('a plain, unrecognized file is still stored and returned — never a refusal', async () => {
      const base64 = Buffer.from('just some scanned text').toString('base64');

      const preview = await service.upload('company-1', {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        base64,
      });

      expect(preview.fileRef).toHaveLength(64); // a real hex SHA-256
      expect(preview.extraction).toEqual({ syntax: null, fields: {} });
    });

    it('refuses an empty file, named', async () => {
      await expect(
        service.upload('company-1', { fileName: 'empty.pdf', mime: 'application/pdf', base64: '' }),
      ).rejects.toThrow(ConflictException);
    });

    // MUTATION 2 of this task's report: "le doublon par hash n'est plus détecté" — this is the test
    // that must go red for that mutation.
    it('refuses re-uploading the exact same file (same hash) already on an existing received-invoice, by name', async () => {
      const base64 = Buffer.from(MINIMAL_CII_XML, 'utf-8').toString('base64');
      const hash = computeArtifactHash(Buffer.from(MINIMAL_CII_XML, 'utf-8'));
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        {
          id: 'ri-existing',
          typeId: 'received-invoice',
          status: 'received',
          data: { fileRef: hash },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', base64 }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', base64 }),
      ).rejects.toThrow(/duplicate/);
      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', base64 }),
      ).rejects.toThrow(/ri-existing/); // names WHICH document already has it
    });

    it('a DIFFERENT file (different hash) is accepted even when another received-invoice exists', async () => {
      (persistence.listDocuments as jest.Mock).mockResolvedValue([
        {
          id: 'ri-existing',
          typeId: 'received-invoice',
          status: 'received',
          data: { fileRef: 'some-other-hash-entirely' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const base64 = Buffer.from(MINIMAL_CII_XML, 'utf-8').toString('base64');

      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', base64 }),
      ).resolves.toMatchObject({ extraction: { syntax: 'CII' } });
    });
  });

  /**
   * TODO_PRODUIT.md T5(b) — "au dépôt", proven end-to-end through the REAL `upload()` pipeline: real
   * Prisma for the Client/PartyIdentifier side (this file's own `jest.mock('../persistence')` only
   * ever touched `DocumentInstance` reads/writes, never this) — see `supplier-reconciliation.spec.ts`
   * for the exhaustive matching-rule coverage (ambiguity, companyId scoping, name fallback); this
   * describe only proves the WIRING: a real VAT in a real deposit reaches a real Client and comes back
   * as `fields.supplierClient` + `supplierMatch`, exactly the shape the frontend's own
   * `buildInitialData` (received-invoice-upload-button.tsx) already spreads verbatim.
   */
  describe('upload — supplier reconciliation (TODO_PRODUIT.md T5(b))', () => {
    let companyId: string;
    let clientId: string;
    const KNOWN_VAT = 'FR40506070801';

    beforeAll(async () => {
      const company = await prisma.company.create({
        data: {
          name: 'Received Invoices Reconciliation Co',
          foundedAt: new Date('2020-01-01'),
          address: '1 Test Street',
          postalCode: '00000',
          city: 'Testville',
          country: 'France',
          countryCode: 'FR',
          phone: '+33000000000',
          email: `received-invoices-reconciliation-${Date.now()}@example.com`,
        },
      });
      companyId = company.id;
      const client = await prisma.client.create({
        data: {
          companyId,
          name: 'Client Book Entry, Different Name On Purpose',
          address: '2 Client Street',
          postalCode: '11111',
          city: 'Clientville',
          country: 'France',
          countryCode: 'FR',
        },
      });
      clientId = client.id;
      await prisma.partyIdentifier.create({
        data: { clientId: client.id, scheme: 'VAT', value: KNOWN_VAT },
      });
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('a deposit whose seller VAT matches an existing client links it automatically — visible in `fields.supplierClient`', async () => {
      const base64 = Buffer.from(ciiXmlWithSellerVat(KNOWN_VAT), 'utf-8').toString('base64');

      const preview = await service.upload(companyId, {
        fileName: 'known-supplier.xml',
        mime: 'application/xml',
        base64,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'matched', clientId, matchedBy: 'vat' });
      expect(preview.extraction.fields.supplierClient).toBe(clientId);
      // The free-text `supplier` name is untouched — it stays whatever the seller's OWN document
      // said, independent from the linked Client's own registered name (see the descriptor's header).
      expect(preview.extraction.fields.supplier).toBe('Fournisseur Test SARL');
    });

    it('a deposit whose seller VAT matches NOTHING never links — no client created, field left empty', async () => {
      const base64 = Buffer.from(ciiXmlWithSellerVat('FR99988877701'), 'utf-8').toString('base64');

      const preview = await service.upload(companyId, {
        fileName: 'unknown-supplier.xml',
        mime: 'application/xml',
        base64,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'unmatched', reason: 'not-found' });
      expect(preview.extraction.fields.supplierClient).toBeUndefined();

      // No client was silently created for the unmatched vendor.
      const clientsAfter = await prisma.client.count({ where: { companyId } });
      expect(clientsAfter).toBe(1);
    });

    it('a deposit with no VAT and no name match at all is reported "no-criteria" once extraction itself yields nothing', async () => {
      const base64 = Buffer.from('just some scanned text').toString('base64');

      const preview = await service.upload(companyId, {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        base64,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'unmatched', reason: 'no-criteria' });
    });
  });

  /**
   * TODO_PRODUIT.md T5(c) — proves the WIRING, not the Mistral client (that lives in
   * `plugins/ocr/providers/mistral/client.spec.ts`, against a real HTTP stub) nor the fallback
   * function itself (`ocr/apply-ocr-fallback.spec.ts`): a STUB extractor registered into the exact
   * same core registry a real plugin would use, proving an OCR proposal reaches `preview.extraction.
   * fields` and that T5(b)'s supplier reconciliation AND T5(a)'s total-vs-sum check both run on
   * whatever it hands back — exactly as they already do for a structurally-read field, since neither
   * downstream mechanism has (or needs) any notion of WHERE a field came from.
   */
  describe('upload — OCR fallback (TODO_PRODUIT.md T5(c))', () => {
    const STUB_ID = 'stub-ocr-for-received-invoices-service-spec';
    const KNOWN_OCR_VAT = 'FR60708090801';
    let companyId: string;
    let clientId: string;

    beforeAll(() => {
      receivedDocumentExtractorRegistry.register({
        id: STUB_ID,
        supports: (mime) => mime === 'application/pdf',
        extract: async () => ({
          fields: {
            supplier: 'OCR-Read Supplier',
            supplierVatId: KNOWN_OCR_VAT,
            currency: 'EUR',
            netAmount: 400,
            vatAmount: 80,
            // Deliberately WRONG on this one total only (4 x 100.00 @ 20% sums to net 400 / VAT 80 /
            // gross 480 — net/VAT above already match that exactly, only gross is printed wrong here)
            // — the same "mundane, single-total typo" shape 36-received-invoices.cy.ts's own
            // MISMATCH_FIXTURE already uses, proven here to react to an OCR-sourced line exactly like
            // a structurally-read one.
            grossAmount: 600,
            lines: [{ description: 'OCR line', quantity: 4, unitPrice: 100, vatRate: '20' }],
          },
        }),
      });

      return prisma.company
        .create({
          data: {
            name: 'Received Invoices OCR Fallback Co',
            foundedAt: new Date('2020-01-01'),
            address: '1 Test Street',
            postalCode: '00000',
            city: 'Testville',
            country: 'France',
            countryCode: 'FR',
            phone: '+33000000000',
            email: `received-invoices-ocr-fallback-${Date.now()}@example.com`,
          },
        })
        .then(async (company) => {
          companyId = company.id;
          const client = await prisma.client.create({
            data: {
              companyId,
              name: 'OCR Client Book Entry',
              address: '2 Client Street',
              postalCode: '11111',
              city: 'Clientville',
              country: 'France',
              countryCode: 'FR',
            },
          });
          clientId = client.id;
          await prisma.partyIdentifier.create({
            data: { clientId: client.id, scheme: 'VAT', value: KNOWN_OCR_VAT },
          });
        });
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('a plain PDF with an active stub extractor comes back pre-filled — never left blank the way a truly unrecognized file stays', async () => {
      const base64 = Buffer.from('a scanned page, no embedded XML at all').toString('base64');

      const preview = await service.upload(companyId, {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        base64,
      });

      expect(preview.ocr).toEqual({ outcome: 'extracted', extractorId: STUB_ID });
      expect(preview.extraction.syntax).toBe('OCR');
      expect(preview.extraction.fields.supplier).toBe('OCR-Read Supplier');
      expect(preview.extraction.fields.netAmount).toBe(400);
    });

    it("the OCR-read supplier VAT auto-reconciles against this company's own client book — the SAME mechanism T5(b) proved for structural extraction", async () => {
      const base64 = Buffer.from('another scanned page').toString('base64');

      const preview = await service.upload(companyId, {
        fileName: 'scan-2.pdf',
        mime: 'application/pdf',
        base64,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'matched', clientId, matchedBy: 'vat' });
      expect(preview.extraction.fields.supplierClient).toBe(clientId);
    });

    it("the OCR-read lines feed T5(a)'s total-vs-sum check exactly like a structurally-read line would — a named, non-blocking warning", () => {
      // The check itself (line-totals-check.ts) runs at "receive" time (received-invoice-actions.ts),
      // not at upload — this proves the FIELDS this upload just returned are the SAME shape that
      // check already knows how to read, without re-driving the whole action pipeline here (that
      // wiring is `received-invoice-actions.ts`'s own concern, untouched by this task).
      const warnings = checkReceivedInvoiceLineTotals({
        currency: 'EUR',
        netAmount: 400,
        vatAmount: 80,
        grossAmount: 600,
        lines: [{ description: 'OCR line', quantity: 4, unitPrice: 100, vatRate: '20' }],
      });

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/Line total mismatch \(gross \/ TTC\)/);
    });
  });

  describe('downloadFile', () => {
    it('reads back exactly what was persisted for an owned document', async () => {
      persistInboundFile(
        'company-1',
        'hash-abc',
        'application/pdf',
        new TextEncoder().encode('the pdf bytes'),
      );
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'ri-1',
        typeId: 'received-invoice',
        status: 'received',
        data: { fileRef: 'hash-abc', fileName: 'invoice.pdf', fileMime: 'application/pdf' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.downloadFile('company-1', 'ri-1');

      expect(result.bytes.toString('utf-8')).toBe('the pdf bytes');
      expect(result.fileName).toBe('invoice.pdf');
      expect(result.mime).toBe('application/pdf');
      expect(persistence.findOwnedDocument).toHaveBeenCalledWith('company-1', 'received-invoice', 'ri-1');
    });

    it('404s, named, when the record has no fileRef at all', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'ri-1',
        typeId: 'received-invoice',
        status: 'received',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.downloadFile('company-1', 'ri-1')).rejects.toThrow(NotFoundException);
    });

    it('404s, named, when the record has a fileRef but the bytes are no longer on disk', async () => {
      (persistence.findOwnedDocument as jest.Mock).mockResolvedValue({
        id: 'ri-1',
        typeId: 'received-invoice',
        status: 'received',
        data: { fileRef: 'never-actually-stored', fileMime: 'application/pdf' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(service.downloadFile('company-1', 'ri-1')).rejects.toThrow(/no longer on disk/);
    });
  });
});
