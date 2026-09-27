import { BadRequestException } from '@nestjs/common';

import { DOCUMENT_LIST_SORT_FIELDS, DocumentListSortField } from '../persistence';

/** `GET /documents`'s own defaults — the list screen's page-size budget, and the ceiling nobody may
 *  ask past (a caller asking for more gets clamped to this rather than refused: the request is, at
 *  worst, a wasted-but-harmless ask, never a shape the API needs to reject outright). */
export const DOCUMENT_LIST_DEFAULT_PAGE_SIZE = 25;
export const DOCUMENT_LIST_MAX_PAGE_SIZE = 100;

/** `YYYY-MM-DD`, nothing looser — the identical contract
 *  `accounting-export.service.ts#DATE_PARAM_PATTERN` already holds for the same shape of param, kept
 *  in sync deliberately rather than imported: these are two independent endpoints that only happen
 *  to agree on what a "calendar day" query param looks like. */
const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** One raw query param exactly as Nest's `@Query()` hands it: absent, a single string, or — for a
 *  key repeated in the URL (`?status=draft&status=sent`) — an array of strings. */
export type RawQueryValue = string | string[] | undefined;

export function firstValue(value: RawQueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** `status[]` accepts EITHER a repeated query key OR one comma-separated value (`?status=draft,sent`)
 *  — the URL the list screen writes on every filter change stays short and shareable, never a wall
 *  of repeated `status=` pairs, while a scripted client posting the classic repeated form still
 *  works exactly as it would on any other list endpoint. */
function normalizeStatusList(value: RawQueryValue): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parsePositiveInt(name: string, value: RawQueryValue, fallback: number): number {
  const raw = firstValue(value);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`"${name}" must be a positive integer.`);
  }
  return parsed;
}

/** Parses+validates one `dateFrom`/`dateTo` query param — a named 400, never a silent fallback (the
 *  same "the caller chose this value, a mistake is worth telling them about" posture
 *  `accounting-export.service.ts#parseDateParam` already holds for its own `from`/`to`). */
function parseDateParam(name: string, value: RawQueryValue): string | undefined {
  const raw = firstValue(value);
  if (raw === undefined) return undefined;
  if (!DATE_PARAM_PATTERN.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`"${name}" must be a valid date in YYYY-MM-DD format.`);
  }
  return raw;
}

/** The two values `settlement` may take: see `documents.service.ts#listDocuments`'s own check for
 *  why this is only ever valid with `typeId=invoice` (that check needs no descriptor, only the
 *  typeId itself, so it lives there rather than here, same reasoning as the existing
 *  dateFrom-requires-typeId check right next to it). */
export const DOCUMENT_LIST_SETTLEMENT_VALUES = ['unsettled', 'overdue'] as const;
export type DocumentListSettlement = (typeof DOCUMENT_LIST_SETTLEMENT_VALUES)[number];

function parseSettlementParam(value: RawQueryValue): DocumentListSettlement | undefined {
  const raw = firstValue(value);
  if (raw === undefined) return undefined;
  if (!(DOCUMENT_LIST_SETTLEMENT_VALUES as readonly string[]).includes(raw)) {
    throw new BadRequestException(
      `"settlement" must be one of: ${DOCUMENT_LIST_SETTLEMENT_VALUES.join(', ')}.`,
    );
  }
  return raw as DocumentListSettlement;
}

export interface RawListDocumentsQuery {
  typeId?: RawQueryValue;
  page?: RawQueryValue;
  pageSize?: RawQueryValue;
  status?: RawQueryValue;
  clientId?: RawQueryValue;
  dateFrom?: RawQueryValue;
  dateTo?: RawQueryValue;
  q?: RawQueryValue;
  sort?: RawQueryValue;
  order?: RawQueryValue;
  settlement?: RawQueryValue;
}

export interface ParsedListDocumentsQuery {
  page: number;
  pageSize: number;
  status?: string[];
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  sort: DocumentListSortField;
  order: 'asc' | 'desc';
  /** Restricts the list to invoices matching `settlement/unsettled-invoices.ts`'s own predicate:
   *  see this file's own `DOCUMENT_LIST_SETTLEMENT_VALUES` header for why the typeId=invoice
   *  restriction is checked in the service, not here. */
  settlement?: DocumentListSettlement;
}

/**
 * The controller-side validation for `GET /documents` — no `ValidationPipe`/class-validator runs
 * anywhere in this API (see `legal.dto.ts`'s own comment on why), so every shape check a scripted
 * client could violate lives here, explicitly, before any of it reaches the service. Every failure
 * is a named 400; nothing here ever guesses or silently drops a malformed value.
 */
export function parseListDocumentsQuery(raw: RawListDocumentsQuery): ParsedListDocumentsQuery {
  const page = parsePositiveInt('page', raw.page, 1);
  const requestedPageSize = parsePositiveInt('pageSize', raw.pageSize, DOCUMENT_LIST_DEFAULT_PAGE_SIZE);
  const pageSize = Math.min(requestedPageSize, DOCUMENT_LIST_MAX_PAGE_SIZE);

  const status = normalizeStatusList(raw.status);

  const clientId = firstValue(raw.clientId)?.trim() || undefined;

  const dateFrom = parseDateParam('dateFrom', raw.dateFrom);
  const dateTo = parseDateParam('dateTo', raw.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    // Plain string comparison is exact for this format — a fixed-width `YYYY-MM-DD` sorts
    // lexicographically exactly the way it sorts chronologically.
    throw new BadRequestException('"dateFrom" must not be after "dateTo".');
  }

  const q = firstValue(raw.q)?.trim() || undefined;

  const sort = (firstValue(raw.sort) ?? 'updatedAt') as DocumentListSortField;
  if (!(DOCUMENT_LIST_SORT_FIELDS as readonly string[]).includes(sort)) {
    throw new BadRequestException(`"sort" must be one of: ${DOCUMENT_LIST_SORT_FIELDS.join(', ')}.`);
  }

  const orderRaw = firstValue(raw.order) ?? 'desc';
  if (orderRaw !== 'asc' && orderRaw !== 'desc') {
    throw new BadRequestException('"order" must be "asc" or "desc".');
  }

  const settlement = parseSettlementParam(raw.settlement);

  return {
    page,
    pageSize,
    status: status.length > 0 ? status : undefined,
    clientId,
    dateFrom,
    dateTo,
    q,
    sort,
    order: orderRaw,
    settlement,
  };
}
