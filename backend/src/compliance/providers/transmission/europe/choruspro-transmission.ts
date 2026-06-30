/**
 * France Chorus Pro B2G transmission provider — real implementation over PISTE gateway.
 *
 * Depth: real PISTE API endpoints, OAuth2 client_credentials + cpro-account header,
 *        deposerFlux + consulterCr polling, typed response mapping.
 *
 * What's done:
 *  - Real PISTE sandbox + prod endpoint URLs.
 *  - configSchema: environment, clientId, clientSecret[secret],
 *    technicalAccountLogin, technicalAccountPassword[secret].
 *  - transmit(): resolves config → finds UBL/CII/Factur-X artifact → deposerFlux
 *    → returns PENDING + ref "{companyId}|{numeroFluxDepot}".
 *  - poll(): consulterCr → maps statutFlux → CLEARED/REJECTED/PENDING.
 *  - SKIPPED when no resolved config (unconfigured company).
 *  - Never logs token, secret, or cpro-account value.
 *
 * Missing for live (requires PISTE sandbox account):
 *  - Validate exact path against the Factures v1.0.0 Swagger (currently auth-gated on PISTE).
 *  - Provide a real ChorusProHttpPort implementation (fetch/axios).
 *  - Register and obtain a compte technique in the Chorus Pro sandbox.
 */

import { TransactionContext } from '../../../canonical/canonical-document';
import { CompliancePlan } from '../../../engine/compliance-engine';
import { ComplianceLogger } from '../../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../../execution/types';
import { ChannelType } from '../../../types';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';
import { ChannelConfigSchema, TransmissionProvider } from '../transmission-provider';
import {
  ChorusProClient,
  ChorusProHttpPort,
  mapChorusProStatus,
  resolveChorusProSyntax,
} from './choruspro-client';

const GP: ChannelType = 'GOV_PORTAL_API';

// ---------------------------------------------------------------------------
// Endpoint URLs
// ---------------------------------------------------------------------------
const CHORUS_PRO_URLS = {
  sandbox: {
    oauthBaseUrl: 'https://sandbox-oauth.piste.gouv.fr',
    apiBaseUrl:   'https://sandbox-api.piste.gouv.fr',
  },
  prod: {
    oauthBaseUrl: 'https://oauth.piste.gouv.fr',
    apiBaseUrl:   'https://api.piste.gouv.fr',
  },
} as const;

