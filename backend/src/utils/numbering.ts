import { BadRequestException, Injectable } from '@nestjs/common';
import prisma from '@/prisma/prisma.service';

export type DocType = 'invoice' | 'quote' | 'payment';

export interface NumberAssignment {
  counter: number;
  rawNumber: string;
}

function formatNumber(counter: number, date: Date, pattern: string): string {
  return pattern.replace(/\{(\w+)(?::(\d+))?\}/g, (_, key, padding) => {
    let value: number | string;

    switch (key) {
      case 'year':
        value = date.getFullYear();
        break;
      case 'month':
        value = date.getMonth() + 1;
        break;
      case 'day':
        value = date.getDate();
        break;
      case 'number':
        value = counter;
        break;
      default:
        return key;
    }

    const padLength = padding !== undefined
      ? parseInt(padding, 10)
      : key === 'number'
        ? 4
        : 0;

    return value.toString().padStart(padLength, '0');
  });
}

@Injectable()
export class NumberingService {
  /**
   * Assign the next number in a gapless series.
   * Uses `UPDATE … RETURNING` inside a $transaction for race safety.
   */
  async nextNumber(
    companyId: string,
    docType: DocType,
    issueDate: Date,
  ): Promise<NumberAssignment> {
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new BadRequestException('Company not found');
    }

    const pattern = this.getFormatPattern(company, docType);
    const scopeKey = issueDate.getFullYear().toString();

    const result = await prisma.$transaction(async (tx: any) => {
      const rows = await tx.$queryRawUnsafe(
          `INSERT INTO "NumberSeries" ("id", "companyId", "docType", "scopeKey", "counter", "createdAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, $3, 0, now(), now())
           ON CONFLICT ("companyId", "docType", "scopeKey") DO UPDATE
           SET "counter" = "NumberSeries"."counter" + 1,
               "updatedAt" = now()
           RETURNING "counter"`,
          companyId,
          docType,
          scopeKey,
        ) as Promise<Array<{ counter: number }>>;

      return rows[0].counter;
    });

    const rawNumber = formatNumber(result, issueDate, pattern);
    return { counter: result, rawNumber };
  }

  private getFormatPattern(company: any, docType: DocType): string {
    switch (docType) {
      case 'invoice':
        return company.invoiceNumberFormat;
      case 'quote':
        return company.quoteNumberFormat;
      case 'payment':
        return company.paymentNumberFormat;
    }
  }
}
