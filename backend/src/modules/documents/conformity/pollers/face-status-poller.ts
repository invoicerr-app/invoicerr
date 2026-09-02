/**
 * The FACe `AuthorityStatusPoller` — root TODO item 10's own named remainder (post-deposit
 * conformity tracking, `conformity/authority-status-poller.ts`'s own header), the read-side twin of
 * `transports/face-transport.ts`. The repère's own client (`avant-refonte-documents`,
 * `compliance/providers/transmission/face-client.ts`) carried a usable status method —
 * `consultarFactura(numeroRegistro)` (`transports/face/face-client.ts` REPRISES it — see that file's
 * own header) — so this is that endpoint, wired, never an invented one.
 *
 * `mapFaceEstado` (`transports/face/face-client.ts`) is the ONE vocabulary this poller trusts for
 * BOTH `isTerminal` and the synthetic `reason` on a rejection — never a second, poller-local copy of
 * the same mapping table, the same discipline `chorus-pro-status-poller.ts`'s own header holds for
 * `mapChorusProStatus`.
 *
 * ## HONESTY NOTE — what is, and is NOT, verified here
 *
 * Same posture as `chorus-pro-status-poller.ts`'s/`anaf-status-poller.ts`'s own header: this
 * checkout holds no FACe-registered certificate (`CREDENTIALS_GUIDE.md` §20, "Repo status: 🔴
 * missing"), so `consultarFactura`'s own response shape has NEVER been observed live — the estado
 * code table comes from the repère's own client, which itself cites the Diputación Foral de
 * Gipuzkoa PGEFe manual rather than a live capture (see `face-client.ts`'s own header).
 *
 * `consultarFactura` IS NOW WS-Security-signed when a company has an active `"{companyId}:XAdES"`
 * signing certificate (`transports/face-transport.ts#certRefFor`/`wsse-sign.ts`, 2026-09-02 task) —
 * resolved here the SAME way `face-transport.ts#send()` does. UNLIKE that write-side gate, THIS
 * poller does NOT hard-refuse when no cert resolves: it falls back to the pre-task unsigned call
 * instead. Deliberately asymmetric — a failed POLL just means conformity status stays PENDING until
 * the next sweep (`ConformitySweepRunner`'s own retry/backoff), a low-stakes, recoverable outcome,
 * unlike a WRITE that would otherwise look like a real deposit attempt. So even a live call through
 * this poller for a company with NO signing certificate configured is still expected to fail at
 * authentication today, not merely "untested" — see `transports/face/wsse-sign.ts`'s own header for
 * what IS now real (a company that DOES have one gets a genuinely signed poll).
 */
import {
  ChannelCredentialsService,
  ResolvedChannelConfig,
} from '@/modules/company/channels/channels.service';

import { certRefFor } from '../../formats/national/facturae-provider';
import { SigningCredentialsPort } from '../../signing/signing-credentials-port';
import { mapFaceEstado } from '../../transports/face/face-client';
import { WsseCertificate } from '../../transports/face/wsse-sign';
import {
  buildFaceClient,
  extractFaceCredentials,
  FACE_PROVIDER_ID,
  FaceCredentials,
} from '../../transports/face-transport';
import {
  AuthorityStatusPoller,
  ChannelNotConnectedError,
  RawAuthorityEvent,
} from '../authority-status-poller';

export { FACE_PROVIDER_ID };

/** A `tramitacion.codigo` is terminal exactly when `mapFaceEstado` no longer calls it PENDING —
 *  CLEARED (2400/2500) and REJECTED (2600/3100) alike, the same "predicate over the provider's own
 *  vocabulary" shape `chorus-pro-status-poller.ts`'s own `isTerminal` already holds. */
function isTerminalFaceStatus(statusCode: string): boolean {
  const mapped = mapFaceEstado(statusCode);
  return mapped === 'CLEARED' || mapped === 'REJECTED';
}

export interface FaceStatusPollerDeps {
  channelCredentials: ChannelCredentialsService;
  /** Root TODO item 13's own port — see this file's own header for why `poll()` resolves the SAME
   *  `"{companyId}:XAdES"` cert `face-transport.ts#send()` does, and why (unlike that write-side
   *  gate) a missing cert here falls back to an unsigned call instead of refusing outright. */
  signingCredentials: SigningCredentialsPort;
}

async function resolveFaceConfig(
  channelCredentials: ChannelCredentialsService,
  companyId: string,
): Promise<{ resolved: ResolvedChannelConfig; credentials: FaceCredentials }> {
  const resolved = await channelCredentials.resolveActive(companyId, FACE_PROVIDER_ID);
  const credentials = resolved && extractFaceCredentials(resolved);
  if (!resolved || !credentials) {
    throw new ChannelNotConnectedError(FACE_PROVIDER_ID);
  }
  return { resolved, credentials };
}

export function buildFaceStatusPoller(deps: FaceStatusPollerDeps): AuthorityStatusPoller {
  return {
    providerId: FACE_PROVIDER_ID,
    isTerminal: isTerminalFaceStatus,

    async poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]> {
      const { resolved, credentials } = await resolveFaceConfig(deps.channelCredentials, companyId);
      // See this file's own header: SOFT resolution — no cert configured falls back to the pre-task
      // unsigned call rather than refusing the poll outright (a low-stakes, retried-later operation,
      // unlike `face-transport.ts#send()`'s own hard gate for the SAME certRef).
      const signingMaterial = await deps.signingCredentials.resolve(certRefFor(companyId));
      const wsseCertificate: WsseCertificate | undefined = signingMaterial
        ? { certDer: signingMaterial.certDer, privateKeyPem: signingMaterial.privateKeyPem }
        : undefined;
      const client = buildFaceClient(credentials, resolved.environment, wsseCertificate);

      const result = await client.consultarFactura(transportRef);
      const mapped = mapFaceEstado(result.tramitacion?.codigo);

      // FACe's own `consultarFactura` carries no "when did this status itself change" field (only
      // the CURRENT `tramitacion`) — "now" is the only honest value for "when THIS poll observed
      // it", the same fallback `pdp-status-poller.ts`/`chorus-pro-status-poller.ts` both use for an
      // event with no platform-supplied timestamp.
      const notes = [
        `tramitacion: ${result.tramitacion?.codigo ?? 'unknown'} (${result.tramitacion?.descripcion ?? ''})`,
      ];
      if (result.anulacion && result.anulacion.codigo !== '4100') {
        notes.push(`anulacion: ${result.anulacion.codigo} (${result.anulacion.descripcion})`);
      }
      return [
        {
          statusCode: result.tramitacion?.codigo ?? 'unknown',
          reason: mapped === 'REJECTED' ? notes.join('; ') : undefined,
          observedAt: new Date(),
          rawPayload: result,
        },
      ];
    },
  };
}
