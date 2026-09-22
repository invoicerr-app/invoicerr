/**
 * Brazil — Receita Federal CNPJ data, served by BrasilAPI.
 *
 * Endpoint : GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 * Docs     : https://brasilapi.com.br/docs#tag/CNPJ
 * Credentials: none.
 */
import { digits, fetchJson, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join } from './shared';

const BRASILAPI_CNPJ = 'https://brasilapi.com.br/api/cnpj/v1';

/** CNPJ: 14 digits, two mod-11 check digits. */
export function isValidCnpj(value: string): boolean {
  const clean = digits(value);
  if (clean.length !== 14 || /^(\d)\1{13}$/.test(clean)) return false;
  const checkDigit = (slice: string, startWeight: number): number => {
    let weight = startWeight;
    let sum = 0;
    for (const ch of slice) {
      sum += parseInt(ch, 10) * weight;
      weight = weight === 2 ? 9 : weight - 1;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return (
    checkDigit(clean.slice(0, 12), 5) === parseInt(clean[12], 10) &&
    checkDigit(clean.slice(0, 13), 6) === parseInt(clean[13], 10)
  );
}

export class BrazilCnpjProvider implements CompanyRegistryProvider {
  readonly id = 'br-cnpj';
  readonly label = 'Receita Federal (CNPJ)';
  readonly countries = ['BR'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'CNPJ (14 digits)';
  readonly docsUrl = 'https://brasilapi.com.br/docs#tag/CNPJ';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'BR') return false;
    return isValidCnpj(query.value);
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const cnpj = digits(query.value);
    const data = await fetchJson<any>(`${BRASILAPI_CNPJ}/${cnpj}`, {
      timeoutMs: this.timeoutMs,
      notFoundStatuses: [404],
    });
    if (!data?.razao_social) return null;

    return {
      name: data.nome_fantasia || data.razao_social,
      legalName: data.razao_social,
      legalId: data.cnpj ?? cnpj,
      legalIdScheme: 'CNPJ',
      address: join(data.descricao_tipo_de_logradouro, data.logradouro, data.numero, data.complemento),
      postalCode: data.cep ? String(data.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2') : undefined,
      city: data.municipio,
      state: data.uf,
      country: 'Brasil',
      countryCode: 'BR',
      foundedAt: toDate(data.data_inicio_atividade),
      status: /ATIVA/i.test(data.descricao_situacao_cadastral ?? '') ? 'ACTIVE' : 'INACTIVE',
    };
  }
}
