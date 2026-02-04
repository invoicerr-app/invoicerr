import { Injectable } from '@nestjs/common';
import { CountryCompliance } from './country-compliance.interface';
import { GenericCountryCompliance } from './generic-country.compliance';
import { FranceCompliance } from './implementations/france.compliance';
import { GermanyCompliance } from './implementations/germany.compliance';

/**
 * Factory for creating country compliance implementations
 * 
 * This factory creates the appropriate compliance class based on country code.
 * It returns a GenericCountryCompliance for unsupported countries.
 * 
 * @example
 * const factory = new CountryComplianceFactory();
 * const franceCompliance = factory.create('FR');
 * const germanyCompliance = factory.create('DE');
 */
@Injectable()
export class CountryComplianceFactory {
  /**
   * Create a country compliance implementation
   * 
   * @param countryCode ISO 3166-1 alpha-2 country code
   * @returns CountryCompliance implementation for the specified country
   */
  create(countryCode: string): CountryCompliance {
    const code = countryCode.toUpperCase();

    switch (code) {
      case 'FR':
        return new FranceCompliance();
      
      case 'DE':
        return new GermanyCompliance();
      
      // Additional countries can be added here:
      // case 'IT': return new ItalyCompliance();
      // case 'ES': return new SpainCompliance();
      // case 'PT': return new PortugalCompliance();
      
      default:
        return new GenericCountryCompliance(code);
    }
  }

  /**
   * Check if a country has a specific implementation (not just generic)
   * 
   * @param countryCode ISO 3166-1 alpha-2 country code
   * @returns true if country has specific implementation
   */
  hasSpecificImplementation(countryCode: string): boolean {
    const code = countryCode.toUpperCase();
    return ['FR', 'DE'].includes(code);
  }

  /**
   * Get list of supported countries with specific implementations
   * 
   * @returns Array of country codes with specific implementations
   */
  getSupportedCountries(): string[] {
    return ['FR', 'DE'];
  }

  /**
   * Get all EU countries (for reference)
   * 
   * @returns Array of EU country codes
   */
  getEUCountries(): string[] {
    return [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
    ];
  }
}
