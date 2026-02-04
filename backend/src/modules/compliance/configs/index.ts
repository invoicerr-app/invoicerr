import { CountryConfig } from '../interfaces/country-config.interface';
import { genericConfig } from './generic.config';
import { frConfig } from './countries/fr.config';
import { deConfig } from './countries/de.config';
import { itConfig } from './countries/it.config';
import { esConfig } from './countries/es.config';
import { ptConfig } from './countries/pt.config';

/**
 * Country configuration registry
 */
const configs: Record<string, CountryConfig> = {
  GENERIC: genericConfig as CountryConfig,
  FR: frConfig,
  DE: deConfig,
  IT: itConfig,
  ES: esConfig,
  PT: ptConfig,
};

/**
 * Get configuration for a country code
 * Falls back to generic config if country not found
 */
export function getCountryConfig(code: string): CountryConfig {
  const upperCode = code.toUpperCase();
  return configs[upperCode] || (configs.GENERIC as CountryConfig);
}

/**
 * Get all country configurations
 */
export function getAllCountryConfigs(): CountryConfig[] {
  return Object.values(configs);
}

/**
 * Check if a country is supported (has specific implementation)
 */
export function isCountrySupported(code: string): boolean {
  const upperCode = code.toUpperCase();
  return upperCode in configs && upperCode !== 'GENERIC';
}

/**
 * Get all supported country codes
 */
export function getSupportedCountryCodes(): string[] {
  return Object.keys(configs).filter(c => c !== 'GENERIC');
}

/**
 * Get EU country codes
 */
export function getEUCountryCodes(): string[] {
  const euCountries = ['FR', 'DE', 'IT', 'ES', 'PT', 'BE', 'NL', 'AT', 'LU'];
  return euCountries.filter(c => c in configs);
}

/**
 * Injectable service for accessing country configurations
 */
@Injectable()
export class ConfigRegistry {
  get(code: string): CountryConfig {
    return getCountryConfig(code);
  }

  getAll(): CountryConfig[] {
    return getAllCountryConfigs();
  }

  has(code: string): boolean {
    return isCountrySupported(code);
  }

  getCodes(): string[] {
    return getSupportedCountryCodes();
  }

  getEUCountries(): CountryConfig[] {
    const euCodes = getEUCountryCodes();
    return euCodes.map(code => configs[code]);
  }
}

export { genericConfig, frConfig, deConfig, itConfig, esConfig, ptConfig };
