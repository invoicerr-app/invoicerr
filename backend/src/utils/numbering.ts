import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/prisma/client';
import { defaultRegistry } from '@/compliance/profiles/registry';

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
   * The caller MUST run this inside a prisma.$transaction(tx => ...) so the counter
   * increment and the document row update are one atomic operation.
   */
  async nextNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
    docType: DocType,
    issueDate: Date,
  ): Promise<NumberAssignment> {
    const company = await tx.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new BadRequestException('Company not found');
    }

    const pattern = this.getFormatPattern(company, docType);
    const startingNumber = this.getStartingNumber(company, docType);
    const scopeKey = await this.resolveScopeKey(company, docType, issueDate);

    const rows = await tx.$queryRawUnsafe<Array<{ counter: number }>>(
        `INSERT INTO "NumberSeries" ("id", "companyId", "docType", "scopeKey", "counter", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, now(), now())
         ON CONFLICT ("companyId", "docType", "scopeKey") DO UPDATE
         SET "counter" = "NumberSeries"."counter" + 1,
             "updatedAt" = now()
         RETURNING "counter"`,
        companyId,
        docType,
        scopeKey,
        startingNumber,
      );

    const result = rows[0].counter;
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

  private getStartingNumber(company: any, docType: DocType): number {
    switch (docType) {
      case 'invoice': return company.invoiceStartingNumber;
      case 'quote': return company.quoteStartingNumber;
      case 'payment': return company.paymentStartingNumber;
    }
  }

  /**
   * Resolve the NumberSeries scope key from the company's compliance profile.
   * Falls back to the issue year when no profile / rule is found.
   */
  private async resolveScopeKey(
    company: any,
    _docType: DocType,
    issueDate: Date,
  ): Promise<string> {
    const countryCode = (company.countryCode || company.country || 'XX').toUpperCase();
    const resolved = defaultRegistry.resolve(countryCode);
    const profile = resolved.profile;

    const activeRule = profile.numbering
      .sort((a, b) => new Date(a.validFrom).getTime() - new Date(b.validFrom).getTime())
      .find(r => {
        const from = new Date(r.validFrom);
        if (r.validTo) {
          const to = new Date(r.validTo);
          return issueDate >= from && issueDate < to;
        }
        return issueDate >= from;
      });

    const model = activeRule?.value?.model;
    const seriesScope = activeRule?.value?.seriesScope;

    // AUTHORITY_RANGE must NOT self-assign a number
    if (model === 'AUTHORITY_RANGE') {
      throw new BadRequestException(
        `Numbering model is AUTHORITY_RANGE for country ${countryCode}: self-assignment is not allowed. Use the compliance engine's FolioPool instead.`,
      );
    }

    switch (seriesScope) {
      case 'ENTITY':
        return 'all';
      case 'BRANCH_POS':
        // TODO: read branch from company when the model supports it
        return 'all';
      case 'DOC_TYPE':
        return 'all';
      case 'YEAR':
      default:
        return issueDate.getFullYear().toString();
    }
  }
}
