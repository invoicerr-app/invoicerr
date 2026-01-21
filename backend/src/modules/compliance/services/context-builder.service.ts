import { Injectable } from '@nestjs/common';
import { getCountryConfig } from '../configs';
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

@Injectable()
export class ContextBuilderService {
  constructor(private readonly viesService: VIESService) {}

  async build(input: ContextBuildInput): Promise<TransactionContext> {
    const { company, client } = input;

    const supplierConfig = getCountryConfig(company.countryCode);
    const customerConfig = client.countryCode ? getCountryConfig(client.countryCode) : null;

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
        performance: client.countryCode, // Simplified for B2B services
        taxation: taxationPlace,
      },
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
    const hasServices = items.some((i) => ['HOUR', 'DAY', 'SERVICE', 'DEPOSIT'].includes(i.type));

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
  }): string {
    const { supplierCountry, customerCountry, customerVatValid, nature, type } = params;

    // B2C = always seller's country (except OSS exceptions)
    if (type === 'B2C') {
      return supplierCountry;
    }

    // Domestic = same country
    if (supplierCountry === customerCountry) {
      return supplierCountry;
    }

    // Intra-EU B2B/B2G services with valid VAT = customer country (reverse charge)
    if (nature === 'services' && customerVatValid && customerCountry) {
      return customerCountry;
    }

    // Intra-EU B2B/B2G goods = exempt delivery, destination country taxation
    if (nature === 'goods' && customerVatValid && customerCountry) {
      return customerCountry;
    }

    // Mixed: use most restrictive case (seller's country)
    // In practice, the invoice should be split or complex rules applied

    // Default = seller's country
    return supplierCountry;
  }
}
