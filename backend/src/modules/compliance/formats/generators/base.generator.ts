import { Logger } from '@nestjs/common';
import { FormatConfig } from '../../interfaces/format.interface';
import {
  FormatGenerator,
  FormatResult,
  InvoiceData,
  InvoiceLineItem,
  PartyData,
} from '../format.interface';

/**
 * Abstract base class for format generators
 * Provides common utilities for XML generation
 */
export abstract class BaseFormatGenerator implements FormatGenerator {
  protected readonly logger: Logger;

  abstract readonly name: string;
  abstract readonly supportedFormats: string[];

  constructor() {
    this.logger = new Logger(this.constructor.name);
  }

  abstract supports(format: string): boolean;
  abstract generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult>;

  /**
   * Escape XML special characters
   */
  protected escapeXml(str: string | undefined | null): string {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Format date as ISO date (YYYY-MM-DD)
   */
  protected formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Format date-time as ISO datetime
   */
  protected formatDateTime(date: Date): string {
    return date.toISOString();
  }

  /**
   * Format amount with 2 decimal places
   */
  protected formatAmount(amount: number): string {
    return amount.toFixed(2);
  }

  /**
   * Format quantity (can have more decimals)
   */
  protected formatQuantity(quantity: number): string {
    return quantity.toString();
  }

  /**
   * Get ISO 3166-1 alpha-2 country code
   */
  protected getCountryCode(country: string): string {
    // Already a 2-letter code
    if (/^[A-Z]{2}$/.test(country.toUpperCase())) {
      return country.toUpperCase();
    }
    // Common country name mappings
    const countryMap: Record<string, string> = {
      france: 'FR',
      germany: 'DE',
      italy: 'IT',
      spain: 'ES',
      portugal: 'PT',
      belgium: 'BE',
      netherlands: 'NL',
      'united kingdom': 'GB',
      uk: 'GB',
      austria: 'AT',
      switzerland: 'CH',
      poland: 'PL',
      hungary: 'HU',
      romania: 'RO',
      greece: 'GR',
    };
    return countryMap[country.toLowerCase()] || country.substring(0, 2).toUpperCase();
  }

  /**
   * Get UN/ECE unit code (Recommendation 20)
   */
  protected getUnitCode(itemType?: 'goods' | 'services'): string {
    // C62 = unit (default for services/generic)
    // EA = each (for goods)
    // HUR = hour
    return itemType === 'goods' ? 'EA' : 'C62';
  }

  /**
   * Get VAT category code for UBL/CII
   * S = Standard, Z = Zero, E = Exempt, AE = Reverse charge, G = Export
   */
  protected getVatCategoryCode(vatRate: number, isExempt = false, isReverseCharge = false): string {
    if (isReverseCharge) return 'AE';
    if (isExempt) return 'E';
    if (vatRate === 0) return 'Z';
    return 'S';
  }

  /**
   * Calculate VAT breakdown by rate
   */
  protected calculateVatBreakdown(
    items: InvoiceLineItem[],
  ): Array<{ rate: number; taxableAmount: number; taxAmount: number }> {
    const breakdown = new Map<number, { taxableAmount: number; taxAmount: number }>();

    for (const item of items) {
      const existing = breakdown.get(item.vatRate) || { taxableAmount: 0, taxAmount: 0 };
      existing.taxableAmount += item.lineTotal;
      existing.taxAmount += item.vatAmount;
      breakdown.set(item.vatRate, existing);
    }

    return Array.from(breakdown.entries()).map(([rate, amounts]) => ({
      rate,
      ...amounts,
    }));
  }

  /**
   * Generate a unique ID for XML elements
   */
  protected generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wrap XML content with declaration
   */
  protected wrapWithDeclaration(xml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  }

  /**
   * Build party address block (common structure)
   */
  protected buildAddressData(party: PartyData): {
    streetName: string;
    cityName: string;
    postalZone: string;
    countryCode: string;
  } {
    return {
      streetName: party.address,
      cityName: party.city,
      postalZone: party.postalCode,
      countryCode: this.getCountryCode(party.country),
    };
  }
}
