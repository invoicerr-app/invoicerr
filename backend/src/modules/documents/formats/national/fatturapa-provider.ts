/**
 * FatturaPA format provider. REPRISED from
 * `invoice-rendering/national/fattura-pa.ts` at git tag `avant-refonte-documents`, ADAPTED to the
 * current generic document model the same way `fa3-provider.ts` is (see that file's own header for
 * the shared reasoning): amounts come from `totals/compute-totals.ts` (via `national-lines.ts`),
 * NEVER `item.quantity * item.unitPrice` by hand — the old builder had no discount concept at all,
 * so reusing its arithmetic verbatim would silently drop this branch's `discountPercent` field.
 *
 * `@digitalia/fatturapa`'s `fpa2xml` (JSON → XML) is REUSED verbatim — already a dependency (see
 * package.json), no new one added. The CodiceDestinatario/PECDestinatario routing reads the client's
 * `IT_SDI`/`PEC` party identifiers exactly the way `entity-identifiers.ts#getIdentifier` already lets
 * any format provider read ANY scheme.
 *
 * NOT wired through the EN 16931 Schematron gate: FatturaPA is a national schema judged by its own
 * official XSD alone (`vendored/it/Schema_VFPR12.xsd`, version 1.2.3 as published on fatturapa.gov.it,
 * its xmldsig import pointed at the local copy), the same reasoning `fa3-provider.ts`'s header gives.
 * The XSD does not carry the SdI's own controls (a generic Natura code, a misused XXXXXXX): those are
 * met by the codes below, not by the schema.
 *
 * ## Provenance
 * Natura with its RiferimentoNormativo, RegimeFiscale and the two fallback CodiceDestinatario values
 * are read from the country data (`einvoiceCodes` in `countries/data/it.json`), each with its source.
 *
 * ## TD04 - the nota di credito (issue #472)
 *
 * A credit note is built with `TipoDocumento` `TD04` - the vendored XSD's own `TipoDocumentoType`
 * enumerates it with the documentation "Nota di credito" (`vendored/it/Schema_VFPR12.xsd`, the
 * Agenzia delle Entrate schema this provider is judged by) - and a `DatiFattureCollegate` block
 * naming the corrected invoice (`IdDocumento` = its number, `Data` = its issue date), the
 * `DatiDocumentiCorrelatiType` slot the same XSD declares for "fatture collegate". Amounts stay
 * POSITIVE: `TD04` is what makes the document a reduction, the same convention EN 16931's 381 holds.
 * `DatiPagamento` is omitted for `TD04`: its only content here is a fixed "pay by bank transfer, full
 * amount" instruction (`TP02`/`MP05`) that describes the BUYER paying the seller, which is the
 * opposite of what a credit note does; the element is optional (`minOccurs="0"` in the same XSD).
 * Only the caller that knows it holds a credit note sets `options.creditNote`
 * (`../credit-note-source.ts`); every invoice keeps `TD01` and its `DatiPagamento`, byte for byte.
 *
 * ## FPA12 vs FPR12 — the two named gaps `3cb39f91` left open, closed here
 *
 * `countries/data/it.json (section "b2gRouting")` already reads, verbatim, the Specifiche tecniche del formato
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
 * `getIdentifier(client, scheme)` mechanism the CodiceDestinatario/PEC routing below already
 * uses for `IT_SDI`/`PEC`, no new plumbing. It is also the ONLY signal `b2g-routing`'s own preflight
 * (`actions/invoice-actions.ts`'s B2G block) actually guarantees is present by the time a send reaches
 * this builder: a GOVERNMENT client's invoice is hard-blocked before this code ever runs unless
 * `IT_PA_CODE` is already on file (`resolveClientB2gRouting`'s `requiredClientIdentifiers`), so "does
 * the client carry a valid 6-char code" and "is this recipient the government body the B2G rule is
 * routing to" agree in every case this repo can actually reach send with. A `download` on a
 * GOVERNMENT client that has not yet filled in its code degrades to FPR12 and the code for a recipient
 * without one, the honest
 * consequence of not having a code to put in `CodiceDestinatario` at all, not a mislabel.
 *
 * **The XSD judges FPA12 and FPR12 alike.** fatturapa.gov.it publishes the same 1.2.3 schema under two
 * names, `Schema_VFPA12_V1.2.3.xsd` (FatturaPA page) and `Schema_VFPR12_v1.2.3.xsd` (Fattura Ordinaria
 * page), byte for byte identical: its `FormatoTrasmissioneType` enumerates both values and its
 * `CodiceDestinatarioType` is `[A-Z0-9]{6,7}`.
 */
