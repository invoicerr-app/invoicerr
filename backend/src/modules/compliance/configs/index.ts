import { Injectable } from '@nestjs/common';
import { CountryConfig } from '../interfaces';
import { beConfig } from './countries/be.config';
import { deConfig } from './countries/de.config';
import { esConfig } from './countries/es.config';
import { frConfig } from './countries/fr.config';
import { itConfig } from './countries/it.config';
import { ptConfig } from './countries/pt.config';
import { genericConfig } from './generic.config';

/**
 * Registry of all country configurations
 */
const configs: Record<string, CountryConfig> = {
  FR: frConfig,
  DE: deConfig,
  BE: beConfig,
  IT: itConfig,
  ES: esConfig,
  PT: ptConfig,
};

/**
 * Get configuration for a specific country
 * Falls back to generic config if country not supported
 */
export function getCountryConfig(code: string): CountryConfig {
  const upperCode = code.toUpperCase();
  if (configs[upperCode]) {
    return configs[upperCode];
  }
  return { ...genericConfig, code: upperCode } as CountryConfig;
}

/**
 * Get all supported country configurations
 */
export function getAllCountryConfigs(): CountryConfig[] {
  return Object.values(configs);
}

/**
 * Check if a country has specific configuration
 */
export function isCountrySupported(code: string): boolean {
  return code.toUpperCase() in configs;
}

/**
 * Get list of supported country codes
 */
export function getSupportedCountryCodes(): string[] {
  return Object.keys(configs);
}

/**
 * Injectable service for country configuration registry
 */
@Injectable()
export class ConfigRegistry {
  private readonly configs: Map<string, CountryConfig>;

  constructor() {
    this.configs = new Map(Object.entries(configs));
  }

  /**
   * Get configuration for a country
   */
  get(code: string): CountryConfig {
    const upperCode = code.toUpperCase();
    const config = this.configs.get(upperCode);
    if (config) {
      return config;
    }
    return { ...genericConfig, code: upperCode } as CountryConfig;
  }

  /**
   * Get all configurations
   */
  getAll(): CountryConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Check if country is supported
   */
  has(code: string): boolean {
    return this.configs.has(code.toUpperCase());
  }

  /**
   * Get all supported country codes
   */
  getCodes(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get EU member configurations
   */
  getEUCountries(): CountryConfig[] {
    return this.getAll().filter((c) => c.isEU);
  }
}

// Re-export configs for direct access
export { genericConfig };
export { frConfig } from './countries/fr.config';
export { deConfig } from './countries/de.config';
export { beConfig } from './countries/be.config';
export { itConfig } from './countries/it.config';
export { esConfig } from './countries/es.config';
export { ptConfig } from './countries/pt.config';
