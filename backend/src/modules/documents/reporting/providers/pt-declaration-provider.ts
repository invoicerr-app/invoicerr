/**
 * The "pt-at" `DeclarationProvider` — Portugal's real-time "comunicação de documentos de faturação"
 * to the Autoridade Tributária e Aduaneira (AT). Status: **implemented to the documented AT contract,
 * awaiting accreditation** — the SAME posture `transports/sdi/` (SdI, Italy) already carries: no real
 * AT "subutilizador" credential or AT public key was available, so this has never made a
 * real round-trip. See `pt-at-client.ts`'s own header for the full VERIFIED/⚠ UNVERIFIED breakdown of
 * the wire protocol itself — this file is the thin `DeclarationProvider` adapter around it, plus the
 * ONE thing `pt-at-client.ts` deliberately does not own: mapping `DeclaredInvoice` onto AT's own
 * `RegisterInvoiceRequest` fields.
 *
 * ## Scope — `RegisterInvoiceRequest` (CREATE) only, never Change/Delete
 *
 * The AT webservice also exposes `ChangeInvoiceStatusRequest` (e.g. marking a document "Anulado") and
 * `DeleteInvoiceRequest` — this codebase's own trigger (`reporting/report-on-send.ts`) only ever
 * fires on a document's OWN "sent" transition, which happens exactly once, at issuance, so CREATE is
 * the only operation this bridge ever has occasion to call.
 *
 * ## What is declared: the invoice and, since issue #501, the credit note
 *
 * Decreto-Lei n.º 198/2012 applies « às faturas e documentos retificativos de fatura » (art. 1.º
 * n.º 2), and the data model of the communication must carry the « Identificação do documento
 * retificado » and the « Código único de documento » (art. 3.º n.º 4 n) and p)). Both are quoted, with
 * their source and reading date, in `countries/data/pt.json (section "reporting")`. So:
 *  - every declared document carries its real ATCUD (field 1.6.2), never the literal "0" this bridge
 *    used to send (see `ptAtAtcudFor` below), and a document without one is refused;
 *  - a credit note is declared as `InvoiceType` "NC", its `LineSummary` lines carry
 *    `DebitCreditIndicator` "D" and a `Reference` to the corrected invoice's own number (manual fields
 *    1.6.4, 1.6.14.3 and 1.6.14.4, see `buildPtAtLineSummaries`).
 *
 * ## The `authorityId` caveat — SYNTHESIZED, not authority-minted (see `synthesizePtAtAuthorityId`
 * below and `countries/data/pt.json (section "reporting")`'s own `notes`)
 *
 * Unlike NAV's `transactionId` or myDATA's `invoiceMark`, AT's `RegisterInvoiceResponse` carries NO
 * per-invoice reference of its own — only a numeric `CodigoResposta`, a `Mensagem`, and a bare
 * `DataOperacao` timestamp (see `pt-at-client.ts`'s own header). This mechanism's own hard contract
 * (`declaration-provider.ts#DeclarationResult.authorityId`, enforced by
 * `reporting-runner.ts#assertNonEmptyDeclarationResult`) requires a non-empty id regardless — so this
 * bridge SYNTHESIZES one from the invoice's own number plus AT's own response timestamp. This is
 * NEVER a reference AT itself would recognize if asked about it later, and must never be presented to
 * a user as "the AT's own confirmation number" — see the synthesis site's own comment for the third,
 * innermost repetition of this exact caveat.
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import {
  ChannelNotConnectedError,
  DeclarationProvider,
  DeclarationResult,
  DeclaredInvoice,
  DeclaredInvoiceLine,
} from '../declaration-provider';
import { isAtcudTypeId, SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID } from '../../numbering/atcud';
import {
  buildPtAtClient,
  describePtAtCodigoResposta,
  PtAtCredentials,
  PtAtRegisterInvoiceResult,
  resolvePtAtBaseUrl,
} from './pt-at-client';

export const PT_AT_PROVIDER_ID = 'pt-at';

/** This bridge's OWN two-value status vocabulary — AT itself gives no status string, only a numeric
 *  `CodigoResposta` (see `pt-at-client.ts`'s own header), so a name has to be minted here rather than
 *  passed through from the authority. */
