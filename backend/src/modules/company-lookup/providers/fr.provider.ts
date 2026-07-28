/**
 * France — Annuaire des Entreprises (DINUM), the public front-end over INSEE SIRENE.
 *
 * Endpoint : GET https://recherche-entreprises.api.gouv.fr/search?q={siren|siret}
 * Docs     : https://recherche-entreprises.api.gouv.fr/docs/
 * Credentials: none (7 req/s public quota).
 *
 * Accepts SIRET (14 digits, the establishment), SIREN (9 digits, the legal unit) and
 * the intra-community VAT number (FR + key + SIREN). SIRET queries only match the
 * head office (`siege`); a non-head-office SIRET falls back to its SIREN, which is
 * what the invoicing forms need — the legal unit's identity, not the branch's.
 */
import { calculateFrenchVAT, isValidSiret } from '@/modules/sirene/sirene.utils';
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';

const SEARCH_URL = 'https://recherche-entreprises.api.gouv.fr/search';

/** SIREN validity = Luhn over 9 digits (INSEE). */
export function isValidSiren(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(clean[8 - i], 10);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Extracts the searchable SIREN/SIRET from whatever the user typed. */
export function toFrenchQueryKey(query: CompanyLookupQuery): string | null {
  if (query.scheme === 'VAT') {
    const clean = stripVatPrefix(query.value, 'FR'); // 2 key chars + 9 digit SIREN
    const siren = clean.slice(-9);
    return isValidSiren(siren) ? siren : null;
  }
  const clean = digits(query.value);
  if (clean.length === 14) return isValidSiret(clean) ? clean : null;
  if (clean.length === 9) return isValidSiren(clean) ? clean : null;
  return null;
}

export class FranceProvider implements CompanyRegistryProvider {
  readonly id = 'fr-recherche-entreprises';
  readonly label = 'Annuaire des Entreprises (INSEE SIRENE)';
  readonly countries = ['FR'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'SIRET (14 digits), SIREN (9 digits) or VAT number';
  readonly docsUrl = 'https://recherche-entreprises.api.gouv.fr/docs/';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured(): boolean {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'FR') return false;
    return toFrenchQueryKey(query) !== null;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const key = toFrenchQueryKey(query);
    if (!key) return null;

    const data = await fetchJson<any>(`${SEARCH_URL}?q=${key}&per_page=1`, { timeoutMs: this.timeoutMs });
    const result = data?.results?.[0];
    if (!result) return null;

    const siege = result.siege ?? {};
    const siren: string | undefined = result.siren ?? (digits(siege.siret ?? '').slice(0, 9) || undefined);
    // A 14-digit query must match the head office; otherwise the answer describes
    // a different establishment than the one asked about.
    if (key.length === 14 && digits(siege.siret ?? '') !== key) return null;

    return {
      name: result.nom_complet ?? result.nom_raison_sociale ?? siege.siret,
      legalName: result.nom_raison_sociale ?? undefined,
      legalId: siege.siret ?? siren,
      legalIdScheme: siege.siret ? 'SIRET' : 'SIREN',
      VAT: siren ? calculateFrenchVAT(siren) : undefined,
      address: siege.adresse,
      postalCode: siege.code_postal,
      city: siege.libelle_commune,
      country: 'France',
      countryCode: 'FR',
      foundedAt: toDate(result.date_creation),
      status: result.etat_administratif === 'C' ? 'INACTIVE' : 'ACTIVE',
    };
  }
}