// ---------------------------------------------------------------------------
// Config schema (rendered in the UI as a connection form)
// ---------------------------------------------------------------------------
const CHORUSPRO_CONFIG_SCHEMA: ChannelConfigSchema = {
  fields: [
    {
      type: 'select',
      name: 'environment',
      label: 'Environment',
      required: true,
      options: [
        { label: 'Sandbox (PISTE sandbox)', value: 'sandbox' },
        { label: 'Production',              value: 'prod'    },
      ],
      default: 'sandbox',
    },
    {
      type: 'text',
      name: 'clientId',
      label: 'PISTE Client ID (OAuth2)',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      required: true,
    },
    {
      type: 'text',
      name: 'clientSecret',
      label: 'PISTE Client Secret (OAuth2)',
      required: true,
      secret: true,
    },
    {
      type: 'text',
      name: 'technicalAccountLogin',
      label: 'Chorus Pro technical account login (compte technique)',
      placeholder: 'login_compte_technique',
      required: true,
    },
    {
      type: 'text',
      name: 'technicalAccountPassword',
      label: 'Chorus Pro technical account password',
      required: true,
      secret: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Stub HTTP port — replaced by a real fetch/axios impl in live use or mocked in tests
// ---------------------------------------------------------------------------
const STUB_HTTP: ChorusProHttpPort = {
  post: async () => {
    throw new Error(
      'Chorus Pro HTTP port not implemented — provide real PISTE credentials + HTTP client',
    );
  },
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class ChorusProTransmissionProvider implements TransmissionProvider {
  readonly id = 'choruspro';
  readonly channel: ChannelType = GP;
  readonly feedback = 'ASYNC_POLL' as const;
  readonly pollPolicy = { everySeconds: 120, timeoutHours: 72, backoff: 'EXPONENTIAL' as const };
  readonly configSchema: ChannelConfigSchema = CHORUSPRO_CONFIG_SCHEMA;

  constructor(private readonly credentials?: ChannelCredentialsPort) {}

  // -------------------------------------------------------------------------
  // transmit
  // -------------------------------------------------------------------------

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    if (!resolvedConfig) {
      return {
        channel: GP,
        status: 'SKIPPED',
        notes: [
          'choruspro: no resolved config — configure PISTE credentials + Chorus Pro technical account',
        ],
      };
    }

    const { config, environment } = resolvedConfig;
    const envKey = (String(config['environment'] ?? environment ?? 'sandbox') === 'prod')
      ? 'prod'
      : 'sandbox';
    const urls = CHORUS_PRO_URLS[envKey];

    const clientId            = String(config['clientId']            ?? '');
    const clientSecret        = String(config['clientSecret']        ?? '');
    const technicalAccountLogin    = String(config['technicalAccountLogin']    ?? '');
    const technicalAccountPassword = String(config['technicalAccountPassword'] ?? '');

    if (!clientId || !clientSecret || !technicalAccountLogin || !technicalAccountPassword) {
      return {
        channel: GP,
        status: 'SKIPPED',
        notes: ['choruspro: incomplete config — clientId, clientSecret, technicalAccountLogin, technicalAccountPassword are all required'],
      };
    }

    // Prefer Factur-X > CII > UBL (Chorus Pro supports all three)
    const art =
      artifacts.find((a) => a.syntax === 'FACTURX') ??
      artifacts.find((a) => a.syntax === 'EN16931_CII') ??
      artifacts.find((a) => a.syntax === 'EN16931_UBL') ??
      artifacts[0];

    if (!art) {
      return { channel: GP, status: 'SKIPPED', notes: ['choruspro: no suitable artifact'] };
    }

    const companyId = ctx.supplierCompanyId;
    if (!companyId) {
      return { channel: GP, status: 'SKIPPED', notes: ['choruspro: no supplierCompanyId'] };
    }

    const syntaxeFlux = resolveChorusProSyntax(art.syntax ?? '');
    const xmlStr = Buffer.isBuffer(art.bytes)
      ? art.bytes.toString('utf-8')
      : new TextDecoder().decode(art.bytes);

    const fileName = `invoice-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.xml`;

    log.info('transmission/choruspro', `depositing flux to Chorus Pro (${envKey}, syntax ${syntaxeFlux}, key ${key})`);

    const client = new ChorusProClient(
      { ...urls, clientId, clientSecret, technicalAccountLogin, technicalAccountPassword },
      STUB_HTTP,
    );

    try {
      const result = await client.deposerFlux(xmlStr, fileName, syntaxeFlux);
      const ref = `${companyId}|${result.numeroFluxDepot}`;
      log.info(
        'transmission/choruspro',
        `flux deposited — numeroFluxDepot ${result.numeroFluxDepot}, statut ${result.statut} (key ${key})`,
      );
      return {
        channel: GP,
        status: 'PENDING',
        ref,
        notes: [`choruspro: numeroFluxDepot=${result.numeroFluxDepot}, statut=${result.statut}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/choruspro', `deposit failed: ${msg} (key ${key})`);
      return { channel: GP, status: 'REJECTED', notes: [`choruspro: ${msg}`] };
    }
  }

  // -------------------------------------------------------------------------
  // poll
  // -------------------------------------------------------------------------

  async poll(ref: string, log: ComplianceLogger): Promise<TransmissionResult> {
    const parts = ref.split('|');
    if (parts.length !== 2) {
      return { channel: GP, status: 'PENDING', ref, notes: ['choruspro: invalid ref format'] };
    }
    const [companyId, numeroFluxDepot] = parts;

    if (!this.credentials) {
      log.todo('transmission/choruspro', `poll consulterCr for numeroFluxDepot ${numeroFluxDepot}`);
      return { channel: GP, status: 'PENDING', ref, notes: ['choruspro: no credentials port'] };
    }

    try {
      const resolved = await this.credentials.resolveActive(companyId, 'choruspro');
      if (!resolved?.isActive) {
        return { channel: GP, status: 'PENDING', ref, notes: ['choruspro: credentials inactive'] };
      }

      const { config, environment } = resolved;
      const envKey = (String(config['environment'] ?? environment ?? 'sandbox') === 'prod')
        ? 'prod'
        : 'sandbox';
      const urls = CHORUS_PRO_URLS[envKey];

      const clientId            = String(config['clientId']            ?? '');
      const clientSecret        = String(config['clientSecret']        ?? '');
      const technicalAccountLogin    = String(config['technicalAccountLogin']    ?? '');
      const technicalAccountPassword = String(config['technicalAccountPassword'] ?? '');

      const client = new ChorusProClient(
        { ...urls, clientId, clientSecret, technicalAccountLogin, technicalAccountPassword },
        STUB_HTTP,
      );

      const cr = await client.consulterCr(numeroFluxDepot);
      const status = mapChorusProStatus(cr.statutFlux);
      log.info(
        'transmission/choruspro',
        `consulterCr → statutFlux=${cr.statutFlux} → ${status} (ref=${ref})`,
      );
      return {
        channel: GP,
        status,
        ref,
        notes: [`choruspro: statutFlux=${cr.statutFlux}`],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('transmission/choruspro', `poll failed: ${msg}`);
      return { channel: GP, status: 'PENDING', ref, notes: [`choruspro: poll error: ${msg}`] };
    }
  }
}
