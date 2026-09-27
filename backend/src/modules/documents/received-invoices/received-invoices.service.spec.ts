import { vi, type Mock } from 'vitest';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { computeArtifactHash } from '../archive/hashing';
import * as persistence from '../persistence';
import { filterLikeListAllDocuments } from '../__tests__/fake-document-instance-table';
import { ExtractorNotReadyError, receivedDocumentExtractorRegistry } from './ocr/extractor';
import { ReceivedInvoicesService } from './received-invoices.service';
import { persistInboundFile } from './storage';
import { MAX_RECEIVED_INVOICE_BYTES } from './upload-validation';

vi.mock('../persistence');

const listAllDocuments = persistence.listAllDocuments as Mock;

/** Hands the duplicate check only the rows the QUERY would have returned — the `fileRef` match moved
 *  into SQL when this read stopped being capped, so a mock returning a fixture verbatim would let
 *  every test here pass on an in-memory comparison production no longer makes. The cap-crossing
 *  fixture lives in `duplicate-upload.read-cap.spec.ts`. */
function seedDocuments(rows: Parameters<typeof filterLikeListAllDocuments>[0]): void {
  listAllDocuments.mockImplementation(async (_companyId: string, options = {}) =>
    filterLikeListAllDocuments(rows, options),
  );
}

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

/** A fake "scanned, no embedded structure" PDF deposit — real enough to pass `upload-validation.ts`'s
 *  own magic-byte check (`%PDF-` — see that file's own header) without being a genuinely parseable
 *  PDF, which is exactly the case every test using this helper means to exercise: `PDFDocument.load`
 *  fails on it just like it would on a real, malformed scan, degrading honestly to `EMPTY_RESULT`
 *  (`extraction.ts#extractEmbeddedXmlFromPdf`'s own documented behavior) rather than being refused at
 *  the upload gate for having the wrong magic number entirely. */
function fakeScannedPdfBytes(text: string): Buffer {
  return Buffer.from(`%PDF-1.4\n${text}`);
}