export const PT_AT_STATUS_ACCEPTED = 'ACCEPTED';
export const PT_AT_STATUS_REJECTED = 'REJECTED';

export function extractPtAtCredentials(resolved: ResolvedChannelConfig): PtAtCredentials | null {
  const {
    username,
    password,
    authPublicKeyPem,
    clientCertificateBase64,
    clientCertificatePassword,
    baseUrl,
    caPem,
  } = resolved.config;
  if (typeof username !== 'string' || !username) return null;
  if (typeof password !== 'string' || !password) return null;
  if (typeof authPublicKeyPem !== 'string' || !authPublicKeyPem) return null;
  if (typeof clientCertificateBase64 !== 'string' || !clientCertificateBase64) return null;
  if (typeof clientCertificatePassword !== 'string' || !clientCertificatePassword) return null;
  return {
    username,
    password,
    authPublicKeyPem,
    clientCertificateBase64,
    clientCertificatePassword,
    baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined,
    // Test-only escape hatch — see `PtAtCredentials.caPem`'s own comment (`pt-at-client.ts`); a real
    // "pt-at" channel config never carries this.
    caPem: typeof caPem === 'string' && caPem.trim() ? caPem.trim() : undefined,
  };
}

/** "NIF nacional: Número de Identificação Fiscal português (sem qualquer prefixo do país)" (Aspetos
 *  Específicos §2.1.1.1, fields 1.3 and 1.6.6) — this codebase's own party identifiers sometimes carry
 *  a "PT" ISO-alpha2 prefix (e.g. "PT123456789", the same convention `formats/` VAT numbers use
 *  elsewhere); AT wants the bare 9-digit number. Strips it when present, passes through unchanged
 *  otherwise (a NIF that never had one is already in the shape AT wants). */
export function stripPtNifPrefix(vatNumber: string | undefined): string | undefined {
  if (!vatNumber) return undefined;
  return vatNumber.replace(/^PT/i, '').trim() || undefined;
}

/** Field 1.6.6 (CustomerTaxID)'s own documented placeholder: "Quando não tenha sido recolhido no
 *  sistema de faturação do emissor, deve ser preenchido com 999999990" — a genuine, cited AT
 *  convention for "no buyer NIF on file", never an invented fallback. */
export const PT_AT_UNKNOWN_CONSUMER_NIF = '999999990';

/** Field 1.6.4 (InvoiceType): "FT" for the invoice, "NC" for the credit note. The codes come from
 *  `numbering/atcud.ts#SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID`, the one table (sourced there to Portaria
 *  n.º 302/2016, field 4.1.4.8, read first-hand on the AT portal for issue #497) that also decides
 *  which series type an ATCUD is registered under. Any type outside that table keeps the "FT" it
 *  always had. */
export function ptAtInvoiceTypeFor(typeId: string): string {
  return isAtcudTypeId(typeId) ? SAFT_PT_DOCUMENT_TYPE_BY_TYPE_ID[typeId] : 'FT';
}

/**
 * Field 1.6.14.7.3 (TaxCode) for one VAT-rate group — see `buildPtAtLineSummaries` below for why lines
 * are grouped by rate rather than declared one-for-one. This bridge does NOT have Portugal's own
 * reduced ("RED")/intermediate ("INT") rate-banding data threaded through `DeclaredInvoiceLine` (only
 * the bare percentage), so every genuinely resolved NON-ZERO rate falls back to "NOR" (taxa normal),
 * named here as a fallback rather than silently misclassified as reduced or intermediate. A `null`
 * rate (compute-totals.ts could not resolve one for this line — see `DeclaredInvoiceLine`'s own
 * header) is DIFFERENT from a genuinely resolved 0%: it uses "OUT" ("Outros, aplicável para regimes
 * especiais de IVA"), never "ISE" (isenta) — this bridge has no basis to claim the line was actually
 * EXEMPT, only that no rate could be determined for it.
 */
