/**
 * The "mydata" `DeclarationProvider` — Greece's AADE myDATA. A single-call flow (unlike NAV's
 * three-step one): `SendInvoices` → `invoiceMark` (this task's own "MARK myDATA"). See
 * `mydata-client.ts`'s own header for the full "verified vs extrapolated" breakdown, INCLUDING the
 * weaker provenance this provider's own facts carry (aade.gr itself was unreachable from this
 * environment — every fact below is corroborated by independent third-party client implementations,
 * not read directly from AADE's own site).
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
} from '../declaration-provider';
import {
  buildMyDataClient,
  buildMyDataInvoicesDocXml,
  MYDATA_PROD_BASE_URL,
  MYDATA_SANDBOX_BASE_URL,
  MyDataCredentials,
} from './mydata-client';

export const MYDATA_PROVIDER_ID = 'mydata';

export function extractMyDataCredentials(resolved: ResolvedChannelConfig): MyDataCredentials | null {
  const { userId, subscriptionKey, baseUrl } = resolved.config;
  if (typeof userId !== 'string' || !userId) return null;
  if (typeof subscriptionKey !== 'string' || !subscriptionKey) return null;
  return {
    userId,
    subscriptionKey,
    baseUrl: typeof baseUrl === 'string' && baseUrl.trim() ? baseUrl.trim() : undefined,
  };
}

/**
 * `vatCategory` (`InvoiceRowType`, VERIFIED to exist and be required, values 1-10 — see
 * `mydata-client.ts`'s own header) — the RATE→CODE mapping itself is EXTRAPOLATED: only the two
 * values independently and repeatedly cited across myDATA integrations are asserted with any
 * confidence (category 1 = the standard rate; category 7 = "no VAT" / exempt / 0%). Every OTHER rate
 * (Greece's own reduced rates — 13%, 6%, and the island-specific reduced rates) falls back to
 * category 1 too, deliberately NAMED as a fallback here rather than silently guessed at a specific
 * code this task could not verify — a real myDATA account would reject a genuinely wrong category
 * loudly (`MyDataApiError`, surfaced as `report:failed`, never masked).
 */
export function mapVatRateToMyDataCategory(ratePercent: number | null): number {
  if (ratePercent === 0) return 7;
  return 1;
}

/**
 * `invoiceType` (`InvoiceHeaderType`, required — see `mydata-client.ts`'s own header) — "1.1"
 * ("Τιμολόγιο Πώλησης" / ordinary sale-of-goods invoice) is this task's own fixed default: the ONLY
 * value independently corroborated across multiple third-party client READMEs as the common case for
 * an ordinary B2B/B2C sales invoice. The XSD's own enumeration (dozens of values, for services,
 * self-billing, intra-community supplies, retail receipts, …) was NOT individually verified — a
 * document type genuinely needing a different code is a real, named gap, not silently misclassified
 * as an ordinary sale.
 */
const MYDATA_DEFAULT_INVOICE_TYPE = '1.1';

/**
 * Builds the `invoice` element's own object graph (`AadeBookInvoiceType`, VERIFIED field names — see
 * `mydata-client.ts`'s own header) — every figure comes straight from `DeclaredInvoice`, never
 * recomputed. `branch` (both parties) defaults to `0` (the schema's own "main branch" convention,
 * widely corroborated, not independently re-verified) since this codebase's data model has no branch
 * concept of its own.
 */
export function buildMyDataInvoiceObject(invoice: DeclaredInvoice): Record<string, unknown> {
  const invoiceDetails = invoice.lines.map((line, index) => ({
    lineNumber: index + 1,
    netValue: line.netAmount.toFixed(2),
    vatCategory: mapVatRateToMyDataCategory(line.vatRatePercent),
    vatAmount: line.vatAmount.toFixed(2),
  }));

  return {
    issuer: {
      vatNumber: invoice.seller.vatNumber ?? invoice.seller.legalId ?? '',
      country: invoice.seller.countryCode ?? 'GR',
      branch: 0,
    },
    counterpart: {
      vatNumber: invoice.buyer.vatNumber ?? invoice.buyer.legalId ?? '',
      country: invoice.buyer.countryCode ?? '',
      branch: 0,
    },
    invoiceHeader: {
      series: 'A',
      aa: invoice.number,
      issueDate: invoice.issueDate,
      invoiceType: MYDATA_DEFAULT_INVOICE_TYPE,
      currency: invoice.currency,
    },
    invoiceDetails,
    invoiceSummary: {
      totalNetValue: invoice.netTotal.toFixed(2),
      totalVatAmount: invoice.vatTotal.toFixed(2),
      totalWithheldAmount: '0.00',
      totalFeesAmount: '0.00',
      totalStampDutyAmount: '0.00',
      totalOtherTaxesAmount: '0.00',
      totalDeductionsAmount: '0.00',
      totalGrossValue: invoice.grossTotal.toFixed(2),
    },
  };
}

export function buildMyDataInvoiceXml(invoice: DeclaredInvoice): string {
  return buildMyDataInvoicesDocXml(buildMyDataInvoiceObject(invoice));
}

export interface MyDataDeclarationProviderDeps {
  channelCredentials: ChannelCredentialsService;
}

export function buildMyDataDeclarationProvider(deps: MyDataDeclarationProviderDeps): DeclarationProvider {
  return {
    providerId: MYDATA_PROVIDER_ID,

    async declare(companyId: string, invoice: DeclaredInvoice): Promise<DeclarationResult> {
      const resolved = await deps.channelCredentials.resolveActive(companyId, MYDATA_PROVIDER_ID);
      const credentials = resolved && extractMyDataCredentials(resolved);
      if (!resolved || !credentials) {
        throw new ChannelNotConnectedError(MYDATA_PROVIDER_ID);
      }

      const baseUrl =
        credentials.baseUrl ||
        (resolved.environment === 'PROD' ? MYDATA_PROD_BASE_URL : MYDATA_SANDBOX_BASE_URL);
      const client = buildMyDataClient(credentials, baseUrl);
      const invoiceXml = buildMyDataInvoiceXml(invoice);

      // A genuine business rejection from myDATA (`MyDataApiError`, its own message already naming
      // the AADE error code) or any network/HTTP failure both PROPAGATE, unhandled here — the runner
      // (`reporting-runner.ts`) treats either exactly like any other non-`ChannelNotConnectedError`
      // failure: retried by BullMQ, then journaled `report:failed` once every retry is exhausted.
      const item = await client.sendInvoices(invoiceXml);

      if (!item.invoiceMark) {
        // Unreachable through `client.sendInvoices` (it throws `MyDataApiError` whenever `errors` is
        // non-empty, and a real success always carries `invoiceMark` per the vendored XSD's own
        // choice — see `mydata-client.ts`'s own header) — never trusted blind: this mechanism's own
        // hard contract (`reporting-runner.ts#assertNonEmptyDeclarationResult`) would refuse an empty
        // `authorityId` anyway, but failing here, NAMED, is more useful than a generic downstream
        // refusal.
        throw new Error('myDATA SendInvoices reported no error but returned no invoiceMark either.');
      }

      return {
        statusCode: item.statusCode ?? 'SUCCESS',
        observedAt: new Date(),
        rawPayload: {
          invoiceMark: item.invoiceMark,
          invoiceUid: item.invoiceUid,
          statusCode: item.statusCode,
        },
        authorityId: item.invoiceMark,
      };
    },
  };
}
