/**
 * Norway — Enhetsregisteret (Brønnøysundregistrene).
 *
 * Endpoint : GET https://data.brreg.no/enhetsregisteret/api/enheter/{orgnr}
 * Docs     : https://data.brreg.no/enhetsregisteret/api/dokumentasjon/
 * Credentials: none.
 *
 * The Norwegian VAT number is the organisation number followed by "MVA", but only
 * for entities actually entered in the VAT register — the `registrertIMvaregisteret`
 * flag is what decides, never the number's shape.
 */
import { digits, fetchJson, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';

const BRREG_URL = 'https://data.brreg.no/enhetsregisteret/api/enheter';

export class NorwayBrregProvider implements CompanyRegistryProvider {
  readonly id = 'no-brreg';
  readonly label = 'Enhetsregisteret (Brønnøysundregistrene)';
  readonly countries = ['NO'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'Organisasjonsnummer (9 digits)';
  readonly docsUrl = 'https://data.brreg.no/enhetsregisteret/api/dokumentasjon/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'NO') return false;
    return digits(query.value).length === 9;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const orgnr = digits(query.value);
    const data = await fetchJson<any>(`${BRREG_URL}/${orgnr}`, { timeoutMs: this.timeoutMs });
    if (!data?.organisasjonsnummer) return null;

    const addr = data.forretningsadresse ?? data.postadresse ?? {};
    const mva = data.registrertIMvaregisteret === true;
    return {
      name: data.navn,
      legalId: data.organisasjonsnummer,
      legalIdScheme: 'ORGNR',
      VAT: mva ? `NO${data.organisasjonsnummer}MVA` : undefined,
      address: Array.isArray(addr.adresse) ? addr.adresse.filter(Boolean).join(', ') : addr.adresse,
      postalCode: addr.postnummer,
      city: addr.poststed,
      country: addr.land ?? 'Norge',
      countryCode: 'NO',
      foundedAt: toDate(data.stiftelsesdato ?? data.registreringsdatoEnhetsregisteret),
      status: data.konkurs || data.underAvvikling ? 'INACTIVE' : 'ACTIVE',
      vatRegistered: mva,
    };
  }
}