export function ptAtTaxCodeFor(vatRatePercent: number | null): string {
  if (vatRatePercent === null) return 'OUT';
  if (vatRatePercent === 0) return 'ISE';
  return 'NOR';
}

interface PtAtLineSummaryGroup {
  vatRatePercent: number | null;
  netAmount: number;
}

/**
 * Field 1.6.14 (LineSummary) is explicit that it is a SUMMARY, not a per-line echo: "Deve existir uma,
 * e uma só linha, por cada taxa (TaxType, TaxCountryRegion, TaxCode)..." — this groups
 * `DeclaredInvoice.lines` by `vatRatePercent` and sums each group's own `netAmount`, rather than
 * emitting one `LineSummary` per invoice line the way a naive line-for-line mapping would (which AT's
 * own manual explicitly says is the wrong shape).
 */
function groupPtAtLinesByVatRate(lines: DeclaredInvoiceLine[]): PtAtLineSummaryGroup[] {
  const groups = new Map<string, PtAtLineSummaryGroup>();
  for (const line of lines) {
    const key = line.vatRatePercent === null ? 'null' : String(line.vatRatePercent);
    const existing = groups.get(key);
    if (existing) {
      existing.netAmount += line.netAmount;
    } else {
      groups.set(key, { vatRatePercent: line.vatRatePercent, netAmount: line.netAmount });
    }
  }
  return Array.from(groups.values());
}

/**
 * Thrown when a document cannot lawfully be declared to the AT as it stands: no ATCUD, or a credit
 * note that names no corrected invoice. Permanent, and deliberately NOT caught here: it propagates
 * like any other failure of `declare()`, so the runner retries it and then journals `report:failed`
 * with this message on the Declarations screen. Thrown before any credential is read or any request
 * is sent, so nothing incomplete ever reaches the authority.
 */
export class PtAtUndeclarableDocumentError extends Error {}

/**
 * Field 1.6.2 (ATCUD). The manual's own note says « deve ser preenchido com «0» (zero) até à sua
 * regulamentação », and that regulation has existed since Portaria n.º 195/2020 (« Regulamenta os
 * requisitos de criação [...] do código único do documento (ATCUD) », in force 1 January 2021). Its
 * art. 3.º n.º 2 defines the code itself: « a concatenação dos seguintes elementos, separados pelo
 * carácter «-», sem aspas: a) Código de validação da série [...]; b) O número sequencial do documento
 * dentro da série ». The « ATCUD: » prefix belongs to the printed mention only (art. 4.º n.º 1, « com o
 * formato «ATCUD:CodigodeValidação-NumeroSequencial» »), which is the form
 * `actions/atcud-issuance.ts` freezes onto the document; it is stripped here, so the field carries
 * `<code>-<sequential>`. Decreto-Lei n.º 198/2012, art. 3.º n.º 4 p) makes the « Código único de
 * documento » part of what is communicated, so a document without one is refused, never sent as "0".
 */
export function ptAtAtcudFor(invoice: DeclaredInvoice): string {
  const code = invoice.atcud?.trim().replace(/^ATCUD:/, '');
  if (!code || !/^\S+-\d+$/.test(code)) {
    throw new PtAtUndeclarableDocumentError(
      `Refusing to declare ${invoice.typeId} ${invoice.number} to the AT: it carries no ATCUD` +
        (invoice.atcud ? ` in the "<code>-<sequential>" shape (found "${invoice.atcud}")` : '') +
        ". The communication must include the document's unique code (Decreto-Lei n.º 198/2012, art. " +
        '3.º n.º 4 p); Portaria n.º 195/2020, art. 3.º), and a placeholder would declare a code the ' +
        'document never had.',
    );
  }
  return code;
}

/** The corrected invoice's own number, for a credit note's field 1.6.14.3 (Reference). Refused when
 *  absent: a correcting document is declared with the « Identificação do documento retificado »
 *  (Decreto-Lei n.º 198/2012, art. 3.º n.º 4 n)). */
