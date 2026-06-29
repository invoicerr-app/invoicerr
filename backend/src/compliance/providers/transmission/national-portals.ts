/**
 * Dedicated (stubbed) transmission providers for national authorities / portals.
 *
 * TAXONOMY RULE — ChannelType vs providerId:
 *   ChannelType  = the transmission *topology / feedback family* (GOV_PORTAL_API, PDP, SDI, …).
 *   providerId   = the *concrete national authority / platform* (sefaz, zatca, choruspro, ksef, …).
 *   GOV_PORTAL_API always needs a providerId — there is NO generic fallback.
 *   A bare { type: 'GOV_PORTAL_API' } channel (no providerId) will be SKIPPED with an explicit
 *   note. SDI and PDP remain distinct ChannelTypes because their topology and feedback genuinely
 *   differ from a plain government portal.
 *
 * Each entry is selected from a profile via `ChannelSpec.providerId`. The registry resolves an
 * exact providerId first; if the id is not found the spec resolves to null (no fallback for
 * GOV_PORTAL_API). Names verified against documentation/compliance/*.md (Authority / Platform).
 *
 * `async: true` ⇒ blocking/clearance-style portals that return PENDING and expose `poll()`
 * (authorization is asynchronous). Real-time/reporting portals return SENT.
 */
import { ComplianceLogger } from '../../execution/logger';
import { TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { FirsTransmissionProvider } from './africa/firs-transmission';
import { KeKraTransmissionProvider } from './africa/ke-kra-transmission';
import { SMALL_AFRICA_PROVIDERS } from './africa/smaller-portals';
import { IdCoretaxTransmissionProvider } from './asia/id-coretax-transmission';
import { InIrpTransmissionProvider } from './asia/in-irp-transmission';
import { MyInvoisTransmissionProvider } from './asia/myinvois-transmission';
import { SMALL_ASIA_PROVIDERS } from './asia/smaller-portals';
import { AnafTransmissionProvider } from './europe/anaf-transmission';
import { EUROPE_PORTAL_PROVIDERS } from './europe/europe-smaller-portals';
import { AfipTransmissionProvider } from './latam/afip-transmission';
import { SefazTransmissionProvider } from './latam/sefaz-transmission';
import { SiiTransmissionProvider } from './latam/sii-transmission';
import { SMALL_LATAM_PROVIDERS } from './latam/smaller-portals';
import { SriTransmissionProvider } from './latam/sri-transmission';
import { UyDgiTransmissionProvider } from './latam/uy-dgi-transmission';
import { EgEtaTransmissionProvider } from './mena/eg-eta-transmission';
import { GibTransmissionProvider } from './mena/gib-transmission';
import { SMALL_MENA_PROVIDERS } from './mena/mena-smaller-portals';
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
    async transmit(_artifacts, _ctx, _plan, key: string, log: ComplianceLogger): Promise<TransmissionResult> {
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
  // --- LATAM (clearance) — proper scaffolded clients ---
  new AfipTransmissionProvider(),       // AR — ARCA/AFIP WSFE
  new SefazTransmissionProvider(),      // BR — SEFAZ NF-e (async, 2-phase)
  new SiiTransmissionProvider(),        // CL — SII DTE (seed→token→EnvioDTE→poll)
  nationalPortal({ id: 'dian', channel: GP, label: 'Colombia DIAN', hint: 'submit UBL 2.1 to DIAN for validación previa, await CUFE acknowledgement', async: true }),
  new SriTransmissionProvider(),        // EC — SRI comprobante (submit→claveAcceso→poll)
  new UyDgiTransmissionProvider(),      // UY — DGI CFE (enviarCfe→idEnvio→poll)
  // CR, DO, GT, PA, PY, SV, VE, BO — generic scaffold with configSchema + injectable HTTP
  ...SMALL_LATAM_PROVIDERS,
  // --- MENA ---
  nationalPortal({ id: 'zatca', channel: GP, label: 'Saudi Arabia ZATCA FATOORA', hint: 'report/clear via FATOORA (B2B clearance, B2C reporting ≤24h), await ZATCA hash/UUID', async: true }),
  // JO (jofotara) + TN (tn-ttn) — scaffolded clients with configSchema + injectable HTTP
  ...SMALL_MENA_PROVIDERS,
  // TR GİB — deeper scaffold: UBL-TR envelope + auth/submit/poll + configSchema
  new GibTransmissionProvider(),
  // EG ETA — deeper scaffold: UUID/hash/sign seam + OAuth2 + submit/poll
  new EgEtaTransmissionProvider(),
  // --- Sub-Saharan Africa — scaffolded clients with injectable HTTP port + configSchema ---
  new FirsTransmissionProvider(),   // NG — FIRS MBS e-invoice (IRN + QR, async clearance)
  new KeKraTransmissionProvider(),  // KE — KRA eTIMS OSCU/VSCU (real-time fiscal)
  // GH, RW, TZ, UG, ZM, ZW, CI, BJ — uniform scaffold (auth/submit/poll, HTTP injectable)
  ...SMALL_AFRICA_PROVIDERS,
  // --- Asia — scaffolded clients with injectable HTTP port + configSchema ---
  new IdCoretaxTransmissionProvider(),  // ID — DGT Coretax e-Faktur (NSFP → kodeOtorisasi)
  new InIrpTransmissionProvider(),      // IN — GST IRP (IRN hash + signed QR)
  new MyInvoisTransmissionProvider(),   // MY — LHDNM MyInvois UBL clearance
  // TW, KZ, PH, TH, NP, BD, PK, CN, VN — uniform scaffold (auth/submit/poll, HTTP injectable)
  ...SMALL_ASIA_PROVIDERS,
  // --- Europe (national) ---
  // France B2G: Chorus Pro is the mandatory government-invoicing platform (AIFE / DGFiP).
  // B2B invoices go via PDP (channel type PDP); B2G invoices go here (GOV_PORTAL_API/choruspro).
  nationalPortal({ id: 'choruspro', channel: GP, label: 'France Chorus Pro (B2G — AIFE/DGFiP)', hint: 'submit invoice to Chorus Pro (UBL/Factur-X), await validation and processing confirmation', async: true }),
  // RO ANAF — deeper scaffold: OAuth2 + PUT upload + stareMesaj poll + UBL/RO_CIUS
  new AnafTransmissionProvider(),
  // UA, ME, HR, AL, LV, SK, RS, ES, GR, HU — scaffolded clients with configSchema + injectable HTTP
  ...EUROPE_PORTAL_PROVIDERS,
];
