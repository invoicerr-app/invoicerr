import { hashDocumentData } from '../archive/document-data-hash';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { buildPurchaseOrderDescriptor } from '../descriptors/purchase-order.descriptor';
import { buildQuoteDescriptor } from '../descriptors/quote.descriptor';
import { isArchivedPdfServable, issuedStatusesOf } from './archived-pdf-policy';

/**
 * Issue #490 - the rule `renderInstancePdf` applies before serving an archived PDF. The statuses
 * asserted below are the ones this file's header documents: if a descriptor's save-draft lock
 * changes, this spec is where the documented list has to be brought back in line.
 */
describe('archived-pdf-policy (issue #490)', () => {
  describe('issuedStatusesOf - derived from each type\'s own "save-draft" lock', () => {
    // "imported" (issue #340) belongs in both lists below: it is a status "save-draft" locks, exactly
    // like "sent" or "signed" - an imported document's content can never change again either, so it
    // genuinely IS issued. What differs is which archive is the legal copy for it: never a DELIVERY
    // archive (an imported document was never sent BY THIS APPLICATION, so it never gets one), always
    // the IMPORT_ORIGINAL archive written at import time. `isArchivedPdfServable` below only ever
    // answers a question about a DELIVERY archive that already exists, so it is never even asked one
    // for an imported document - `documents.service.ts#renderInstancePdf` resolves "imported" against
    // `archive/persistence.ts#findImportOriginalArtifact` FIRST, before this policy runs at all. Kept
    // in these two lists rather than excluded from them: excluding it would say the content CAN still
    // change, which is false, and would be the wrong reason to reach the right serving behavior.
    it('invoice: every status but "draft"', () => {
      // Issue #581 added "validated" (numbered and locked without sending) to this list: "save-draft"
      // locks it exactly like every other post-draft status, so its archived PDF is the legal copy too.
      expect([...issuedStatusesOf(buildInvoiceDescriptor())].sort()).toEqual(
        ['cancelled', 'imported', 'send_failed', 'sending', 'sent', 'validated'].sort(),
      );
    });

    it('credit note: every status but "draft"', () => {
      expect([...issuedStatusesOf(buildCreditNoteDescriptor())].sort()).toEqual(
        ['imported', 'send_failed', 'sending', 'sent'].sort(),
      );
    });

    it('quote: "signed" and "accepted" only ("sent" stays editable, so it is not issued)', () => {
      expect([...issuedStatusesOf(buildQuoteDescriptor())].sort()).toEqual(['accepted', 'signed']);
    });

    it('a type whose save-draft locks nothing (purchase order): none', () => {
      expect(issuedStatusesOf(buildPurchaseOrderDescriptor())).toEqual([]);
    });
  });

  describe('isArchivedPdfServable', () => {
    const quote = buildQuoteDescriptor();
    const data = { client: 'c', lines: [{ description: 'a', unitPrice: 1 }] };

    it('serves an archive rendered from the current data, whatever the key order jsonb hands back', () => {
      const reordered = { lines: [{ unitPrice: 1, description: 'a' }], client: 'c' };
      expect(
        isArchivedPdfServable({
          descriptor: quote,
          status: 'draft',
          currentData: reordered,
          archivedDataHash: hashDocumentData(data),
        }),
      ).toBe(true);
    });

    it('refuses an archive rendered from other data on an unissued document', () => {
      expect(
        isArchivedPdfServable({
          descriptor: quote,
          status: 'draft',
          currentData: { ...data, client: 'd' },
          archivedDataHash: hashDocumentData(data),
        }),
      ).toBe(false);
    });

    it('refuses an archive with no recorded hash on an unissued document', () => {
      expect(
        isArchivedPdfServable({
          descriptor: quote,
          status: 'sent',
          currentData: data,
          archivedDataHash: null,
        }),
      ).toBe(false);
    });

    it('serves any archive of an issued document, matching or not, hash recorded or not', () => {
      const invoice = buildInvoiceDescriptor();
      for (const archivedDataHash of [null, hashDocumentData({ other: true })]) {
        expect(
          isArchivedPdfServable({ descriptor: invoice, status: 'sent', currentData: data, archivedDataHash }),
        ).toBe(true);
      }
    });
  });
});