function ptAtCorrectedInvoiceReferenceFor(invoice: DeclaredInvoice): string {
  const reference = invoice.correctedInvoice?.number?.trim();
  if (!reference) {
    throw new PtAtUndeclarableDocumentError(
      `Refusing to declare credit note ${invoice.number} to the AT: it names no corrected invoice, and ` +
        'a correcting document is declared with the identification of the document it corrects ' +
        '(Decreto-Lei n.º 198/2012, art. 3.º n.º 4 n)).',
    );
  }
  return reference;
}

/**
 * Builds the `doc:LineSummary` array: one entry per distinct VAT rate present on the document (see
 * `groupPtAtLinesByVatRate` above). `TaxPointDate` (field 1.6.14.2, "data de envio da mercadoria ou
 * da prestação do serviço") falls back to the document's own `issueDate`: `DeclaredInvoice` carries
 * no separate dispatch/delivery date, so no finer timestamp is available to fill this field with.
 *
 * `DebitCreditIndicator` (field 1.6.14.4): « D – Débito (caso o valor da linha, sem imposto, dos
 * documentos a lançar a débito na respetiva conta) », « C – Crédito » otherwise. An invoice's sale is
 * booked to credit ("C", the manual's own worked example); a credit note reverses it, so it is booked
 * to debit ("D"), and carries `Reference` (field 1.6.14.3, « Referência à fatura [...] através de
 * identificação única da mesma [...] Deve ser utilizada a estrutura de numeração do campo de origem »),
 * the corrected invoice's own number. The keys are emitted in the manual's field order (1.6.14.2,
 * 1.6.14.3, 1.6.14.4, then the amount and the tax), since the XML is written in insertion order.
 */
export function buildPtAtLineSummaries(invoice: DeclaredInvoice): Record<string, unknown>[] {
  const isCreditNote = invoice.typeId === 'credit-note';
  const reference = isCreditNote ? ptAtCorrectedInvoiceReferenceFor(invoice) : undefined;
  return groupPtAtLinesByVatRate(invoice.lines).map((group) => ({
    'doc:TaxPointDate': invoice.issueDate,
    ...(reference ? { 'doc:Reference': reference } : {}),
    'doc:DebitCreditIndicator': isCreditNote ? 'D' : 'C',
    'doc:Amount': group.netAmount.toFixed(2),
    'doc:Tax': {
      'doc:TaxType': 'IVA',
      'doc:TaxCountryRegion': invoice.seller.countryCode ?? 'PT',
      'doc:TaxCode': ptAtTaxCodeFor(group.vatRatePercent),
      'doc:TaxPercentage': (group.vatRatePercent ?? 0).toFixed(2),
    },
  }));
}

/** The manual's own worked example value (Aspetos Específicos §2.1.1.3) — a fixed webservice-schema
 *  version, not this product's own. */
export const PT_AT_EFATURA_MD_VERSION = '0.0.1';

/**
 * The SAF-T (PT) structure version this field (`AuditFileVersion`, 1.2) declares the SENDING SOFTWARE
 * "consegue disponibilizar" — Portaria n.º 302/2016, de 2 de dezembro (which revised the SAF-T (PT)
 * data structure) is the regulation governing this version number; "1.04_01" is the exact value the
 * webservice manual's OWN worked example uses (repeated identically across every one of its five
 * document-type examples). Invoicerr does NOT itself generate a SAF-T (PT) export file — this field
 * is populated purely to satisfy AT's mandatory schema field, mirroring the manual's own worked
 * example precisely; it is NOT a claim that this product supports SAF-T (PT) export.
 */
export const PT_AT_AUDIT_FILE_VERSION = '1.04_01';

/**
 * Maps `DeclaredInvoice` onto `RegisterInvoiceRequest`'s own fields (Aspetos Específicos §2.1.1.1) —
 * every figure comes straight from `DeclaredInvoice` (itself built from `totals/compute-totals.ts`,
 * never recomputed here), the same "never invent a number" discipline every sibling provider in this
 * directory holds. Fields with no `DeclaredInvoice` equivalent (HashCharacters,
 * SoftwareCertificateNumber) use the manual's own documented placeholder for "not applicable to a
 * non-certified sender", quoted in each field's own comment below, never guessed. The ATCUD is the
 * document's own (`ptAtAtcudFor`), and throws `PtAtUndeclarableDocumentError` when it has none.
 */
