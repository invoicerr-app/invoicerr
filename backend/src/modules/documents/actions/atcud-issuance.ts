/**
 * Portugal's ATCUD - the DB-touching orchestration `numbering/atcud.ts`'s pure functions are wired
 * into. Two entry points, each called by the "send" action of every type in
 * `numbering/atcud.ts#SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID`: the invoice (`invoice-actions.ts`) and, since
 * issue #497, the credit note (`credit-note-actions.ts`). See that table's own header for the legal
 * basis of the credit note's ATCUD (Decreto-Lei n.º 28/2019, art. 2.º c) ii) and 7.º n.º 3; Portaria
 * n.º 195/2020, art. 4.º n.º 1) and for why each type has its OWN series (Portaria n.º 195/2020, art.
 * 2.º b): the series is registered per SAF-T document type, "FT" or "NC"). Every lookup below is
 * therefore keyed by the document's own typeId: its own number format, its own registered series.
 *
 *  - `ensureAtcudIssuable` - the PREFLIGHT gate, run from the "send" action's own preflight
 *    (`invoice-actions.ts`, `credit-note-actions.ts`), BEFORE the record ever leaves "draft"/"send_failed" and BEFORE
 *    `numbering/take-number.ts` ever spends a sequence number. This is the LOAD-BEARING check: this
 *    codebase's own numbering never hands a number back once taken (`numbering/sequence.ts`'s own
 *    header, "never waste a number"), so whatever can still refuse the whole issuance must run first -
 *    the exact same posture `tax/resolve-invoice-tax.ts`'s own named hard blocks already hold for an
 *    unresolved buyer/seller country.
 *  - `attachAtcudToNumberedDocument` - wired as `async-send.ts`'s `onNumbered` hook, run immediately
 *    after a real number is taken. Reads the FROZEN `displayNumber` numbering just produced (never
 *    re-predicts one) and persists `DocumentInstance.atcud`. A pure re-check of what
 *    `ensureAtcudIssuable` already approved - see its own header for why it therefore never throws.
 *
 * Both are no-ops for every company whose resolved country has no "ATCUD" `documentValidationCode`
 * fact declared (issue #603 - `country-policy/schema.ts`'s own header, `countries/data/pt.json
 * (section "policy")`) - a `resolveCompanyCountryCode` call plus one in-memory catalog lookup, no
 * further reads, no further writes. Today only Portugal declares that fact, so this is behaviourally
 * identical to the `countryCode !== 'PT'` check it replaces. This is what
 * `documents.service.invoice.spec.ts`'s "a non-Portuguese invoice's output is byte-for-byte unchanged"
 * coverage actually rests on: neither function does anything else before that check.
 */
import { BadRequestException } from '@nestjs/common';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

import { resolveCompanyCountryCode } from '../country-policy/country-policy';
import { defaultCountryPolicyCatalog } from '../country-policy/registry';
import { resolveCompanyNumberFormat } from '../numbering/company-number-format';
import {
  AtcudFormatIncompatibleError,
  AtcudTypeId,
  computeAtcud,
  parseAtcudPattern,
  renderAtcudSeriesId,
  SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID,
  splitAtcudDisplayNumber,
} from '../numbering/atcud';
import { TakenDocumentNumber } from '../numbering/sequence';

/** How each ATCUD-eligible type is named in the messages below. */
const ATCUD_TYPE_LABEL: Record<AtcudTypeId, string> = {
  invoice: 'invoice',
  'credit-note': 'credit note',
};

/** Thrown by `ensureAtcudIssuable` when the predicted series has no AT validation code registered yet
 *  (company settings) - AT FAQ 4308/4312, quoted verbatim in countries/data/pt.json (section "policy"): a code must
 *  be associated with a series BEFORE any document in it is issued. */
export class AtcudValidationCodeMissingError extends Error {}

/** Every NAMED hard-block this file can throw - each "send" preflight turns either into a 400: a data
 *  problem the user can fix (a bad number format, a code not yet registered), never a 500. Mirrors
 *  `tax/resolve-invoice-tax.ts#isInvoiceTaxBlockError` exactly, one file over. */
export function isAtcudBlockError(error: unknown): error is Error {
  return error instanceof AtcudFormatIncompatibleError || error instanceof AtcudValidationCodeMissingError;
}

/**
 * The PREFLIGHT gate - see this file's own header. `now` defaults to `new Date()`, the SAME "now" the
 * numbering step itself will use moments later (`numbering/take-number.ts#takeDocumentNumber`'s own
 * `issuedAt` default) - a parameter only so a test can pin it, never passed a different value by any
 * real caller.
 */
