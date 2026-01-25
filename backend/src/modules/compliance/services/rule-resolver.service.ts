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
    const customerCountry = context.customer.countryCode;

    // Check for cross-border override first
    if (customerCountry && supplierConfig.transmission.crossBorder) {
      const crossBorderPlatform = supplierConfig.transmission.crossBorder[customerCountry];
      if (crossBorderPlatform) {
        return this.buildTransmissionFromPlatform(crossBorderPlatform, supplierConfig);
      }
    }

    // Export to non-EU: use exportDefault or email
    if (context.transaction.isExport) {
      const exportPlatform = supplierConfig.transmission.exportDefault || 'email';
      return this.buildTransmissionFromPlatform(exportPlatform, supplierConfig);
    }

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

    // Handle dot-notation path conditions (e.g., "transaction.isIntraEU")
    if (typeof condition === 'string' && condition.includes('.')) {
      return this.evaluatePath(condition, context);
    }

    // Handle string conditions for backwards compatibility
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
      case 'supplier.isVatRegistered':
        return context.supplier.isVatRegistered;
      // Transaction type conditions
      case 'transaction.type.B2B':
        return context.transaction.type === 'B2B';
      case 'transaction.type.B2G':
        return context.transaction.type === 'B2G';
      case 'transaction.type.B2C':
        return context.transaction.type === 'B2C';
      // Transaction nature conditions
      case 'transaction.nature.goods':
        return context.transaction.nature === 'goods';
      case 'transaction.nature.services':
        return context.transaction.nature === 'services';
      case 'transaction.nature.mixed':
        return context.transaction.nature === 'mixed';
      default:
        this.logger.debug(`Unhandled string condition: ${condition}`);
        return false;
    }
  }

  /**
   * Evaluate a dot-notation path against the context
   */
  private evaluatePath(path: string, context: TransactionContext): boolean {
    const parts = path.split('.');
    let value: unknown = context;

    for (const part of parts) {
      if (value === null || value === undefined) {
        return false;
      }
      if (typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        this.logger.debug(`Path evaluation failed for "${path}" at "${part}"`);
        return false;
      }
    }

    // Return boolean value, or true if value is truthy
    return value === true || (typeof value === 'string' && value !== '');
  }

  private evaluateStructuredCondition(
    condition: Record<string, unknown>,
    context: TransactionContext,
  ): boolean {
    const type = condition.type as string;
    const property = condition.property as string;
    const value = condition.value;
    const operator = (condition.operator as string) || 'equals';

    // Get the actual value from context
    let actualValue: unknown;

    switch (type) {
      case 'transaction':
        actualValue = context.transaction[property as keyof typeof context.transaction];
        break;
      case 'customer':
        actualValue = context.customer[property as keyof typeof context.customer];
        break;
      case 'supplier':
        actualValue = context.supplier[property as keyof typeof context.supplier];
        break;
      case 'place':
        actualValue = context.place[property as keyof typeof context.place];
        break;
      case 'path':
        // Allow arbitrary path evaluation
        return this.evaluatePath(property, context);
      case 'and':
        // Logical AND of multiple conditions
        if (Array.isArray(condition.conditions)) {
          return condition.conditions.every((c) =>
            this.evaluateCondition(c as string | object, context),
          );
        }
        return false;
      case 'or':
        // Logical OR of multiple conditions
        if (Array.isArray(condition.conditions)) {
          return condition.conditions.some((c) =>
            this.evaluateCondition(c as string | object, context),
          );
        }
        return false;
      case 'not':
        // Logical NOT of a condition
        if (condition.condition) {
          return !this.evaluateCondition(condition.condition as string | object, context);
        }
        return false;
      default:
        this.logger.debug(`Unknown condition type: ${type}`);
        return false;
    }

    // Apply operator
    return this.applyOperator(actualValue, operator, value);
  }

  /**
   * Apply comparison operator
   */
  private applyOperator(actual: unknown, operator: string, expected: unknown): boolean {
    switch (operator) {
      case 'equals':
      case 'eq':
        return actual === expected;
      case 'notEquals':
      case 'ne':
        return actual !== expected;
      case 'exists':
        return actual !== null && actual !== undefined;
      case 'notExists':
        return actual === null || actual === undefined;
      case 'in':
        return Array.isArray(expected) && expected.includes(actual);
      case 'notIn':
        return Array.isArray(expected) && !expected.includes(actual);
      case 'gt':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'gte':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      case 'lt':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case 'lte':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'contains':
        return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected);
      case 'startsWith':
        return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected);
      case 'endsWith':
        return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected);
      case 'matches':
        return typeof actual === 'string' && typeof expected === 'string' && new RegExp(expected).test(actual);
      case 'isTrue':
        return actual === true;
      case 'isFalse':
        return actual === false;
      default:
        // Default to equality check
        return actual === expected;
    }
  }

  /**
   * Build transmission rules from a platform name
   */
  private buildTransmissionFromPlatform(
    platform: string,
    supplierConfig: CountryConfig,
  ): TransmissionRules {
    // Map known platforms to their configurations
    const platformConfigs: Record<string, Partial<TransmissionRules>> = {
      email: {
        method: 'email',
        mandatory: false,
        platform: 'email',
        async: false,
        deadlineDays: null,
        labelKey: 'transmission.email',
        icon: 'mail',
      },
      peppol: {
        method: 'peppol',
        mandatory: false,
        platform: 'peppol',
        async: true,
        deadlineDays: null,
        labelKey: 'transmission.peppol',
        icon: 'globe',
      },
      superpdp: {
        method: 'pdp',
        mandatory: true,
        platform: 'superpdp',
        async: true,
        deadlineDays: supplierConfig.transmission.b2b?.deadlineDays || null,
        labelKey: 'transmission.superpdp',
        icon: 'shield-check',
      },
      sdi: {
        method: 'clearance',
        mandatory: true,
        platform: 'sdi',
        async: true,
        deadlineDays: 12,
        labelKey: 'transmission.sdi',
        icon: 'building-2',
      },
      choruspro: {
        method: 'pdp',
        mandatory: true,
        platform: 'choruspro',
        async: true,
        deadlineDays: 30,
        labelKey: 'transmission.choruspro',
        icon: 'building-2',
      },
    };

    const config = platformConfigs[platform.toLowerCase()];
    if (config) {
      return {
        method: config.method || 'email',
        mandatory: config.mandatory ?? false,
        platform: config.platform || platform,
        async: config.async ?? false,
        deadlineDays: config.deadlineDays ?? null,
        labelKey: config.labelKey || `transmission.${platform}`,
        icon: config.icon || 'mail',
      };
    }

    // Fallback for unknown platforms - default to email
    return {
      method: 'email',
      mandatory: false,
      platform: platform,
      async: false,
      deadlineDays: null,
      labelKey: `transmission.${platform}`,
      icon: 'mail',
    };
  }
}