export function buildPtAtInvoiceRequestFields(invoice: DeclaredInvoice): Record<string, unknown> {
  const sellerNif = stripPtNifPrefix(invoice.seller.vatNumber) ?? invoice.seller.legalId ?? '';
  const buyerCountry = invoice.buyer.countryCode ?? '';
  const isDomesticBuyer = buyerCountry.toUpperCase() === 'PT';
  const buyerNif = isDomesticBuyer
    ? (stripPtNifPrefix(invoice.buyer.vatNumber) ?? invoice.buyer.legalId ?? PT_AT_UNKNOWN_CONSUMER_NIF)
    : (invoice.buyer.vatNumber ?? invoice.buyer.legalId ?? PT_AT_UNKNOWN_CONSUMER_NIF);
  // `InvoiceStatusDate`/`SystemEntryDate` (fields 1.6.8.2/1.6.13) are documented as the DateTime "of
  // the last save"/"of signature" — `DeclaredInvoice` only carries a date-only `issueDate` (see
  // `formats/shared-build.ts#toDateOnly`), so this bridge fills a midnight time-of-day: no finer
  // timestamp is available to build one from.
  const issueDateTime = `${invoice.issueDate}T00:00:00`;

  return {
    'doc:eFaturaMDVersion': PT_AT_EFATURA_MD_VERSION,
    'doc:AuditFileVersion': PT_AT_AUDIT_FILE_VERSION,
    'doc:TaxRegistrationNumber': sellerNif,
    // "Caso contrário, deve ser preenchido com a especificação 'Global'" (field 1.4) — this product
    // has no per-establishment ("estabelecimento") concept of its own.
    'doc:TaxEntity': 'Global',
    // "Se não aplicável, deve ser preenchido com '0' (zero)" (field 1.5) — this product holds no AT
    // "Portaria n.º 363/2010" software certificate number.
    'doc:SoftwareCertificateNumber': '0',
    'doc:InvoiceData': {
      'doc:InvoiceNo': invoice.number,
      // The document's own ATCUD, "<code>-<sequential>": see `ptAtAtcudFor` for why not "0".
      'doc:ATCUD': ptAtAtcudFor(invoice),
      'doc:InvoiceDate': invoice.issueDate,
      'doc:InvoiceType': ptAtInvoiceTypeFor(invoice.typeId),
      // "1" se autofaturação, "0" caso contrário (field 1.6.5) — this product never self-bills.
      'doc:SelfBillingIndicator': '0',
      'doc:CustomerTaxID': buyerNif,
      'doc:CustomerTaxIDCountry': buyerCountry || 'PT',
      'doc:DocumentStatus': {
        // "N – Normal" (field 1.6.8.1) — the only status a freshly-issued invoice can carry.
        'doc:InvoiceStatus': 'N',
        'doc:InvoiceStatusDate': issueDateTime,
      },
      // "0 (zero), caso o documento seja gerado por um programa não certificado" (field 1.6.9) — this
      // product is not an AT-certified invoicing program, so no real hash-character substring exists.
      'doc:HashCharacters': '0',
      // "1" se houver adesão ao regime de IVA de Caixa, "0" caso contrário (field 1.6.10) — this
      // product has no cash-VAT-scheme concept of its own; never asserted true without one.
      'doc:CashVATSchemeIndicator': '0',
      // "1" se a fatura for emitida sem papel (field 1.6.11) — every invoice this product issues is
      // electronic, never printed by this bridge.
      'doc:PaperLessIndicator': '1',
      'doc:SystemEntryDate': issueDateTime,
      'doc:LineSummary': buildPtAtLineSummaries(invoice),
      'doc:DocumentTotals': {
        'doc:TaxPayable': invoice.vatTotal.toFixed(2),
        'doc:NetTotal': invoice.netTotal.toFixed(2),
        'doc:GrossTotal': invoice.grossTotal.toFixed(2),
      },
    },
  };
}

