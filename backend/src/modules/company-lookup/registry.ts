/**
 * The provider registry: which registry API serves which country, in what order.
 *
 * Which providers serve a country, in what order, and the note shown with it are country data
 * (`coverage/registry.ts`); this file only maps those ids to provider instances and appends the
 * worldwide directories, which serve every country and always come last.
 */
import { AustraliaAbrProvider } from './providers/au.provider';
import { BrazilCnpjProvider } from './providers/br.provider';
import { SwitzerlandZefixProvider } from './providers/ch.provider';
import { ColombiaRuesProvider } from './providers/co.provider';
import { CzechAresProvider } from './providers/cz.provider';
import { DenmarkCvrProvider } from './providers/dk.provider';
import { FinlandPrhProvider } from './providers/fi.provider';
import { FranceProvider } from './providers/fr.provider';
import { GleifProvider } from './providers/gleif.provider';
import { UkCompaniesHouseProvider } from './providers/gb.provider';
import { IsraelRegistrarProvider } from './providers/il.provider';
import { IrelandCroProvider } from './providers/ie.provider';
import { NetherlandsKvkProvider } from './providers/nl.provider';
import { NorwayBrregProvider } from './providers/no.provider';
import { NewZealandNzbnProvider } from './providers/nz.provider';
import { PeruSunatProvider } from './providers/pe.provider';
import { PolandWykazProvider } from './providers/pl.provider';
import { RomaniaAnafProvider } from './providers/ro.provider';
import { SlovakRpoProvider } from './providers/sk.provider';
import { TaiwanGcisProvider } from './providers/tw.provider';
import { VietnamTaxCodeProvider } from './providers/vn.provider';
// Cross-border, not countries: the EU VAT check and the two worldwide directories.
import { PeppolDirectoryProvider } from './providers/peppol-directory.provider';
import { ViesProvider } from './providers/vies.provider';
import { CompanyLookupCoverage, defaultLookupCoverage } from './coverage/registry';
import { ISO_COUNTRY_CODES } from './data/iso-countries';
import {
  CompanyRegistryProvider,
  CountryLookupCapability,
  LookupScheme,
  ProviderCapability,
  ProviderCoverage,
} from './types';
import { byCodeUnit } from '@/lib/compare';

const VIES_PROVIDER_ID = 'eu-vies';

export function buildDefaultProviders(timeoutMs?: number): CompanyRegistryProvider[] {
  return [
    new FranceProvider(timeoutMs),
    new CzechAresProvider(timeoutMs),
    new SlovakRpoProvider(timeoutMs),
    new PolandWykazProvider(timeoutMs),
    new RomaniaAnafProvider(timeoutMs),
    new NorwayBrregProvider(timeoutMs),
    new DenmarkCvrProvider(timeoutMs),
    new FinlandPrhProvider(timeoutMs),
    new UkCompaniesHouseProvider(timeoutMs),
    new IrelandCroProvider(timeoutMs),
    new NetherlandsKvkProvider(timeoutMs),
    new SwitzerlandZefixProvider(timeoutMs),
    new BrazilCnpjProvider(timeoutMs),
    new PeruSunatProvider(timeoutMs),
    new AustraliaAbrProvider(timeoutMs),
    new NewZealandNzbnProvider(timeoutMs),
    new TaiwanGcisProvider(timeoutMs),
    new IsraelRegistrarProvider(timeoutMs),
    new VietnamTaxCodeProvider(timeoutMs),
    new ColombiaRuesProvider(timeoutMs),
    new ViesProvider(timeoutMs),
    // Worldwide, keyless, no registration — the safety net for the ~65 countries whose
    // own register publishes nothing.
    new GleifProvider(timeoutMs),
    new PeppolDirectoryProvider(timeoutMs),
  ];
}

const GENERIC_NOTE_KEY = 'companyLookup.notes.generic';
const PARTIAL_ONLY_NOTE_KEY = 'companyLookup.notes.partialOnly';
const VIES_ONLY_NOTE_KEY = 'companyLookup.notes.viesOnly';

function toCapability(p: CompanyRegistryProvider): ProviderCapability {
  const credentialEnvVars = p.credentialEnvVars ?? [];
  return {
    id: p.id,
    label: p.label,
    coverage: p.coverage ?? 'REGISTER',
    schemes: p.schemes,
    identifierLabel: p.identifierLabel,
    docsUrl: p.docsUrl,
    requiresCredentials: credentialEnvVars.length > 0,
    credentialEnvVars: credentialEnvVars.length > 0 ? credentialEnvVars : undefined,
    configured: p.isConfigured(),
  };
}

export class CompanyLookupRegistry {
  constructor(
    private readonly providers: CompanyRegistryProvider[] = buildDefaultProviders(),
    private readonly coverage: CompanyLookupCoverage = defaultLookupCoverage,
  ) {}

  all(): CompanyRegistryProvider[] {
    return this.providers;
  }

  /** Providers serving a country: the ones its data lists, in that order, then the worldwide directories. */
  forCountry(countryCode: string): CompanyRegistryProvider[] {
    const cc = (countryCode ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return [];
    const listed = this.coverage
      .providersFor(cc)
      .map((id) => this.providers.find((p) => p.id === id))
      .filter((p): p is CompanyRegistryProvider => p !== undefined);
    return [...listed, ...this.providers.filter((p) => p.worldwide)];
  }

  capability(countryCode: string): CountryLookupCapability {
    const cc = (countryCode ?? '').toUpperCase();
    const providers = this.forCountry(cc).map(toCapability);
    const configured = providers.filter((p) => p.configured);

    const status =
      configured.length > 0 ? 'AVAILABLE' : providers.length > 0 ? 'NEEDS_CREDENTIALS' : 'UNAVAILABLE';
    const schemes = [...new Set(configured.flatMap((p) => p.schemes))] as LookupScheme[];

    // REGISTER as soon as one configured provider is a real register; the worldwide
    // directories alone only ever amount to PARTIAL.
    const coverage: ProviderCoverage = configured.some((p) => p.coverage === 'REGISTER')
      ? 'REGISTER'
      : 'PARTIAL';

    const explicitNoteKey = this.coverage.factsFor(cc)?.noteKey;
    const viesOnly = configured.some((p) => p.id === VIES_PROVIDER_ID) && coverage === 'REGISTER';
    const fallbackNoteKey =
      status === 'UNAVAILABLE'
        ? GENERIC_NOTE_KEY
        : coverage === 'PARTIAL'
          ? PARTIAL_ONLY_NOTE_KEY
          : viesOnly && configured.filter((p) => p.coverage === 'REGISTER').length === 1
            ? VIES_ONLY_NOTE_KEY
            : undefined;
    const noteKeys = [explicitNoteKey, fallbackNoteKey].filter((key): key is string => !!key);

    return {
      countryCode: cc,
      status,
      coverage,
      providers,
      schemes,
      identifierLabel: configured[0]?.identifierLabel ?? providers[0]?.identifierLabel,
      noteKeys,
    };
  }

  /** Capabilities for every ISO 3166-1 country, plus any other code the lookup data names. */
  capabilities(): CountryLookupCapability[] {
    const countries = new Set<string>([...ISO_COUNTRY_CODES, ...this.coverage.countries()]);
    return [...countries].sort(byCodeUnit).map((cc) => this.capability(cc));
  }
}

export const defaultLookupRegistry = new CompanyLookupRegistry();
