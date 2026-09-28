/**
 * The orchestration `documents.service.ts`'s `runAction` actually calls - resolves the number FORMAT
 * that applies to this company's next document of this type (issue #496: the country's own format
 * from `country-policy`, or the company's running series, see `company-number-format.ts`), and only
 * THEN asks `sequence.ts` for a real number, checked against the country's constraints before it is
 * committed. Kept as its own file (not inlined into `sequence.ts` or
 * `documents.service.ts`) for the same reason `country-policy.ts` and `country-policy/schema.ts` stay
 * separate: `sequence.ts` should not need to know Company has a `numberFormats` column at all, and
 * `documents.service.ts`'s own tests mock this ONE function wholesale (the same discipline they
 * already hold for `./persistence` and `./country-policy/country-policy`) rather than reaching past
 * it into Prisma or the sequence internals.
 */
import { DocumentInstanceResult } from '../actions/action-registry';
import {
  assertNumberSatisfies,
  issuedAtFrom,
  periodKeyFor,
  resolveCompanyNumberFormat,
} from './company-number-format';
import { TakenDocumentNumber, takeDocumentNumber, takeDocumentNumberWithStatusTransition } from './sequence';

/**
 * Takes the next number for `(companyId, typeId)` and writes it onto `documentId` — see sequence.ts's
 * `takeDocumentNumber` for the atomicity/never-waste guarantee this only adds a format lookup in
 * front of. Resolving the format (`resolveCompanyNumberFormat` throws for a company whose country has
 * none) HAPPENS BEFORE any sequence number is touched, deliberately: a missing format must never cost
 * this company a wasted number, only refuse the request that would have used it.
 *
 * Returns `undefined` in the same case `takeDocumentNumber` itself does (the document already carries
 * a number — see that function's own header) — never called at all by `runAction` unless it has
 * already checked `number == null` in memory first, but this stays a real, DB-level guard regardless.
 *
 * `data` (issue #515) — whatever the caller already has for this document (its own
 * `DocumentInstanceResult.data`, typically), read ONLY for the `issueDate` field `issuedAtFrom`
 * extracts from it: the moment `{year}` is rendered from, and the moment `periodKeyFor` keys a
 * `reset: "yearly"` counter by — never the server clock this function happens to run at. Optional,
 * defaulting to "now" through `issuedAtFrom(undefined)`, for the one caller
 * (`send-document-email.ts`) that reaches this function as a defensive fallback on an already-numbered
 * document, where the value can never actually matter (see that call site's own header).
 */
export async function takeDocumentNumberForTransition(
  companyId: string,
  typeId: string,
  documentId: string,
  data?: unknown,
): Promise<TakenDocumentNumber | undefined> {
  const resolved = await resolveCompanyNumberFormat(companyId, typeId);
  const issuedAt = issuedAtFrom(data);

  return takeDocumentNumber(
    companyId,
    typeId,
    documentId,
    { pattern: resolved.pattern, check: assertNumberSatisfies(resolved) },
    issuedAt,
    periodKeyFor(resolved, issuedAt),
  );
}

/**
 * The atomic sibling of `takeDocumentNumberForTransition` above - same format-resolution-first
 * discipline (a bad pattern refuses the whole call before anything is written, never after the
 * status has already moved), but wraps `sequence.ts#takeDocumentNumberWithStatusTransition` instead
 * of `takeDocumentNumber`: the "draft"/"send_failed" -> "sending" write and the numbering write land
 * as ONE transaction, closing the gap PR #473's review point 1 named (see that function's own header
 * for the full "why"). `actions/async-send.ts`'s phase-1 branch calls this INSTEAD OF
 * `persistence.ts#upsertDocument` whenever this call is actually eligible to number the record
 * (`numberOnEnqueue && isNumberingAllowedFrom(...)` - computed by the caller, this function has no
 * opinion of its own about `onlyFrom`), never both.
 *
 * `numbered` can come back `undefined` (PR #473 review point 2, round 2): the caller's own
 * eligibility check reads a pre-transaction snapshot that can go stale under a genuine race (see
 * `sequence.ts#takeDocumentNumberWithStatusTransition`'s own header) - the status transition still
 * lands, but nothing is renumbered when the row already carries a number by the time this runs.
 *
 * `issuedAt` (issue #515) is read straight from `data.issueDate` (`issuedAtFrom`) - the SAME `data`
 * this call is about to write onto the document, so there is no separate value to keep in sync: the
 * date a `reset: "yearly"` counter keys by is exactly the date the record will show as its own
 * `issueDate` once this transaction commits.
 */
export async function takeDocumentNumberForTransitionWithStatus(
  companyId: string,
  typeId: string,
  documentId: string,
  fromStatuses: string[],
  toStatus: string,
  data: Record<string, unknown>,
): Promise<{ document: DocumentInstanceResult; numbered: TakenDocumentNumber | undefined }> {
  const resolved = await resolveCompanyNumberFormat(companyId, typeId);
  const issuedAt = issuedAtFrom(data);

  return takeDocumentNumberWithStatusTransition(
    companyId,
    typeId,
    documentId,
    fromStatuses,
    toStatus,
    data,
    { pattern: resolved.pattern, check: assertNumberSatisfies(resolved) },
    issuedAt,
    periodKeyFor(resolved, issuedAt),
  );
}
