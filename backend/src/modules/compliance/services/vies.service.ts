import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry {
  valid: boolean;
  timestamp: number;
}

/**
 * Service for validating EU VAT numbers via the VIES (VAT Information Exchange System) service.
 *
 * IMPORTANT: This service uses a fail-open strategy. If the VIES service is unavailable
 * or returns an error, VAT numbers are accepted as valid by default. This design choice
 * prevents VIES downtime from blocking invoice creation, but means invalid VAT numbers
 * may occasionally pass validation when VIES is unavailable.
 *
 * For stricter validation requirements, consider:
 * - Implementing retry logic with exponential backoff
 * - Adding a queue for deferred validation
 * - Flagging invoices for manual review when VIES validation fails
 */
@Injectable()
export class VIESService {
  private readonly logger = new Logger(VIESService.name);
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  /**
   * Validate a VAT number against the EU VIES service.
   *
   * @param vatNumber The VAT number to validate (e.g., "FR12345678901")
   * @returns true if valid OR if VIES service is unavailable (fail-open behavior)
   * @see https://ec.europa.eu/taxation_customs/vies/
   */
  async validate(vatNumber: string): Promise<boolean> {
    if (!vatNumber) return false;

    const normalizedVat = vatNumber.replace(/\s/g, '').toUpperCase();
    const cached = this.cache.get(normalizedVat);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.valid;
    }

    try {
      const result = await this.callVIES(normalizedVat);
      this.cache.set(normalizedVat, { valid: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      // FAIL-OPEN: Accept VAT number when VIES service is unavailable
      // This prevents VIES downtime from blocking business operations
      // See class documentation for alternative approaches
      this.logger.warn(
        `VIES validation failed for ${normalizedVat}, accepting by default (fail-open):`,
        error,
      );
      return true;
    }
  }

  private async callVIES(vatNumber: string): Promise<boolean> {
    const countryCode = vatNumber.substring(0, 2);
    const number = vatNumber.substring(2);

    const soapEnvelope = `
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
        <soapenv:Header/>
        <soapenv:Body>
          <urn:checkVat>
            <urn:countryCode>${countryCode}</urn:countryCode>
            <urn:vatNumber>${number}</urn:vatNumber>
          </urn:checkVat>
        </soapenv:Body>
      </soapenv:Envelope>
    `;

    const response = await fetch(
      'https://ec.europa.eu/taxation_customs/vies/services/checkVatService',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          SOAPAction: '',
        },
        body: soapEnvelope,
      },
    );

    if (!response.ok) {
      throw new Error(`VIES API returned ${response.status}`);
    }

    const text = await response.text();
    return text.includes('<valid>true</valid>');
  }

  clearCache(): void {
    this.cache.clear();
  }
}
