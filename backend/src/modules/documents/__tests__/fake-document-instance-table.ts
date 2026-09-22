/**
 * An in-memory stand-in for `prisma.documentInstance`, for the specs that prove a read covers the
 * WHOLE set rather than one capped page.
 *
 * Those specs cannot mock `../persistence` the way the rest of this module's specs do: the thing
 * under test IS the read, so a mocked `listAllDocuments` returning a hand-written array proves
 * nothing about whether the real one pages. They mock the Prisma client instead and let the real
 * persistence layer run against this table — which honours `take` exactly like Postgres does, so a
 * capped read genuinely returns fewer rows here and the spec genuinely fails.
 *
 * Supports only what those reads actually issue: `findMany` with a `where` of the shapes
 * persistence.ts builds (plain equality, `in`, `gt`, `contains`, a `data` JSON-path `equals`/
 * `string_contains`, `AND`/`OR`), `orderBy` (one field or a list), `take`/`skip`, and `count`.
 * Anything else is deliberately absent rather than faked loosely — a spec reaching for it should
 * teach this file the real shape, not get a silent approximation.
 */
import { DocumentInstanceResult } from '../actions/action-registry';

type Row = DocumentInstanceResult;
type Where = Record<string, unknown>;

let rows: Row[] = [];

/** Replaces the whole table. Call from a `beforeEach`, never mid-assertion. */
export function seedDocumentInstances(seeded: Row[]): void {
  rows = [...seeded];
}

/** Every row currently in the table — for a spec that needs the truth to compare a read against. */
export function seededDocumentInstances(): Row[] {
  return [...rows];
}

/** One `DocumentInstance` row, with the columns every read here touches already filled in. */
export function documentInstanceRow(overrides: Partial<Row> & { id: string }): Row {
  return {
    typeId: 'invoice',
    companyId: 'company-1',
    status: 'sent',
    data: {},
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    number: null,
    displayNumber: null,
    atcud: null,
    lastActionError: null,
    transportRef: null,
    channelProviderId: null,
    deliveryConfirmedAt: null,
    ...overrides,
  } as Row;
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
}

function matchesCondition(actual: unknown, condition: Record<string, unknown>): boolean {
  if ('in' in condition) return (condition.in as unknown[]).includes(actual);
  if ('gt' in condition) return compareValues(actual, condition.gt) > 0;
  if ('gte' in condition) return compareValues(actual, condition.gte) >= 0;
  if ('lt' in condition) return compareValues(actual, condition.lt) < 0;
  if ('contains' in condition) {
    return (
      typeof actual === 'string' && actual.toLowerCase().includes(String(condition.contains).toLowerCase())
    );
  }
  throw new Error(`fake documentInstance table: unsupported condition ${JSON.stringify(condition)}`);
}

function matchesJsonPath(row: Row, condition: Record<string, unknown>): boolean {
  const path = condition.path as string[];
  const actual = (row.data as Record<string, unknown> | null)?.[path[0]];
  if ('equals' in condition) return actual === condition.equals;
  if ('string_contains' in condition) {
    return (
      typeof actual === 'string' &&
      actual.toLowerCase().includes(String(condition.string_contains).toLowerCase())
    );
  }
  throw new Error(`fake documentInstance table: unsupported data filter ${JSON.stringify(condition)}`);
}

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === 'AND') {
      if (!(value as Where[]).every((clause) => matches(row, clause))) return false;
      continue;
    }
    if (key === 'OR') {
      if (!(value as Where[]).some((clause) => matches(row, clause))) return false;
      continue;
    }
    if (key === 'data') {
      if (!matchesJsonPath(row, value as Record<string, unknown>)) return false;
      continue;
    }
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      if (!matchesCondition(actual, value as Record<string, unknown>)) return false;
      continue;
    }
    if (actual !== value) return false;
  }
  return true;
}

function applyOrderBy(matched: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return matched;
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, 'asc' | 'desc'>[];
  return [...matched].sort((a, b) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0];
      const left = (a as unknown as Record<string, unknown>)[field];
      const right = (b as unknown as Record<string, unknown>)[field];
      // Postgres's own default: NULLS LAST ascending, NULLS FIRST descending.
      if (left === null || right === null) {
        if (left === right) continue;
        return left === null ? 1 : -1;
      }
      const delta = compareValues(left, right);
      if (delta !== 0) return direction === 'asc' ? delta : -delta;
    }
    return 0;
  });
}

export const fakeDocumentInstanceDelegate = {
  async findMany(args: { where?: Where; orderBy?: unknown; take?: number; skip?: number }): Promise<Row[]> {
    const matched = applyOrderBy(
      rows.filter((row) => matches(row, args.where)),
      args.orderBy,
    );
    const start = args.skip ?? 0;
    return args.take === undefined ? matched.slice(start) : matched.slice(start, start + args.take);
  },
  async count(args: { where?: Where }): Promise<number> {
    return rows.filter((row) => matches(row, args.where)).length;
  },
  async findFirst(args: { where?: Where }): Promise<Row | null> {
    return rows.find((row) => matches(row, args.where)) ?? null;
  },
};

/** What a spec hands `vi.mock('@/prisma/prisma.service')` — the default export the codebase imports
 *  as its Prisma singleton, carrying only the delegate these reads use. */
export const fakePrismaClient = { documentInstance: fakeDocumentInstanceDelegate };

/**
 * `listAllDocuments`' own filtering, applied to a plain array — for the many specs that mock
 * `../persistence` wholesale rather than the Prisma client.
 *
 * Those specs hand their read a hand-written fixture, so a mock returning it VERBATIM would hand the
 * code under test rows the real query would have excluded (another client's invoice, a draft), and
 * the spec would then be asserting behavior production never sees. The filtering moved INTO the
 * query as part of closing the read cap, so a fixture-based mock has to move with it.
 *
 * It is not a substitute for a cap-crossing fixture: a spec built on this proves the rules AROUND
 * the read, never that the read covers the whole set. That is what the `*.read-cap.spec.ts` files
 * exist for, and they run the real persistence layer against the table above instead.
 */
export function filterLikeListAllDocuments(
  rows: Row[],
  options: {
    typeId?: string;
    status?: string[];
    dataEquals?: Record<string, string>;
    orderBy?: { field: 'updatedAt' | 'createdAt'; direction: 'asc' | 'desc' };
  } = {},
): Row[] {
  const kept = rows.filter((row) => {
    if (options.typeId !== undefined && row.typeId !== options.typeId) return false;
    if (options.status && options.status.length > 0 && !options.status.includes(row.status)) return false;
    for (const [key, value] of Object.entries(options.dataEquals ?? {})) {
      if ((row.data as Record<string, unknown> | null)?.[key] !== value) return false;
    }
    return true;
  });
  if (!options.orderBy) return kept;
  const sign = options.orderBy.direction === 'asc' ? 1 : -1;
  const field = options.orderBy.field;
  return [...kept].sort((a, b) => sign * (a[field].getTime() - b[field].getTime()));
}
