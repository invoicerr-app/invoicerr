import { CountryComplianceProfile } from './schema';
import { FALLBACK } from './data/fallback';
import { ALL_PROFILES } from './data/all';

function buildIndex(profiles: CountryComplianceProfile[]): Record<string, CountryComplianceProfile> {
  const index: Record<string, CountryComplianceProfile> = {};
  for (const p of profiles) index[p.countryCode.toUpperCase()] = p; // later entries win
  return index;
}

export interface ResolvedProfile {
  profile: CountryComplianceProfile;
  isFallback: boolean;
  /** Set when a delegating profile (e.g. MC) was followed to its target (e.g. FR). */
  delegatedFrom?: string;
}

/**
 * Loads a country profile, following delegation, with a safe fallback for unknown countries.
 * Adding a country = adding a data entry consumed by ALL_PROFILES, never an engine change.
 */
export class ProfileRegistry {
  private readonly profiles: Record<string, CountryComplianceProfile>;

  constructor(extra?: Record<string, CountryComplianceProfile>) {
    this.profiles = { ...buildIndex(ALL_PROFILES), ...(extra ?? {}) };
  }

  has(country: string): boolean {
    return !!this.profiles[(country ?? '').toUpperCase()];
  }

  /** Country codes that have a real (non-fallback) profile. */
  countries(): string[] {
    return Object.keys(this.profiles).sort();
  }

  resolve(country: string): ResolvedProfile {
    const code = (country ?? '').toUpperCase();
    const p = this.profiles[code];
    if (!p) {
      return { profile: { ...FALLBACK, countryCode: code || 'XX' }, isFallback: true };
    }
    if (p.delegatesTo) {
      const target = this.profiles[p.delegatesTo.toUpperCase()];
      if (target) return { profile: target, isFallback: false, delegatedFrom: code };
      return { profile: { ...FALLBACK, countryCode: code }, isFallback: true };
    }
    return { profile: p, isFallback: false };
  }
}

export const defaultRegistry = new ProfileRegistry();
