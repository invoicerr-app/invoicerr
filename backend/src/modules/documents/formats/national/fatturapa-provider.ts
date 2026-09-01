/**
 * FatturaPA 1.2 (IT/SM) format provider — root TODO item 10, wave 2. REPRISED from
 * `invoice-rendering/national/fattura-pa.ts` at git tag `avant-refonte-documents`, ADAPTED to the
 * current generic document model the same way `fa3-provider.ts` is (see that file's own header for
 * the shared reasoning): amounts come from `totals/compute-totals.ts` (via `national-lines.ts`),
 * NEVER `item.quantity * item.unitPrice` by hand — the old builder had no discount concept at all,
 * so reusing its arithmetic verbatim would silently drop this branch's `discountPercent` field.
 *
 * `@digitalia/fatturapa`'s `fpa2xml` (JSON → XML) is REUSED verbatim — already a dependency (see
 * package.json), no new one added. The CodiceDestinatario/PECDestinatario routing (F-16/M-8 at the
 * repère) is REPRISED VERBATIM: it reads the client's `IT_SDI`/`PEC` party identifiers exactly the
 * way `entity-identifiers.ts#getIdentifier` already lets any format provider read ANY scheme, with
 * no registry check that the scheme is "known" — the same latitude `party-snapshot.ts`'s own
 * `partyIdentifiers: { scheme: string; value: string }[]` already gives every caller.
 *
 * NOT wired through the EN 16931 Schematron gate — FatturaPA is an ITALIAN NATIONAL schema with its
 * own official XSD (`vendored/it/Schema_VFPR12.xsd`, vendored byte-for-byte from the repère), judged
 * by THAT XSD alone, exactly the same reasoning `fa3-provider.ts`'s own header gives.
 *
 * ## Provenance
 * The Natura/RiferimentoNormativo mapping and the 4-branch CodiceDestinatario routing are REPRISED,
 * not invented — see `fattura-pa.ts`'s own header at the repère and its `fattura-pa.spec.ts` (kept,
 * `fatturapa-provider.spec.ts`, adapted to this module's own fixture shape) for the sourcing already
 * established there. Nothing here asserts a NEW tax rule.
 *
 * ## FPA12 vs FPR12 — the two named gaps `3cb39f91` left open, closed here
 *
 * `b2g-routing/data/it.json` already reads, verbatim, the Specifiche tecniche del formato
 * FatturaPA v1.3.2 par. 1.4 (Allegato B): `FormatoTrasmissione` is `FPA12` ("fattura verso PA") when
 * `CodiceDestinatario` is the recipient's 6-character "Codice Ufficio" from IndicePA, `FPR12`
 * ("fattura verso privati") when it is the 7-character B2B code — see par. 1.1's own text, quoted
 * there. This builder now reads that SAME discriminant off the client:
 *
 * **Discriminant chosen: the presence of a valid 6-character `IT_PA_CODE` party identifier on the
 * CLIENT — never `Client.kind` itself.** Both signals were available (the b2g-routing decision
 * already knows `Client.kind === 'GOVERNMENT'`), but this builder receives only a
 * `DocumentFormatParty` (`party-snapshot.ts`) — a shape shared verbatim with `Company` and
 * deliberately free of any business-entity concept (see that file's own header: "a provider never has
 * to know whether it is looking at a seller … or a buyer"). Threading `kind` through it would mean
 * either growing `CompanyRowForFormat` with a field companies don't have, or making the shared
 * interface lie for one party and not the other. The identifier, by contrast, is EXACTLY the fact the
 * SdI specification itself keys off — a `CodiceDestinatario` IS a 6-character IndicePA code or it
 * ISN'T, independent of any internal `kind` label — and it slots into the SAME
 * `getIdentifier(client, scheme)` mechanism the CodiceDestinatario/PEC 4-branch routing below already
 * uses for `IT_SDI`/`PEC`, no new plumbing. It is also the ONLY signal `b2g-routing`'s own preflight
 * (`actions/invoice-actions.ts`'s B2G block) actually guarantees is present by the time a send reaches
 * this builder: a GOVERNMENT client's invoice is hard-blocked before this code ever runs unless
 * `IT_PA_CODE` is already on file (`resolveClientB2gRouting`'s `requiredClientIdentifiers`), so "does
 * the client carry a valid 6-char code" and "is this recipient the government body the B2G rule is
 * routing to" agree in every case this repo can actually reach send with. A `download` on a
 * GOVERNMENT client that has not yet filled in its code degrades to FPR12/XXXXXXX — the honest
 * consequence of not having a code to put in `CodiceDestinatario` at all, not a mislabel.
 *
 * **The XSD: verified, not assumed, to already judge FPA12 correctly — nothing new to vendor.** The
 * vendored `vendored/it/Schema_VFPR12.xsd` was suspected (see `b2g-routing/data/it.json`'s own "TROU
 * CONNU" note) of being a B2B-only schema that would wrongly reject an `FPA12` document. It is not:
 * its OWN root `xs:documentation` reads "XML schema fatture destinate a PA e privati in forma
 * ordinaria" ("… for PA AND privates …"), its `FormatoTrasmissioneType` enumerates BOTH `FPA12` and
 * `FPR12`, and its `CodiceDestinatarioType` is `[A-Z0-9]{6,7}` — 6 OR 7 characters, exactly the two
 * lengths the Specifiche distinguish. Fetched directly from fatturapa.gov.it on 2026-09-01 to make
 * sure this was not a repère-era approximation: the tax agency in fact publishes this SAME schema
 * (identical `FormatoTrasmissioneType`/`CodiceDestinatarioType`/root element/targetNamespace) under
 * TWO different file names for its current 1.2.3 revision —
 * `https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/Schema_VFPA12_V1.2.3.xsd` (linked
 * under "FatturaPA", i.e. the PA-facing page) and
 * `.../Schema_VFPR12_v1.2.3.xsd` (linked under "Fattura Ordinaria", the private-facing page) — one
 * schema, two download links for two audiences, not two different rule sets. The vendored 1.2 copy
 * predates that 1.2.3 renumbering but carries the identical two type definitions, so it judges an
 * `FPA12` document exactly as correctly as it judges an `FPR12` one; nothing to vendor twice. (Not
 * independently diffed byte-for-byte beyond those two types across the FULL 1.2 → 1.2.3 schema — a
 * pre-existing version gap that applies equally to the B2B path already, unrelated to this fix.)
 */
