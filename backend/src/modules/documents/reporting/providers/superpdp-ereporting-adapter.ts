/**
 * SuperPDP's implementation of the French accredited-platform (PA) e-reporting API.
 *
 * Three published routes, read from `https://api.superpdp.tech/openapi/superpdp.json` on 2026-11-07:
 * - `POST /v1.beta/b2c_transactions` (`CreateTransactions`), the B2C invoice-data declaration;
 * - `POST /v1.beta/b2c_payments` (`CreatePayment`), the payment-data declaration;
 * - `PATCH /v1.beta/companies` (`CompanyUpdateVatRegime`), the VAT regime the platform's own
 *   declaration schedule depends on.
 *
 * No live round-trip was run from this environment: no SuperPDP sandbox credential is available here.
 * The live spec (`fr-pa-declaration-provider.live.spec.ts`) is gated by `liveDescribe`, so CI never
 * pretends this integration was exercised. Everything below is the published schema, not a guess at
 * a private API.
 */
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';

import {
  ChannelNotConnectedError,
  DeclaredInvoice,
  DeclaredPayment,
  DeclarationResult,
} from '../declaration-provider';
import { EReportingAdapter } from '../ereporting-adapter';
import { SuperPdpClient, SuperPdpB2cTransactionInput } from '../../transports/superpdp/superpdp-client';
import { extractSuperPdpCredentials } from '../../transports/superpdp-transport';

const TRANSPORT_ID = 'pdp';

/** The four values the platform's `company_patch.vat_regime` enum accepts, keyed by the company
 *  profile's own French regime. A value outside this table is refused: the platform would reject it
 *  anyway, and a default would silently declare under the wrong schedule. */
const VAT_REGIME_BY_PROFILE: Record<string, 'monthly' | 'quarterly' | 'simplified' | 'vat_exemption'> = {
  FRANCHISE: 'vat_exemption',
  REAL_MONTHLY: 'monthly',
  REAL_QUARTERLY: 'quarterly',
  SIMPLIFIED: 'simplified',
};

function money(value: number): string {
  return value.toFixed(2);
}

function percent(value: number): string {
  return value.toFixed(2);
}

async function requireCredentials(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<{ baseUrl: string; clientId: string; clientSecret: string }> {
  const resolved = await channelCredentials.resolveActive(companyId, TRANSPORT_ID);
  const credentials = resolved && extractSuperPdpCredentials(resolved);
  if (!credentials) {
    // Let the runner classify this as `report:blocked`, never as a declaration.
    throw new ChannelNotConnectedError(
      'The French accredited platform is not connected for this company. Connect it in company ' +
        'settings (Channels) before its e-reporting obligation can be declared.',
    );
  }
  return credentials;
}

function categoryCodeOf(invoice: DeclaredInvoice): 'TLB1' | 'TPS1' | 'TMA1' {
  const natures = invoice.lineNatures;
  if (!natures || natures.length === 0) {
    throw new Error(
      'Cannot declare this invoice to the accredited platform: at least one line has no article, ' +
        'so it cannot be classified as goods (TLB1) or services (TPS1).',
    );
  }
  const services = natures.filter((nature) => nature === 'service').length;
  if (services === natures.length) return 'TPS1';
  if (services === 0) return 'TLB1';
  // A mixed invoice keeps both categories in one declaration: the AFNOR Z12-012 transaction category
  // for a mixed operation is TMA1. Amounts stay grouped by VAT rate, exactly as the platform expects.
  return 'TMA1';
}

function transactionPayload(invoice: DeclaredInvoice): SuperPdpB2cTransactionInput {
  const groups = new Map<number, { taxable: number; tax: number }>();
  for (const line of invoice.lines) {
    if (line.vatRatePercent === null) {
      throw new Error(
        `Cannot declare invoice ${invoice.number}: a line has no resolvable VAT rate, and the ` +
          'accredited platform requires one per VAT subtotal.',
      );
    }
    const group = groups.get(line.vatRatePercent) ?? { taxable: 0, tax: 0 };
    group.taxable += line.netAmount;
    group.tax += line.vatAmount;
    groups.set(line.vatRatePercent, group);
  }

  return {
    date: invoice.issueDate,
    currency: invoice.currency,
    role_code: 'SE',
    category_code: categoryCodeOf(invoice),
    tax_exclusive_amount: money(invoice.netTotal),
    tax_total: money(invoice.vatTotal),
    tax_subtotals: [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rate, group]) => ({
        tax_percent: percent(rate),
        taxable_amount: money(group.taxable),
        tax_total: money(group.tax),
      })),
  };
}