import { guessCountryCode } from '@/utils/country-name-to-iso';
import { getIdentifier } from '@/utils/entity-identifiers';
import { fromMinor } from '@/utils/financial';

import { DocumentInstanceResult } from '../../actions/action-registry';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { TaxScheme } from '../../tax/types';
import { computeDocumentTotals } from '../../totals/compute-totals';
import { einvoiceCodesFor, exemptionCodeFor, taxRegimeCodeFor } from '../../einvoice-codes/registry';
import { CountryEinvoiceCodesFile, ExemptionCodeFact } from '../../einvoice-codes/schema';
import { requireDisplayNumber, toDateOnly } from '../shared-build';
import {
  DocumentFormatBuildOptions,
  DocumentFormatBuildResult,
  DocumentFormatParty,
  DocumentFormatProvider,
} from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { escapeXmlTree } from './fatturapa-xml-guard';
import { extractNationalLines, NationalLine } from './national-lines';
import { nationalFormatCountry } from './format-country';
import { documentCurrencyOrSellerNational } from './seller-currency';

const FATTURAPA_XSD = 'it/Schema_VFPR12.xsd';
const fatturapaFormatId = 'fatturapa';

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

/** The Natura of an untaxed line, read from the country data; `undefined` for a taxed line. */
function naturaFor(
  codes: CountryEinvoiceCodesFile,
  line: NationalLine | undefined,
  ratePercent: number,
  sellerTaxScheme: TaxScheme | undefined,
): ExemptionCodeFact | undefined {
  if (ratePercent > 0 || !line) return undefined;
  return exemptionCodeFor(
    codes,
    { exemptionReason: line.exemptionReason, vatRateId: line.rawVatRate },
    sellerTaxScheme,
  );
}

function buildDettaglioLinea(line: NationalLine, currency: string, natura: ExemptionCodeFact | undefined) {
  const rate = line.vatRatePercent ?? 0;
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
    // `DettaglioLineeType` has no `RiferimentoNormativo`; only `DatiRiepilogoType` does.
    ...(natura ? { Natura: natura.code } : {}),
  };
}

