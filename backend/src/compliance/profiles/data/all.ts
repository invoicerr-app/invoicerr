import { CountryComplianceProfile } from '../schema';
import { FR } from './fr';
import { IT } from './it';
import { MC } from './monaco';
import { MX } from './mx';
import { PL } from './pl';
import { US } from './us';
import { EUROPE_PROFILES } from './europe';
import { LATAM_PROFILES } from './latam';
import { MENA_PROFILES } from './mena';
import { AFRICA_PROFILES } from './africa';
import { ASIA_PROFILES } from './asia';

/** Hand-written profiles with richer, verified specifics (OFFICIAL confidence). */
export const BESPOKE_PROFILES: CountryComplianceProfile[] = [FR, US, MX, IT, PL, MC];

/**
 * Every wired jurisdiction. Bespoke profiles take precedence over any archetype-built one with the
 * same country code (so a country can graduate from BEST_EFFORT data to a verified bespoke profile
 * without touching the registry).
 */
export const ALL_PROFILES: CountryComplianceProfile[] = [
  ...EUROPE_PROFILES,
  ...LATAM_PROFILES,
  ...MENA_PROFILES,
  ...AFRICA_PROFILES,
  ...ASIA_PROFILES,
  ...BESPOKE_PROFILES, // last so they override archetype-built duplicates
];
