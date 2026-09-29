/**
 * Wire shapes for importing a document issued by a previous tool (issue #340), shared by the
 * single-document endpoint (`document-import.controller.ts`) and the CSV bulk import
 * (`document-import-csv.service.ts`), both of which funnel into the same
 * `document-import.service.ts#importDocument` core.
 */

/** The two types v1 of #340 covers (the owner's own decision): "v1 scope: invoices and credit
 *  notes ... Importing from the official original ... is a later step." */
export type ImportableTypeId = 'invoice' | 'credit-note';

export function isImportableTypeId(value: unknown): value is ImportableTypeId {
  return value === 'invoice' || value === 'credit-note';
}

/** The original file reference, the SAME `{ fileRef, fileName, mime }` shape
 *  `attachments.service.ts#AttachmentRef` already returns from `POST /documents/attachments/upload`,
 *  reused verbatim rather than inventing a second upload contract. */
export interface ImportOriginalFileRef {
  fileRef: string;
  fileName: string;
  mime: string;
}

/**
 * Evidence that the PREVIOUS tool actually transmitted this document to the authority its country
 * requires (the owner's own decision): "when missing, the import is accepted with a visible,
 * lasting warning". Every field optional: a document genuinely never transmitted has none of them,
 * and that absence IS the fact this type lets the rest of the app observe
 * (`hasTransmissionEvidence` below).
 */
export interface ImportTransmissionEvidence {
  /** Italy - the SdI's own identifiant/ricevuta id for the deposit (free text: this app never
   *  re-verifies it against the SdI, it is a declared historical fact). */
  sdiId?: string;
  /** Poland - the KSeF number the previous tool's own submission was assigned. Stored so a LATER
   *  correction (a KOR, `formats/national/fa3-kor.ts`) can cite it, per art. 106j ust. 2 pkt 2a
   *  ustawy o VAT - see `document-import.service.ts`'s own header for how this is wired into the
   *  SAME `DocumentAuthorityEvent` journal a real KSeF submission would have written. */
  ksefNumber?: string;
  /** France - the accredited platform (PA) reference for the transmission, when the previous tool
   *  used one. */
  paReference?: string;
  /** Portugal - the FULL ATCUD as printed on the original document (e.g. "ATCUD:XXXXXXXX-1"),
   *  frozen straight onto `DocumentInstance.atcud` - see that column's own schema comment for why an
   *  ATCUD, once set, is never recomputed. */
  atcud?: string;
}

export function hasTransmissionEvidence(evidence: ImportTransmissionEvidence | undefined): boolean {
  if (!evidence) return false;
  return Boolean(
    evidence.sdiId?.trim() ||
      evidence.ksefNumber?.trim() ||
      evidence.paReference?.trim() ||
      evidence.atcud?.trim(),
  );
}

export interface ImportDocumentInput {
  companyId: string;
  typeId: ImportableTypeId;
  /** The document's own business fields (client, issueDate, dueDate, currency, notes,
   *  clientReference, lines for invoice, or invoice, correctedLines, lines, reason for credit note),
   *  validated against exactly the same company-resolved descriptor `POST .../save-draft` already
   *  validates against (see `document-import.service.ts`'s own header). */
  data: Record<string, unknown>;
  /** The number as the previous tool printed it, kept verbatim - becomes `displayNumber`. Never
   *  reformatted, never checked against this company's own number-format pattern: it was never
   *  issued by this company's own running series (`DocumentInstance.number` stays null - the
   *  counter is never consumed, see `numbering/`'s own comment on `number`). */
  originalNumber: string;
  transmissionEvidence: ImportTransmissionEvidence;
  originalFile: ImportOriginalFileRef;
}

export interface ImportDocumentResult {
  id: string;
  typeId: ImportableTypeId;
  status: 'imported';
  displayNumber: string;
  transmitted: boolean;
}