async function build(
  descriptor: DocumentTypeDescriptor,
  document: Pick<DocumentInstanceResult, 'id' | 'data' | 'displayNumber' | 'status'>,
  company: DocumentFormatParty,
  client: DocumentFormatParty,
  _companyId?: string,
  options?: DocumentFormatBuildOptions,
): Promise<DocumentFormatBuildResult> {
  const { fpa2xml } = await import('@digitalia/fatturapa');

  const data = (document.data ?? {}) as Record<string, unknown>;
  const totals = computeDocumentTotals(descriptor, data);
  const lines = extractNationalLines(data, totals);
  const currency = documentCurrencyOrSellerNational(totals.currency, company);

  const issueDate = toDateOnly(data.issueDate);
  // Never a `'DRAFT'` placeholder - see `shared-build.ts#requireDisplayNumber`'s own header.
  const invoiceNumber = requireDisplayNumber(document);
  const correctedInvoice = options?.creditNote?.correctedInvoice;

  // ── identifiers ──────────────────────────────────────────────────
  const vatId = getIdentifier(company, 'VAT') || '';
  const formatCountry = nationalFormatCountry(fatturapaFormatId);
  const codes = einvoiceCodesFor(formatCountry);
  const vatCountry = guessCountryCode(company.country) ?? formatCountry;
  const cf = getIdentifier(company, 'LEGAL_ID') || '';

  const clienteVatId = getIdentifier(client, 'VAT') || '';
  const clienteVatCountry = guessCountryCode(client.country) ?? '';
  const clienteCf = getIdentifier(client, 'LEGAL_ID') || '';

  // ── ProgressivoInvio: unique per invoice ─────────────────────────
  const progressivoInvio = invoiceNumber.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || '00001';

  // ── FormatoTrasmissione / CodiceDestinatario / PECDestinatario ──────────────────────────────────
  // The PA discriminant is checked FIRST and, when it fires, decides BOTH fields outright — see this
  // file's own header ("FPA12 vs FPR12") for why a valid 6-char `IT_PA_CODE` identifier is the signal
  // used, not `Client.kind`. Otherwise the B2B/private routing runs, its two fallback codes read from
  // the country data.
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
    codiceDestinatario = codes.recipientCodes.withoutCode;
    pecDestinatario = clientePec;
  } else if (clienteVatCountry && clienteVatCountry !== formatCountry) {
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = codes.recipientCodes.establishedAbroad;
  } else {
    formatoTrasmissione = 'FPR12';
    codiceDestinatario = codes.recipientCodes.withoutCode;
  }

  // ── Natura: an untaxed line with no code declared for it is refused, never guessed ─────────────
  const lineNaturas = lines.map((line) =>
    naturaFor(codes, line, line.vatRatePercent ?? 0, company.taxScheme),
  );
  const naturaErrors = lines
    .filter((line, i) => (line.vatRatePercent ?? 0) <= 0 && !lineNaturas[i])
    .map(
      (line) =>
        `Line ${line.index + 1} carries no VAT and no Natura code is declared for it: pick a VAT ` +
        'exemption rate from the list, or check the company VAT exemption setting.',
    );

  // ── DatiRiepilogo: grouped by VAT rate, from totals.vatBreakdown (never recomputed) ───────────
  // `vatBreakdown` groups strictly by NUMERIC percentage, never by catalog id — a seller mixing
  // `it-esente` AND `it-non-imponibile` lines (both 0%) on the SAME invoice would fold them into ONE
  // bucket here, which cannot honestly carry two different Natura codes at once. The FIRST
  // contributing line's Natura stands for the bucket: right for the common case of a whole invoice
  // under ONE regime, not a mix.
  const riepilogoList = totals.vatBreakdown.map((entry) => {
    const representativeLine = lines.find((line) => line.vatRatePercent === entry.ratePercent);
    const natura = naturaFor(codes, representativeLine, entry.ratePercent, company.taxScheme);
    return {
      AliquotaIVA: fmtRate(entry.ratePercent),
      // `DatiRiepilogoType` (the vendored `Schema_VFPR12.xsd`) declares its own element sequence as
      // `AliquotaIVA, Natura?, SpeseAccessorie?, Arrotondamento?, ImponibileImporto, Imposta,
      // EsigibilitaIVA?, RiferimentoNormativo?` — `Natura` sits right after `AliquotaIVA`, and
      // `RiferimentoNormativo` is the VERY LAST element, after `EsigibilitaIVA`, never grouped
      // together with `Natura` at the end the way this object used to place them (a second half of
      // the SAME latent element-order bug `buildDettaglioLinea` above carried).
      ...(natura ? { Natura: natura.code } : {}),
      ImponibileImporto: fmtAmount(fromMinor(entry.baseMinor, currency), 2),
      Imposta: fmtAmount(fromMinor(entry.vatMinor, currency), 2),
      EsigibilitaIVA: 'I' as const,
      ...(natura ? { RiferimentoNormativo: natura.legalReference } : {}),
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
            RegimeFiscale: taxRegimeCodeFor(codes, company.taxScheme),
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
            Nazione: clienteVatCountry || formatCountry,
          },
          ...(clienteVatCountry && clienteVatCountry !== formatCountry
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
            // TD04 "Nota di credito" for a credit note - see this file's own header, "TD04".
            TipoDocumento: correctedInvoice ? 'TD04' : 'TD01',
            Divisa: currency,
            Data: issueDate,
            Numero: invoiceNumber,
            ImportoTotaleDocumento: fmtAmount(totaleDocumento, 2),
          },
          ...(correctedInvoice
            ? {
                DatiFattureCollegate: [
                  { IdDocumento: correctedInvoice.displayNumber, Data: correctedInvoice.issueDate },
                ],
              }
            : {}),
        },
        DatiBeniServizi: {
          DettaglioLinee: lines.map((line, i) => buildDettaglioLinea(line, currency, lineNaturas[i])),
          DatiRiepilogo: riepilogoList,
        },
        // Omitted for TD04 - see this file's own header, "TD04".
        ...(correctedInvoice
          ? {}
          : {
              DatiPagamento: {
                CondizioniPagamento: 'TP02',
                DettaglioPagamento: {
                  ModalitaPagamento: 'MP05',
                  ImportoPagamento: fmtAmount(totaleDocumento, 2),
                },
              },
            }),
      },
    },
  };

  // Every string in `fattura` — free text (line descriptions, party names, addresses, …) and fixed
  // structural values alike — is rewritten here, ONCE, before it ever reaches `fpa2xml`. See
  // `fatturapa-xml-guard.ts`'s own header for why this has to be a whole-tree pass rather than a
  // wrapper at each field above: fast-xml-parser@3.21.1 (pinned transitively through
  // `@digitalia/fatturapa`, `fixAvailable: false`) escapes nothing on its own.
  const xml: string = await fpa2xml(escapeXmlTree(fattura) as Record<string, unknown>);

  const xsd = await validateXsd(xml, FATTURAPA_XSD);
  const errors = [...naturaErrors, ...xsd.errors];
  return { bytes: new TextEncoder().encode(xml), validation: { valid: errors.length === 0, errors } };
}

export const fatturapaFormatProvider: DocumentFormatProvider = {
  id: fatturapaFormatId,
  syntax: 'FATTURAPA',
  mime: 'application/xml',
  build,
};
