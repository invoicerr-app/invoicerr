/**
 * FA_VAT (PL, KSeF) builder — FA(2) and FA(3) variants.
 *
 * FA(2) extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 *
 * FA(3) is KSeF 2.0's successor structure (schema published 2025-06-25 in the Central Repository
 * of Electronic Document Templates — http://crd.gov.pl/wzor/2025/06/25/13775/ — vendored at
 * ../../../compliance/schemas/pl/schemat_FA3.xsd). It replaces FA(2) once the KSeF clearance
 * mandate goes live (2026-02-01 for large taxpayers — see compliance/profiles/data/pl.ts
 * `regime`/`formats` axes; smaller taxpayers follow on staggered later dates but FA(3) is the
 * structure required from that point on). FA(3) is a structural superset of FA(2): every FA(2)
 * element name still exists, plus new optional sections (Zalacznik attachment table, LinkDoPlatnosci,
 * IPKSeF, extra payment-form choices) and exactly two new **mandatory** buyer-side markers —
 * `JST` (jednostka samorządu terytorialnego — local-government sub-unit) and `GV` (grupa VAT — VAT
 * group member) — which invoicerr always declares "not applicable" (2 = Nie), the same convention
 * already used for the Adnotacje flags below.
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import type { InvoiceRenderData } from '../render-data';

/** FA(2) target namespace (crd.gov.pl wzór published 2023-06-29). */
export const FA_VAT_2_NAMESPACE = 'http://crd.gov.pl/wzor/2023/06/29/12648/';
/** FA(3) target namespace (crd.gov.pl wzór published 2025-06-25 — KSeF 2.0). */
export const FA_VAT_3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/';

export type FaVatVersion = 2 | 3;

/**
 * Date from which FA(3) is selected by default (ISO date, UTC midnight).
 * Matches the KSeF 2.0 clearance mandate onset already encoded in
 * compliance/profiles/data/pl.ts (`regime`/`formats` validFrom) and the date the Ministry of
 * Finance states FA(3) replaces FA(2) as the required structure
 * (https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/struktura-logiczna-fa-3/).
 */
export const FA_VAT_3_EFFECTIVE_DATE = '2026-02-01';

/**
 * Deterministic FA(2)/FA(3) selection by the document's issue date — KSeF 2.0's staggered FA(3)
 * mandate (M-5). `versionOverride` allows a caller (e.g. a future per-company profile setting) to
 * force a specific version regardless of date; absent that, the issue date decides.
 */
export function selectFaVatVersion(
  issueDate: Date | null | undefined,
  versionOverride?: FaVatVersion,
): FaVatVersion {
  if (versionOverride) return versionOverride;
  if (!issueDate) return 2;
  return issueDate.getTime() >= Date.parse(`${FA_VAT_3_EFFECTIVE_DATE}T00:00:00Z`) ? 3 : 2;
}