import { getIdentifier } from '@/utils/entity-identifiers';
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../../actions/action-registry';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { toDateOnly } from '../shared-build';
import { DocumentFormatBuildResult, DocumentFormatParty, DocumentFormatProvider } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { extractNationalLines, NationalLine } from './national-lines';

const FATTURAPA_XSD = 'it/Schema_VFPR12.xsd';

/** Format a number as a string matching the yup SPrezzoSchema regex: /^[-]?\d{1,12}(\.\d{2,8})$/ */
function fmtAmount(n: number, decimals = 2): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return rounded.toFixed(decimals);
}

/** Format AliquotaIVA as /^[-]?\d{1,3}(\.\d{2,2})$/ */
function fmtRate(n: number): string {
  return n.toFixed(2);
}

/** Map NaturaType — codes N1-N7 per FatturaPA spec. VERBATIM from fattura-pa.ts at the repère. */
const EU_CC = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]; // prettier-ignore

function mapNatura(vatRate: number, clientCountry: string, clientVatId: string): string | undefined {
  if (vatRate > 0) return undefined;
  const cc = (clientCountry || '').slice(0, 2).toUpperCase();
  if (cc !== 'IT' && EU_CC.includes(cc) && clientVatId) return 'N6';
  return 'N2';
}

function riferimentoNormativo(natura: string): string {
  switch (natura) {
    case 'N6':
      return 'Reverse charge art. 17 DPR 633/72';
    case 'N4':
      return 'Esente art. 10 DPR 633/72';
    case 'N3':
      return 'Non imponibile art. 8 DPR 633/72';
    case 'N2':
      return 'Operazione non soggetta';
    default:
      return 'Art. 1 DPR 633/72';
  }
}

