import { Injectable, Logger } from '@nestjs/common';
import { FormatConfig } from '../interfaces/format.interface';
import { FormatGenerator, FormatResult, InvoiceData } from './format.interface';

/**
 * Format Service - Orchestrator for e-invoice format generation
 *
 * Selects the appropriate generator based on format configuration
 * and generates XML content for invoices.
 *
 * Note: Country-specific generators (Factur-X, FatturaPA, UBL, KSeF)
 * need to be implemented and registered manually.
 */
@Injectable()
export class FormatService {
  private readonly logger = new Logger(FormatService.name);
  private readonly generators: FormatGenerator[] = [];

  constructor() {
    // No generators by default - add country-specific generators manually
    this.logger.log(
      `FormatService initialized with ${this.generators.length} generators`,
    );
  }

  /**
   * Register a format generator
   */
  registerGenerator(generator: FormatGenerator): void {
    this.generators.push(generator);
    this.logger.log(`Registered generator: ${generator.name}`);
  }

  /**
   * Generate XML for an invoice using the appropriate format generator
   */
  async generate(invoice: InvoiceData, config: FormatConfig): Promise<FormatResult> {
    const format = config.preferred.toLowerCase();

    // Find a generator that supports this format
    const generator = this.generators.find((g) => g.supports(format));

    if (!generator) {
      this.logger.warn(`No generator found for format: ${format}`);
      return {
        success: false,
        format,
        syntax: config.syntax,
        error: `Unsupported format: ${format}. Available formats: ${this.getSupportedFormats().join(', ') || 'none'}`,
      };
    }

    this.logger.debug(`Using ${generator.name} generator for format: ${format}`);

    try {
      const result = await generator.generate(invoice, config);

      if (result.success) {
        this.logger.debug(`Successfully generated ${format} XML for invoice ${invoice.number}`);
      } else {
        this.logger.warn(`Failed to generate ${format} XML: ${result.error}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Format generation error for ${format}:`, error);
      return {
        success: false,
        format,
        syntax: config.syntax,
        error: error instanceof Error ? error.message : 'Unknown generation error',
      };
    }
  }

  /**
   * Get list of all supported formats
   */
  getSupportedFormats(): string[] {
    const formats = new Set<string>();
    for (const generator of this.generators) {
      for (const format of generator.supportedFormats) {
        formats.add(format);
      }
    }
    return Array.from(formats);
  }

  /**
   * Check if a format is supported
   */
  isFormatSupported(format: string): boolean {
    return this.generators.some((g) => g.supports(format.toLowerCase()));
  }

  /**
   * Get generator for a specific format (for advanced use)
   */
  getGenerator(format: string): FormatGenerator | undefined {
    return this.generators.find((g) => g.supports(format.toLowerCase()));
  }

  /**
   * Validate generated XML (if generator supports it)
   */
  async validate(
    xml: string,
    format: string,
  ): Promise<{ valid: boolean; errors: string[] }> {
    const generator = this.getGenerator(format);

    if (!generator) {
      return { valid: false, errors: [`Unknown format: ${format}`] };
    }

    if (!generator.validate) {
      // Generator doesn't support validation - assume valid
      return { valid: true, errors: [] };
    }

    return generator.validate(xml);
  }
}
