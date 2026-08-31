/**
 * FA(3) (PL, KSeF 2.0) format provider — root TODO item 10, wave 2. REPRISED from
 * `invoice-rendering/national/fa-vat.ts` at git tag `avant-refonte-documents` (the FA(3) half only —
 * FA(2) is out of this wave's scope, see this task's own brief), ADAPTED to the current generic
 * document model exactly the way `facturx-provider.ts`/`cii-provider.ts` are: amounts come from
 * `totals/compute-totals.ts` (via `national-lines.ts`), NEVER recalculated by hand the way the old
 * `InvoiceRenderData`-based builder did (`item.quantity * item.unitPrice`, no discount concept at
 * all — this branch's descriptor now HAS one, `discountPercent`, so reusing the old arithmetic
 * verbatim would silently drop it).
 *
 * NOT wired through `structural-check.ts`/`validate-schematron.ts` (the EN 16931 gate) — FA(3) is a
 * POLISH NATIONAL schema with its OWN official XSD (`vendored/pl/schemat_FA3.xsd`, vendored
 * byte-for-byte from the repère), so it is judged by THAT XSD, never by the EN 16931 Schematron: a
 * national format's own XSD is its judge, exactly as `validate-schematron.ts`'s own header already
 * says for the two syntaxes it DOES cover. `validateXsd` (`vendored/validate-xsd.ts`) is the reprised
 * XSD half of the removed `compliance/schemas/validate.ts` — this is the first real caller since item
 * 12 left it out.
 *
 * Deliberately NOT reprised from fa-vat.ts, and why:
 *  - FA(2) / `selectFaVatVersion` — this wave only ever emits FA(3) (the KSeF 2.0 structure); FA(2)
 *    was the pre-2026-02-01 structure and has no caller in this branch's document model.
 *  - The `korFients`/faktura korygująca (credit-note) block — this branch's `invoice` descriptor has
 *    no correction-linkage shape compatible with the old one's `correction` input; a credit note
 *    reaching KSeF is a real, NAMED gap (see this task's own report), not silently dropped.
 *
 * ## Provenance — what is and isn't asserted
 * The XML SHAPE (element names, nesting, the FA(3) mandatory `JST`/`GV` "not applicable" markers) is
 * REPRISED, not invented — see fa-vat.ts's own header at the repère for its sourcing (the published
 * KSeF 2.0 schema, crd.gov.pl). The VAT-rate → P_13_x/P_14_x summary BUCKET mapping (23%→group 1,
 * 8%→group 2, 5%→group 3, 0%→group 7, anything else uncounted in the per-rate summary though still
 * counted in the P_15 grand total) is preserved VERBATIM from that same builder — a genuine, known
 * limitation for a rate outside {23,22,8,7,5,0} (e.g. a reduced rate this catalog doesn't carry for
 * Poland), not a new gap this task introduces.
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../../actions/action-registry';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { toDateOnly } from '../shared-build';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { extractNationalLines, NationalLine } from './national-lines';

const FA_VAT_3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/';
const FA3_XSD = 'pl/schemat_FA3.xsd';

/** Same "not applicable" address builder fa-vat.ts used — `guessCountryCode` resolves the party's
 *  free-text `country`, defaulting to 'PL' the same way `build-semantic-invoice.ts`'s own EN 16931
 *  bridge defaults unresolved countries to this product's primary market (see that file's header). */
function buildAddress(party: DocumentFormatParty) {
  const cc = guessCountryCode(party.country) ?? 'PL';
  const street = party.address || '';
  const cityLine = [party.postalCode, party.city].filter(Boolean).join(' ') || '';
  const addr: Record<string, string> = { KodKraju: cc, AdresL1: street || cityLine || '-' };
  if (street && cityLine) addr.AdresL2 = cityLine;
  return addr;
}

/** FA(3) rate-bucket grouping — VERBATIM from fa-vat.ts (see this file's own header on the limitation
 *  this carries forward unchanged, never a new one). */
function summaryBucket(ratePercent: number): '23' | '8' | '5' | '0' | null {
  if (ratePercent === 23 || ratePercent === 22) return '23';
  if (ratePercent === 8 || ratePercent === 7) return '8';
  if (ratePercent === 5) return '5';
  if (ratePercent === 0) return '0';
  return null;
}

/** FA(3) per-line `P_12` rate code — VERBATIM mapping from fa-vat.ts. */
function lineRateCode(ratePercent: number | null): string {
  if (ratePercent === 23) return '23';
  if (ratePercent === 22) return '22';
  if (ratePercent === 8) return '8';
  if (ratePercent === 7) return '7';
  if (ratePercent === 5) return '5';
  return 'zw';
}

