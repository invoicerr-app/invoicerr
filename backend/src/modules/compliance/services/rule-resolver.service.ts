import { Injectable } from '@nestjs/common';
import { ApplicableRules, CountryConfig, TransactionContext, TransmissionConfig } from '../interfaces';
import { getCountryConfig } from '../configs';

@Injectable()
export class RuleResolverService {
  resolve(context: TransactionContext): ApplicableRules {
    const supplierConfig = getCountryConfig(context.supplier.countryCode);
    const customerConfig = context.customer.countryCode
      ? getCountryConfig(context.customer.countryCode)
      : null;

    return {
      vat: this.resolveVAT(context, supplierConfig),
      requiredFields: this.resolveRequiredFields(context, supplierConfig, customerConfig),
      transmission: this.resolveTransmission(context, supplierConfig, customerConfig),
      legalMentionKeys: this.resolveMentions(context, supplierConfig),
    };
  }

  private resolveVAT(context: TransactionContext, config: CountryConfig) {
    // Reverse charge: B2B intra-EU with VAT-registered customer
    if (
      context.transaction.isIntraEU &&
      context.customer.isVatRegistered &&
      context.transaction.type === 'B2B'
    ) {
      return {
        rates: [{ code: 'AE', rate: 0, label: 'vat.reverseCharge' }],
        defaultRate: 0,
        reverseCharge: true,
        reverseChargeTextKey: config.vat.reverseChargeTextKey,
      };
    }

    // Export outside EU
    if (context.transaction.isExport) {
      return {
        rates: [{ code: 'G', rate: 0, label: 'vat.export' }],
        defaultRate: 0,
        reverseCharge: false,
        reverseChargeTextKey: null,
      };
    }

    // Domestic or other: supplier country rates
    return {
      rates: config.vat.rates,
      defaultRate: config.vat.defaultRate,
      reverseCharge: false,
      reverseChargeTextKey: null,
    };
  }

  private resolveRequiredFields(
    context: TransactionContext,
    supplierConfig: CountryConfig,
    customerConfig: CountryConfig | null,
  ) {
    const invoiceFields = [...supplierConfig.requiredFields.invoice];
    const clientFields = [...supplierConfig.requiredFields.client];

    // B2G may require additional fields
    if (context.transaction.type === 'B2G' && customerConfig) {
      // Add any B2G-specific required fields here
    }

    return {
      invoice: invoiceFields,
      client: clientFields,
    };
  }

  private resolveTransmission(
    context: TransactionContext,
    supplierConfig: CountryConfig,
    customerConfig: CountryConfig | null,
  ): TransmissionConfig {
    // B2G: use customer country rules
    if (context.transaction.type === 'B2G' && customerConfig) {
      return customerConfig.transmission.b2g;
    }

    // B2B/B2C: use supplier country rules
    return supplierConfig.transmission.b2b;
  }

  private resolveMentions(context: TransactionContext, config: CountryConfig): string[] {
    const mentions: string[] = [];

    // Add reverse charge mention
    if (context.transaction.isIntraEU && context.customer.isVatRegistered) {
      mentions.push(config.vat.reverseChargeTextKey);
    }

    return mentions;
  }
}
