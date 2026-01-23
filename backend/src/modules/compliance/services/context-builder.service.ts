import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigRegistry, getCountryConfig } from '../configs';
import { CountryConfig, TransactionContext } from '../interfaces';
import { VIESService } from './vies.service';

export interface ContextBuildInput {
  company: {
    countryCode: string;
    VAT: string | null;
    exemptVat: boolean;
    identifiers?: Record<string, string>;
  };
  client: {
    countryCode: string | null;
    VAT: string | null;
    type: 'COMPANY' | 'INDIVIDUAL';
    isPublicEntity?: boolean;
    identifiers?: Record<string, string>;
  };
  items?: Array<{
    type: string; // 'HOUR' | 'DAY' | 'SERVICE' | 'PRODUCT' | 'DEPOSIT'
  }>;
  deliveryCountry?: string;
}

export interface ExtendedTransactionContext extends TransactionContext {
  supplierConfig: CountryConfig;
  customerConfig: CountryConfig | null;
}

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly viesService: VIESService,
    @Optional() private readonly configRegistry?: ConfigRegistry,
  ) {}

  async build(input: ContextBuildInput): Promise<TransactionContext> {
    const { company, client } = input;

    const supplierConfig = this.getConfig(company.countryCode);
    const customerConfig = client.countryCode
      ? this.getConfig(client.countryCode)
      : null;

    // Validate customer VAT if intra-EU
    let customerVatValid = false;
    if (client.VAT && customerConfig?.isEU && supplierConfig.isEU) {
      customerVatValid = await this.viesService.validate(client.VAT);
    }

    const isDomestic = company.countryCode === client.countryCode;
    const isIntraEU = supplierConfig.isEU && !!customerConfig?.isEU && !isDomestic;
    const isExport = supplierConfig.isEU && !!customerConfig && !customerConfig.isEU;

    // Determine transaction nature (goods vs services)
    const nature = this.resolveNature(input.items);

    // Determine transaction type
    const type = this.resolveType(client);

    // Compute taxation place
    const taxationPlace = this.resolveTaxationPlace({
      supplierCountry: company.countryCode,
      customerCountry: client.countryCode,
      customerVatValid,
      nature,
      type,
      deliveryPlace: input.deliveryCountry,
      supplierConfig,
      customerConfig,
    });

    return {
      supplier: {
        countryCode: company.countryCode,
        vatNumber: company.VAT,
        isVatRegistered: !!company.VAT && !company.exemptVat,
        identifiers: company.identifiers || {},
      },
      customer: {
        countryCode: client.countryCode,
        vatNumber: client.VAT,
        isVatRegistered: customerVatValid,
        isPublicEntity: client.isPublicEntity || false,
        identifiers: client.identifiers || {},
      },
      transaction: {
        type,
        nature,
        isDomestic,
        isIntraEU,
        isExport,
      },
      place: {
        delivery: input.deliveryCountry || client.countryCode,
        performance: client.countryCode,
        taxation: taxationPlace,
      },
    };
  }

  /**
   * Build extended context with configs included
   */
  async buildExtended(input: ContextBuildInput): Promise<ExtendedTransactionContext> {
    const context = await this.build(input);
    const supplierConfig = this.getConfig(input.company.countryCode);
    const customerConfig = input.client.countryCode
      ? this.getConfig(input.client.countryCode)
      : null;

    return {
      ...context,
      supplierConfig,
      customerConfig,
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
   * Determines transaction type (B2B, B2G, B2C)
   */
  private resolveType(client: ContextBuildInput['client']): 'B2B' | 'B2G' | 'B2C' {
    if (client.isPublicEntity) return 'B2G';
    if (client.type === 'COMPANY') return 'B2B';
    return 'B2C';
  }

  /**
   * Determines transaction nature (goods, services, mixed)
   */
  private resolveNature(items?: Array<{ type: string }>): 'goods' | 'services' | 'mixed' {
    if (!items || items.length === 0) return 'services';

    const hasGoods = items.some((i) => ['PRODUCT'].includes(i.type));
    const hasServices = items.some((i) =>
      ['HOUR', 'DAY', 'SERVICE', 'DEPOSIT'].includes(i.type),
    );

    if (hasGoods && hasServices) return 'mixed';
    if (hasGoods) return 'goods';
    return 'services';
  }

  /**
   * Determines the country where VAT is due according to EU rules
   */
  private resolveTaxationPlace(params: {
    supplierCountry: string;
    customerCountry: string | null;
    customerVatValid: boolean;
    nature: 'goods' | 'services' | 'mixed';
    type: 'B2B' | 'B2G' | 'B2C';
    deliveryPlace: string | null | undefined;
    supplierConfig: CountryConfig;
    customerConfig: CountryConfig | null;
  }): string {
    const {
      supplierCountry,
      customerCountry,
      customerVatValid,
      nature,
      type,
      supplierConfig,
      customerConfig,
    } = params;

    // Non-EU supplier: taxation rules of supplier country
    if (!supplierConfig.isEU) {
      return supplierCountry;
    }

    // B2C = always seller's country (except OSS exceptions)
    if (type === 'B2C') {
      return supplierCountry;
    }

    // Domestic = same country
    if (supplierCountry === customerCountry) {
      return supplierCountry;
    }

    // Export outside EU = no VAT (exempt)
    if (customerConfig && !customerConfig.isEU) {
      return supplierCountry; // VAT exempt, but document issued in supplier country
    }

    // Intra-EU B2B/B2G services with valid VAT = customer country (reverse charge)
    if (nature === 'services' && customerVatValid && customerCountry) {
      return customerCountry;
    }

    // Intra-EU B2B/B2G goods = exempt delivery, destination country taxation
    if (nature === 'goods' && customerVatValid && customerCountry) {
      return customerCountry;
    }

    // Mixed: complex case - would need to split invoice in practice
    // Default to seller's country
    return supplierCountry;
  }
}
