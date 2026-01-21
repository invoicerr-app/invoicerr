import { Injectable } from '@nestjs/common';
import { getAllCountryConfigs, getCountryConfig } from './configs';
import { CountrySummaryDto, FrontendComplianceConfigDto } from './dto/compliance-config.dto';
import { TransactionContext } from './interfaces';
import { ContextBuilderService, ContextBuildInput } from './services/context-builder.service';
import { RuleResolverService } from './services/rule-resolver.service';
import {
  VATCalculationInput,
  VATCalculationResult,
  VATRules as VATEngineRules,
  VATEngineService,
} from './services/vat-engine.service';
import { TransmissionPayload, TransmissionResult } from './transmission/transmission.interface';
import { TransmissionService } from './transmission/transmission.service';

@Injectable()
export class ComplianceService {
  constructor(
    private readonly contextBuilder: ContextBuilderService,
    private readonly ruleResolver: RuleResolverService,
    private readonly vatEngine: VATEngineService,
    private readonly transmissionService: TransmissionService,
  ) {}

  /**
   * Get raw country config
   */
  getConfig(countryCode: string) {
    return getCountryConfig(countryCode);
  }

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

  /**
   * Calculate VAT based on items and rules
   */
  calculateVAT(items: VATCalculationInput[], rules: VATEngineRules): VATCalculationResult {
    return this.vatEngine.calculate(items, rules);
  }

  /**
   * Send invoice using the appropriate transmission strategy
   */
  async sendInvoice(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    return this.transmissionService.send(platform, payload);
  }

  /**
   * Get compliance config for frontend based on transaction context
   */
  getConfigForFrontend(
    supplierCountry: string,
    customerCountry: string | null,
    transactionType: 'B2B' | 'B2G' | 'B2C',
    nature: 'goods' | 'services' | 'mixed' = 'services',
  ): FrontendComplianceConfigDto {
    const supplierConfig = getCountryConfig(supplierCountry);
    const customerConfig = customerCountry ? getCountryConfig(customerCountry) : null;

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
    };
  }

  /**
   * Get list of supported countries
   */
  getAvailableCountries(): CountrySummaryDto[] {
    return getAllCountryConfigs().map((c) => ({
      code: c.code,
      currency: c.currency,
      isEU: c.isEU,
    }));
  }
}
