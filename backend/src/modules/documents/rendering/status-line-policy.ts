import { DocumentTypeDescriptor } from '../descriptors/types';
import { issuedStatusesOf } from './archived-pdf-policy';

/**
 * Issue #494: when a rendered PDF prints the document's "Status: <status>" line.
 *
 * ## Why a delivered PDF prints no status at all
 *
 * The PDF a send delivers is rendered inside `deliver()` (`actions/async-send.ts`), while the record
 * is still "sending": it used to print "Status: sending". That PDF is the copy the client keeps, the
 * DELIVERY archive an e-signature is bound to (#477) and what the download serves once the document is
 * issued (#490). Two replacements were possible, and only one holds:
 *  - "the status the document is being sent into" ("sent") is not true when the bytes are rendered:
 *    they are rendered BEFORE `deliver()` has reached anyone, and a delivery that fails leaves the
 *    record "send_failed" while a retry delivers bytes rendered the same way. Even once true, it does
 *    not stay true: an invoice is later cancelled, a quote later signed, accepted or refused, and the
 *    copy the client holds can never follow.
 *  - no status line: a frozen legal copy states only what stays true of it. A workflow status is not
 *    an item of the invoice content Directive 2006/112/EC art. 226 lists (and all five supported
 *    countries transpose); number, dates, parties, amounts and mentions are, and they are printed
 *    elsewhere, unchanged. The printed value was also the raw internal id ("sending",
 *    "send_failed"), never a translated label.
 * So a delivered PDF prints no status line, for every type.
 *
 * ## Which renders still print it
 *
 * A working copy: a render on demand (download, share link, portal, ZIP export) of a document that is
 * NOT issued, where "Status: draft" warns whoever holds the file that it is not the document the
 * client will receive. A render on demand of an ISSUED document (`issuedStatusesOf`, the same list
 * #490 serves the archive for) prints none either: it only happens when there is no archive to serve
 * (a credit note issued before issue #499, when its send archived nothing, or a document whose
 * archiving is still being retried), and it then stands in for the delivered copy, so it must read
 * the same.
 */
export type RenderPurpose =
  /** The bytes a send delivers and archives, and every legal e-invoice form built from them. */
  | 'delivery'
  /** A render on demand for someone who asked for the file. */
  | 'on-demand';

export function printsStatusLine(
  descriptor: DocumentTypeDescriptor,
  status: string,
  purpose: RenderPurpose,
): boolean {
  if (purpose === 'delivery') return false;
  return !issuedStatusesOf(descriptor).includes(status);
}
