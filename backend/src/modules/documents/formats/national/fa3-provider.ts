/**
 * FA(3) (PL, KSeF 2.0) format provider. REPRISED from
 * `invoice-rendering/national/fa-vat.ts` at git tag `avant-refonte-documents` (the FA(3) half only —
 * FA(2) is out of scope), ADAPTED to the current generic
 * document model exactly the way `facturx-provider.ts`/`cii-provider.ts` are: amounts come from
 * `totals/compute-totals.ts` (via `national-lines.ts`), NEVER recalculated by hand the way the old
 * `InvoiceRenderData`-based builder did (`item.quantity * item.unitPrice`, no discount concept at
 * all — this branch's descriptor now HAS one, `discountPercent`, so reusing the old arithmetic
 * verbatim would silently drop it).
 *
 * NOT wired through `structural-check.ts`/`validate-schematron.ts` (the EN 16931 gate) — FA(3) is a
 * POLISH NATIONAL schema with its OWN official XSD (`vendored/pl/schemat_FA3.xsd`, vendored
 * byte-for-byte from the reference), so it is judged by THAT XSD, never by the EN 16931 Schematron: a
 * national format's own XSD is its judge, exactly as `validate-schematron.ts`'s own header already
 * says for the two syntaxes it DOES cover. `validateXsd` (`vendored/validate-xsd.ts`) is the reprised
 * XSD half of the removed `compliance/schemas/validate.ts` — this is the first real caller since item
 * 12 left it out.
 *
 * Deliberately NOT reprised from fa-vat.ts, and why:
 *  - FA(2) / `selectFaVatVersion` — this provider only ever emits FA(3) (the KSeF 2.0 structure); FA(2)
 *    was the pre-2026-02-01 structure and has no caller in this branch's document model.
 *  - The `korFients`/faktura korygująca (credit-note) block — this branch's `invoice` descriptor has
 *    no correction-linkage shape compatible with the old one's `correction` input; a credit note
 *    reaching KSeF is a real, NAMED gap, not silently dropped.
 *
 * ## Provenance — what is and isn't asserted
 * The XML SHAPE (element names, nesting, the FA(3) mandatory `JST`/`GV` "not applicable" markers) is
 * REPRISED, not invented — see fa-vat.ts's own header at the reference for its sourcing (the published
 * KSeF 2.0 schema, crd.gov.pl). The VAT-rate → P_13_x/P_14_x summary BUCKET mapping (23%→group 1,
 * 8%→group 2, 5%→group 3, 0%→group 7, anything else uncounted in the per-rate summary though still
 * counted in the P_15 grand total) is preserved VERBATIM from that same builder — a genuine, known
 * limitation for a rate outside {23,22,8,7,5,0} (e.g. a reduced rate this catalog doesn't carry for
 * Poland), not a new gap introduced here.
 *
 * ## KOR — the faktura korygująca gap this file's own header used to name, now closed
 * `RodzajFaktury = KOR` + the `PrzyczynaKorekty`/`DaneFaKorygowanej` block, when `data.correctsInvoiceId`
 * (`descriptors/invoice.descriptor.ts`) names the invoice this one corrects — same XSD elements, same
 * relative order (`RodzajFaktury`, then this optional block, then `FaWiersz`) fa-vat.ts's own KOR mode
 * used at the reference, re-verified directly against THIS file's own vendored `schemat_FA3.xsd`
 * (`DaneFaKorygowanej`'s `xsd:choice` between `NrKSeF`+`NrKSeFFaKorygowanej` and `NrKSeFN` — see
 * `fa3-kor.ts`'s own header for which branch applies and why). `PrzyczynaKorekty` reads
 * `data.correctionReason` (`country-fields/data/pl.json`) when set, or else a generic, honest fallback
 * naming the corrected invoice — never an empty element (the schema allows omitting it entirely, but a
 * KOR that names no reason at all when a human COULD have typed one is a worse document than a
 * generic one). `TZnakowy`'s own `maxLength` is 240 (verified against `ElementarneTypyDanych_v10-0E.xsd`
 * directly — NOT the 256 fa-vat.ts's own comment assumed at the reference, a real, if harmless,
 * discrepancy in that file worth not repeating here).
 */
import { BadRequestException } from '@nestjs/common';

import { getIdentifier } from '@/utils/entity-identifiers';
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../../actions/action-registry';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { toDateOnly } from '../shared-build';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { FaVatKorContext, resolveFaVatKorContext } from './fa3-kor';
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
  // OPTIONAL, matching `DocumentFormatProvider.build`'s own 5th parameter (format-provider.ts) —
  // needed HERE (unlike every other provider so far, bar facturx-provider.ts's own PDF reference
  // labels) to look up the ORIGINAL invoice this one corrects, tenant-scoped: see fa3-kor.ts's own
  // header. Absent only for a caller that has no companyId to give (none today — both real callers,
  // `ksef-transport.ts` and `documents.service.ts#downloadDocumentFormat`, already pass one) — a
  // document that names `correctsInvoiceId` with no `companyId` on hand refuses loudly below, rather
  // than silently building an ordinary (RodzajFaktury=VAT) invoice for what the data itself flags as a
  // correction.
  companyId?: string,
): Promise<DocumentFormatBuildResult> {
  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractNationalLines(data, totals);
  const currency = totals.currency || 'PLN';

  // ── KOR (faktura korygująca) — see this file's own header and fa3-kor.ts's for the full design. ──
  const correctsInvoiceId =
    typeof data.correctsInvoiceId === 'string' && data.correctsInvoiceId.trim()
      ? data.correctsInvoiceId
      : undefined;
  let korContext: FaVatKorContext | undefined;
  if (correctsInvoiceId) {
    if (!companyId) {
      throw new BadRequestException(
        'Cannot build a Polish faktura korygująca (KOR): no company context was supplied to the FA(3) ' +
          'builder to look up the corrected invoice — this is an internal wiring gap, not a data problem.',
      );
    }
    korContext = await resolveFaVatKorContext(companyId, correctsInvoiceId);
  }

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
    // reference for the sourcing of this being mandatory (the published KSeF 2.0 schema).
    JST: 2,
    GV: 2,
  };

  // ── KOR block — PrzyczynaKorekty (optional per the XSD, always sent when correcting: see this
  //    file's own header on why an empty one is worse than a generic fallback) + the mandatory
  //    DaneFaKorygowanej entry, `xsd:choice`d between `korContext.originalKsefNumber` and `NrKSeFN`
  //    (fa3-kor.ts's own header). Spread right after `RodzajFaktury`, before `FaWiersz` — the exact
  //    relative order `schemat_FA3.xsd` declares for this optional sequence. ──
  const reason = (
    (typeof data.correctionReason === 'string' ? data.correctionReason.trim() : '') ||
    `Korekta faktury ${korContext?.originalDisplayNumber ?? ''}`.trim()
  ).slice(0, 240);
  const korFields = korContext
    ? {
        PrzyczynaKorekty: reason,
        DaneFaKorygowanej: [
          {
            DataWystFaKorygowanej: korContext.originalIssueDate,
            NrFaKorygowanej: korContext.originalDisplayNumber.slice(0, 240),
            ...(korContext.originalKsefNumber
              ? { NrKSeF: '1', NrKSeFFaKorygowanej: korContext.originalKsefNumber }
              : { NrKSeFN: '1' }),
          },
        ],
      }
    : {};

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
        RodzajFaktury: korContext ? 'KOR' : 'VAT',
        ...korFields,
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