/** Shared FA(2)/FA(3) XML tree builder — everything but the handful of version-specific fields. */
async function buildFaVatXml(data: InvoiceRenderData, version: FaVatVersion): Promise<string> {
  const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
  const creationDt = (data.issuedAt ?? data.createdAt).toISOString().replace(/\.\d{3}Z$/, '');
  const invoiceNumber = data.rawNumber || (data.number?.toString() ?? 'DRAFT');
  const currency = data.company.currency || 'PLN';
  const sellerNip = (getIdentifier(data.company, 'VAT') || '').replace(/^[A-Z]{2}/, '');
  const clientNip = (getIdentifier(data.client, 'VAT') || '').replace(/^[A-Z]{2}/, '');

  // ── address builder (FA(2)/FA(3) TAdres: KodKraju + AdresPol fields — unchanged between versions) ──
  const buildAddress = (e: {
    address?: string | null;
    city?: string | null;
    postalCode?: string | null;
    country?: string | null;
  }) => {
    const cc = guessCountryCode(e.country) ?? 'PL';
    const street = e.address || '';
    const cityLine = [e.postalCode, e.city].filter(Boolean).join(' ') || '';
    const addr: Record<string, string> = { KodKraju: cc, AdresL1: street || cityLine || '-' };
    if (street && cityLine) addr.AdresL2 = cityLine;
    return addr;
  };

  // ── VAT rate grouping ──
  const groups: Record<string, { net: number; tax: number }> = {};
  let totalNet = 0;
  let totalTax = 0;

  for (const item of data.items) {
    const net = Math.round(item.quantity * item.unitPrice * 100) / 100;
    const tax = Math.round(net * (item.vatRate || 0)) / 100;
    totalNet += net;
    totalTax += tax;

    const rate = item.vatRate || 0;
    let gk: string;
    if (rate === 23 || rate === 22) gk = '23';
    else if (rate === 8 || rate === 7) gk = '8';
    else if (rate === 5) gk = '5';
    else gk = '0';

    if (!groups[gk]) groups[gk] = { net: 0, tax: 0 };
    groups[gk].net += net;
    groups[gk].tax += tax;
  }

  // ── P_13_x / P_14_x summary fields ──
  const faSummary: Record<string, string> = {};
  if (groups['23']) {
    faSummary.P_13_1 = groups['23'].net.toFixed(2);
    faSummary.P_14_1 = groups['23'].tax.toFixed(2);
  }
  if (groups['8']) {
    faSummary.P_13_2 = groups['8'].net.toFixed(2);
    faSummary.P_14_2 = groups['8'].tax.toFixed(2);
  }
  if (groups['5']) {
    faSummary.P_13_3 = groups['5'].net.toFixed(2);
    faSummary.P_14_3 = groups['5'].tax.toFixed(2);
  }
  if (groups['0'] && groups['0'].net > 0) {
    faSummary.P_13_7 = groups['0'].net.toFixed(2);
  }

  // ── FaWiersz line items ──
  const faWiersze = data.items.map((item, idx) => {
    const net = Math.round(item.quantity * item.unitPrice * 100) / 100;
    const rate = item.vatRate || 0;

    let p12: string;
    if (rate === 23) p12 = '23';
    else if (rate === 22) p12 = '22';
    else if (rate === 8) p12 = '8';
    else if (rate === 7) p12 = '7';
    else if (rate === 5) p12 = '5';
    else p12 = 'zw';

    const line: Record<string, any> = {
      NrWierszaFa: idx + 1,
      P_7: item.name,
      PKWiU: '00',
      P_8A: (item as any).unit || 'szt.',
      P_8B: Number(item.quantity.toFixed(6)),
      P_9A: Number(item.unitPrice.toFixed(8)),
      P_11: Number(net.toFixed(2)),
      P_12: p12,
    };
    return line;
  });

  // ── Podmiot2 (buyer) — FA(3) adds two mandatory markers at the end of the sequence ──
  const podmiot2: Record<string, any> = {
    DaneIdentyfikacyjne: clientNip
      ? {
          NIP: clientNip,
          Nazwa:
            data.client.name ||
            `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim(),
        }
      : {
          BrakID: '1',
          Nazwa:
            data.client.name ||
            `${data.client.contactFirstname || ''} ${data.client.contactLastname || ''}`.trim(),
        },
    Adres: buildAddress(data.client),
    ...(data.client.contactEmail || data.client.contactPhone
      ? {
          DaneKontaktowe: {
            ...(data.client.contactEmail ? { Email: data.client.contactEmail } : {}),
            ...(data.client.contactPhone ? { Telefon: data.client.contactPhone } : {}),
          },
        }
      : {}),
  };
  if (version === 3) {
    // Mandatory in FA(3) (xsd:element with no minOccurs="0" → default minOccurs=1). invoicerr
    // doesn't support JST sub-unit invoicing or VAT-group membership, so both are always "2" (Nie),
    // mirroring the "not applicable" convention already used throughout Adnotacje below.
    podmiot2.JST = 2;
    podmiot2.GV = 2;
  }

  // ── full FA(2)/FA(3) object tree ──
  const namespace = version === 3 ? FA_VAT_3_NAMESPACE : FA_VAT_2_NAMESPACE;
  const kodSystemowy = version === 3 ? 'FA (3)' : 'FA (2)';

  const fa = {
    Faktura: {
      '@': {
        xmlns: namespace,
        'xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/',
      },
      Naglowek: {
        KodFormularza: { '@': { kodSystemowy, wersjaSchemy: '1-0E' }, '#': 'FA' },
        WariantFormularza: version,
        DataWytworzeniaFa: creationDt,
        SystemInfo: 'invoicerr',
      },
      Podmiot1: {
        PrefiksPodatnika: 'PL',
        DaneIdentyfikacyjne: {
          NIP: sellerNip,
          Nazwa: data.company.name,
        },
        Adres: buildAddress(data.company),
        ...(data.company.email || data.company.phone
          ? {
              DaneKontaktowe: {
                ...(data.company.email ? { Email: data.company.email } : {}),
                ...(data.company.phone ? { Telefon: data.company.phone } : {}),
              },
            }
          : {}),
      },
      Podmiot2: podmiot2,
      Fa: {
        KodWaluty: currency,
        P_1: issueDate,
        P_2: invoiceNumber,
        ...faSummary,
        P_15: Number((totalNet + totalTax).toFixed(2)),
        Adnotacje: {
          P_16: '2',
          P_17: '2',
          P_18: '2',
          P_18A: '2',
          Zwolnienie: { P_19N: '1' },
          NoweSrodkiTransportu: { P_22N: '1' },
          P_23: '2',
          PMarzy: { P_PMarzyN: '1' },
        },
        RodzajFaktury: 'VAT',
        FaWiersz: faWiersze,
      },
      Stopka: {
        Informacje: { StopkaFaktury: `Faktura ${invoiceNumber}` },
      },
    },
  };

  const builder = await import('xmlbuilder2');
  const doc = builder.create(fa as any, { format: 'fragment' });
  return doc.end({ prettyPrint: true });
}

/** FA_VAT / FA(2) XML — fully XSD-compliant FA(2) structure. Kept available during the FA(2)→FA(3)
 *  transition (both must build+validate — see COMPLIANCE_TODO M-5). */
export async function buildFaVat2(data: InvoiceRenderData): Promise<string> {
  return buildFaVatXml(data, 2);
}

/** FA_VAT / FA(3) XML — KSeF 2.0 structure, XSD-compliant against the vendored schemat_FA3.xsd. */
export async function buildFaVat3(data: InvoiceRenderData): Promise<string> {
  return buildFaVatXml(data, 3);
}

/**
 * FA_VAT (PL, KSeF) builder — selects FA(2) or FA(3) by the document's issue date (see
 * {@link selectFaVatVersion}) unless `opts.version` forces one explicitly.
 */
export async function buildFaVat(
  data: InvoiceRenderData,
  opts?: { version?: FaVatVersion },
): Promise<string> {
  const version = selectFaVatVersion(data.issuedAt ?? data.createdAt, opts?.version);
  return buildFaVatXml(data, version);
}
