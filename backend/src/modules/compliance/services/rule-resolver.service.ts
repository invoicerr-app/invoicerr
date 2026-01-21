import { Injectable } from '@nestjs/common';
import { getCountryConfig } from '../configs';
import type {
  ApplicableRules,
  CountryConfig,
  FormatRules,
  TransactionContext,
  TransmissionRules,
  VATRules,
  ValidationRules,
} from '../interfaces';

@Injectable()
export class RuleResolverService {
  resolve(context: TransactionContext): ApplicableRules {
    const supplierConfig = getCountryConfig(context.supplier.countryCode);
    const customerConfig = context.customer.countryCode
      ? getCountryConfig(context.customer.countryCode)
      : null;

    return {
      vat: this.resolveVAT(context, supplierConfig),
      validation: this.resolveValidation(context, supplierConfig, customerConfig),
      format: this.resolveFormat(supplierConfig),
      transmission: this.resolveTransmission(context, supplierConfig, customerConfig),
      numbering: supplierConfig.numbering,
      legalMentionKeys: this.resolveMentions(context, supplierConfig),
    };
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
      // Choose text based on nature (goods vs services)
      const reverseChargeTextKey =
        context.transaction.nature === 'goods'
          ? config.vat.reverseChargeTexts.goods
          : config.vat.reverseChargeTexts.services;

      return {
        rates: [{ code: 'AE', rate: 0, label: 'vat.reverseCharge' }],
        exemptions: config.vat.exemptions,
        defaultRate: 0,
        reverseCharge: true,
        reverseChargeTextKey,
      };
    }

    // Export outside EU
    if (context.transaction.isExport) {
      return {
        rates: [{ code: 'G', rate: 0, label: 'vat.export' }],
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
  private resolveFormat(config: CountryConfig): FormatRules {
    return {
      preferred: config.documentFormat.preferred,
      supported: config.documentFormat.supported,
      xmlSyntax: config.documentFormat.xmlSyntax,
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
        method: b2gConfig.method,
        mandatory: b2gConfig.mandatory,
        platform: b2gConfig.platform || null,
        async: b2gConfig.async,
        deadlineDays: b2gConfig.deadlineDays || null,
        labelKey: b2gConfig.labelKey,
        icon: b2gConfig.icon,
      };
    }

    // B2B/B2C: issuer country rules
    const b2bConfig = supplierConfig.transmission.b2b;
    return {
      method: b2bConfig.method,
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
      // Simplified condition evaluation
      // In production, use a more robust expression evaluator
      if (this.evaluateCondition(conditional.condition, context)) {
        mentions.push(conditional.textKey);
      }
    }

    return mentions;
  }

  /**
   * Evaluates a simple condition
   * Supports: company.exemptVat, transaction.isIntraEU, etc.
   */
  private evaluateCondition(condition: string, context: TransactionContext): boolean {
    // For now, only handle a few basic conditions
    switch (condition) {
      case 'transaction.isIntraEU':
        return context.transaction.isIntraEU;
      case 'transaction.isExport':
        return context.transaction.isExport;
      case 'customer.isVatRegistered':
        return context.customer.isVatRegistered;
      default:
        // Unhandled conditions = false
        return false;
    }
  }
}
