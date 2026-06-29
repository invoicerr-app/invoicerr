/**
 * India IRP transmission provider — scaffold, live-deferred.
 *
 * Wraps InIrpClient to implement the TransmissionProvider interface.
 * Flow: authenticate → generateIrn → IRN + signed QR (CLEARED synchronously).
 * Ref format: "{companyId}|{irn}"
 *
 * Missing for real integration (live-deferred):
 *   - AES-256-ECB encryption of the app_key for the NIC auth handshake
 *   - HSN/SAC code mapping per line item
 *   - State code (Stcd/Pos) mapping from postal/city address
 *   - E-way bill bundling (mandatory for value > ₹50,000 on certain goods)
 *   - Full INV-01 JSON payload validation against GST schema
 *   - DSC (digital signature certificate) signing of the payload (Class 3)
 *
 * LIVE PROOF: DEFERRED — no public IRP sandbox GSTIN + app_key available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { InIrpClient, InIrpHttpPort, InIrpInvoicePayload } from './in-irp-client';

const GP: ChannelType = 'GOV_PORTAL_API';

export class InIrpTransmissionProvider implements TransmissionProvider {
  readonly id = 'in-irp';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 30, timeoutHours: 2, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'IRP environment', required: true,
        options: [{ label: 'Sandbox (NIC)', value: 'sandbox' }, { label: 'Production', value: 'prod' }],
        default: 'sandbox',
      },
      { type: 'text', name: 'gstin', label: 'GSTIN (15 chars)', required: true, minLength: 15, maxLength: 15 },
      { type: 'text', name: 'appKey', label: 'IRP App Key (from GSP/NIC)', required: false, secret: true },
      { type: 'text', name: 'clientId', label: 'GSP Client ID', required: false },
      { type: 'text', name: 'clientSecret', label: 'GSP Client Secret', required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: InIrpHttpPort,
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
      return { channel: GP, status: 'SKIPPED', notes: ['in-irp: no resolved config (GSTIN + app_key required)'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'sandbox').toLowerCase() as 'sandbox' | 'prod';
    const gstin = config.gstin as string;
    if (!gstin) {
      return { channel: GP, status: 'SKIPPED', notes: ['in-irp: GSTIN required'] };
    }

    const inArtifact = artifacts.find((a) => a.syntax === 'IN_IRP');
    if (!inArtifact) {
      return { channel: GP, status: 'SKIPPED', notes: ['in-irp: no IN_IRP artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['in-irp: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();
    try {
      const client = new InIrpClient(http, {
        environment: env,
        gstin,
        appKey: config.appKey as string | undefined,
        clientId: config.clientId as string | undefined,
        clientSecret: config.clientSecret as string | undefined,
      });

      log.info('transmission/in-irp', `generating IRN for GSTIN ${gstin} (key ${key})`);

      // Build a minimal INV-01 payload from the transaction context
      // TODO: map all mandatory INV-01 fields (HSN, state codes, e-way bill, etc.)
      const issueDate = ctx.issueDate ?? new Date();
      const dd = String(issueDate.getDate()).padStart(2, '0');
      const mm = String(issueDate.getMonth() + 1).padStart(2, '0');
      const yyyy = issueDate.getFullYear();
      const docNo = ctx.externalRef ?? `INV-${yyyy}-${Date.now()}`;
      const total = ctx.lines.reduce((s, l) => s + (l.unitNetMinor * l.quantity) / 100, 0);
      const gst = total * 0.18; // TODO: use real GST rate from ctx

      const payload: InIrpInvoicePayload = {
        version: '1.1',
        TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
        DocDtls: { Typ: 'INV', No: docNo, Dt: `${dd}/${mm}/${yyyy}` },
        SellerDtls: {
          Gstin: gstin,
          LglNm: ctx.supplier.legalName,
          Addr1: ctx.supplier.address?.line1 ?? 'TODO: address',
          Loc: ctx.supplier.address?.city ?? 'TODO: city',
          Pin: parseInt(ctx.supplier.address?.postalCode?.replace(/\D/g, '') ?? '110001'),
          Stcd: '07', // TODO: map state code from address
        },
        BuyerDtls: {
          Gstin: ctx.buyer.identifiers.find((i) => i.scheme === 'VAT')?.value ?? '99AAAAA0000A1Z5',
          LglNm: ctx.buyer.legalName,
          Addr1: ctx.buyer.address?.line1 ?? 'TODO: address',
          Loc: ctx.buyer.address?.city ?? 'TODO: city',
          Pin: parseInt((ctx.buyer.address?.postalCode ?? '400001').replace(/\D/g, '')),
          Stcd: '27', // TODO: map state code
          Pos: '27', // TODO: place of supply
        },
        ItemList: ctx.lines.map((l, i) => {
          const unitNet = l.unitNetMinor / 100;
          const lineTotal = unitNet * l.quantity;
          const lineGst = lineTotal * 0.18; // TODO: real GST rate
          return {
            SlNo: String(i + 1),
            PrdDesc: l.description ?? 'Service',
            IsServc: 'Y',
            HsnCd: '998314', // TODO: HSN/SAC from product catalog
            Qty: l.quantity,
            Unit: 'OTH',
            UnitPrice: unitNet,
            TotAmt: lineTotal,
            AssAmt: lineTotal,
            GstRt: 18,
            IgstAmt: 0,
            CgstAmt: lineGst / 2,
            SgstAmt: lineGst / 2,
            TotItemVal: lineTotal + lineGst,
          };
        }),
        ValDtls: {
          AssVal: total,
          CgstVal: gst / 2,
          SgstVal: gst / 2,
          IgstVal: 0,
          TotInvVal: total + gst,
        },
      };

      const resp = await client.submitInvoice(payload);
      if (resp.Status !== '1') {
        return { channel: GP, status: 'REJECTED', notes: [`in-irp: IRP rejected — status ${resp.Status}`] };
      }

      const ref = `${companyId}|${resp.Irn}`;
      log.info('transmission/in-irp', `IRN ${resp.Irn} — AckNo ${resp.AckNo} (key ${key})`);
      return {
        channel: GP,
        status: 'CLEARED', // IRP returns IRN synchronously → CLEARED immediately
        ref,
        authorityIds: [
          { scheme: 'IRN', value: resp.Irn },
          { scheme: 'ACK', value: resp.AckNo },
        ],
        notes: [
          `IRN: ${resp.Irn}`,
          `AckNo: ${resp.AckNo}`,
          `AckDt: ${resp.AckDt}`,
          `SignedQR: ${resp.SignedQRCode.slice(0, 30)}... (seam: embed in PDF/XML)`,
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/in-irp', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`in-irp: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // IRP returns IRN synchronously → transmit returns CLEARED. poll() is a safety net.
    const [companyId, irn] = ref.split('|');
    if (!irn) return { channel: GP, status: 'PENDING', ref, notes: ['in-irp: invalid ref'] };
    if (!this.credentials) {
      log.todo('transmission/in-irp', `poll IRN ${irn} for company ${companyId}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['in-irp: poll deferred (use IRP /Invoice/irn endpoint)'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'in-irp');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['in-irp: credentials inactive'] };
      log.todo('transmission/in-irp', `poll IRN ${irn} via IRP /Invoice/irn?irn=... (live-deferred)`);
      return { channel: GP, status: 'PENDING', ref, notes: ['in-irp: poll live-deferred'] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { channel: GP, status: 'PENDING', ref, notes: [`in-irp: poll error: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): InIrpHttpPort {
  return {
    authenticate: async () => { throw new Error('InIrpHttpPort not implemented — IRP GSTIN + app_key required'); },
    generateIrn: async () => { throw new Error('InIrpHttpPort not implemented — live IRP credentials required'); },
    cancelIrn: async () => { throw new Error('InIrpHttpPort not implemented'); },
    ping: async () => { throw new Error('InIrpHttpPort not implemented'); },
  };
}
