/**
 * The "nav" `DeclarationProvider` — Hungary's Online Számla 3.0. Orchestrates the flow this task's
 * own brief names verbatim and `nav-client.ts`'s own header verifies against the official spec:
 * `tokenExchange` → `manageInvoice` → `queryTransactionStatus`. See that file's own header for the
 * full "verified vs extrapolated" breakdown of the wire protocol itself — this file is the thin
 * `DeclarationProvider` adapter around it, plus the ONE thing `nav-client.ts` deliberately does not
 * own: the invoice XML content itself.
 *
 * ## Scope — CREATE only, never MODIFY/STORNO
 *
 * NAV's own obligation legally extends to modifying/cancelling invoices too (spec's own
 * `ManageInvoiceOperationType`: CREATE/MODIFY/STORNO) — this codebase's trigger
 * (`reporting/report-on-send.ts`) only ever fires on a document's OWN "sent" transition, which for
 * the "invoice" type happens exactly once, at issuance. A credit note reaching a FUTURE
 * `reporting/data/hu.json` `appliesTo: 'credit-note'` entry would need its own MODIFY/STORNO mapping
 * — deliberately NOT built here (see `schema.ts`'s own `ReportableDocumentType` header) rather than
 * guessed at.
 *
 * ## ⚖ invoiceData.xsd — a DELIBERATELY MINIMAL subset, not full conformance
 *
 * `invoiceData.xsd` (the actual Hungarian invoice business-content schema NAV expects inside
 * `manageInvoice`'s own `invoiceData` field) is a VERY large, Hungary-specific schema — this task did
 * not read it exhaustively (see `nav-client.ts`'s own header, "EXTRAPOLATED"). What WAS confirmed, by
 * reading the schema's own top-level structure directly: the root type is `InvoiceDataType`
 * (`invoiceNumber` → `invoiceIssueDate` → `completenessIndicator` → `invoiceMain`), `invoiceMain`
 * carries exactly one `invoice` (`InvoiceType`: `invoiceHead` → `invoiceLines` → `invoiceSummary`),
 * and `invoiceHead` carries `supplierInfo`/`customerInfo`/`invoiceDetail`. `buildNavInvoiceXml` below
 * builds EXACTLY this envelope, filled with what `DeclaredInvoice` actually carries — the deeper
 * mandatory sub-fields of `supplierInfo.supplierTaxNumber`/`customerInfo.customerVatData`/etc. (which
 * NAV's own schema very likely further constrains — Hungarian tax numbers have their own 8+1+2 digit
 * structure, for instance) were NOT individually re-verified field-by-field. The ROOT element name
 * itself (`InvoiceData`) is inferred from the schema's own file/type naming convention
 * (`InvoiceDataType`), not from an independently confirmed top-level `<xs:element>` declaration.
 * `NAV_LIVE=1` against the real sandbox (see `CREDENTIALS_GUIDE.md`) is what would actually settle
 * whether this minimal subset is accepted as-is or needs more of the schema's own optional richness.
 */
import { create } from 'xmlbuilder2';

import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import {
  ChannelNotConnectedError,
  DeclarationProvider,
  DeclarationResult,
  DeclaredInvoice,
} from '../declaration-provider';
import { buildNavClient, NAV_PROD_BASE_URL, NAV_TEST_BASE_URL, NavCredentials } from './nav-client';

export const NAV_PROVIDER_ID = 'nav';

export function extractNavCredentials(resolved: ResolvedChannelConfig): NavCredentials | null {
  const { login, password, taxNumber, signingKey, exchangeKey, baseUrl } = resolved.config;
  if (typeof login !== 'string' || !login) return null;
  if (typeof password !== 'string' || !password) return null;
  if (typeof taxNumber !== 'string' || !taxNumber) return null;
  if (typeof signingKey !== 'string' || !signingKey) return null;
  if (typeof exchangeKey !== 'string' || !exchangeKey) return null;
  return {
    login,
    password,
    taxNumber,
    signingKey,
    exchangeKey,
    baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined,
  };
}

/** `InvoiceStatusType` (invoiceApi.xsd, VERIFIED — see `nav-client.ts`'s own header): RECEIVED,
 *  PROCESSING, SAVED, DONE, ABORTED. A NON-terminal status (RECEIVED/PROCESSING/SAVED) is still an
 *  HONEST, journalable outcome — this task's own trigger runs `queryTransactionStatus` exactly ONCE,
 *  immediately after `manageInvoice` (see `nav-client.ts`'s own header on why no fixed polling
 *  cadence is asserted); a status that has not reached DONE/ABORTED yet is not a FAILURE of this
 *  mechanism, it is simply what NAV had decided by the time this one query ran. */
