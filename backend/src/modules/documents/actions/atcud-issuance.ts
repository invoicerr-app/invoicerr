/**
 * Portugal's ATCUD — the DB-touching orchestration `numbering/atcud.ts`'s pure functions are wired
 * into. Two entry points, both invoice-only (`invoice-actions.ts` is the sole caller of either).
 * "credit-note" DOES declare `numbering` now (issue #471: CGI art. 289, I, 5 requires a French
 * credit note to carry a sequential number, and country-policy/data/pt.json's own numbering fact says
 * Portugal requires one too, CIVA art. 36.º n.º 6) but deliberately still does NOT get an ATCUD  -
 * extending `ATCUD_TYPE_ID` below to a second type is out of scope for that issue (see this file's
 * own `ATCUD_TYPE_ID` comment, and country-policy/data/pt.json's numbering fact for the honest gap
 * this leaves): `credit-note-actions.ts` never wires `onNumbered` at all, so
 * `attachAtcudToNumberedInvoice` is never even reachable for a credit note, and its "send" carries no
 * `preflight` that calls `ensureAtcudIssuable` either - a Portuguese credit note is numbered but never
 * throws for lack of an ATCUD, since nothing here ever asks it to have one.
 *
 *  - `ensureAtcudIssuable` — the PREFLIGHT gate, run from the invoice "send" action's own preflight
 *    (`invoice-actions.ts`), BEFORE the record ever leaves "draft"/"send_failed" and BEFORE
 *    `numbering/take-number.ts` ever spends a sequence number. This is the LOAD-BEARING check: this
 *    codebase's own numbering never hands a number back once taken (`numbering/sequence.ts`'s own
 *    header, "never waste a number"), so whatever can still refuse the whole issuance must run first —
 *    the exact same posture `tax/resolve-invoice-tax.ts`'s own named hard blocks already hold for an
 *    unresolved buyer/seller country.
 *  - `attachAtcudToNumberedInvoice` — wired as `async-send.ts`'s `onNumbered` hook, run immediately
 *    after a real number is taken. Reads the FROZEN `displayNumber` numbering just produced (never
 *    re-predicts one) and persists `DocumentInstance.atcud`. A pure re-check of what
 *    `ensureAtcudIssuable` already approved — see its own header for why it therefore never throws.
 *
 * Both are no-ops for every company whose resolved country is not Portugal — a single
 * `resolveCompanyCountryCode` call, no further reads, no further writes. This is what
 * `documents.service.invoice.spec.ts`'s "a non-Portuguese invoice's output is byte-for-byte unchanged"
 * coverage actually rests on: neither function does anything else before that check.
 */
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { resolveNumberFormat } from '../numbering/format-number';
import {
  AtcudFormatIncompatibleError,
  computeAtcud,
  parseAtcudPattern,
  renderAtcudSeriesId,
  splitAtcudDisplayNumber,
} from '../numbering/atcud';
import { TakenDocumentNumber } from '../numbering/sequence';

/** The only DocumentTypeDescriptor this branch declares BOTH `numbering` AND a fiscally-relevant PT
 *  document — see `numbering/atcud.ts`'s own header. Kept as a named constant, not sprinkled as a
 *  string literal, so a future second ATCUD-eligible type is a one-line change here, never a search-
 *  and-replace across this file. */
const ATCUD_TYPE_ID = 'invoice';

/** Thrown by `ensureAtcudIssuable` when the predicted series has no AT validation code registered yet
 *  (company settings) — AT FAQ 4308/4312, quoted verbatim in country-policy/data/pt.json: a code must
 *  be associated with a series BEFORE any document in it is issued. */
export class AtcudValidationCodeMissingError extends Error {}

/** Every NAMED hard-block this file can throw — `invoice-actions.ts`'s own preflight turns either into
 *  a 400: a data problem the user can fix (a bad number format, a code not yet registered), never a
 *  500. Mirrors `tax/resolve-invoice-tax.ts#isInvoiceTaxBlockError` exactly, one file over. */
export function isAtcudBlockError(error: unknown): error is Error {
  return error instanceof AtcudFormatIncompatibleError || error instanceof AtcudValidationCodeMissingError;
}

