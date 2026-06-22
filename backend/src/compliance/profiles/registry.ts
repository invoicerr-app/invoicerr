import { CountryComplianceProfile } from './schema';
import { FALLBACK } from './data/fallback';
import { FR } from './data/fr';
import { MC } from './data/monaco';
import { US } from './data/us';

const BUILT_IN: Record<string, CountryComplianceProfile> = { FR, US, MC };

export interface ResolvedProfile {
  profile: CountryComplianceProfile;
  isFallback: boolean;
  /** Set when a delegating profile (e.g. MC) was followed to its target (e.g. FR). */
  delegatedFrom?: string;
}

/**
 * Loads a country profile, following delegation, with a safe fallback for unknown countries.
 * Adding the 78th country = adding a data file here, never an engine change.
 */
export class ProfileRegistry {
  private readonly profiles: Record<string, CountryComplianceProfile>;

  constructor(extra?: Record<string, CountryComplianceProfile>) {
    this.profiles = { ...BUILT_IN, ...(extra ?? {}) };
  }

  has(country: string): boolean {
    return !!this.profiles[(country ?? '').toUpperCase()];
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
