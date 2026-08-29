/**
 * The provider registry — which registry API serves which country, in what order.
 *
 * Resolution order per country: the national register first (it returns the legal
 * name, address and registration date), then VIES as the EU-wide fallback (it always
 * at least confirms the VAT number). Adding a country means adding a provider here,
 * never touching the service or the controller.
 *
 * Countries with no entry are reported as UNAVAILABLE with a note explaining why, so
 * the UI can hide the lookup button instead of offering something that cannot work.
 */
// One file per country — adding a jurisdiction means adding a file and a line below.
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
import {
  CompanyRegistryProvider,
  CountryLookupCapability,
  LookupScheme,
  ProviderCapability,
  ProviderCoverage,
} from './types';

/**
 * Fallback order. A national register knows every company in its country, so it always
 * goes first; VIES then confirms EU VAT numbers; the worldwide directories come last
 * because they only list the entities that opted into them.
 */
const VIES_PROVIDER_ID = 'eu-vies';
const FALLBACK_ORDER: Record<string, number> = {
  [VIES_PROVIDER_ID]: 1,
  gleif: 2,
  'peppol-directory': 3,
};
const NATIONAL_REGISTER = 0;

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

/**
 * Why a country has no lookup, or what the available lookup is limited to.
 * Kept explicit for the jurisdictions users ask about most; everything else gets
 * the generic note below.
 */
export const COUNTRY_LOOKUP_NOTES: Record<string, string> = {
  DE: 'Germany does not disclose names through VIES and the Handelsregister has no public API — the VAT number can be validated, the rest is entered by hand.',
  ES: 'Spain validates the VAT number through VIES but does not disclose the name or address; the Registro Mercantil has no free API.',
  US: "There is no federal business register — company data sits with each state's Secretary of State, none of which share a common API.",
  MX: 'The SAT publishes no company lookup service; the RFC is validated offline instead.',
  IN: 'GSTIN lookup is only available through a paid GSP subscription.',
  CN: 'The national enterprise credit system (GSXT) has no public API.',
  JP: 'The National Tax Agency corporate number API requires a registered application id.',
  SG: 'ACRA data is published through data.gov.sg datasets that require an account.',
  ZA: 'CIPC enterprise enquiries require a paid customer account.',
  VN: 'Vietnam publishes no direct API — the lookup goes through a third-party mirror of the tax register, so the tax code leaves this instance.',
  IT: 'Italy discloses the name and address through VIES; the Registro Imprese itself has no free API.',
  MC: "Monaco keeps its own Répertoire du Commerce et de l'Industrie, which has no public API — Monegasque numbers are not in the French register either.",
  AT: 'Austria validates through VIES; Firmenbuch extracts are sold per query.',
  BE: 'Belgium validates through VIES; the KBO/BCE publishes bulk open data but no per-company API.',
  SE: 'Sweden validates through VIES; Bolagsverket sells its API per query.',
  PT: 'Portugal validates through VIES; the Registo Comercial has no free API.',
  GR: 'Greece validates through VIES; GEMI has no free public API.',
  HU: 'Hungary validates through VIES; the NAV taxpayer query requires credentials.',
  LU: 'Luxembourg validates through VIES; RCS extracts require an account.',
  LT: 'Lithuania validates through VIES; Registrų centras charges for its API.',
  LV: 'Latvia validates through VIES; the Uzņēmumu reģistrs publishes bulk open data but no per-company API.',
  EE: 'Estonia validates through VIES; the Äriregister API requires an X-Road/paid contract.',
  SI: 'Slovenia validates through VIES; AJPES charges for register access.',
  HR: 'Croatia validates through VIES; sudreg requires a registered API key.',
  BG: 'Bulgaria validates through VIES; the Търговски регистър has no free JSON API.',
  CY: 'Cyprus validates through VIES; the Registrar of Companies has no public API.',
  MT: 'Malta validates through VIES; the MBR has no public API.',
};

const GENERIC_NOTE =
  'No public business-register API is available for this country — company details are entered manually.';

const PARTIAL_ONLY_NOTE =
  'This country has no open register API, so the lookup falls back to the worldwide directories (GLEIF LEI index, Peppol Directory): companies listed there are found, most small businesses are not.';

const VIES_ONLY_NOTE =
  'Covered by VIES: the VAT number is validated, and the name and address are returned only when the member state discloses them.';

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
  constructor(private readonly providers: CompanyRegistryProvider[] = buildDefaultProviders()) {}

  all(): CompanyRegistryProvider[] {
    return this.providers;
  }

  /** Providers serving a country: national register first, worldwide directories last. */
  forCountry(countryCode: string): CompanyRegistryProvider[] {
    const cc = (countryCode ?? '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return [];
    return this.providers
      .filter((p) => p.countries === 'ALL' || p.countries.includes(cc))
      .sort(
        (a, b) => (FALLBACK_ORDER[a.id] ?? NATIONAL_REGISTER) - (FALLBACK_ORDER[b.id] ?? NATIONAL_REGISTER),
      );
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

    const explicitNote = COUNTRY_LOOKUP_NOTES[cc];
    const viesOnly = configured.some((p) => p.id === VIES_PROVIDER_ID) && coverage === 'REGISTER';
    const fallbackNote =
      status === 'UNAVAILABLE'
        ? GENERIC_NOTE
        : coverage === 'PARTIAL'
          ? PARTIAL_ONLY_NOTE
          : viesOnly && configured.filter((p) => p.coverage === 'REGISTER').length === 1
            ? VIES_ONLY_NOTE
            : undefined;
    const note = [explicitNote, fallbackNote].filter(Boolean).join(' ') || undefined;

    return {
      countryCode: cc,
      status,
      coverage,
      providers,
      schemes,
      identifierLabel: configured[0]?.identifierLabel ?? providers[0]?.identifierLabel,
      note,
    };
  }

  /** Capabilities for every country the compliance profiles know about, plus any extra a provider covers. */
  capabilities(): CountryLookupCapability[] {
    // La liste venait des profils pays du moteur de conformité, supprimé : seuls les pays
    // que les fournisseurs de recherche couvrent réellement subsistent.
    const countries = new Set<string>();
    for (const p of this.providers) {
      if (p.countries === 'ALL') continue; // worldwide providers add no country of their own
      for (const c of p.countries) countries.add(c);
    }
    return [...countries].sort().map((cc) => this.capability(cc));
  }
}

export const defaultLookupRegistry = new CompanyLookupRegistry();
