import { BadRequestException } from '@nestjs/common';

import { firstValue, RawQueryValue } from './list-documents.dto';

/** `YYYY-MM-DD`, nothing looser - deliberately duplicated from `list-documents.dto.ts`'s own
 *  identical `DATE_PARAM_PATTERN` rather than imported: see that file's own header on why a
 *  duplicated single-purpose constant beats a shared one for two independent endpoints that only
 *  happen to agree on what a calendar-day param looks like. */
const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(name: string, value: RawQueryValue): string | undefined {
  const raw = firstValue(value);
  if (raw === undefined) return undefined;
  if (!DATE_PARAM_PATTERN.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`"${name}" must be a valid date in YYYY-MM-DD format.`);
  }
  return raw;
}

export interface RawDashboardQuery {
  dateFrom?: RawQueryValue;
  dateTo?: RawQueryValue;
}

/** The one period shape every dashboard widget contribution reads - `undefined` means "no period
 *  set", the exact pre-existing (unscoped, whole-history) behavior every contribution's own "unset
 *  path stays byte-identical" guarantee is built around (see invoice-contributions.ts and friends).
 *  Both bounds are inclusive `YYYY-MM-DD` strings - the identical contract `GET /documents`'s own
 *  `dateFrom`/`dateTo` already holds, deliberately: THE CONSISTENCY RULE (issue #418) requires a
 *  period-scoped tile's own figure and the list its `link` opens to select documents by EXACTLY the
 *  same field and the same inclusive-bounds comparison, and giving the two params the same shape
 *  here is a precondition for that, not just a style choice. */
export interface DashboardPeriod {
  dateFrom: string;
  dateTo: string;
}

/**
 * The controller-side validation for `GET /documents/dashboard`'s own `dateFrom`/`dateTo` - the same
 * "no ValidationPipe anywhere in this API, so every shape check lives here, explicit, before the
 * service ever sees it" posture `list-documents.dto.ts#parseListDocumentsQuery` already holds.
 *
 * Both params are required TOGETHER - a period is a RANGE, so "from without to" (or the reverse)
 * is not a smaller, still-meaningful request, it is a malformed one and gets a named 400 rather than
 * a guessed open end. Neither given at all -> `undefined`, the default "whole history" behavior this
 * endpoint has always had; that is the ordinary case, not a degraded one.
 */
export function parseDashboardQuery(raw: RawDashboardQuery): DashboardPeriod | undefined {
  const dateFrom = parseDateParam('dateFrom', raw.dateFrom);
  const dateTo = parseDateParam('dateTo', raw.dateTo);

  if (!dateFrom && !dateTo) return undefined;
  if (!dateFrom || !dateTo) {
    throw new BadRequestException('"dateFrom" and "dateTo" must be given together.');
  }
  if (dateFrom > dateTo) {
    // Plain string comparison is exact for this format - see list-documents.dto.ts's own identical
    // check for why a fixed-width YYYY-MM-DD sorts lexicographically exactly as it sorts
    // chronologically.
    throw new BadRequestException('"dateFrom" must not be after "dateTo".');
  }

  return { dateFrom, dateTo };
}