/**
 * The PREFLIGHT gate — see this file's own header. `now` defaults to `new Date()`, the SAME "now" the
 * numbering step itself will use moments later (`numbering/take-number.ts#takeDocumentNumber`'s own
 * `issuedAt` default) — a parameter only so a test can pin it, never passed a different value by any
 * real caller.
 */
export async function ensureAtcudIssuable(companyId: string, now: Date = new Date()): Promise<void> {
  const countryCode = await resolveCompanyCountryCode(companyId);
  if (countryCode !== 'PT') return;

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { numberFormats: true },
  });
  const pattern = resolveNumberFormat(
    company?.numberFormats as Record<string, unknown> | null,
    ATCUD_TYPE_ID,
  );

  const shape = parseAtcudPattern(pattern);
  if (!shape) {
    throw new AtcudFormatIncompatibleError(
      `This company's Portuguese "${ATCUD_TYPE_ID}" number format ("${pattern}") cannot produce a ` +
        'lawful ATCUD sequential number — Portaria n.º 195/2020, art. 3.º n.º 3 requires the document ' +
        'number to end in a literal "/" immediately followed by the sequential digits (a "{number}" or ' +
        '"{number:N}" token), with nothing after them. Reconfigure the invoice number format in company ' +
        'settings — e.g. "FT {year}/{number:4}" — before issuing.',
    );
  }

  const seriesId = renderAtcudSeriesId(shape.seriesTemplate, now);
  const series = await prisma.companyAtcudSeries.findUnique({
    where: { companyId_typeId_seriesId: { companyId, typeId: ATCUD_TYPE_ID, seriesId } },
  });
  if (!series) {
    throw new AtcudValidationCodeMissingError(
      `No AT validation code is registered for the invoice series "${seriesId}" — Portaria n.º ` +
        '195/2020 requires this code to be obtained from the Portal das Finanças and associated with ' +
        'the series BEFORE any document in it is issued (AT FAQ 4308). Add it in company settings ' +
        '("ATCUD series") before sending this invoice.',
    );
  }
}

/**
 * Computes and freezes the ATCUD onto a JUST-numbered invoice — see this file's own header, second
 * bullet, for why this never throws: `ensureAtcudIssuable` above is the load-bearing check, this is a
 * defensive re-confirmation of what it already approved, running AFTER a sequence number this
 * codebase can never hand back has already been spent (`numbering/sequence.ts`'s own "never waste a
 * number" header). Any failure here is logged loudly instead — the invoice still sends, printing
 * without an ATCUD, which `documents.service.invoice.spec.ts` covers as the honest degraded outcome —
 * never a silently wrong one.
 */
export async function attachAtcudToNumberedInvoice(
  companyId: string,
  documentId: string,
  numbered: TakenDocumentNumber,
): Promise<void> {
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    if (countryCode !== 'PT') return;

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { numberFormats: true },
    });
    const pattern = resolveNumberFormat(
      company?.numberFormats as Record<string, unknown> | null,
      ATCUD_TYPE_ID,
    );
    const { seriesId, sequentialNumber } = splitAtcudDisplayNumber(numbered.displayNumber, pattern);

    const series = await prisma.companyAtcudSeries.findUnique({
      where: { companyId_typeId_seriesId: { companyId, typeId: ATCUD_TYPE_ID, seriesId } },
    });
    if (!series) {
      throw new AtcudValidationCodeMissingError(
        `No AT validation code registered for invoice series "${seriesId}" at attach time.`,
      );
    }

    const atcud = computeAtcud(series.validationCode, sequentialNumber);
    await prisma.documentInstance.update({ where: { id: documentId }, data: { atcud } });
  } catch (error) {
    logger.error(
      'Failed to attach the ATCUD to a numbered Portuguese invoice — it will print without one. The ' +
        'invoice "send" preflight (ensureAtcudIssuable) should have already refused this case; reaching ' +
        "here means the company's number format or AT validation code changed in the narrow gap " +
        'between that check and numbering.',
      {
        category: 'documents',
        details: {
          companyId,
          documentId,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}