/**
 * SYNTHESIZES a stable, non-empty `authorityId` from the invoice's own number and AT's own response
 * `DataOperacao` timestamp — see this file's own header, "The `authorityId` caveat", for WHY this is
 * necessary (AT mints no per-invoice reference of its own).
 *
 * ⚠ THIS ID IS NOT AUTHORITY-MINTED. It is a value THIS BRIDGE constructs after the fact, purely so
 * `DeclarationResult.authorityId`'s own non-empty hard contract can be satisfied — AT itself has no
 * record of, and would not recognize, this exact string if asked. Never surface it to a user as an
 * "AT confirmation number"; `countries/data/pt.json (section "reporting")`'s own `notes` repeats this same caveat at the
 * obligation-fact level, and this file's own header repeats it a third time — deliberately redundant,
 * given how easy a synthesized id is to mistake for a real one once it is sitting in a UI next to
 * NAV's very real `transactionId`/myDATA's very real `invoiceMark`.
 */
export function synthesizePtAtAuthorityId(invoice: DeclaredInvoice, dataOperacao: string): string {
  const safeNumber = invoice.number.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `pt-at-synth:${safeNumber}:${dataOperacao}`;
}

export interface PtAtDeclarationProviderDeps {
  channelCredentials: ChannelCredentialsService;
}

export function buildPtAtDeclarationProvider(deps: PtAtDeclarationProviderDeps): DeclarationProvider {
  return {
    providerId: PT_AT_PROVIDER_ID,

    async declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult> {
      // Built first: a document that cannot be declared (no ATCUD, a credit note with no corrected
      // invoice) is refused on its own terms, whatever the state of the credentials, and before any
      // request could carry it (`PtAtUndeclarableDocumentError`'s own header).
      const requestFields = buildPtAtInvoiceRequestFields(invoice);

      const resolved = await deps.channelCredentials.resolveActive(companyId, PT_AT_PROVIDER_ID);
      const credentials = resolved && extractPtAtCredentials(resolved);
      if (!resolved || !credentials) {
        throw new ChannelNotConnectedError(PT_AT_PROVIDER_ID);
      }

      const baseUrl = resolvePtAtBaseUrl(resolved.environment, credentials.baseUrl);
      // `credentials.caPem` is undefined for every real "pt-at" channel — see its own comment in
      // `pt-at-client.ts` — so this is a no-op (Node's system trust store) outside of
      // `pt-declaration-provider.spec.ts`'s own local mTLS stub.
      const client = buildPtAtClient(credentials, baseUrl, { ca: credentials.caPem });

      // A POSITIVE CodigoResposta (an authentication-layer rejection) is thrown by the client itself
      // as `PtAtApiError` and PROPAGATES from here, unhandled — same posture every sibling provider's
      // own genuine platform/protocol failure takes (`declaration-provider.ts`'s own "any other Error
      // propagates" contract): retried by BullMQ, then journaled `report:failed` once exhausted.
      const result: PtAtRegisterInvoiceResult = await client.registerInvoice(requestFields);

      const authorityId = synthesizePtAtAuthorityId(invoice, result.dataOperacao ?? new Date().toISOString());

      if (result.codigoResposta < 0) {
        // A NEGATIVE CodigoResposta is a genuine, PERMANENT verdict about THIS invoice's own data
        // (e.g. -7 "Documento inválido por valores anómalos") — returned as a normal, journalable
        // rejection rather than thrown: see this file's own header and `pt-at-client.ts`'s own header
        // for why retrying achieves nothing here — an honest, non-terminal-but-real outcome, not an
        // error.
        return {
          statusCode: PT_AT_STATUS_REJECTED,
          reason: result.mensagem ?? describePtAtCodigoResposta(result.codigoResposta),
          observedAt: new Date(),
          rawPayload: {
            codigoResposta: result.codigoResposta,
            mensagem: result.mensagem,
            dataOperacao: result.dataOperacao,
          },
          authorityId,
        };
      }

      return {
        statusCode: PT_AT_STATUS_ACCEPTED,
        observedAt: new Date(),
        rawPayload: {
          codigoResposta: result.codigoResposta,
          mensagem: result.mensagem,
          dataOperacao: result.dataOperacao,
        },
        authorityId,
      };
    },
  };
}
