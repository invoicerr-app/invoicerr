import { Injectable } from '@nestjs/common';
import { ConfigRegistry, getAllCountryConfigs } from './configs';
import {
  CountrySummaryDto,
  FrontendComplianceConfigDto,
} from './dto/compliance-config.dto';
import { FormatResult, FormatService, InvoiceData } from './formats';
import { CountryConfig, TransactionContext, TransmissionStatus } from './interfaces';
import { CorrectionService, CorrectionContext, CorrectionRequest } from './services/correction.service';
import { ContextBuilderService, ContextBuildInput } from './services/context-builder.service';
import { HashChainService, HashInput } from './services/hash-chain.service';
import { NumberingService, NumberingContext } from './services/numbering.service';
import { QRCodeService, QRCodeInput } from './services/qr-code.service';
import { RuleResolverService } from './services/rule-resolver.service';
import {
  VATCalculationInput,
  VATCalculationResult,
  VATEngineRules,
  VATEngineService,
} from './services/vat-engine.service';
import { TransmissionPayload, TransmissionResult } from './transmission/transmission.interface';
import { TransmissionService } from './transmission/transmission.service';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly configRegistry: ConfigRegistry,
    private readonly contextBuilder: ContextBuilderService,
    private readonly ruleResolver: RuleResolverService,
    private readonly vatEngine: VATEngineService,
    private readonly numberingService: NumberingService,
    private readonly hashChainService: HashChainService,
    private readonly qrCodeService: QRCodeService,
    private readonly correctionService: CorrectionService,
    private readonly transmissionService: TransmissionService,
    private readonly formatService: FormatService,
  ) {}

  // ============================================
  // Configuration
  // ============================================

  /**
   * Get raw country config
   */
  getConfig(countryCode: string): CountryConfig {
    return this.configRegistry.get(countryCode);
  }

  /**
   * Check if a country is supported
   */
  isCountrySupported(countryCode: string): boolean {
    return this.configRegistry.has(countryCode);
  }

  /**
   * Get all supported country codes
   */
  getSupportedCountries(): string[] {
    return this.configRegistry.getCodes();
  }

  /**
   * Get list of supported countries with summary info
   */
  getAvailableCountries(): CountrySummaryDto[] {
    return getAllCountryConfigs().map((c) => ({
      code: c.code,
      name: c.name,
      currency: c.currency,
      isEU: c.isEU,
    }));
  }

  // ============================================
  // Context and Rules
  // ============================================

  /**
   * Build transaction context from company and client data
   */
  async buildContext(input: ContextBuildInput): Promise<TransactionContext> {
    return this.contextBuilder.build(input);
  }

  /**
   * Resolve applicable rules based on transaction context
   */
  resolveRules(context: TransactionContext) {
    return this.ruleResolver.resolve(context);
  }

  // ============================================
  // VAT Calculation
  // ============================================

  /**
   * Calculate VAT based on items and rules
   */
  calculateVAT(items: VATCalculationInput[], rules: VATEngineRules): VATCalculationResult {
    return this.vatEngine.calculate(items, rules);
  }

  // ============================================
  // Invoice Numbering
  // ============================================

  /**
   * Generate next invoice number
   */
  async generateInvoiceNumber(context: NumberingContext, countryCode: string) {
    const config = this.getConfig(countryCode);
    return this.numberingService.generateNext(context, config.numbering);
  }

  /**
   * Check for gaps in numbering
   */
  async checkNumberingGaps(companyId: string, series: string | undefined, existingNumbers: number[]) {
    return this.numberingService.checkForGaps(companyId, series, existingNumbers);
  }

  // ============================================
  // Hash Chain
  // ============================================

  /**
   * Generate hash for invoice (for countries requiring hash chain)
   */
  generateInvoiceHash(input: HashInput, countryCode: string) {
    const config = this.getConfig(countryCode);

    if (!config.numbering.hashChaining) {
      return null;
    }

    // Use country-specific hash generation
    if (countryCode === 'ES') {
      return this.hashChainService.generateHashSpain(input, config.numbering);
    }
    if (countryCode === 'PT') {
      return this.hashChainService.generateHashPortugal(input);
    }

    return this.hashChainService.generateHash(input, config.numbering);
  }

  /**
   * Get initial hash for first invoice
   */
  getInitialHash(): string {
    return this.hashChainService.getInitialHash();
  }

  // ============================================
  // QR Code
  // ============================================

  /**
   * Generate QR code content for invoice
   */
  generateQRCode(input: QRCodeInput, countryCode: string) {
    const config = this.getConfig(countryCode);

    if (!config.qrCode?.required) {
      return null;
    }

    // Use country-specific QR generation
    if (countryCode === 'PT') {
      return this.qrCodeService.generatePortugalQR(input);
    }
    if (countryCode === 'ES') {
      return this.qrCodeService.generateSpainQR(input);
    }

    return this.qrCodeService.generateContent(input, config.qrCode);
  }

  // ============================================
  // Corrections (Credit Notes)
  // ============================================

  /**
   * Check if an invoice can be modified directly
   */
  canModifyInvoice(invoice: CorrectionContext, countryCode: string): boolean {
    const config = this.getConfig(countryCode);
    if (!config.correction) return true;
    return this.correctionService.canModifyDirectly(invoice, config.correction);
  }

  /**
   * Create a credit note
   */
  createCreditNote(invoice: CorrectionContext, request: CorrectionRequest, countryCode: string) {
    const config = this.getConfig(countryCode);
    if (!config.correction) {
      return {
        canCorrect: true,
        method: 'credit_note' as const,
        creditNoteData: {
          originalInvoiceRef: invoice.invoiceNumber,
          reason: request.reason,
          items: [],
          totalHT: -invoice.totalHT,
          totalVAT: -invoice.totalVAT,
          totalTTC: -invoice.totalTTC,
        },
      };
    }
    return this.correctionService.createCreditNote(invoice, request, config.correction);
  }

  /**
   * Get available correction codes for a country
   */
  getCorrectionCodes(countryCode: string) {
    const config = this.getConfig(countryCode);
    if (!config.correction) return [];
    return this.correctionService.getAvailableCodes(config.correction);
  }

  // ============================================
  // Format Generation
  // ============================================

  /**
   * Generate e-invoice XML in the appropriate format for a country
   */
  async generateInvoiceXML(invoice: InvoiceData, countryCode: string): Promise<FormatResult> {
    const config = this.getConfig(countryCode);
    return this.formatService.generate(invoice, config.format);
  }

  /**
   * Get list of supported e-invoice formats
   */
  getSupportedFormats(): string[] {
    return this.formatService.getSupportedFormats();
  }

  /**
   * Check if a format is supported
   */
  isFormatSupported(format: string): boolean {
    return this.formatService.isFormatSupported(format);
  }

  // ============================================
  // Transmission
  // ============================================

  /**
   * Send invoice using the appropriate transmission strategy
   */
  async sendInvoice(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    return this.transmissionService.send(platform, payload);
  }

  /**
   * Check transmission status
   */
  async checkTransmissionStatus(platform: string, externalId: string): Promise<TransmissionStatus> {
    return this.transmissionService.checkStatus(platform, externalId);
  }

  /**
   * Get supported transmission platforms
   */
  getSupportedPlatforms(): string[] {
    return this.transmissionService.getSupportedPlatforms();
  }

  // ============================================
  // Frontend API
  // ============================================

  /**
   * Get compliance config for frontend based on transaction context
   */
  getConfigForFrontend(
    supplierCountry: string,
    customerCountry: string | null,
    transactionType: 'B2B' | 'B2G' | 'B2C',
    nature: 'goods' | 'services' | 'mixed' = 'services',
  ): FrontendComplianceConfigDto {
    const supplierConfig = this.getConfig(supplierCountry);
    const customerConfig = customerCountry ? this.getConfig(customerCountry) : null;

    const isDomestic = supplierCountry === customerCountry;
    const isIntraEU = supplierConfig.isEU && !!customerConfig?.isEU && !isDomestic;
    const isExport = supplierConfig.isEU && !!customerConfig && !customerConfig.isEU;

    // Build simplified context for rule resolution
    const context: TransactionContext = {
      supplier: {
        countryCode: supplierCountry,
        vatNumber: null,
        isVatRegistered: true,
        identifiers: {},
      },
      customer: {
        countryCode: customerCountry,
        vatNumber: null,
        isVatRegistered: transactionType === 'B2B' && !!customerConfig?.isEU,
        isPublicEntity: transactionType === 'B2G',
        identifiers: {},
      },
      transaction: {
        type: transactionType,
        nature,
        isDomestic,
        isIntraEU,
        isExport,
      },
      place: {
        delivery: customerCountry,
        performance: customerCountry,
        taxation: isDomestic ? supplierCountry : customerCountry || supplierCountry,
      },
    };

    const rules = this.ruleResolver.resolve(context);

    return {
      vatRates: rules.vat.rates,
      defaultVatRate: rules.vat.defaultRate,
      reverseCharge: rules.vat.reverseCharge,
      reverseChargeTextKey: rules.vat.reverseChargeTextKey,
      exemptions: rules.vat.exemptions,
      requiredFields: rules.validation.requiredFields,
      identifierFormats: rules.validation.identifierFormats,
      vatNumberFormat: rules.validation.vatNumberFormat,
      format: rules.format,
      transmission: rules.transmission,
      numbering: rules.numbering,
      legalMentionKeys: rules.legalMentionKeys,
      identifiers: supplierConfig.identifiers,
      customFields: supplierConfig.customFields || [],
      qrCodeRequired: supplierConfig.qrCode?.required || false,
      signatureRequired: supplierConfig.signature?.required || false,
      hashChainRequired: supplierConfig.numbering.hashChaining,
      correctionCodes: supplierConfig.correction?.codes || [],
    };
  }
}
