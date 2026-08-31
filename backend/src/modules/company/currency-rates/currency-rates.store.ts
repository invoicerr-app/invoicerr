import { BadRequestException } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

import { CurrencyRateLike } from './convert';

/**
 * Company-scoped persistence for `CurrencyRate` — same "every query scoped by companyId" discipline
 * documents/persistence.ts and settlement/payments.ts already hold, and the same "plain exported
 * functions over the prisma singleton" shape, reused here so `contributions/currency-consolidation.ts`
 * (documents module) can read rates and the reference currency WITHOUT importing a NestJS service or
 * wiring a cross-module DI dependency — a plain function call, exactly like it already does for
 * `settlement/payments.ts`'s `sumPaidMinorByDocument`.
 */

export interface CurrencyRateResult {
  id: string;
  companyId: string;
  from: string;
  to: string;
  rate: number;
  asOf: Date;
  source: string;
  createdAt: Date;
}

/** Prisma's `Decimal` -> plain `number`, the one boundary this whole feature crosses that type at —
 *  see convert.ts's own comment on `CurrencyRateLike.rate` for why every PURE function downstream
 *  only ever sees a `number`. */
function toResult(row: {
  id: string;
  companyId: string;
  from: string;
  to: string;
  rate: { toString(): string };
  asOf: Date;
  source: string;
  createdAt: Date;
}): CurrencyRateResult {
  return {
    id: row.id,
    companyId: row.companyId,
    from: row.from,
    to: row.to,
    rate: Number(row.rate.toString()),
    asOf: row.asOf,
    source: row.source,
    createdAt: row.createdAt,
  };
}

/** Every rate the company has entered, newest `asOf` first — the order a "Rates" settings list
 *  reads naturally (the row that would currently win resolution shown at the top). */
export async function listCurrencyRates(companyId: string): Promise<CurrencyRateResult[]> {
  const rows = await prisma.currencyRate.findMany({
    where: { companyId },
    orderBy: { asOf: 'desc' },
  });
  return rows.map(toResult);
}

export interface CreateCurrencyRateInput {
  companyId: string;
  from: string;
  to: string;
  rate: number;
  asOf: Date;
  /** Defaults to 'manual' — see the `CurrencyRate` model's own schema.prisma comment on why this is
   *  the only source implemented today, and why the column still exists as a named field rather than
   *  being hardcoded away entirely. */
  source?: string;
}

/**
 * Guard rails from the task's own spec, enforced HERE (not left to the database, not left to the
 * frontend form alone) since this is the one function every write path — the controller today,
 * anything else tomorrow — funnels through:
 *  - `rate` must be strictly positive: a zero or negative exchange rate is never a real one, and
 *    `convertMinor` (convert.ts) has no defined meaning for it.
 *  - `from` must differ from `to`: an identity conversion needs no stored rate at all (see
 *    currency-consolidation.ts's own handling of `currency === referenceCurrency`), so a row that
 *    claims one would be pure noise nothing ever resolves against on purpose.
 */
export async function createCurrencyRate(input: CreateCurrencyRateInput): Promise<CurrencyRateResult> {
  if (!(input.rate > 0)) {
    throw new BadRequestException('Currency rate must be a positive number.');
  }
  if (input.from === input.to) {
    throw new BadRequestException('A currency rate must have a different "from" and "to" currency.');
  }

  const row = await prisma.currencyRate.create({
    data: {
      companyId: input.companyId,
      from: input.from,
      to: input.to,
      rate: input.rate,
      asOf: input.asOf,
      source: input.source ?? 'manual',
    },
  });
  return toResult(row);
}

/** `Company.referenceCurrency` — `null` when the company has never opted in, which is the ONLY
 *  signal `currency-consolidation.ts` needs to skip consolidation entirely (see that column's own
 *  schema.prisma comment). A company that no longer exists (shouldn't happen given the FK a caller
 *  always resolves companyId from) is treated the same as "no reference currency chosen". */
export async function getReferenceCurrency(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { referenceCurrency: true },
  });
  return company?.referenceCurrency ?? null;
}

/** `CurrencyRateResult[]` -> the narrow shape `convert.ts`'s pure functions actually need — the same
 *  "DB result -> pure-function input" narrowing settlement/credits.ts's own
 *  `toSettlementCreditInputs` already performs for payments/credits. */
export function toCurrencyRateLikes(rates: readonly CurrencyRateResult[]): CurrencyRateLike[] {
  return rates.map((r) => ({ from: r.from, to: r.to, rate: r.rate, asOf: r.asOf, source: r.source }));
}
