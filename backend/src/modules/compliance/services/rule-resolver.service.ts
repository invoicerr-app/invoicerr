import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigRegistry, getCountryConfig } from '../configs';
import {
  ApplicableRules,
  CountryConfig,
  FormatRules,
  TransactionContext,
  TransmissionRules,
  ValidationRules,
  VATRules,
} from '../interfaces';

@Injectable()
export class RuleResolverService {
  private readonly logger = new Logger(RuleResolverService.name);

  constructor(@Optional() private readonly configRegistry?: ConfigRegistry) {}

  resolve(context: TransactionContext): ApplicableRules {
    const supplierConfig = this.getConfig(context.supplier.countryCode);
    const customerConfig = context.customer.countryCode
      ? this.getConfig(context.customer.countryCode)
      : null;

    return {
      vat: this.resolveVAT(context, supplierConfig),
      validation: this.resolveValidation(context, supplierConfig, customerConfig),
      format: this.resolveFormat(context, supplierConfig, customerConfig),
      transmission: this.resolveTransmission(context, supplierConfig, customerConfig),
      numbering: supplierConfig.numbering,
      legalMentionKeys: this.resolveMentions(context, supplierConfig),
    };
  }

  private getConfig(countryCode: string): CountryConfig {
    try {
      if (this.configRegistry) {
        return this.configRegistry.get(countryCode);
      }
      return getCountryConfig(countryCode);
    } catch (error) {
      this.logger.warn(
        `Failed to get config for country ${countryCode}, using fallback: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      // Return generic config as fallback
      return getCountryConfig('GENERIC');
    }
  }

  /**
   * Resolves VAT rules based on transaction context
   */
  private resolveVAT(context: TransactionContext, config: CountryConfig): VATRules {
    // Reverse charge: intra-EU B2B/B2G with registered customer
    if (
      context.transaction.isIntraEU &&
      context.customer.isVatRegistered &&
      (context.transaction.type === 'B2B' || context.transaction.type === 'B2G')
    ) {
      const reverseChargeTextKey =
        context.transaction.nature === 'goods'
          ? config.vat.reverseChargeTexts.goods
          : config.vat.reverseChargeTexts.services;

      return {
        rates: [{ code: 'AE', rate: 0, labelKey: 'vat.reverseCharge' }],
        exemptions: config.vat.exemptions,
        defaultRate: 0,
        reverseCharge: true,
        reverseChargeTextKey,
      };
    }

    // Export outside EU
    if (context.transaction.isExport) {
      return {
        rates: [{ code: 'G', rate: 0, labelKey: 'vat.export' }],
        exemptions: config.vat.exemptions,
        defaultRate: 0,
        reverseCharge: false,
        reverseChargeTextKey: null,
      };
    }

    // Domestic or other: issuer country rates
    return {
      rates: config.vat.rates,
      exemptions: config.vat.exemptions,
      defaultRate: config.vat.defaultRate,
      reverseCharge: false,
      reverseChargeTextKey: null,
    };
  }

  /**
   * Resolves validation rules
   */
  private resolveValidation(
    _context: TransactionContext,
    supplierConfig: CountryConfig,
    customerConfig: CountryConfig | null,
  ): ValidationRules {
    const identifierFormats: Record<string, string> = {};

    // Add issuer country identifier formats
    for (const identifier of supplierConfig.identifiers.company) {
      identifierFormats[identifier.id] = identifier.format;
    }

    // Add customer identifier formats if customer country known
    if (customerConfig) {
      for (const identifier of customerConfig.identifiers.client) {
        identifierFormats[`client_${identifier.id}`] = identifier.format;
      }
    }

    return {
      requiredFields: {
        invoice: supplierConfig.requiredFields.invoice,
        client: supplierConfig.requiredFields.client,
      },
      identifierFormats,
      vatNumberFormat: supplierConfig.vat.numberFormat,
    };
  }

  /**
   * Resolves document format rules
   */
  private resolveFormat(
    context: TransactionContext,
    supplierConfig: CountryConfig,
    customerConfig: CountryConfig | null,
  ): FormatRules {
    // For B2G, customer country format may take precedence
    if (context.transaction.type === 'B2G' && customerConfig) {
      return {
        preferred: customerConfig.format.preferred,
        supported: customerConfig.format.supported,
        xmlSyntax: customerConfig.format.syntax,
      };
    }

    return {
      preferred: supplierConfig.format.preferred,
      supported: supplierConfig.format.supported,
      xmlSyntax: supplierConfig.format.syntax,
    };
  }

  /**
   * Resolves transmission rules
   */
  private resolveTransmission(
    context: TransactionContext,
    supplierConfig: CountryConfig,
    customerConfig: CountryConfig | null,
  ): TransmissionRules {
    // B2G: customer country rules (public entity)
    if (context.transaction.type === 'B2G' && customerConfig) {
      const b2gConfig = customerConfig.transmission.b2g;
      return {
        method: b2gConfig.model,
        mandatory: b2gConfig.mandatory,
        platform: b2gConfig.platform || null,
        async: b2gConfig.async,
        deadlineDays: b2gConfig.deadlineDays || null,
        labelKey: b2gConfig.labelKey,
        icon: b2gConfig.icon,
      };
    }

    // B2C: check if specific B2C config exists
    if (context.transaction.type === 'B2C' && supplierConfig.transmission.b2c) {
      const b2cConfig = supplierConfig.transmission.b2c;
      return {
        method: b2cConfig.model,
        mandatory: b2cConfig.mandatory,
        platform: b2cConfig.platform || null,
        async: b2cConfig.async,
        deadlineDays: b2cConfig.deadlineDays || null,
        labelKey: b2cConfig.labelKey,
        icon: b2cConfig.icon,
      };
    }

    // B2B or fallback: issuer country rules
    const b2bConfig = supplierConfig.transmission.b2b;
    return {
      method: b2bConfig.model,
      mandatory: b2bConfig.mandatory,
      platform: b2bConfig.platform || null,
      async: b2bConfig.async,
      deadlineDays: b2bConfig.deadlineDays || null,
      labelKey: b2bConfig.labelKey,
      icon: b2bConfig.icon,
    };
  }

  /**
   * Resolves mandatory legal mentions
   */
  private resolveMentions(context: TransactionContext, config: CountryConfig): string[] {
    const mentions: string[] = [...config.legalMentions.mandatory];

    // Add conditional mentions
    for (const conditional of config.legalMentions.conditional) {
      if (this.evaluateCondition(conditional.condition, context)) {
        mentions.push(conditional.textKey);
      }
    }

    return mentions;
  }

  /**
   * Evaluates a condition (string or structured)
   */
  private evaluateCondition(
    condition: string | object,
    context: TransactionContext,
  ): boolean {
    // Handle structured conditions
    if (typeof condition === 'object' && 'type' in condition) {
      return this.evaluateStructuredCondition(condition as Record<string, unknown>, context);
    }

    // Handle string conditions
    switch (condition) {
      case 'transaction.isIntraEU':
        return context.transaction.isIntraEU;
      case 'transaction.isExport':
        return context.transaction.isExport;
      case 'transaction.isDomestic':
        return context.transaction.isDomestic;
      case 'customer.isVatRegistered':
        return context.customer.isVatRegistered;
      case 'customer.isPublicEntity':
        return context.customer.isPublicEntity;
      case 'company.exemptVat':
        // This would need to be passed in context
        return false;
      default:
        // Unhandled conditions = false
        return false;
    }
  }

  private evaluateStructuredCondition(
    condition: Record<string, unknown>,
    context: TransactionContext,
  ): boolean {
    const type = condition.type as string;

    switch (type) {
      case 'transaction':
        return context.transaction[condition.property as keyof typeof context.transaction] === true;
      case 'customer':
        return context.customer[condition.property as keyof typeof context.customer] === true;
      case 'field':
        // Would need access to invoice fields
        return false;
      case 'expression':
        // Would need an expression evaluator
        return false;
      default:
        return false;
    }
  }
}
