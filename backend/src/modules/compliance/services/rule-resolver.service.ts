import { Injectable, Logger } from '@nestjs/common';
import { CountryComplianceFactory, GenericCountryCompliance } from '../countries';
import {
  ApplicableRules,
  FormatRules,
  TransactionContext,
  TransmissionRules,
  ValidationRules,
  VATRules,
} from '../interfaces';

/**
 * Rule Resolver Service
 * 
 * Resolves applicable compliance rules based on transaction context.
 * Uses the CountryComplianceFactory to get country-specific rules.
 */
@Injectable()
export class RuleResolverService {
  private readonly logger = new Logger(RuleResolverService.name);

  constructor(
    private readonly complianceFactory: CountryComplianceFactory,
  ) {}

  resolve(context: TransactionContext): ApplicableRules {
    const supplierCompliance = this.complianceFactory.create(context.supplier.countryCode);
    const customerCompliance = context.customer.countryCode
      ? this.complianceFactory.create(context.customer.countryCode)
      : null;

    return {
      vat: this.resolveVAT(context, supplierCompliance),
      validation: this.resolveValidation(context, supplierCompliance, customerCompliance),
      format: this.resolveFormat(context, supplierCompliance, customerCompliance),
      transmission: this.resolveTransmission(context, supplierCompliance, customerCompliance),
      numbering: {
        seriesRequired: false,
        seriesRegistration: false,
        hashChaining: supplierCompliance.requiresHashChain(),
        gapAllowed: true,
        resetPeriod: 'yearly',
      },
      legalMentionKeys: supplierCompliance.getLegalMentions(),
    };
  }

  /**
   * Resolves VAT rules based on transaction context
   */
  private resolveVAT(context: TransactionContext, compliance: GenericCountryCompliance): VATRules {
    // Reverse charge: intra-EU B2B/B2G with registered customer
    if (
      context.transaction.isIntraEU &&
      context.customer.isVatRegistered &&
      (context.transaction.type === 'B2B' || context.transaction.type === 'B2G')
    ) {
      const reverseChargeTextKey =
        context.transaction.nature === 'goods'
          ? 'compliance.reverseCharge.goods'
          : 'compliance.reverseCharge.services';

      return {
        rates: [{ code: 'AE', rate: 0, labelKey: 'vat.reverseCharge' }],
        exemptions: [],
        defaultRate: 0,
        reverseCharge: true,
        reverseChargeTextKey,
      };
    }

    // Export outside EU
    if (context.transaction.isExport) {
      return {
        rates: [{ code: 'G', rate: 0, labelKey: 'vat.export' }],
        exemptions: [],
        defaultRate: 0,
        reverseCharge: false,
        reverseChargeTextKey: null,
      };
    }

    // Domestic or other: issuer country rates
    return {
      rates: compliance.getVatRates(),
      exemptions: [],
      defaultRate: compliance.getVatRateForCategory('S'),
      reverseCharge: false,
      reverseChargeTextKey: null,
    };
  }

  /**
   * Resolves validation rules
   */
  private resolveValidation(
    _context: TransactionContext,
    supplierCompliance: GenericCountryCompliance,
    customerCompliance: GenericCountryCompliance | null,
  ): ValidationRules {
    const identifierFormats: Record<string, string> = {};

    // Add issuer country identifier formats
    for (const identifierType of supplierCompliance.getSupportedIdentifierTypes()) {
      identifierFormats[identifierType] = '.*'; // Simplified, should use actual regex
    }

    // Add customer identifier formats if customer country known
    if (customerCompliance) {
      for (const identifierType of customerCompliance.getSupportedIdentifierTypes()) {
        identifierFormats[`client_${identifierType}`] = '.*';
      }
    }

    return {
      requiredFields: {
        invoice: supplierCompliance.getRequiredInvoiceFields(),
        client: supplierCompliance.getRequiredClientFields(),
      },
      identifierFormats,
      vatNumberFormat: supplierCompliance.isEU ? '^[A-Z]{2}[0-9A-Z]{8,12}$' : '.*',
    };
  }

  /**
   * Resolves document format rules
   */
  private resolveFormat(
    context: TransactionContext,
    supplierCompliance: GenericCountryCompliance,
    customerCompliance: GenericCountryCompliance | null,
  ): FormatRules {
    const supportedFormats = supplierCompliance.getSupportedEInvoiceFormats();

    // For B2G, customer country format may take precedence
    if (context.transaction.type === 'B2G' && customerCompliance) {
      return {
        preferred: 'pdf',
        supported: customerCompliance.getSupportedEInvoiceFormats(),
        xmlSyntax: 'UBL',
      };
    }

    return {
      preferred: 'pdf',
      supported: supportedFormats,
      xmlSyntax: 'UBL',
    };
  }

  /**
   * Resolves transmission rules
   */
  private resolveTransmission(
    context: TransactionContext,
    supplierCompliance: GenericCountryCompliance,
    _customerCompliance: GenericCountryCompliance | null,
  ): TransmissionRules {
    const methods = supplierCompliance.getSupportedTransmissionMethods();

    // Find preferred method (first available or email fallback)
    const preferredMethod = methods.find(m => m.supported) || { 
      id: 'email', 
      name: 'Email', 
      description: '', 
      supported: true, 
      mandatory: false 
    };

    return {
      method: preferredMethod.id as any,
      mandatory: preferredMethod.mandatory,
      platform: preferredMethod.id,
      async: false,
      deadlineDays: null,
      labelKey: `transmission.${preferredMethod.id}`,
      icon: 'mail',
    };
  }
}
