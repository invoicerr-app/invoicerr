import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/prisma/prisma.service';

export interface VatRateView {
  id: string;
  rate: number;
  label: string;
  category: string;
  confidence: string;
  source: string;
  sourceCheckedAt: Date;
  notes: string | null;
}

/**
 * Read side of the VAT rate catalog (backend/src/compliance/tax-rates/) — the write side is
 * `seedVatRates()`, which is the only thing that ever creates/updates/deletes a `VatRate` row. This
 * service never writes: the table is a mirror of the reference files, not user-editable data.
 */
@Injectable()
export class VatRatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rates in force for `countryCode` at `at` (validFrom <= at < validTo, or validTo is null). */
  async ratesFor(countryCode: string, at: Date): Promise<VatRateView[]> {
    const rows = await this.prisma.vatRate.findMany({
      where: {
        countryCode: countryCode.toUpperCase(),
        validFrom: { lte: at },
        OR: [{ validTo: null }, { validTo: { gt: at } }],
      },
      orderBy: { rate: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      rate: r.rate,
      label: r.label,
      category: r.category,
      confidence: r.confidence,
      source: r.source,
      sourceCheckedAt: r.sourceCheckedAt,
      notes: r.notes,
    }));
  }
}