function paymentPayload(payment: DeclaredPayment): {
  date: string;
  subtotals: {
    category_code: 'TLB1' | 'TPS1' | 'TMA1';
    tax_percent: string;
    amount: string;
    currency_code: string;
  }[];
} {
  const category = categoryCodeOf(payment.invoice);
  return {
    date: payment.paidAt,
    subtotals: payment.subtotals.map((subtotal) => ({
      category_code: category,
      tax_percent: percent(subtotal.vatRatePercent),
      // The platform's subtotal amount is the gross amount received at that rate.
      amount: money(subtotal.taxableAmount + subtotal.vatAmount),
      currency_code: payment.currency,
    })),
  };
}

/**
 * The platform's own id is journaled as the declaration's `authorityId` because the mechanism needs
 * ONE non-empty reference, but it is NOT a tax-administration reference: the platform aggregates and
 * transmits later. `statusText` says so in words a user reads on the Declarations screen.
 */
function submitted(
  reference: string,
  rawPayload: unknown,
  label: 'transaction' | 'payment',
): DeclarationResult {
  return {
    statusCode: 'SUBMITTED',
    statusText:
      `Recorded by the accredited platform as ${label} ${reference}. This is the platform's own ` +
      'record, not a tax administration reference: transmission happens on the platform side.',
    authorityId: reference,
    observedAt: new Date(),
    rawPayload,
  };
}

export interface SuperPdpEReportingAdapterDeps {
  channelCredentials: ChannelCredentialsService;
  /** Injectable for the unit specs; production builds the real client from the connected config. */
  buildClient?: (credentials: { baseUrl: string; clientId: string; clientSecret: string }) => SuperPdpClient;
}

export function buildSuperPdpEReportingAdapter(deps: SuperPdpEReportingAdapterDeps): EReportingAdapter {
  const build =
    deps.buildClient ??
    ((credentials) =>
      new SuperPdpClient({
        baseUrl: credentials.baseUrl,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        apiStyle: 'superpdp',
      }));

  async function clientFor(companyId: string): Promise<SuperPdpClient> {
    return build(await requireCredentials(deps.channelCredentials, companyId));
  }

  return {
    transportId: TRANSPORT_ID,

    async declareTransaction(companyId, invoice) {
      const client = await clientFor(companyId);
      const created = await client.createB2cTransactions([transactionPayload(invoice)]);
      const record = created[0];
      if (!record || typeof record.id !== 'number') {
        throw new Error(
          'The accredited platform accepted the B2C declaration without returning a record id  -  ' +
            'refusing to journal a reference nobody can look up.',
        );
      }
      return submitted(String(record.id), record, 'transaction');
    },

    async declarePayment(companyId, payment) {
      const client = await clientFor(companyId);
      const created = await client.createB2cPayments([paymentPayload(payment)]);
      const record = created[0];
      if (!record || typeof record.id !== 'number') {
        throw new Error(
          'The accredited platform accepted the B2C payment without returning a record id  -  ' +
            'refusing to journal a reference nobody can look up.',
        );
      }
      return submitted(String(record.id), record, 'payment');
    },

    async syncCompanyProfile(companyId, profile) {
      const vatRegime = VAT_REGIME_BY_PROFILE[profile.vatRegime];
      if (!vatRegime) {
        throw new Error(
          `The company's VAT regime "${profile.vatRegime}" has no published SuperPDP equivalent  -  ` +
            'refusing to leave the platform on a different declaration schedule than the law sets.',
        );
      }
      const client = await clientFor(companyId);
      await client.updateCompanyVatRegime({
        vat_regime: vatRegime,
        has_vat_on_debits: profile.vatOnDebits,
      });
    },
  };
}

/** Kept exported for the provider spec's fixture: a party is never declared by this adapter, but the
 *  type documents what `DeclaredInvoice` carries. */
