/**
 * Dedicated (stubbed) transmission providers for national authorities / portals.
 *
 * Each entry replaces a country's reliance on the generic `gov-portal` catch-all with a *named*
 * provider, selected from a profile via `ChannelSpec.providerId` (the registry already prefers an
 * exact providerId over the channel default — see registry.resolve). Names verified against
 * docs/compliance/*.md (Authority / Platform fields).
 *
 * `async: true` ⇒ blocking/clearance-style portals that return PENDING and expose `poll()`
 * (authorization is asynchronous). Real-time/reporting portals return SENT.
 */
import { ComplianceLogger } from '../../execution/logger';
import { TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { TransmissionProvider } from './transmission-provider';

interface NationalPortalSpec {
  /** Stable provider id referenced by ChannelSpec.providerId, e.g. 'sefaz', 'sii'. */
  id: string;
  /** Underlying channel — almost always GOV_PORTAL_API (a national API). */
  channel: ChannelType;
  /** Human label (authority + platform) used in the stub message. */
  label: string;
  /** What the real integration must do. */
  hint: string;
  /** Clearance-style (asynchronous authorization) ⇒ PENDING + poll(). */
  async?: boolean;
}

function nationalPortal(spec: NationalPortalSpec): TransmissionProvider {
  return {
    id: spec.id,
    channel: spec.channel,
    // Clearance portals are polled for their authorization; real-time/report portals are fire-and-forget.
    feedback: spec.async ? 'ASYNC_POLL' : 'NONE',
    pollPolicy: spec.async ? { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' } : undefined,
    transmit(_artifacts, _ctx, _plan, key: string, log: ComplianceLogger): TransmissionResult {
      log.todo(`transmission/${spec.id}`, `${spec.hint} (key ${key})`);
      return {
        channel: spec.channel,
        status: spec.async ? 'PENDING' : 'SENT',
        notes: [`stub: integrate ${spec.label}`],
      };
    },
    poll: spec.async
      ? (ref: string, log: ComplianceLogger): TransmissionResult => {
          log.todo(`transmission/${spec.id}`, `poll ${spec.label} authorization status for ${ref}`);
          return { channel: spec.channel, status: 'PENDING', ref, notes: [] };
        }
      : undefined,
  };
}

const GP: ChannelType = 'GOV_PORTAL_API';

export const NATIONAL_PORTAL_PROVIDERS: TransmissionProvider[] = [
  // --- LATAM (clearance) ---
  nationalPortal({ id: 'afip', channel: GP, label: 'Argentina ARCA/AFIP WSFE', hint: 'submit comprobante to ARCA/AFIP web service, await CAE', async: true }),
  nationalPortal({ id: 'bo-sin', channel: GP, label: 'Bolivia SIN', hint: 'submit to SIN Sistema de Facturación Electrónica, await authorization', async: true }),
  nationalPortal({ id: 'sefaz', channel: GP, label: 'Brazil SEFAZ', hint: 'submit signed NF-e to the SEFAZ web service, await protocolo de autorização', async: true }),
  nationalPortal({ id: 'sii', channel: GP, label: 'Chile SII', hint: 'submit DTE to SII (EnvioDTE), await aceptación; send acuse', async: true }),
  nationalPortal({ id: 'dian', channel: GP, label: 'Colombia DIAN', hint: 'submit UBL 2.1 to DIAN for validación previa, await CUFE acknowledgement', async: true }),
  nationalPortal({ id: 'cr-hacienda', channel: GP, label: 'Costa Rica Hacienda', hint: 'submit XML to Ministerio de Hacienda, await respuesta-Hacienda', async: true }),
  nationalPortal({ id: 'dgii', channel: GP, label: 'Dominican Republic DGII', hint: 'submit e-CF to DGII, await aprobación comercial / acuse', async: true }),
  nationalPortal({ id: 'sri', channel: GP, label: 'Ecuador SRI', hint: 'submit comprobante to SRI, await autorización (clave de acceso)', async: true }),
  nationalPortal({ id: 'gt-sat', channel: GP, label: 'Guatemala SAT (FEL)', hint: 'certify FEL DTE via certificador → SAT, await UUID', async: true }),
  nationalPortal({ id: 'pa-dgi', channel: GP, label: 'Panama DGI', hint: 'submit FE/CF via PAC → DGI, await CUFE authorization', async: true }),
  nationalPortal({ id: 'sifen', channel: GP, label: 'Paraguay SIFEN', hint: 'submit e-Kuatia DE to SIFEN, await aprobación', async: true }),
  nationalPortal({ id: 'sv-mh', channel: GP, label: 'El Salvador MH', hint: 'submit DTE JSON to Ministerio de Hacienda, await selloRecibido', async: true }),
  nationalPortal({ id: 'uy-dgi', channel: GP, label: 'Uruguay DGI', hint: 'submit CFE to DGI, await respuesta', async: true }),
  nationalPortal({ id: 'seniat', channel: GP, label: 'Venezuela SENIAT', hint: 'submit factura electrónica to SENIAT, await authorization', async: true }),
  // --- MENA ---
  nationalPortal({ id: 'zatca', channel: GP, label: 'Saudi Arabia ZATCA FATOORA', hint: 'report/clear via FATOORA (B2B clearance, B2C reporting ≤24h), await ZATCA hash/UUID', async: true }),
  nationalPortal({ id: 'jofotara', channel: GP, label: 'Jordan JoFotara', hint: 'submit to JoFotara national platform, await acknowledgement', async: true }),
  nationalPortal({ id: 'tn-ttn', channel: GP, label: 'Tunisia TTN / El Fatoura', hint: 'submit TEIF via TradeNet (TTN), await clearance', async: true }),
  // --- Sub-Saharan Africa (real-time fiscal device/API) ---
  nationalPortal({ id: 'firs', channel: GP, label: 'Nigeria FIRS', hint: 'submit to FIRS e-invoice (MBS), await IRN', async: true }),
  nationalPortal({ id: 'ke-kra', channel: GP, label: 'Kenya KRA eTIMS', hint: 'transmit to KRA eTIMS (OSCU/VSCU) in real time' }),
  nationalPortal({ id: 'gh-gra', channel: GP, label: 'Ghana GRA E-VAT', hint: 'transmit to GRA E-VAT in real time' }),
  nationalPortal({ id: 'rw-rra', channel: GP, label: 'Rwanda RRA EBM', hint: 'transmit to RRA EBM in real time' }),
  nationalPortal({ id: 'tz-tra', channel: GP, label: 'Tanzania TRA VFD', hint: 'transmit to TRA VFD in real time' }),
  nationalPortal({ id: 'ug-ura', channel: GP, label: 'Uganda URA EFRIS', hint: 'transmit to URA EFRIS in real time' }),
  nationalPortal({ id: 'zm-zra', channel: GP, label: 'Zambia ZRA Smart Invoice', hint: 'transmit to ZRA Smart Invoice in real time' }),
  nationalPortal({ id: 'zw-zimra', channel: GP, label: 'Zimbabwe ZIMRA FDMS', hint: 'transmit to ZIMRA FDMS in real time' }),
  nationalPortal({ id: 'ci-dgi', channel: GP, label: 'Ivory Coast DGI (FNE/SIGF)', hint: 'transmit FNE to DGI SIGF in real time' }),
  nationalPortal({ id: 'bj-dgi', channel: GP, label: 'Benin DGI e-MECeF', hint: 'transmit to DGI e-MECeF in real time' }),
  // --- Asia ---
  nationalPortal({ id: 'id-coretax', channel: GP, label: 'Indonesia DGT e-Faktur/Coretax', hint: 'submit e-Faktur to DGT/Coretax, await approval code', async: true }),
  nationalPortal({ id: 'tw-mof', channel: GP, label: 'Taiwan MoF', hint: 'transmit eGUI to the MoF platform, reserve invoice-number track', async: true }),
  nationalPortal({ id: 'kz-isesf', channel: GP, label: 'Kazakhstan IS ESF', hint: 'submit ESF to IS ESF, await registration', async: true }),
  nationalPortal({ id: 'ph-bir', channel: GP, label: 'Philippines BIR EIS', hint: 'transmit to BIR EIS in real time' }),
  nationalPortal({ id: 'th-rd', channel: GP, label: 'Thailand RD', hint: 'submit e-Tax Invoice to the RD (or report via service provider)' }),
  nationalPortal({ id: 'np-ird', channel: GP, label: 'Nepal IRD CBMS', hint: 'transmit to IRD CBMS in real time' }),
  nationalPortal({ id: 'bd-nbr', channel: GP, label: 'Bangladesh NBR', hint: 'transmit to NBR e-invoice in real time' }),
  nationalPortal({ id: 'pk-fbr', channel: GP, label: 'Pakistan FBR', hint: 'transmit to FBR e-invoice in real time, await IRN' }),
  // --- Europe (national) ---
  nationalPortal({ id: 'es-aeat', channel: GP, label: 'Spain AEAT SII/Verifactu', hint: 'push the SII/Verifactu ledger record to AEAT (near-real-time)' }),
  nationalPortal({ id: 'ua-dps', channel: GP, label: 'Ukraine DPS', hint: 'register the tax invoice in ЄРПН via DPS, handle blocking/unblocking', async: true }),
  nationalPortal({ id: 'me-fiscal', channel: GP, label: 'Montenegro fiscalization', hint: 'fiscalize in real time, await IKOF/JIKR' }),
  nationalPortal({ id: 'hr-fiskalizacija', channel: GP, label: 'Croatia Fiskalizacija 2.0', hint: 'fiscalize/clear via the CIS, await acknowledgement', async: true }),
  nationalPortal({ id: 'al-cis', channel: GP, label: 'Albania CIS', hint: 'fiscalize via the Central Information System, await NIVF/NSLF', async: true }),
  nationalPortal({ id: 'lv-vid', channel: GP, label: 'Latvia VID', hint: 'submit to VID / eAddress (mandate from 2026)' }),
  nationalPortal({ id: 'sk-financnasprava', channel: GP, label: 'Slovakia Finančná správa', hint: 'submit to the Financial Administration e-invoice system' }),
];
