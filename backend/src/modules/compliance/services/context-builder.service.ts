import { Injectable, Logger } from '@nestjs/common';
import { CountryComplianceFactory, GenericCountryCompliance } from '../countries';
import { TransactionContext } from '../interfaces';
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
  supplierCompliance: GenericCountryCompliance;
  customerCompliance: GenericCountryCompliance | null;
}

/**
 * Context Builder Service
 * 
 * Builds transaction context for compliance checks.
 * Uses the CountryComplianceFactory to get country-specific compliance.
 */
@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly viesService: VIESService,
    private readonly complianceFactory: CountryComplianceFactory,
  ) {}

  async build(input: ContextBuildInput): Promise<TransactionContext> {
    const { company, client } = input;

    const supplierCompliance = this.complianceFactory.create(company.countryCode);
    const customerCompliance = client.countryCode
      ? this.complianceFactory.create(client.countryCode)
      : null;

    // Validate customer VAT if intra-EU
    let customerVatValid = false;
    if (client.VAT && customerCompliance?.isEU && supplierCompliance.isEU) {
      customerVatValid = await this.viesService.validate(client.VAT);
    }

    const isDomestic = company.countryCode === client.countryCode;
    const isIntraEU = supplierCompliance.isEU && !!customerCompliance?.isEU && !isDomestic;
    const isExport = supplierCompliance.isEU && !!customerCompliance && !customerCompliance.isEU;

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
      supplierCompliance,
      customerCompliance,
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
   * Build extended context with compliance objects included
   */
  async buildExtended(input: ContextBuildInput): Promise<ExtendedTransactionContext> {
    const context = await this.build(input);
    const supplierCompliance = this.complianceFactory.create(input.company.countryCode);
    const customerCompliance = input.client.countryCode
      ? this.complianceFactory.create(input.client.countryCode)
      : null;

    return {
      ...context,
      supplierCompliance,
      customerCompliance,
    };
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
    supplierCompliance: GenericCountryCompliance;
    customerCompliance: GenericCountryCompliance | null;
  }): string {
    const {
      supplierCountry,
      customerCountry,
      customerVatValid,
      nature,
      type,
      supplierCompliance,
      customerCompliance,
    } = params;

    // Non-EU supplier: taxation rules of supplier country
    if (!supplierCompliance.isEU) {
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
    if (customerCompliance && !customerCompliance.isEU) {
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