export async function ensureAtcudIssuable(
  companyId: string,
  typeId: AtcudTypeId,
  now: Date = new Date(),
): Promise<void> {
  const countryCode = await resolveCompanyCountryCode(companyId);
  const documentValidationCode = defaultCountryPolicyCatalog.documentValidationCodeFor(countryCode ?? '');
  if (documentValidationCode?.scheme !== 'ATCUD') return;

  const label = ATCUD_TYPE_LABEL[typeId];
  // Issue #496: the format is Portugal's own (`countries/data/pt.json (section "policy")`: "FT A/{number}" for an
  // invoice, "NC A/{number}" for a credit note), or a series the company already started, which
  // `company-number-format.ts` keeps only while it satisfies pt.json's own "TYPE SERIES/NUMBER"
  // constraint - so the shape check below can only fail on a catalog error, never on a user choice.
  const { pattern } = await resolveCompanyNumberFormat(companyId, typeId);

  const shape = parseAtcudPattern(pattern);
  if (!shape) {
    throw new AtcudFormatIncompatibleError(
      `This company's Portuguese ${label} number format ("${pattern}") cannot produce a ` +
        'lawful ATCUD sequential number - Portaria n.º 195/2020, art. 3.º n.º 3 requires the document ' +
        'number to end in a literal "/" immediately followed by the sequential digits (a "{number}" or ' +
        '"{number:N}" token), with nothing after them. Number formats are defined per country ' +
        '(countries/data/pt.json (section "policy")), not by the company: this is a catalog error to report.',
    );
  }

  const seriesId = renderAtcudSeriesId(shape.seriesTemplate, now);
  const series = await prisma.companyAtcudSeries.findUnique({
    where: { companyId_typeId_seriesId: { companyId, typeId, seriesId } },
  });
  if (!series) {
    throw new AtcudValidationCodeMissingError(
      `No AT validation code is registered for the ${label} series "${seriesId}" ` +
        `(SAF-T document type ${SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID[typeId]}) - Portaria n.º 195/2020 requires ` +
        'this code to be obtained from the Portal das Finanças and associated with the series BEFORE any ' +
        `document in it is issued (AT FAQ 4308). Add it in company settings ("ATCUD series") before ` +
        `sending this ${label}.`,
    );
  }
}

/**
 * The "send" preflight both ATCUD-eligible types call: a no-op for every company whose resolved
 * country is not Portugal (`ensureAtcudIssuable`'s own first line), otherwise the LOAD-BEARING hard
 * block. It runs at the same preflight moment as the invoice's transport/mandate and cross-border-tax
 * checks, before the record is ever transitioned to "sending" and before `numberOnEnqueue` can spend
 * a sequence number this codebase can never hand back (numbering/sequence.ts's own "never waste a
 * number" header). `isAtcudBlockError` turns either named error (an incompatible number format, or a
 * validation code not yet registered for the predicted series) into a 400 the user can act on.
 */
export async function runAtcudPreflight(companyId: string, typeId: AtcudTypeId): Promise<void> {
  try {
    await ensureAtcudIssuable(companyId, typeId);
  } catch (error) {
    if (isAtcudBlockError(error)) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/**
 * Computes and freezes the ATCUD onto a JUST-numbered document - see this file's own header, second
 * bullet, for why this never throws: `ensureAtcudIssuable` above is the load-bearing check, this is a
 * defensive re-confirmation of what it already approved, running AFTER a sequence number this
 * codebase can never hand back has already been spent (`numbering/sequence.ts`'s own "never waste a
 * number" header). Any failure here is logged loudly instead - the document still sends, printing
 * without an ATCUD, which `documents.service.invoice.spec.ts` covers as the honest degraded outcome -
 * never a silently wrong one.
 */
export async function attachAtcudToNumberedDocument(
  companyId: string,
  typeId: AtcudTypeId,
  documentId: string,
  numbered: TakenDocumentNumber,
): Promise<void> {
  try {
    const countryCode = await resolveCompanyCountryCode(companyId);
    const documentValidationCode = defaultCountryPolicyCatalog.documentValidationCodeFor(countryCode ?? '');
    if (documentValidationCode?.scheme !== 'ATCUD') return;

    const { pattern } = await resolveCompanyNumberFormat(companyId, typeId);
    const { seriesId, sequentialNumber } = splitAtcudDisplayNumber(numbered.displayNumber, pattern);

    const series = await prisma.companyAtcudSeries.findUnique({
      where: { companyId_typeId_seriesId: { companyId, typeId, seriesId } },
    });
    if (!series) {
      throw new AtcudValidationCodeMissingError(
        `No AT validation code registered for ${ATCUD_TYPE_LABEL[typeId]} series "${seriesId}" at attach time.`,
      );
    }

    const atcud = computeAtcud(series.validationCode, sequentialNumber);
    await prisma.documentInstance.update({ where: { id: documentId }, data: { atcud } });
  } catch (error) {
    logger.error(
      `Failed to attach the ATCUD to a numbered Portuguese ${ATCUD_TYPE_LABEL[typeId]} - it will print ` +
        'without one. The "send" preflight (ensureAtcudIssuable) should have already refused this case; ' +
        "reaching here means the company's AT validation code (or its country) changed in the narrow " +
        'gap between that check and numbering.',
      {
        category: 'documents',
        details: {
          companyId,
          typeId,
          documentId,
          message: error instanceof Error ? error.message : String(error),
        },
      },
    );
  }
}
