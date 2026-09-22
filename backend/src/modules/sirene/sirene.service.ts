import { Injectable, Logger } from '@nestjs/common';
import { FranceProvider } from '@/modules/company-lookup/providers/fr.provider';
import { SireneCompanyDto } from '@/modules/sirene/dto/sirene-company.dto';
import { isValidSiret } from '@/modules/sirene/sirene.utils';

/**
 * French SIRET lookup — a thin, backwards-compatible facade over the country-aware
 * company lookup (`modules/company-lookup`). New code should call CompanyLookupService,
 * which serves every country that has a registry API; this endpoint stays for the
 * existing `/api/sirene/siret/:siret` callers.
 */
@Injectable()
export class SireneService {
  private readonly logger = new Logger(SireneService.name);
  private readonly provider = new FranceProvider();

  async getCompanyBySiret(siret: string): Promise<SireneCompanyDto | null> {
    if (!isValidSiret(siret)) return null;

    try {
      const company = await this.provider.lookup({
        countryCode: 'FR',
        scheme: 'LEGAL_ID',
        value: siret,
      });
      if (!company) return null;

      return {
        name: company.name,
        legalId: company.legalId as string,
        VAT: company.VAT,
        address: company.address,
        postalCode: company.postalCode,
        city: company.city,
        state: company.state,
        country: company.country,
        foundedAt: company.foundedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Sirene lookup for ${siret} failed: ${message}`);
      return null;
    }
  }
}