function buildFaWiersz(line: NationalLine, currency: string) {
  return {
    NrWierszaFa: line.index + 1,
    P_7: line.description,
    PKWiU: '00',
    P_8A: line.unit || 'szt.',
    P_8B: Number(line.quantity.toFixed(6)),
    P_9A: Number(line.unitPrice.toFixed(8)),
    P_11: Number(fromMinor(line.netMinor, currency).toFixed(2)),
    P_12: lineRateCode(line.vatRatePercent),
  };
}

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status' | 'createdAt'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractNationalLines(data, totals);
  const currency = totals.currency || 'PLN';

  const invoiceNumber = document.displayNumber ?? 'DRAFT';
  const issueDate = toDateOnly(data.issueDate);
  // "DataWytworzeniaFa" — full datetime, no millis/zone suffix, same convention fa-vat.ts used.
  const creationSource =
    typeof data.issueDate === 'string' ? new Date(data.issueDate) : (document.createdAt ?? new Date());
  const creationDt = (Number.isNaN(creationSource.getTime()) ? new Date() : creationSource)
    .toISOString()
    .split('.')[0];

  const sellerNip = (getIdentifier(company, 'VAT') || '').replace(/^[A-Z]{2}/, '');
  const clientNip = (getIdentifier(client, 'VAT') || '').replace(/^[A-Z]{2}/, '');

  // ── P_13_x / P_14_x summary buckets — see this file's own header on the verbatim, bounded gap. ──
  const bucketTotals: Record<'23' | '8' | '5' | '0', { netMinor: number; vatMinor: number }> = {
    '23': { netMinor: 0, vatMinor: 0 },
    '8': { netMinor: 0, vatMinor: 0 },
    '5': { netMinor: 0, vatMinor: 0 },
    '0': { netMinor: 0, vatMinor: 0 },
  };
  for (const entry of totals.vatBreakdown) {
    const bucket = summaryBucket(entry.ratePercent);
    if (!bucket) continue;
    bucketTotals[bucket].netMinor += entry.baseMinor;
    bucketTotals[bucket].vatMinor += entry.vatMinor;
  }
  const faSummary: Record<string, string> = {};
  if (bucketTotals['23'].netMinor > 0) {
    faSummary.P_13_1 = fromMinor(bucketTotals['23'].netMinor, currency).toFixed(2);
    faSummary.P_14_1 = fromMinor(bucketTotals['23'].vatMinor, currency).toFixed(2);
  }
  if (bucketTotals['8'].netMinor > 0) {
    faSummary.P_13_2 = fromMinor(bucketTotals['8'].netMinor, currency).toFixed(2);
    faSummary.P_14_2 = fromMinor(bucketTotals['8'].vatMinor, currency).toFixed(2);
  }
  if (bucketTotals['5'].netMinor > 0) {
    faSummary.P_13_3 = fromMinor(bucketTotals['5'].netMinor, currency).toFixed(2);
    faSummary.P_14_3 = fromMinor(bucketTotals['5'].vatMinor, currency).toFixed(2);
  }
  if (bucketTotals['0'].netMinor > 0) {
    faSummary.P_13_7 = fromMinor(bucketTotals['0'].netMinor, currency).toFixed(2);
  }

  const podmiot2: Record<string, unknown> = {
    DaneIdentyfikacyjne: clientNip
      ? { NIP: clientNip, Nazwa: client.name }
      : { BrakID: '1', Nazwa: client.name },
    Adres: buildAddress(client),
    ...(client.email || client.phone
      ? {
          DaneKontaktowe: {
            ...(client.email ? { Email: client.email } : {}),
            ...(client.phone ? { Telefon: client.phone } : {}),
          },
        }
      : {}),
    // Mandatory in FA(3) (xsd:element, minOccurs defaults to 1) — this product supports neither JST
    // sub-unit invoicing nor VAT-group membership, so both are always "2" (Nie), the same
    // "not applicable" convention Adnotacje already uses below. See fa-vat.ts's own header at the
    // repère for the sourcing of this being mandatory (the published KSeF 2.0 schema).
    JST: 2,
    GV: 2,
  };

  const fa = {
    Faktura: {
      '@': {
        xmlns: FA_VAT_3_NAMESPACE,
        'xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/',
      },
      Naglowek: {
        KodFormularza: { '@': { kodSystemowy: 'FA (3)', wersjaSchemy: '1-0E' }, '#': 'FA' },
        WariantFormularza: 3,
        DataWytworzeniaFa: creationDt,
        SystemInfo: 'invoicerr',
      },
      Podmiot1: {
        PrefiksPodatnika: 'PL',
        DaneIdentyfikacyjne: { NIP: sellerNip, Nazwa: company.name },
        Adres: buildAddress(company),
        ...(company.email || company.phone
          ? {
              DaneKontaktowe: {
                ...(company.email ? { Email: company.email } : {}),
                ...(company.phone ? { Telefon: company.phone } : {}),
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
        P_15: Number(fromMinor(totals.grossMinor, currency).toFixed(2)),
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
        FaWiersz: lines.map((line) => buildFaWiersz(line, currency)),
      },
      Stopka: {
        Informacje: { StopkaFaktury: `Faktura ${invoiceNumber}` },
      },
    },
  };

  const builder = await import('xmlbuilder2');
  const doc = builder.create(fa as Record<string, unknown>, { format: 'fragment' });
  const xml = doc.end({ prettyPrint: true });

  const xsd = await validateXsd(xml, FA3_XSD);
  return { bytes: new TextEncoder().encode(xml), validation: { valid: xsd.valid, errors: xsd.errors } };
}

export const fa3FormatProvider: DocumentFormatProvider = {
  id: 'fa3',
  syntax: 'FA_VAT_3',
  mime: 'application/xml',
  build,
};