function buildDettaglioLinea(
  line: NationalLine,
  currency: string,
  clienteVatCountry: string,
  clienteVatId: string,
) {
  const rate = line.vatRatePercent ?? 0;
  const natura = mapNatura(rate, clienteVatCountry, clienteVatId);
  return {
    NumeroLinea: line.index + 1,
    Descrizione: line.description,
    Quantita: fmtAmount(line.quantity, 2),
    PrezzoUnitario: fmtAmount(line.unitPrice, 8),
    // The line's TOTAL is the discounted net `compute-totals.ts` already computed — NEVER
    // `quantity * unitPrice` (which would ignore `discountPercent`, the gap this rewrite exists to
    // close — see this file's own header).
    PrezzoTotale: fmtAmount(fromMinor(line.netMinor, currency), 8),
    AliquotaIVA: fmtRate(rate),
    ...(natura ? { Natura: natura, RiferimentoNormativo: riferimentoNormativo(natura) } : {}),
  };
}

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
): Promise<DocumentFormatBuildResult> {
  const { fpa2xml } = await import('@digitalia/fatturapa');

  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractNationalLines(data, totals);
  const currency = totals.currency || 'EUR';

  const issueDate = toDateOnly(data.issueDate);
  const invoiceNumber = document.displayNumber ?? 'DRAFT';

  // ── identifiers ──────────────────────────────────────────────────
  const vatId = getIdentifier(company, 'VAT') || '';
  const vatCountry = (company.country || 'IT').slice(0, 2).toUpperCase();
  const cf = getIdentifier(company, 'LEGAL_ID') || '';

  const clienteVatId = getIdentifier(client, 'VAT') || '';
  const clienteVatCountry = (client.country || '').slice(0, 2).toUpperCase();
  const clienteCf = getIdentifier(client, 'LEGAL_ID') || '';

  // ── ProgressivoInvio: unique per invoice ─────────────────────────
  const progressivoInvio = invoiceNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || '00001';

  // ── FormatoTrasmissione / CodiceDestinatario / PECDestinatario ──────────────────────────────────
  // The PA discriminant is checked FIRST and, when it fires, decides BOTH fields outright — see this
  // file's own header ("FPA12 vs FPR12") for why a valid 6-char `IT_PA_CODE` identifier is the signal
  // used, not `Client.kind`. Only once it does NOT fire does the ORIGINAL 4-branch B2B/private routing
  // (VERBATIM from the repère) run unchanged — same outcomes as before this task for every client that
  // has no `IT_PA_CODE` on file, which is every test/fixture that predates it.
  const clientePaCode = getIdentifier(client, 'IT_PA_CODE') || '';
  const isValidPaCode = /^[A-Za-z0-9]{6}$/.test(clientePaCode);

  const clienteSdiCode = getIdentifier(client, 'IT_SDI') || '';
  const clientePec = getIdentifier(client, 'PEC') || '';
  const isValidSdiCode = /^[A-Za-z0-9]{7}$/.test(clienteSdiCode);

  let formatoTrasmissione: 'FPA12' | 'FPR12';
  let codiceDestinatario: string;
  let pecDestinatario: string | undefined;
  if (isValidPaCode) {
    formatoTrasmissione = 'FPA12';
    codiceDestinatario = clientePaCode.toUpperCase();
  } else if (isValidSdiCode) {
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = clienteSdiCode.toUpperCase();
  } else if (clientePec) {
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = '0000000';
    pecDestinatario = clientePec;
  } else if (clienteVatCountry && clienteVatCountry !== 'IT') {
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = 'XXXXXXX';
  } else {
    // Domestic IT, neither code nor PEC on file — '0000000' would fail @digitalia/fatturapa's own
    // yup business-rule gate (PECDestinatario required whenever CodiceDestinatario is '0000000');
    // 'XXXXXXX' is the least-wrong fallback that needs no data we don't have. See fattura-pa.ts's
    // own header for the same call, reprised verbatim.
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = 'XXXXXXX';
  }

  // ── DatiRiepilogo: grouped by VAT rate, from totals.vatBreakdown (never recomputed) ───────────
  const riepilogoList = totals.vatBreakdown.map((entry) => {
    const natura = mapNatura(entry.ratePercent, clienteVatCountry, clienteVatId);
    return {
      AliquotaIVA: fmtRate(entry.ratePercent),
      ImponibileImporto: fmtAmount(fromMinor(entry.baseMinor, currency), 2),
      Imposta: fmtAmount(fromMinor(entry.vatMinor, currency), 2),
      EsigibilitaIVA: 'I' as const,
      ...(natura ? { Natura: natura, RiferimentoNormativo: riferimentoNormativo(natura) } : {}),
    };
  });

  // ── Contatti ───────────────────────────────────────────────────
  const contatti: Record<string, string> = {};
  if (company.phone) contatti.Telefono = company.phone;
  if (company.email) contatti.Email = company.email;

  const totaleDocumento = fromMinor(totals.grossMinor, currency);

  const fattura = {
    'p:FatturaElettronica': {
      '@': {
        versione: formatoTrasmissione,
        'xmlns:p': 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
        // The schema itself judges BOTH FormatoTrasmissione values identically (see this file's own
        // header) — only the location HINT's own filename tracks which official download page a human
        // would find it under, never a second schema this codebase actually validates against.
        'xsi:schemaLocation': `http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_${formatoTrasmissione === 'FPA12' ? 'VFPA12' : 'VFPR12'}.xsd`,
      },
      FatturaElettronicaHeader: {
        DatiTrasmissione: {
          IdTrasmittente: { IdPaese: vatCountry, IdCodice: cf || vatId },
          ProgressivoInvio: progressivoInvio,
          FormatoTrasmissione: formatoTrasmissione,
          CodiceDestinatario: codiceDestinatario,
          ...(pecDestinatario ? { PECDestinatario: pecDestinatario } : {}),
        },
        CedentePrestatore: {
          DatiAnagrafici: {
            IdFiscaleIVA: { IdPaese: vatCountry, IdCodice: vatId },
            Anagrafica: { Denominazione: company.name },
            RegimeFiscale: 'RF01',
          },
          Sede: {
            Indirizzo: company.address || 'N/A',
            CAP: company.postalCode || '00000',
            Comune: company.city || 'N/A',
            Nazione: vatCountry,
          },
          ...(Object.keys(contatti).length > 0 ? { Contatti: contatti } : {}),
        },
        CessionarioCommittente: {
          DatiAnagrafici: {
            ...(clienteVatId ? { IdFiscaleIVA: { IdPaese: clienteVatCountry, IdCodice: clienteVatId } } : {}),
            ...(clienteCf && /^[A-Z0-9]{11,16}$/.test(clienteCf) ? { CodiceFiscale: clienteCf } : {}),
            Anagrafica: { Denominazione: client.name },
          },
          Sede: {
            Indirizzo: client.address || 'N/A',
            CAP: client.postalCode || '00000',
            Comune: client.city || 'N/A',
            Nazione: clienteVatCountry || 'IT',
          },
          ...(clienteVatCountry && clienteVatCountry !== 'IT'
            ? {
                StabileOrganizzazione: {
                  Indirizzo: client.address || 'N/A',
                  CAP: client.postalCode || '00000',
                  Comune: client.city || 'N/A',
                  Nazione: clienteVatCountry,
                },
              }
            : {}),
        },
      },
      FatturaElettronicaBody: {
        DatiGenerali: {
          DatiGeneraliDocumento: {
            TipoDocumento: 'TD01',
            Divisa: currency,
            Data: issueDate,
            Numero: invoiceNumber,
            ImportoTotaleDocumento: fmtAmount(totaleDocumento, 2),
          },
        },
        DatiBeniServizi: {
          DettaglioLinee: lines.map((line) =>
            buildDettaglioLinea(line, currency, clienteVatCountry, clienteVatId),
          ),
          DatiRiepilogo: riepilogoList,
        },
        DatiPagamento: {
          CondizioniPagamento: 'TP02',
          DettaglioPagamento: {
            ModalitaPagamento: 'MP05',
            ImportoPagamento: fmtAmount(totaleDocumento, 2),
          },
        },
      },
    },
  };

  const xml: string = await fpa2xml(fattura as Record<string, unknown>);

  const xsd = await validateXsd(xml, FATTURAPA_XSD);
  return { bytes: new TextEncoder().encode(xml), validation: { valid: xsd.valid, errors: xsd.errors } };
}

export const fatturapaFormatProvider: DocumentFormatProvider = {
  id: 'fatturapa',
  syntax: 'FATTURAPA',
  mime: 'application/xml',
  build,
};
