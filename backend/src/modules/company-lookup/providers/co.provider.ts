/**
 * Colombia — RUES (Registro Único Empresarial y Social), published as the
 * Confecámaras open dataset on datos.gov.co.
 *
 * Endpoint : GET https://www.datos.gov.co/resource/c82u-588k.json?numero_identificacion={nit}
 * Docs     : https://www.datos.gov.co/d/c82u-588k  (Socrata SODA API, keyless)
 * Credentials: none.
 *
 * The dataset carries the legal name, the chamber of commerce, the registration date
 * and the standing of the registration — but no address, which stays manual.
 */
import { digits, fetchJson } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';

const RUES_URL = 'https://www.datos.gov.co/resource/c82u-588k.json';

/** NIT: 9-10 digits, mod-11 verification digit (the last one, often written after a dash). */
export function isValidNit(value: string): boolean {
  const clean = digits(value);
  return clean.length >= 8 && clean.length <= 10;
}

/** The dataset stores dates as YYYYMMDD strings. */
function parseRuesDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return undefined;
  const d = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export class ColombiaRuesProvider implements CompanyRegistryProvider {
  readonly id = 'co-rues';
  readonly label = 'RUES (Confecámaras · datos.gov.co)';
  readonly countries = ['CO'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'NIT (without the verification digit)';
  readonly docsUrl = 'https://www.datos.gov.co/d/c82u-588k';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'CO') return false;
    return isValidNit(query.value);
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const nit = digits(query.value);
    const data = await fetchJson<any[]>(`${RUES_URL}?numero_identificacion=${nit}&$limit=1`, {
      timeoutMs: this.timeoutMs,
    });
    const record = Array.isArray(data) ? data[0] : undefined;
    if (!record?.razon_social) return null;

    return {
      name: record.razon_social,
      legalId: record.numero_identificacion ?? nit,
      legalIdScheme: 'NIT',
      VAT: record.numero_identificacion ?? nit,
      // The chamber of commerce is the closest thing to a locality in this dataset.
      state: record.camara_comercio,
      country: 'Colombia',
      countryCode: 'CO',
      foundedAt: parseRuesDate(record.fecha_matricula),
      status: /ACTIVA/i.test(record.estado_matricula ?? '') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