/** Same fixture, plus a seller VAT identifier (`SpecifiedTaxRegistration`) — the supplier-reconciliation
 *  wiring test below needs the ONE extra fact `reconcileSupplierClient` reads. */
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
  // The narrow shape `ReceivedInvoicesService` depends on (`ReceivedInvoiceOcrDispatcher`,
  // `queue/received-invoice-ocr.dispatcher.ts`) — a bare mock, no Nest, no BullMQ, no Redis, the same
  // "depend on the concrete class as a DI-safe VALUE import, mock it structurally in a spec" shape
  // `document-queue.dispatcher.ts`'s own consumers already hold.
  let ocrDispatcher: { enqueue: Mock; getResult: Mock };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'received-invoices-service-test-'));
    process.env.DOCUMENTS_INBOUND_DIR = dir;
    ocrDispatcher = { enqueue: vi.fn().mockResolvedValue(undefined), getResult: vi.fn() };
    service = new ReceivedInvoicesService(ocrDispatcher as never);
    seedDocuments([]);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.DOCUMENTS_INBOUND_DIR;
    else process.env.DOCUMENTS_INBOUND_DIR = originalEnv;
    vi.resetAllMocks();
  });

  describe('upload', () => {
    it('stores the file, extracts CII fields, and returns the SHA-256 as fileRef', async () => {
      const bytes = Buffer.from(MINIMAL_CII_XML, 'utf-8');
      const expectedHash = computeArtifactHash(Buffer.from(MINIMAL_CII_XML, 'utf-8'));

      const preview = await service.upload('company-1', {
        fileName: 'supplier-invoice.xml',
        mime: 'application/xml',
        bytes,
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
      // A structural hit means `needsOcr` is false (extraction.ts's own `syntax` is no longer null) —
      // OCR is never even a candidate, so nothing is ever enqueued.
      expect(preview.ocr).toEqual({ outcome: 'not-attempted' });
      expect(ocrDispatcher.enqueue).not.toHaveBeenCalled();
    });

    it('a plain, unrecognized file is still stored and returned — never a refusal', async () => {
      const bytes = fakeScannedPdfBytes('just some scanned text');

      const preview = await service.upload('company-1', {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        bytes,
      });

      expect(preview.fileRef).toHaveLength(64); // a real hex SHA-256
      expect(preview.extraction).toEqual({ syntax: null, fields: {} });
    });

    it('refuses an empty file, named', async () => {
      await expect(
        service.upload('company-1', {
          fileName: 'empty.pdf',
          mime: 'application/pdf',
          bytes: Buffer.alloc(0),
        }),
      ).rejects.toThrow(ConflictException);
    });

    // Mutation "the hash duplicate is no longer detected" — this is the test that must go red for it.
    it('refuses re-uploading the exact same file (same hash) already on an existing received-invoice, by name', async () => {
      const bytes = Buffer.from(MINIMAL_CII_XML, 'utf-8');
      const hash = computeArtifactHash(Buffer.from(MINIMAL_CII_XML, 'utf-8'));
      seedDocuments([
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
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', bytes }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', bytes }),
      ).rejects.toThrow(/duplicate/);
      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', bytes }),
      ).rejects.toThrow(/ri-existing/); // names WHICH document already has it
      // Refused before persisting, before extraction, before anything OCR-related ever runs.
      expect(ocrDispatcher.enqueue).not.toHaveBeenCalled();
    });

    it('a DIFFERENT file (different hash) is accepted even when another received-invoice exists', async () => {
      seedDocuments([
        {
          id: 'ri-existing',
          typeId: 'received-invoice',
          status: 'received',
          data: { fileRef: 'some-other-hash-entirely' },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const bytes = Buffer.from(MINIMAL_CII_XML, 'utf-8');

      await expect(
        service.upload('company-1', { fileName: 'supplier-invoice.xml', mime: 'application/xml', bytes }),
      ).resolves.toMatchObject({ extraction: { syntax: 'CII' } });
    });
  });

  describe('upload — mime allow-list, magic-byte check, size limit, filename sanitizing', () => {
    it('refuses a mime outside the allow-list, named', async () => {
      const bytes = Buffer.from('<script>alert(1)</script>');

      await expect(
        service.upload('company-1', { fileName: 'payload.html', mime: 'text/html', bytes }),
      ).rejects.toThrow(BadRequestException);
    });

    // The actual scenario this whole check exists for: a THIRD PARTY declares "application/pdf" (or
    // any other allowed mime) for content that is not that at all — an HTML page, here — hoping it
    // gets stored under a trusted label. `storage.ts`'s inbound store is shared with the generic
    // `documents.controller.ts#downloadAttachment` route, which only echoes back a Content-Type it
    // itself trusts (`ALLOWED_ATTACHMENT_MIMES`) — but this deposit's OWN download route
    // (`received-invoices.controller.ts#downloadFile`) always forces `Content-Disposition: attachment`
    // regardless, so the actual defense belongs HERE: never let the mismatched bytes reach disk at all.
    it('refuses a declared mime whose ACTUAL bytes do not match it, even though the mime itself is allowed', async () => {
      const bytes = Buffer.from('<html><body>not a pdf at all</body></html>');

      await expect(
        service.upload('company-1', { fileName: 'invoice.pdf', mime: 'application/pdf', bytes }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a file over the size limit, named', async () => {
      const bytes = fakeScannedPdfBytes('a'.repeat(MAX_RECEIVED_INVOICE_BYTES + 1));

      await expect(
        service.upload('company-1', { fileName: 'big.pdf', mime: 'application/pdf', bytes }),
      ).rejects.toThrow(PayloadTooLargeException);
    });

    it('strips a path from an uploaded filename before it is ever stored', async () => {
      const bytes = Buffer.from(MINIMAL_CII_XML, 'utf-8');

      const preview = await service.upload('company-1', {
        fileName: '../../etc/passwd.xml',
        mime: 'application/xml',
        bytes,
      });

      expect(preview.fileName).toBe('passwd.xml');
    });

    it('strips control characters from an uploaded filename before it is ever stored', async () => {
      const bytes = Buffer.from(MINIMAL_CII_XML, 'utf-8');

      const preview = await service.upload('company-1', {
        fileName: 'invoice\u0000.xml',
        mime: 'application/xml',
        bytes,
      });

      expect(preview.fileName).toBe('invoice.xml');
    });
  });

  /**
   * Supplier reconciliation "at upload", proven end-to-end through the REAL `upload()` pipeline: real
   * Prisma for the Client/PartyIdentifier side (this file's own `vi.mock('../persistence')` only
   * ever touched `DocumentInstance` reads/writes, never this) — see `supplier-reconciliation.spec.ts`
   * for the exhaustive matching-rule coverage (ambiguity, companyId scoping, name fallback); this
   * describe only proves the WIRING: a real VAT in a real deposit reaches a real Client and comes back
   * as `fields.supplierClient` + `supplierMatch`, exactly the shape the frontend's own
   * `buildInitialData` (received-invoice-upload-button.tsx) already spreads verbatim.
   */
  describe('upload — supplier reconciliation', () => {
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
      const bytes = Buffer.from(ciiXmlWithSellerVat(KNOWN_VAT), 'utf-8');

      const preview = await service.upload(companyId, {
        fileName: 'known-supplier.xml',
        mime: 'application/xml',
        bytes,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'matched', clientId, matchedBy: 'vat' });
      expect(preview.extraction.fields.supplierClient).toBe(clientId);
      // The free-text `supplier` name is untouched — it stays whatever the seller's OWN document
      // said, independent from the linked Client's own registered name (see the descriptor's header).
      expect(preview.extraction.fields.supplier).toBe('Fournisseur Test SARL');
    });

    it('a deposit whose seller VAT matches NOTHING never links — no client created, field left empty', async () => {
      const bytes = Buffer.from(ciiXmlWithSellerVat('FR99988877701'), 'utf-8');

      const preview = await service.upload(companyId, {
        fileName: 'unknown-supplier.xml',
        mime: 'application/xml',
        bytes,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'unmatched', reason: 'not-found' });
      expect(preview.extraction.fields.supplierClient).toBeUndefined();

      // No client was silently created for the unmatched vendor.
      const clientsAfter = await prisma.client.count({ where: { companyId } });
      expect(clientsAfter).toBe(1);
    });

    it('a deposit with no VAT and no name match at all is reported "no-criteria" once extraction itself yields nothing', async () => {
      const bytes = fakeScannedPdfBytes('just some scanned text');

      const preview = await service.upload(companyId, {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        bytes,
      });

      expect(preview.supplierMatch).toEqual({ outcome: 'unmatched', reason: 'no-criteria' });
    });
  });

  /**
   * The enqueue-vs-synchronous DECISION `upload()` makes — see that method's own comment for the exact
   * three-part rule. Proves the WIRING only: `ReceivedInvoiceOcrDispatcher.enqueue` called with the
   * right data (and `extract()` never called during the request) when a configured extractor exists;
   * the pre-existing synchronous outcome otherwise. The actual OCR-execution-and-backfill logic — an
   * OCR proposal reaching `extraction.fields`, supplier reconciliation over an OCR-read VAT, the
   * total-vs-sum check accepting OCR-sourced lines — moved to `ocr/run-ocr-job.spec.ts`, since none of
   * it happens inside THIS service any more once an extractor is configured.
   */
  describe('upload — asynchronous OCR', () => {
    const STUB_ID = 'stub-ocr-for-received-invoices-service-spec';
    const isConfigured = vi.fn();
    const extract = vi.fn();

    beforeAll(() => {
      // ONE stub, registered once — the registry has no `unregister` (see `extractor.ts`'s own
      // header). Placed in THIS describe block's own `beforeAll` (which Vitest runs right before this
      // block's first test, never at file load time) so every describe block ABOVE this one in the
      // file still runs with nothing registered for 'application/pdf', exactly as before this change.
      receivedDocumentExtractorRegistry.register({
        id: STUB_ID,
        supports: (mime) => mime === 'application/pdf',
        isConfigured,
        extract,
      });
    });

    beforeEach(() => {
      isConfigured.mockReset();
      extract.mockReset();
    });

    it('enqueues and returns ocr: "pending" when a configured extractor exists — never calls extract() during the request', async () => {
      isConfigured.mockReturnValue(true);
      const bytes = fakeScannedPdfBytes('a scanned page, no embedded XML at all');
      const expectedHash = computeArtifactHash(bytes);

      const preview = await service.upload('company-1', {
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        bytes,
      });

      expect(preview).toEqual({
        fileRef: expectedHash,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
        extraction: { syntax: null, fields: {} },
        supplierMatch: { outcome: 'unmatched', reason: 'no-criteria' },
        ocr: { outcome: 'pending' },
      });
      expect(ocrDispatcher.enqueue).toHaveBeenCalledWith({
        companyId: 'company-1',
        fileRef: expectedHash,
        fileName: 'scan.pdf',
        mime: 'application/pdf',
      });
      expect(extract).not.toHaveBeenCalled();
    });

    it('runs OCR synchronously — immediate "unavailable", never enqueues — when the registered extractor reports itself unconfigured', async () => {
      // The self-hosted-with-nothing-configured case, reproduced through the SAME shape
      // `LocalOcrProvider.isConfigured()` uses (an extractor genuinely registered, `extract()` itself
      // declining with `ExtractorNotReadyError`) rather than nothing registered at all — proving the
      // GATE, not merely the absence.
      isConfigured.mockReturnValue(false);
      extract.mockRejectedValue(new ExtractorNotReadyError(STUB_ID, 'not configured'));
      const bytes = fakeScannedPdfBytes('another scanned page');

      const preview = await service.upload('company-1', {
        fileName: 'scan-2.pdf',
        mime: 'application/pdf',
        bytes,
      });

      expect(preview.ocr).toEqual({ outcome: 'unavailable' });
      expect(preview.extraction).toEqual({ syntax: null, fields: {} });
      expect(extract).toHaveBeenCalled();
      expect(ocrDispatcher.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('downloadFile', () => {
    it('reads back exactly what was persisted for an owned document', async () => {
      // A real-shaped SHA-256 (64 lowercase hex characters) — storage.ts's own `inboundPath` now
      // rejects anything else as an invalid content hash before it ever becomes a filesystem path.
      const fileRef = 'a'.repeat(64);
      await persistInboundFile(
        'company-1',
        fileRef,
        'application/pdf',
        new TextEncoder().encode('the pdf bytes'),
      );
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
        id: 'ri-1',
        typeId: 'received-invoice',
        status: 'received',
        data: { fileRef, fileName: 'invoice.pdf', fileMime: 'application/pdf' },
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
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
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
      (persistence.findOwnedDocument as Mock).mockResolvedValue({
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
