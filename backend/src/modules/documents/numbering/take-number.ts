/**
 * The orchestration `documents.service.ts`'s `runAction` actually calls — reads the active company's
 * own number FORMAT (Company.numberFormats, see format-number.ts), resolves+validates it, and only
 * THEN asks `sequence.ts` for a real number. Kept as its own file (not inlined into `sequence.ts` or
 * `documents.service.ts`) for the same reason `country-policy.ts` and `country-policy/schema.ts` stay
 * separate: `sequence.ts` should not need to know Company has a `numberFormats` column at all, and
 * `documents.service.ts`'s own tests mock this ONE function wholesale (the same discipline they
 * already hold for `./persistence` and `./country-policy/country-policy`) rather than reaching past
 * it into Prisma or the sequence internals.
 */
import prisma from '@/prisma/prisma.service';

import { resolveNumberFormat } from './format-number';
import { TakenDocumentNumber, takeDocumentNumber } from './sequence';

/**
 * Takes the next number for `(companyId, typeId)` and writes it onto `documentId` — see sequence.ts's
 * `takeDocumentNumber` for the atomicity/never-waste guarantee this only adds a format lookup in
 * front of. Resolving (and validating — `resolveNumberFormat` throws for a misconfigured pattern) the
 * company's format HAPPENS BEFORE any sequence number is touched, deliberately: a bad format must
 * never cost this company a wasted number, only refuse the request that would have used it.
 *
 * Returns `undefined` in the same case `takeDocumentNumber` itself does (the document already carries
 * a number — see that function's own header) — never called at all by `runAction` unless it has
 * already checked `number == null` in memory first, but this stays a real, DB-level guard regardless.
 */
export async function takeDocumentNumberForTransition(
  companyId: string,
  typeId: string,
  documentId: string,
): Promise<TakenDocumentNumber | undefined> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { numberFormats: true },
  });
  const pattern = resolveNumberFormat(company?.numberFormats as Record<string, unknown> | null, typeId);

  return takeDocumentNumber(companyId, typeId, documentId, pattern);
}
