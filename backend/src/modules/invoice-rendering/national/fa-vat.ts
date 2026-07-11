/**
 * FA_VAT / FA(2) (PL, KSeF) builder.
 *
 * Extracted verbatim from InvoiceRenderingService (behaviour-preserving).
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import type { InvoiceRenderData } from '../render-data';

/** FA_VAT (PL/KSeF) XML — fully XSD-compliant FA(2) structure. */
export async function buildFaVat(data: InvoiceRenderData): Promise<string> {
  const issueDate = (data.issuedAt ?? data.createdAt).toISOString().split('T')[0];
  const creationDt = (data.issuedAt ?? data.createdAt).toISOString().replace(/\.\d{3}Z$/, '');
  const invoiceNumber = data.rawNumber || (data.number?.toString() ?? 'DRAFT');
  const currency = data.company.currency || 'PLN';
  const sellerNip = (getIdentifier(data.company, 'VAT') || '').replace(/^[A-Z]{2}/, '');
  const clientNip = (getIdentifier(data.client, 'VAT') || '').replace(/^[A-Z]{2}/, '');

  // ── address builder (FA(2) TAdres: KodKraju + AdresPol fields) ──
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

  // ── full FA(2) object tree ──
  const fa2 = {
    Faktura: {
      '@': {
        xmlns: 'http://crd.gov.pl/wzor/2023/06/29/12648/',
        'xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/',
      },
      Naglowek: {
        KodFormularza: { '@': { kodSystemowy: 'FA (2)', wersjaSchemy: '1-0E' }, '#': 'FA' },
        WariantFormularza: 2,
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
      Podmiot2: {
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
      },
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
  const doc = builder.create(fa2 as any, { format: 'fragment' });
  return doc.end({ prettyPrint: true });
}
