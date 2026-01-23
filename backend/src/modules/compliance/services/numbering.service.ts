import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { NumberingConfig } from '../interfaces';

export interface NumberingContext {
  companyId: string;
  series?: string;
  year?: number;
  month?: number;
  documentType?: 'invoice' | 'quote' | 'receipt';
}

export interface GeneratedNumber {
  number: string;
  fullNumber: string;
  sequence: number;
  series?: string;
  year?: number;
}

export interface NumberingState {
  lastSequence: number;
  lastHash?: string;
  year?: number;
  month?: number;
}

@Injectable()
export class NumberingService {
  private readonly logger = new Logger(NumberingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate next invoice number according to country rules
   */
  async generateNext(
    context: NumberingContext,
    config: NumberingConfig,
  ): Promise<GeneratedNumber> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const documentType = context.documentType || 'invoice';

    // Use a transaction to ensure atomicity
    const result = await this.prisma.$transaction(async (tx) => {
      // Find or create the sequence record
      let sequenceRecord = await tx.numberingSequence.findUnique({
        where: {
          companyId_series_documentType: {
            companyId: context.companyId,
            series: context.series || '',
            documentType,
          },
        },
      });

      let sequence = sequenceRecord?.lastSequence || 0;

      // Check if reset is needed
      const shouldReset = this.shouldReset(
        sequenceRecord
          ? { lastSequence: sequenceRecord.lastSequence, year: sequenceRecord.year, month: sequenceRecord.month }
          : { lastSequence: 0, year: currentYear, month: currentMonth },
        config,
        currentYear,
        currentMonth,
      );

      if (shouldReset) {
        sequence = 0;
        this.logger.log(
          `Resetting numbering sequence for ${context.companyId}/${context.series || 'default'}/${documentType}`,
        );
      }

      sequence += 1;

      // Upsert the sequence record
      sequenceRecord = await tx.numberingSequence.upsert({
        where: {
          companyId_series_documentType: {
            companyId: context.companyId,
            series: context.series || '',
            documentType,
          },
        },
        create: {
          companyId: context.companyId,
          series: context.series || '',
          documentType,
          lastSequence: sequence,
          year: currentYear,
          month: currentMonth,
        },
        update: {
          lastSequence: sequence,
          year: currentYear,
          month: currentMonth,
        },
      });

      return { sequence, sequenceRecord };
    });

    // Format the number
    const formattedNumber = this.formatNumber(
      result.sequence,
      context,
      config,
      currentYear,
    );

    return {
      number: formattedNumber.number,
      fullNumber: formattedNumber.fullNumber,
      sequence: result.sequence,
      series: context.series,
      year: currentYear,
    };
  }

  /**
   * Validate an invoice number format
   */
  validateFormat(number: string, config: NumberingConfig): boolean {
    if (config.seriesFormat) {
      const regex = new RegExp(config.seriesFormat);
      // Extract series part and validate
      const parts = number.split('/');
      if (parts.length > 1) {
        return regex.test(parts[0]);
      }
    }
    return true;
  }

  /**
   * Check for gaps in numbering sequence
   */
  async checkForGaps(
    _companyId: string,
    _series: string | undefined,
    existingNumbers: number[],
  ): Promise<number[]> {
    if (existingNumbers.length === 0) return [];

    const sorted = [...existingNumbers].sort((a, b) => a - b);
    const gaps: number[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const expected = sorted[i - 1] + 1;
      if (sorted[i] !== expected) {
        // Found gap(s)
        for (let j = expected; j < sorted[i]; j++) {
          gaps.push(j);
        }
      }
    }

    return gaps;
  }

  /**
   * Get last hash for hash chain
   */
  async getLastHash(
    context: NumberingContext,
    _config: NumberingConfig,
  ): Promise<string | undefined> {
    const documentType = context.documentType || 'invoice';
    const record = await this.prisma.numberingSequence.findUnique({
      where: {
        companyId_series_documentType: {
          companyId: context.companyId,
          series: context.series || '',
          documentType,
        },
      },
    });
    return record?.lastHash || undefined;
  }

  /**
   * Update last hash after invoice creation
   */
  async setLastHash(
    context: NumberingContext,
    _config: NumberingConfig,
    hash: string,
  ): Promise<void> {
    const documentType = context.documentType || 'invoice';
    await this.prisma.numberingSequence.update({
      where: {
        companyId_series_documentType: {
          companyId: context.companyId,
          series: context.series || '',
          documentType,
        },
      },
      data: {
        lastHash: hash,
      },
    });
  }

  /**
   * Reserve a number (for draft invoices)
   */
  async reserveNumber(
    context: NumberingContext,
    config: NumberingConfig,
  ): Promise<GeneratedNumber> {
    return this.generateNext(context, config);
  }

  /**
   * Release a reserved number (if draft is deleted)
   */
  async releaseNumber(
    context: NumberingContext,
    _config: NumberingConfig,
    sequence: number,
  ): Promise<void> {
    // In production, track released numbers to potentially reuse
    // For now, we just log it
    const documentType = context.documentType || 'invoice';
    this.logger.warn(
      `Number ${sequence} released for ${context.companyId}/${context.series || 'default'}/${documentType}. ` +
        `Note: Depending on country rules, this may create a gap.`,
    );
  }

  /**
   * Get current state for a sequence
   */
  async getState(
    context: NumberingContext,
    _config: NumberingConfig,
  ): Promise<NumberingState> {
    const documentType = context.documentType || 'invoice';
    const record = await this.prisma.numberingSequence.findUnique({
      where: {
        companyId_series_documentType: {
          companyId: context.companyId,
          series: context.series || '',
          documentType,
        },
      },
    });

    if (!record) {
      const now = new Date();
      return {
        lastSequence: 0,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      };
    }

    return {
      lastSequence: record.lastSequence,
      lastHash: record.lastHash || undefined,
      year: record.year,
      month: record.month,
    };
  }

  private shouldReset(
    state: NumberingState,
    config: NumberingConfig,
    currentYear: number,
    currentMonth: number,
  ): boolean {
    switch (config.resetPeriod) {
      case 'yearly':
        return state.year !== currentYear;
      case 'monthly':
        return state.year !== currentYear || state.month !== currentMonth;
      default:
        return false;
    }
  }

  private formatNumber(
    sequence: number,
    context: NumberingContext,
    config: NumberingConfig,
    year: number,
  ): { number: string; fullNumber: string } {
    const paddedSequence = sequence.toString().padStart(5, '0');
    const yearSuffix = year.toString().slice(-2);

    if (config.seriesRequired && context.series) {
      // Format: SERIES/YEAR/SEQUENCE (e.g., A/24/00001)
      const fullNumber = `${context.series}/${yearSuffix}/${paddedSequence}`;
      return {
        number: paddedSequence,
        fullNumber,
      };
    }

    if (config.resetPeriod === 'yearly') {
      // Format: YEAR-SEQUENCE (e.g., 2024-00001)
      const fullNumber = `${year}-${paddedSequence}`;
      return {
        number: paddedSequence,
        fullNumber,
      };
    }

    // Simple sequential number
    return {
      number: paddedSequence,
      fullNumber: paddedSequence,
    };
  }
}
