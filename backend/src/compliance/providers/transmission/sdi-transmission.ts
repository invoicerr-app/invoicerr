import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from './channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from './transmission-provider';
import type { SdiHttpPort } from './sdi/sdi-client';

/**
 * Italy — Sistema di Interscambio.
 *
 * LIVE PROOF: DEFERRED — requires AdE (Agenzia delle Entrate) intermediary accreditation
 * and a qualified digital certificate (PFX) before a real round-trip can be attempted.
 * All unit tests use a mocked SdiHttpPort.
 *
 * Transmission flow:
 *   1. transmit(): build a SdiClient from the resolved config, submit FatturaPA → PENDING + ref.
 *   2. poll(): re-check SdI for the latest notifica → map to CLEARED/REJECTED/PENDING.
 *   3. Inbound callbacks (notifiche): handled via the InboundRouter (not implemented here).
 *
 * Ref format: "{companyId}|{idSdI}|{idTrasmittente}"
 */
export class SdiTransmissionProvider implements TransmissionProvider {
  readonly id = 'sdi';
  readonly channel: ChannelType = 'SDI';
  readonly feedback = 'ASYNC_CALLBACK' as const; // SdI notifiche (consegnata/scartata…)
  readonly pollPolicy = { everySeconds: 60, timeoutHours: 72, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      {
        type: 'text',
        name: 'idTrasmittente',
        label: 'IdTrasmittente',
        placeholder: 'IT01234567890',
        required: true,
      },
      {
        type: 'select',
        name: 'transmitChannel',
        label: 'Transmission channel',
        required: true,
        options: [
          { label: 'SDI Cooperativa (web service)', value: 'SDICoop' },
          { label: 'PEC (Posta Elettronica Certificata)', value: 'PEC' },
        ],
      },
      { type: 'text', name: 'certificate', label: 'PFX certificate (base64)', required: true, secret: true },
      {
        type: 'text',
        name: 'certificatePassword',
        label: 'Certificate password',
        required: true,
        secret: true,
      },
    ],
  };

  constructor(
    private readonly credentials?: ChannelCredentialsPort,
    /** Inject a mock SdiHttpPort for tests; production uses the default stub. */
    private readonly httpPort?: SdiHttpPort,
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
      log.info('transmission/sdi', `no resolved config for company — skipping (key ${key})`);
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no resolved config'] };
    }

    const { config } = resolvedConfig;
    const idTrasmittente = config.idTrasmittente as string;
    const certificate = config.certificate as string | undefined;
    const certificatePassword = config.certificatePassword as string | undefined;

    if (!idTrasmittente) {
      return {
        channel: 'SDI',
        status: 'SKIPPED',
        notes: ['sdi: incomplete config (idTrasmittente required)'],
      };
    }

    // Find FatturaPA artifact
    const fatturapaArtifact = artifacts.find((a) => a.syntax === 'FATTURAPA');
    if (!fatturapaArtifact) {
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no FATTURAPA artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: 'SDI', status: 'SKIPPED', notes: ['sdi: no supplierCompanyId in context'] };
    }

    try {
      const { SdiClient } = await import('./sdi/sdi-client.js');

      const xmlBytes =
        typeof fatturapaArtifact.bytes === 'string'
          ? Buffer.from(fatturapaArtifact.bytes, 'utf-8')
          : fatturapaArtifact.bytes instanceof Buffer
            ? fatturapaArtifact.bytes
            : Buffer.from(fatturapaArtifact.bytes);

      // Derive canonical SdI filename: IT{idTrasmittente}_{progr}.xml (simplified from key)
      const filename = `${idTrasmittente}_${key.slice(-5).replace(/[^a-zA-Z0-9]/g, '0')}.xml`;

      // Use injected HTTP port (test mock) or fall back to a stub that throws clearly.
      // A real SDICoop SOAP client requires AdE intermediary accreditation + PFX certificate.
      const http = this.httpPort ?? {
        submit: async () => {
          throw new Error(
            'SdI SDICoop transport not implemented — AdE intermediary accreditation and PFX certificate required',
          );
        },
        getStatus: async () => {
          throw new Error('SdI SDICoop transport not implemented — AdE intermediary accreditation required');
        },
        sendEsito: async () => {
          throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required');
        },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      log.info('transmission/sdi', `submitting FatturaPA to SdI (key ${key}, file ${filename})`);
      const result = await client.submit(xmlBytes, filename);

      const ref = `${companyId}|${result.idSdI}|${idTrasmittente}`;
      log.info('transmission/sdi', `submitted → idSdI ${result.idSdI} (key ${key})`);
      return {
        channel: 'SDI',
        status: 'PENDING',
        ref,
        notes: [`idSdI: ${result.idSdI}`, `file: ${result.filename}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `transmit failed: ${msg} (key ${key})`);
      return { channel: 'SDI', status: 'REJECTED', notes: [`sdi: transmit error: ${msg}`] };
    }
  }

  async sendStatus(
    ref: string,
    status: string,
    _ctx: TransactionContext,
    _plan: CompliancePlan,
    log: ComplianceLogger,
  ): Promise<TransmissionResult> {
    // Emit the esito committente (NE notifica) — buyer acceptance/refusal — to SdI.
    // Called when WE are the buyer receiving a FatturaPA and emitting our response.
    //
    // Status mapping:
    //   accept / approv / consegn → EC01 (accettazione — accepted)
    //   refus / reject / scart   → EC02 (rifiuto — refused)
    //
    // Ref format: "companyId|idSdI|idTrasmittente"
    //
    // LIVE PROOF: DEFERRED — SDICoop SOAP transport requires AdE intermediary accreditation
    // and a qualified PFX certificate. The SdiHttpPort.sendEsito() port is defined;
    // inject a real SOAP transport once accreditation is obtained.

    const parts = ref.split('|');
    if (parts.length !== 3) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: invalid ref for sendStatus'] };
    }
    const [companyId, idSdIStr, idTrasmittente] = parts;
    const idSdI = parseInt(idSdIStr, 10);

    if (Number.isNaN(idSdI)) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: invalid idSdI in ref'] };
    }

    const sl = status.toLowerCase();
    const esito: 'EC01' | 'EC02' = ['accept', 'approv', 'consegn', 'cleared', 'autoriz'].some((w) =>
      sl.includes(w),
    )
      ? 'EC01'
      : 'EC02';

    if (!this.credentials) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: no credentials port for sendStatus'] };
    }

    const resolved = await this.credentials.resolveActive(companyId, 'sdi');
    if (!resolved?.isActive) {
      return { channel: 'SDI', status: 'QUEUED', ref, notes: ['sdi: credentials no longer active'] };
    }

    const { config } = resolved;
    const certificate = config.certificate as string | undefined;
    const certificatePassword = config.certificatePassword as string | undefined;

    try {
      const { SdiClient } = await import('./sdi/sdi-client.js');

      // Use injected port (test mock) or fall back to a stub that throws clearly.
      // A real SOAP SDICoop client with sendEsito() requires AdE accreditation.
      const http = this.httpPort ?? {
        submit: async () => {
          throw new Error('SdI SDICoop transport not implemented');
        },
        getStatus: async () => {
          throw new Error('SdI SDICoop transport not implemented');
        },
        sendEsito: async () => {
          throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required');
        },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      log.info(
        'transmission/sdi',
        `sendStatus: sending esito ${esito} (${status}) for idSdI ${idSdI} (ref ${ref})`,
      );
      await client.sendEsito(idSdI, esito);
      return {
        channel: 'SDI',
        status: 'SENT',
        ref,
        notes: [`esito committente ${esito} sent for idSdI ${idSdI}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `sendStatus failed: ${msg} (ref ${ref})`);
      return { channel: 'SDI', status: 'QUEUED', ref, notes: [`sdi: sendStatus error: ${msg}`] };
    }
  }

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    // Parse ref: companyId|idSdI|idTrasmittente
    const parts = ref.split('|');
    if (parts.length !== 3) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: invalid ref format'] };
    }
    const [companyId, idSdIStr, idTrasmittente] = parts;
    const idSdI = parseInt(idSdIStr, 10);

    if (Number.isNaN(idSdI)) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: invalid idSdI in ref'] };
    }

    if (!this.credentials) {
      return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'sdi');
      if (!resolved || !resolved.isActive) {
        return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: credentials no longer active'] };
      }

      const { config } = resolved;
      const certificate = config.certificate as string | undefined;
      const certificatePassword = config.certificatePassword as string | undefined;

      const { SdiClient } = await import('./sdi/sdi-client.js');

      const http = this.httpPort ?? {
        submit: async () => {
          throw new Error('SdI transport not implemented');
        },
        getStatus: async () => {
          throw new Error('SdI SDICoop transport not implemented — AdE accreditation required');
        },
        sendEsito: async () => {
          throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required');
        },
      };

      const client = new SdiClient(http, { idTrasmittente, certificate, certificatePassword });

      const status = await client.getStatus(idSdI);

      if (!status.latestNotifica) {
        return { channel: 'SDI', status: 'PENDING', ref, notes: ['sdi: no notifica received yet'] };
      }

      return SdiClient.mapNotifica(status.latestNotifica, ref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/sdi', `poll failed: ${msg}`);
      return { channel: 'SDI', status: 'PENDING', ref, notes: [`sdi: poll error: ${msg}`] };
    }
  }
}
