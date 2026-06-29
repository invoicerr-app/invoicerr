/**
 * Indonesia DGT Coretax / e-Faktur transmission provider — scaffold, live-deferred.
 *
 * Wraps IdCoretaxClient to implement the TransmissionProvider interface.
 * Flow: authenticate → submit Faktur Pajak → poll for APPROVED + kodeOtorisasi.
 * Ref format: "{companyId}|{nsfp}"
 *
 * Missing for real integration (live-deferred):
 *   - NSFP pre-assignment from DGT (GET /nsfp/request) before invoice generation
 *   - Full Faktur Pajak field population (PPnBM, multi-rate VAT, etc.)
 *   - e-Faktur correction/cancellation flows
 *   - Coretax system reliability (launching issues in early 2025)
 *
 * LIVE PROOF: DEFERRED — no public Coretax sandbox credentials available.
 */
import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import { IdCoretaxClient, IdCoretaxFakturItem, IdCoretaxHttpPort } from './id-coretax-client';

const GP: ChannelType = 'GOV_PORTAL_API';

export class IdCoretaxTransmissionProvider implements TransmissionProvider {
  readonly id = 'id-coretax';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'select', name: 'environment', label: 'Coretax environment', required: true,
        options: [
          { label: 'Pre-production (sandbox)', value: 'preprod' },
          { label: 'Production', value: 'prod' },
        ],
        default: 'preprod',
      },
      { type: 'text', name: 'npwp', label: 'NPWP (15 digits)', required: true, minLength: 15, maxLength: 15 },
      { type: 'text', name: 'passphrase', label: 'Coretax API passphrase', required: false, secret: true },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    private readonly httpPort?: IdCoretaxHttpPort,
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
      return { channel: GP, status: 'SKIPPED', notes: ['id-coretax: no resolved config (NPWP + passphrase required)'] };
    }

    const { config, environment } = resolvedConfig;
    const env = ((config.environment as string) ?? environment ?? 'preprod').toLowerCase() as 'preprod' | 'prod';
    const npwp = config.npwp as string;
    if (!npwp) return { channel: GP, status: 'SKIPPED', notes: ['id-coretax: NPWP required'] };

    const idArtifact = artifacts.find((a) => a.syntax === 'ID_EFAKTUR');
    if (!idArtifact) {
      return { channel: GP, status: 'SKIPPED', notes: ['id-coretax: no ID_EFAKTUR artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) return { channel: GP, status: 'SKIPPED', notes: ['id-coretax: no supplierCompanyId'] };

    const http = this.httpPort ?? buildStubHttpPort();
    try {
      const client = new IdCoretaxClient(http, {
        environment: env,
        npwp,
        passphrase: config.passphrase as string | undefined,
      });

      // Build a minimal Faktur Pajak item from the transaction context.
      // TODO: NSFP must be pre-assigned by DGT; for now uses a placeholder.
      const nsfp = (config.nsfp as string) ?? '<!-- TODO: pre-assign NSFP from DGT -->';
      const issueDate = ctx.issueDate ?? new Date();
      const dateStr = issueDate.toISOString().split('T')[0];
      const total = ctx.lines.reduce((s, l) => s + (l.unitNetMinor * l.quantity) / 100, 0);
      const ppn = total * 0.11; // Standard PPN 11%

      const fakturItem: IdCoretaxFakturItem = {
        nsfp,
        tanggalFaktur: dateStr,
        npwpPenjual: npwp,
        npwpPembeli: ctx.buyer.identifiers.find((i) => i.scheme === 'VAT')?.value?.replace(/\D/g, '') ?? '000000000000000',
        namaPembeli: ctx.buyer.legalName,
        alamatPembeli: ctx.buyer.address?.line1 ?? ctx.buyer.countryCode ?? 'TODO: address',
        dpp: Math.round(total),
        ppn: Math.round(ppn),
        tarifPpn: 11,
        barangJasas: ctx.lines.map((l, i) => {
          const unitNet = l.unitNetMinor / 100;
          const lineTotal = unitNet * l.quantity;
          return {
            kodeBarang: String(i + 1).padStart(3, '0'),
            namaBarang: l.description ?? 'Service',
            satuan: 'Unit',
            jumlah: l.quantity,
            hargaSatuan: unitNet,
            jumlahBarangJasa: lineTotal,
            potonganHarga: 0,
            dppBarang: lineTotal,
            ppnBarang: lineTotal * 0.11,
          };
        }),
      };

      log.info('transmission/id-coretax', `submitting e-Faktur NSFP ${nsfp} for NPWP ${npwp} (key ${key})`);
      const resp = await client.submitFaktur([fakturItem]);

      const result = resp.fakturResults[0];
      if (!result) {
        return { channel: GP, status: 'REJECTED', notes: ['id-coretax: no result in response'] };
      }
      if (result.status === 'REJECTED') {
        return { channel: GP, status: 'REJECTED', notes: [`id-coretax: ${result.errorCode}: ${result.errorMessage}`] };
      }
      if (result.status === 'APPROVED' && result.kodeOtorisasi) {
        const ref = `${companyId}|${nsfp}`;
        log.info('transmission/id-coretax', `APPROVED — kodeOtorisasi ${result.kodeOtorisasi} (key ${key})`);
        return {
          channel: GP,
          status: 'CLEARED',
          ref,
          authorityIds: [
            { scheme: 'NSFP', value: nsfp },
            { scheme: 'KODE_OTORISASI', value: result.kodeOtorisasi },
          ],
          notes: [`NSFP: ${nsfp}`, `kodeOtorisasi: ${result.kodeOtorisasi}`],
        };
      }
      // PENDING
      const ref = `${companyId}|${nsfp}`;
      return { channel: GP, status: 'PENDING', ref, notes: [`id-coretax: NSFP ${nsfp} pending approval`] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/id-coretax', `transmit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`id-coretax: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) return { channel: GP, status: 'PENDING', ref, notes: ['id-coretax: invalid ref'] };
    const [companyId, nsfp] = parts;
    if (!this.credentials) {
      log.todo('transmission/id-coretax', `poll Coretax NSFP ${nsfp}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['id-coretax: poll deferred (use /efaktur/status/{nsfp})'] };
    }
    try {
      const resolved = await this.credentials.resolveActive(companyId, 'id-coretax');
      if (!resolved?.isActive) return { channel: GP, status: 'PENDING', ref, notes: ['id-coretax: credentials inactive'] };
      const { config, environment } = resolved;
      const env = ((config.environment as string) ?? environment ?? 'preprod').toLowerCase() as 'preprod' | 'prod';
      const http = this.httpPort ?? buildStubHttpPort();
      const client = new IdCoretaxClient(http, {
        environment: env,
        npwp: config.npwp as string,
        passphrase: config.passphrase as string | undefined,
      });
      const status = await client.getStatus(nsfp);
      if (status.status === 'APPROVED' && status.kodeOtorisasi) {
        return {
          channel: GP, status: 'CLEARED', ref,
          authorityIds: [
            { scheme: 'NSFP', value: nsfp },
            { scheme: 'KODE_OTORISASI', value: status.kodeOtorisasi },
          ],
          notes: [`id-coretax: APPROVED — kodeOtorisasi: ${status.kodeOtorisasi}`],
        };
      }
      if (status.status === 'REJECTED') {
        return { channel: GP, status: 'REJECTED', ref, notes: [`id-coretax: REJECTED — ${status.errorMessage}`] };
      }
      return { channel: GP, status: 'PENDING', ref, notes: ['id-coretax: PENDING'] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/id-coretax', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`id-coretax: poll error: ${msg}`] };
    }
  }
}

function buildStubHttpPort(): IdCoretaxHttpPort {
  return {
    authenticate: async () => { throw new Error('IdCoretaxHttpPort not implemented — NPWP + passphrase required'); },
    submitFaktur: async () => { throw new Error('IdCoretaxHttpPort not implemented — live Coretax credentials required'); },
    getStatus: async () => { throw new Error('IdCoretaxHttpPort not implemented'); },
  };
}
