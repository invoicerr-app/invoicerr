import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConflictException, NotFoundException } from '@nestjs/common';

import { computeArtifactHash } from '../archive/hashing';
import * as persistence from '../persistence';
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
