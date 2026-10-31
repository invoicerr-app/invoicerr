/**
 * What a CREDIT NOTE hands a format provider, plus the facts that make the file a credit note
 * (`DocumentFormatBuildOptions.creditNote` - BT-3 381 and, for a linked note, BG-3 in EN 16931; TD04
 * and `DatiFattureCollegate` in FatturaPA). A linked note is resolved from the invoice it corrects; a
 * free one from its own client and lines.
 *
 * ## Why the invoice's descriptor prices a credit note
 *
 * A LINKED credit note owns no amounts of its own: `correctedLines` is a `rowSelection`, a pointer at
 * rows of the corrected invoice's own `lines` (`credit-note.descriptor.ts`, "Two shapes, one type").
 * The amount it credits is defined in one place, `totals/linked-credit-note.ts` (issue #507): those
 * selected rows, priced with the INVOICE's own descriptor (which is what makes the invoice's per-line
 * `discountPercent` count - the credit note's own `lines` subfields declare no discount). This file
 * builds the XML from that same source, so the total a credit-note XML declares (BT-112/BT-115,
 * `ImportoTotaleDocumento`) is, to the cent, the amount settlement subtracts from the invoice and the
 * total the PDF prints. A second pricing path would be a second answer to the same question.
 *
 * ## What is refused, and why
 *
 *  - A corrected invoice with no number of its own. BG-3's BT-25 is 1..1 inside BG-3, and a reference
 *    to "an invoice" with no number is not the "référence à la facture initiale de façon spécifique et
 *    non équivoque" CGI art. 289, I, 5 asks of a correcting document. A FREE credit note emits no
 *    BG-3 at all, so this refusal only applies to the linked shape.
 *  - The credit note's own missing number is refused by `shared-build.ts#requireDisplayNumber` and by
 *    `documents.service.ts#downloadDocumentFormat`'s own gate, not here.
 *
 * A FREE credit note (no `invoice`) is priced from its OWN `lines`, and its buyer is its own `client`
 * (both declared by `credit-note.descriptor.ts`), so it needs no corrected invoice to build a file.
 */
import { BadRequestException } from '@nestjs/common';

import { DocumentInstanceResult } from '../actions/action-registry';
import { buildCreditNoteDescriptor } from '../descriptors/credit-note.descriptor';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { resolveLinkedCreditNote } from '../totals/linked-credit-note';
import { resolveInvoiceCrossBorderTaxForCompany } from '../tax/load-and-resolve';
import { isInvoiceTaxBlockError } from '../tax/resolve-invoice-tax';
import { TransportFormatSource } from '../transports/transport-registry';
import { CorrectedInvoiceReference } from './format-provider';
import { toDateOnly } from './shared-build';

export interface CreditNoteFormatSource {
  /** The INVOICE descriptor - see this file's own header, "Why the invoice's descriptor". */
  pricingDescriptor: DocumentTypeDescriptor;
  /**
   * Invoice-shaped data for the build: the corrected invoice's selected lines and client, the
   * credit note's OWN issue date, currency and notes. In memory only, never persisted.
   */
  pricingData: Record<string, unknown>;
  /** The date cross-border tax is resolved against (`documents.service.ts#downloadDocumentFormat`):
   *  the corrected invoice's own issue date for a linked note (a reduction follows the tax treatment
   *  of the supply it reduces), the note's own date for a free one. */
  correctedInvoiceIssueDate: unknown;
  /** Absent for a FREE credit note: there is no preceding invoice to reference (BG-3). */
  correctedInvoice?: CorrectedInvoiceReference;
}

/**
 * Issue #507: the pricing itself (which rows, which descriptor, which currency) is
 * `totals/linked-credit-note.ts`, the one rule the PDF, the email, the totals card, the list row and
 * settlement also read. This function only adds what an electronic file needs on top of it: the three
 * refusals in this file's own header.
 */
export async function resolveCreditNoteFormatSource(
  companyId: string,
  creditNote: Pick<DocumentInstanceResult, 'data'>,
): Promise<CreditNoteFormatSource> {
  const data = (creditNote.data ?? {}) as Record<string, unknown>;
  const linked = await resolveLinkedCreditNote(companyId, data);
  if (!linked) {
    // A free credit note prices itself and names its own client, so it needs no corrected invoice.
    return {
      pricingDescriptor: buildCreditNoteDescriptor(),
      pricingData: data,
      correctedInvoiceIssueDate: data.issueDate,
    };
  }

  if (!linked.invoice.displayNumber) {
    throw new BadRequestException(
      'Cannot build an electronic credit note: the invoice it corrects has no number of its own, so ' +
        'the mandatory reference to it (EN 16931 BG-3/BT-25) cannot be written.',
    );
  }

  const lines = linked.pricingData.lines as unknown[];
  if (lines.length === 0) {
    throw new BadRequestException(
      'Cannot build an electronic credit note: none of the lines it corrects exist on the invoice any ' +
        'more, so it would credit nothing.',
    );
  }

  return {
    pricingDescriptor: linked.pricingDescriptor,
    pricingData: linked.pricingData,
    correctedInvoiceIssueDate: linked.invoiceIssueDate,
    correctedInvoice: {
      displayNumber: linked.invoice.displayNumber,
      issueDate: toDateOnly(linked.invoiceIssueDate),
    },
  };
}

/**
 * Issue #499 - the credit note's electronic form as a TRANSPORT builds it at issuance: the same source
 * as its "download-xml" above, with the cross-border tax treatment resolved the same way
 * `documents.service.ts#downloadDocumentFormat` resolves it (against the corrected invoice's own
 * issue date, then the credit note's own date put back for BT-2), so the file a platform receives and
 * the file the download serves are built from identical data. A tax hard block (unresolved buyer
 * country...) is a 400 naming the reason, as it is for the invoice's own send
 * (`invoice-actions.ts#runInvoiceCrossBorderTaxPreflight`).
 *
 * `document` keeps the credit note's own id and number; only its `data` is the invoice-shaped build
 * input. `humanReadable` is the credit note itself, so a Factur-X embeds the credit note's own page
 * (issue #472), never a rendering of the invoice-shaped data.
 */
export async function resolveCreditNoteDeliverySource(
  companyId: string,
  creditNote: DocumentInstanceResult,
  creditNoteDescriptor: DocumentTypeDescriptor,
): Promise<TransportFormatSource> {
  const source = await resolveCreditNoteFormatSource(companyId, creditNote);
  let resolvedData: Record<string, unknown>;
  try {
    resolvedData = (
      await resolveInvoiceCrossBorderTaxForCompany(companyId, {
        ...source.pricingData,
        issueDate: source.correctedInvoiceIssueDate,
      })
    ).data;
  } catch (error) {
    if (isInvoiceTaxBlockError(error)) throw new BadRequestException(error.message);
    throw error;
  }
  return {
    descriptor: source.pricingDescriptor,
    document: { ...creditNote, data: { ...resolvedData, issueDate: source.pricingData.issueDate } },
    options: {
      creditNote: source.correctedInvoice ? { correctedInvoice: source.correctedInvoice } : {},
      humanReadable: { descriptor: creditNoteDescriptor, document: creditNote },
    },
  };
}
