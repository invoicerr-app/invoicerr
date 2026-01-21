import type { CountryConfig } from '../interfaces';
import { frConfig } from './countries/fr.config';
import { genericConfig } from './generic.config';

const configs: Record<string, CountryConfig> = {
  FR: frConfig,
};

export function getCountryConfig(code: string): CountryConfig {
  if (configs[code]) {
    return configs[code];
  }
  return { ...genericConfig, code } as CountryConfig;
}

export function getAllCountryConfigs(): CountryConfig[] {
  return Object.values(configs);
}

export function isCountrySupported(code: string): boolean {
  return code in configs;
}
