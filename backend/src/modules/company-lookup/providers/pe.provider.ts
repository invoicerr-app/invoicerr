/**
 * Peru — SUNAT taxpayer register, served by apis.net.pe.
 *
 * Endpoint : GET https://api.apis.net.pe/v1/ruc?numero={ruc}
 * Docs     : https://apis.net.pe/api-consulta-ruc
 * Credentials: none — PE_APISNET_TOKEN lifts the anonymous quota when set.
 */
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const APISNET_RUC = 'https://api.apis.net.pe/v1/ruc';

/** RUC: 11 digits, mod-11 check digit. */
export function isValidRuc(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(clean[i], 10), 0);
  const rest = 11 - (sum % 11);
  const check = rest === 10 ? 0 : rest === 11 ? 1 : rest;
  return check === parseInt(clean[10], 10);
}

export class PeruSunatProvider implements CompanyRegistryProvider {
  readonly id = 'pe-sunat';
  readonly label = 'SUNAT (registro de contribuyentes)';
  readonly countries = ['PE'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'RUC (11 digits)';
  readonly docsUrl = 'https://apis.net.pe/api-consulta-ruc';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'PE') return false;
    return isValidRuc(query.value);
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const ruc = digits(query.value);
    const token = process.env.PE_APISNET_TOKEN;
    const data = await fetchJson<any>(`${APISNET_RUC}?numero=${ruc}`, {
      timeoutMs: this.timeoutMs,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      notFoundStatuses: [404, 422],
    });
    if (!data?.nombre) return null;

    return {
      name: data.nombre,
      legalId: data.numeroDocumento ?? ruc,
      legalIdScheme: 'RUC',
      address: join(data.direccion),
      city: data.distrito ?? data.provincia,
      state: data.departamento,
      country: 'Perú',
      countryCode: 'PE',
      status: /ACTIVO/i.test(data.estado ?? '') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
