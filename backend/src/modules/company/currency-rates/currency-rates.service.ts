import { Injectable } from '@nestjs/common';

import {
  CreateCurrencyRateInput,
  CurrencyRateResult,
  createCurrencyRate,
  listCurrencyRates,
} from './currency-rates.store';

/**
 * Thin `@Injectable` layer over currency-rates.store.ts's plain functions — kept deliberately thin
 * (no logic duplicated here) so this Controller → Service → Prisma discipline holds at the Nest
 * layer while the SAME store functions stay directly importable, DI-free, from
 * documents/contributions/*.ts (see currency-rates.store.ts's own header for why that matters).
 */
@Injectable()
export class CurrencyRatesService {
  async list(companyId: string): Promise<CurrencyRateResult[]> {
    return listCurrencyRates(companyId);
  }

  async create(input: CreateCurrencyRateInput): Promise<CurrencyRateResult> {
    return createCurrencyRate(input);
  }
}
