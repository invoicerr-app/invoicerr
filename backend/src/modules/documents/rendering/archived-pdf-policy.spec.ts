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
    it('invoice: every status but "draft"', () => {
      expect([...issuedStatusesOf(buildInvoiceDescriptor())].sort()).toEqual(
        ['cancelled', 'send_failed', 'sending', 'sent'].sort(),
      );
    });

    it('credit note: every status but "draft"', () => {
      expect([...issuedStatusesOf(buildCreditNoteDescriptor())].sort()).toEqual(
        ['send_failed', 'sending', 'sent'].sort(),
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