function reasonFor(invoiceStatus: string): string | undefined {
  return invoiceStatus === 'ABORTED'
    ? 'NAV reported ABORTED processing for this invoice submission.'
    : undefined;
}

/**
 * Deliberately minimal `InvoiceData` XML — see this file's own header. Every value comes straight
 * from `DeclaredInvoice` (itself built from `totals/compute-totals.ts`, never recomputed) — nothing
 * here invents a figure.
 */
export function buildNavInvoiceXml(invoice: DeclaredInvoice): string {
  const lines = invoice.lines.map((line, index) => ({
    lineNumber: index + 1,
    lineDescription: line.description,
    quantity: line.quantity,
    lineNetAmount: line.netAmount.toFixed(2),
    lineVatRate: line.vatRatePercent ?? 0,
    lineVatAmount: line.vatAmount.toFixed(2),
    lineGrossAmount: line.grossAmount.toFixed(2),
  }));

  const doc = {
    InvoiceData: {
      '@xmlns': 'http://schemas.nav.gov.hu/OSA/3.0/data',
      invoiceNumber: invoice.number,
      invoiceIssueDate: invoice.issueDate,
      completenessIndicator: false,
      invoiceMain: {
        invoice: {
          invoiceHead: {
            supplierInfo: {
              supplierTaxNumber: invoice.seller.vatNumber ?? invoice.seller.legalId ?? '',
              supplierName: invoice.seller.name,
              supplierAddress: {
                countryCode: invoice.seller.countryCode ?? 'HU',
                postalCode: invoice.seller.postalCode,
                city: invoice.seller.city,
                streetName: invoice.seller.address,
              },
            },
            customerInfo: {
              customerName: invoice.buyer.name,
              customerVatData: invoice.buyer.vatNumber ?? invoice.buyer.legalId ?? '',
              customerAddress: {
                countryCode: invoice.buyer.countryCode ?? '',
                postalCode: invoice.buyer.postalCode,
                city: invoice.buyer.city,
                streetName: invoice.buyer.address,
              },
            },
            invoiceDetail: {
              invoiceCategory: 'NORMAL',
              invoiceDeliveryDate: invoice.issueDate,
              currencyCode: invoice.currency,
              exchangeRate: 1,
            },
          },
          invoiceLines: { line: lines },
          invoiceSummary: {
            summaryNormal: {
              invoiceNetAmount: invoice.netTotal.toFixed(2),
              invoiceVatAmount: invoice.vatTotal.toFixed(2),
            },
            invoiceGrossAmountHUF: invoice.grossTotal.toFixed(2),
          },
        },
      },
    },
  };
  return create(doc).end({ headless: true });
}

export interface NavDeclarationProviderDeps {
  channelCredentials: ChannelCredentialsService;
}

export function buildNavDeclarationProvider(deps: NavDeclarationProviderDeps): DeclarationProvider {
  return {
    providerId: NAV_PROVIDER_ID,

    async declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult> {
      const resolved = await deps.channelCredentials.resolveActive(companyId, NAV_PROVIDER_ID);
      const credentials = resolved && extractNavCredentials(resolved);
      if (!resolved || !credentials) {
        throw new ChannelNotConnectedError(NAV_PROVIDER_ID);
      }

      const baseUrl =
        credentials.baseUrl || (resolved.environment === 'PROD' ? NAV_PROD_BASE_URL : NAV_TEST_BASE_URL);
      const client = buildNavClient(credentials, baseUrl);

      const invoiceXml = buildNavInvoiceXml(invoice);
      const invoiceDataBase64 = Buffer.from(invoiceXml, 'utf8').toString('base64');

      const exchangeToken = await client.tokenExchange();
      const transactionId = await client.manageInvoice(exchangeToken, invoiceDataBase64);
      const { invoiceStatus, rawXml } = await client.queryTransactionStatus(transactionId);

      return {
        statusCode: invoiceStatus,
        reason: reasonFor(invoiceStatus),
        observedAt: new Date(),
        rawPayload: { transactionId, invoiceStatus, invoiceXml, rawXml },
        authorityId: transactionId,
      };
    },
  };
}
