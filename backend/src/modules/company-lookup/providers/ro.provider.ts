/**
 * Romania — ANAF public taxpayer register.
 *
 * Endpoint : POST https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva
 *            body [{ cui, data }]
 * Docs     : https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt
 * Credentials: none.
 *
 * ANAF is also the authority on whether the company is registered for VAT and for
 * RO e-Factura, which the invoicing flow needs before it picks a channel.
 */
import { digits, fetchJson, stripVatPrefix, toDate } from '../http';
import { CompanyLookupCompany, CompanyLookupQuery, CompanyRegistryProvider, LookupScheme } from '../types';
import { join, localDate } from './shared';

const ANAF_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva';

export class RomaniaAnafProvider implements CompanyRegistryProvider {
  readonly id = 'ro-anaf';
  readonly label = 'ANAF (registrul contribuabililor)';
  readonly countries = ['RO'] as const;
  readonly schemes: readonly LookupScheme[] = ['LEGAL_ID', 'VAT'];
  readonly identifierLabel = 'CUI / CIF';
  readonly docsUrl = 'https://static.anaf.ro/static/10/Anaf/Informatii_R/Servicii_web/doc_WS_V9.txt';
  readonly credentialEnvVars = [] as const;

  constructor(private readonly timeoutMs = 8000) {}

  isConfigured() {
    return true;
  }

  supports(query: CompanyLookupQuery): boolean {
    if (query.countryCode.toUpperCase() !== 'RO') return false;
    const cui = digits(stripVatPrefix(query.value, 'RO'));
    return cui.length >= 2 && cui.length <= 10;
  }

  async lookup(query: CompanyLookupQuery): Promise<CompanyLookupCompany | null> {
    const cui = Number(digits(stripVatPrefix(query.value, 'RO')));
    if (!Number.isFinite(cui) || cui <= 0) return null;

    const data = await fetchJson<any>(ANAF_URL, {
      method: 'POST',
      body: [{ cui, data: localDate('Europe/Bucharest') }],
      timeoutMs: this.timeoutMs,
    });
    const entry = data?.found?.[0];
    const general = entry?.date_generale;
    if (!general?.denumire) return null;

    const seat = entry.adresa_sediu_social ?? {};
    const vatRegistered = entry.inregistrare_scop_Tva?.scpTVA ?? null;
    return {
      name: general.denumire,
      legalId: String(general.cui ?? cui),
      legalIdScheme: 'CUI',
      VAT: vatRegistered ? `RO${general.cui ?? cui}` : undefined,
      address: join(seat.sdenumire_Strada, seat.snumar_Strada, seat.sdetalii_Adresa) ?? general.adresa,
      postalCode: seat.scod_Postal || general.codPostal || undefined,
      city: seat.sdenumire_Localitate,
      state: seat.sdenumire_Judet,
      country: 'România',
      countryCode: 'RO',
      foundedAt: toDate(general.data_inregistrare),
      status: entry.stare_inactiv?.statusInactivi ? 'INACTIVE' : 'ACTIVE',
      vatRegistered,
    };
  }
}
