/**
 * Nigeria FIRS MBS transmission provider — scaffold, live-deferred.
 *
 * Flow: authenticate → generateIrn → submitInvoice → (async) poll for CLEARED.
 * Ref format: "{companyId}|{irn}"
 *
 * Missing for real integration (live-deferred):
 *   - XAdES/PKCS#7 signing of the invoice payload (FIRS-certified cert)
 *   - Service ID lookup from FIRS MBS activity-type catalogue
 *   - Buyer TIN validation via FIRS TIN lookup
 *   - QR code embedding in the invoice PDF
 *   - Multi-currency (CBN FX rate required when currency ≠ NGN)
 *
 * LIVE PROOF: DEFERRED — no public FIRS MBS sandbox credentials available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { computeFirsIrn, FirsClient, FirsHttpPort, FirsInvoicePayload } from './firs-client';

const GP: ChannelType = 'GOV_PORTAL_API';

export class FirsTransmissionProvider implements TransmissionProvider {
  readonly id = 'firs';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'FIRS MBS environment', required: true,
        options: [{ label: 'Sandbox', value: 'sandbox' }, { label: 'Production', value: 'prod' }],
        default: 'sandbox',
      },
      { type: 'text', name: 'clientId', label: 'FIRS MBS Client ID (TIN)', required: true, minLength: 12, maxLength: 12 },
      { type: 'text', name: 'clientSecret', label: 'FIRS MBS Client Secret', required: true, secret: true },
      { type: 'text', name: 'serviceId', label: 'Service/Activity ID (from FIRS MBS catalogue)', required: false },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: FirsHttpPort,
  ) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      return { channel: GP, status: 'SKIPPED', notes: ['firs: no resolved config (FIRS MBS clientId + clientSecret required)'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'sandbox').toLowerCase() as 'sandbox' | 'prod';
    const clientId = config.clientId as string;
    if (!clientId) {
      return { channel: GP, status: 'SKIPPED', notes: ['firs: clientId (TIN) required'] };
    }

    const art = artifacts.find((a) => a.syntax === 'NG_FIRS');
    if (!art) {
      return { channel: GP, status: 'SKIPPED', notes: ['firs: no NG_FIRS artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['firs: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();
    try {
      const client = new FirsClient(http, {
        environment: env,
        clientId,
        clientSecret: config.clientSecret as string | undefined,
        serviceId: (config.serviceId as string | undefined) ?? '08-00-02-00', // default: professional services
      });

      const issueDate = ctx.issueDate ?? new Date();
      const issueDateStr = issueDate.toISOString().split('T')[0];
      const invoiceNumber = ctx.externalRef ?? `INV-${Date.now()}`;
      const serviceId = (config.serviceId as string | undefined) ?? '08-00-02-00';

      const total = ctx.lines.reduce((s, l) => s + (l.unitNetMinor * l.quantity) / 100, 0);
      const vatAmount = total * 0.075; // Nigeria VAT is 7.5%

      const payload: FirsInvoicePayload = {
        businessName: ctx.supplier.legalName,
        tinSupplier: clientId,
        tinBuyer: ctx.buyer.identifiers.find((i) => i.scheme === 'VAT')?.value ?? '0000000000000',
        buyerName: ctx.buyer.legalName,
        buyerAddress: ctx.buyer.address?.line1 ?? 'TODO: buyer address',
        invoiceNumber,
        invoiceDate: issueDateStr,
        currency: 'NGN',
        serviceId,
        lines: ctx.lines.map((l, i) => {
          const lineTotal = (l.unitNetMinor * l.quantity) / 100;
          const lineVat = lineTotal * 0.075;
          return {
            lineId: i + 1,
            productDescription: l.description ?? 'Service',
            quantity: l.quantity,
            unitPrice: l.unitNetMinor / 100,
            taxableAmount: lineTotal,
            vatRate: 7.5,
            vatAmount: lineVat,
            totalAmount: lineTotal + lineVat,
          };
        }),
        taxableAmount: total,
        totalVat: vatAmount,
        totalAmount: total + vatAmount,
      };

      log.info('transmission/firs', `generating IRN for TIN ${clientId} (key ${key})`);

      const result = await client.submitNew(payload);
      const ref = `${companyId}|${result.irn}`;
      log.info('transmission/firs', `IRN ${result.irn} submitted, status: ${result.status} (key ${key})`);

      return {
        channel: GP,
        status: 'PENDING',
        ref,
        authorityIds: [{ scheme: 'IRN', value: result.irn }],
        notes: [
          `IRN: ${result.irn}`,
          `status: ${result.status}`,
          `QR: ${result.qrCode.slice(0, 30)}... (seam: embed in invoice PDF)`,
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/firs', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`firs: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const [companyId, irn] = ref.split('|');
    if (!irn) return { channel: GP, status: 'PENDING', ref, notes: ['firs: invalid ref format'] };
    if (!this.credentials) {
      log.todo('transmission/firs', `poll IRN ${irn} for company ${companyId}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['firs: poll deferred (use FIRS MBS /api/v1/invoice/status/{irn})'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'firs');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['firs: credentials inactive'] };
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'sandbox').toLowerCase() as 'sandbox' | 'prod';
      const http = this.httpPort ?? buildStubHttpPort();
      const client = new FirsClient(http, {
        environment: env,
        clientId: config.clientId as string,
        clientSecret: config.clientSecret as string | undefined,
      });
      log.todo('transmission/firs', `poll IRN ${irn} via FIRS MBS status endpoint (live-deferred)`);
      return { channel: GP, status: 'PENDING', ref, notes: ['firs: poll live-deferred — no FIRS MBS credentials available'] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { channel: GP, status: 'PENDING', ref, notes: [`firs: poll error: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): FirsHttpPort {
  return {
    authenticate: async () => { throw new Error('FirsHttpPort not implemented — FIRS MBS clientId + clientSecret required'); },
    generateIrn: async () => { throw new Error('FirsHttpPort not implemented — live FIRS MBS credentials required'); },
    submitInvoice: async () => { throw new Error('FirsHttpPort not implemented'); },
    getStatus: async () => { throw new Error('FirsHttpPort not implemented'); },
  };
}

/** Re-export for use in tests and consumers. */
export { computeFirsIrn };
