/**
 * Kenya KRA eTIMS transmission provider — scaffold, live-deferred.
 *
 * Flow: authenticate (OSCU/VSCU) → saveTrns → receive rcptNo + rcptSign.
 * KRA eTIMS is real-time / synchronous → returns SENT (no async poll needed).
 * Ref format: "{companyId}|{invoiceNo}|{rcptNo}"
 *
 * Missing for real integration (live-deferred):
 *   - OSCU/VSCU device initialization (POST /initializer)
 *   - Item classification codes (eTIMS GS1 category code per line)
 *   - QR code generation and PDF embedding ({pin}|{rcptNo}|{intrlData}|{rcptSign})
 *   - Branch ID for multi-branch taxpayers
 *
 * LIVE PROOF: DEFERRED — no public KRA eTIMS sandbox credentials available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { KeKraClient, KeKraHttpPort, KeKraInvoicePayload } from './ke-kra-client';

const GP: ChannelType = 'GOV_PORTAL_API';

export class KeKraTransmissionProvider implements TransmissionProvider {
  readonly id = 'ke-kra';
  readonly channel: ChannelType = GP;
  readonly feedback = 'NONE' as const;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'KRA eTIMS environment', required: true,
        options: [{ label: 'Sandbox', value: 'sandbox' }, { label: 'Production', value: 'prod' }],
        default: 'sandbox',
      },
      { type: 'text', name: 'taxpayerPin', label: 'KRA Taxpayer PIN (11 chars)', required: true, minLength: 11, maxLength: 11 },
      { type: 'text', name: 'deviceSerial', label: 'OSCU/VSCU Device Serial Number', required: true },
      { type: 'text', name: 'branchId', label: 'Branch ID (default "00")', required: false },
    ],
  };

  constructor(
    private readonly _credentials?: ChannelCredentialsPort,
    private readonly httpPort?: KeKraHttpPort,
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
      return { channel: GP, status: 'SKIPPED', notes: ['ke-kra: no resolved config (KRA taxpayerPin + deviceSerial required)'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'sandbox').toLowerCase() as 'sandbox' | 'prod';
    const taxpayerPin = config.taxpayerPin as string;
    if (!taxpayerPin) {
      return { channel: GP, status: 'SKIPPED', notes: ['ke-kra: taxpayerPin required'] };
    }

    const art = artifacts.find((a) => a.syntax === 'KE_ETIMS');
    if (!art) {
      return { channel: GP, status: 'SKIPPED', notes: ['ke-kra: no KE_ETIMS artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['ke-kra: no supplierCompanyId'] };
    }

    const http = this.httpPort ?? buildStubHttpPort();
    try {
      const client = new KeKraClient(http, {
        environment: env,
        taxpayerPin,
        deviceSerial: config.deviceSerial as string | undefined,
        branchId: config.branchId as string | undefined,
      });

      const issueDate = ctx.issueDate ?? new Date();
      const invoiceDateStr = [
        issueDate.getFullYear(),
        String(issueDate.getMonth() + 1).padStart(2, '0'),
        String(issueDate.getDate()).padStart(2, '0'),
      ].join('');
      const invoiceNo = ctx.externalRef ?? `INV-${Date.now()}`;

      const total = ctx.lines.reduce((s, l) => s + (l.unitNetMinor * l.quantity) / 100, 0);
      const vatAmt = total * 0.16; // Kenya standard VAT is 16%

      const payload: KeKraInvoicePayload = {
        tpin: taxpayerPin,
        bhfId: (config.branchId as string | undefined) ?? '00',
        invoiceNo,
        invoiceDate: invoiceDateStr,
        custPin: ctx.buyer.identifiers.find((i) => i.scheme === 'VAT')?.value,
        custNm: ctx.buyer.legalName,
        invTypCd: '1',
        pymtTyCd: '02',
        validDt: invoiceDateStr,
        items: ctx.lines.map((l, i) => {
          const lineTotal = (l.unitNetMinor * l.quantity) / 100;
          const lineTax = lineTotal * 0.16;
          return {
            itemSeq: i + 1,
            itemNm: l.description ?? 'Service',
            itemClsCd: '20101601', // TODO: map from product catalogue
            itemTyCd: '2', // service
            qty: l.quantity,
            prc: l.unitNetMinor / 100,
            splyAmt: lineTotal,
            dcAmt: 0,
            taxblAmt: lineTotal,
            taxTyCd: 'A',
            taxAmt: lineTax,
            totAmt: lineTotal + lineTax,
          };
        }),
        totItemCnt: ctx.lines.length,
        taxblAmtA: total,
        taxblAmtB: 0,
        taxblAmtC: 0,
        taxblAmtD: 0,
        taxblAmtE: 0,
        taxAmtA: vatAmt,
        taxAmtB: 0,
        taxAmtC: 0,
        taxAmtD: 0,
        taxAmtE: 0,
        totTaxblAmt: total,
        totTaxAmt: vatAmt,
        totAmt: total + vatAmt,
      };

      log.info('transmission/ke-kra', `submitting to KRA eTIMS for PIN ${taxpayerPin} (key ${key})`);

      const resp = await client.submitInvoice(payload);

      if (resp.resultCd !== '000') {
        return { channel: GP, status: 'REJECTED', notes: [`ke-kra: eTIMS error ${resp.resultCd}: ${resp.resultMsg}`] };
      }

      const rcptNo = resp.data?.rcptNo ?? 0;
      const ref = `${companyId}|${invoiceNo}|${rcptNo}`;
      const qrStr = resp.data
        ? KeKraClient.buildQrString(taxpayerPin, rcptNo, resp.data.intrlData, resp.data.rcptSign)
        : '';

      log.info('transmission/ke-kra', `receipt ${rcptNo} issued (key ${key})`);

      return {
        channel: GP,
        status: 'SENT',
        ref,
        authorityIds: [{ scheme: 'RCPT_NO', value: String(rcptNo) }],
        notes: [
          `rcptNo: ${rcptNo}`,
          `sdcDateTime: ${resp.data?.sdcDateTime ?? 'N/A'}`,
          `QR: ${qrStr.slice(0, 40)}... (seam: encode as QR image + print on receipt)`,
        ],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/ke-kra', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`ke-kra: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): KeKraHttpPort {
  return {
    authenticate: async () => { throw new Error('KeKraHttpPort not implemented — KRA taxpayerPin + deviceSerial required'); },
    saveTrns: async () => { throw new Error('KeKraHttpPort not implemented — live KRA eTIMS credentials required'); },
    selectTrns: async () => { throw new Error('KeKraHttpPort not implemented'); },
  };
}
