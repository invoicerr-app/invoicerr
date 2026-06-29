/**
 * SdI (Sistema di Interscambio) client abstraction.
 *
 * Real SdI access for intermediaries requires:
 *   - AdE (Agenzia delle Entrate) accreditation
 *   - A qualified digital certificate (PFX/P12) issued to the intermediary
 *   - A dedicated channel: SDICoop (SOAP web service) or SFTP
 *
 * SDICoop SOAP endpoint:
 *   https://sdi.fatturapa.gov.it/SdI_riceviFile/v1.0/RiceviFileService
 *
 * LIVE PROOF: DEFERRED — pending AdE intermediary accreditation.
 * This module is structured so the SdiHttpPort can be swapped for a real SOAP transport
 * once accreditation is obtained. All tests use a mocked port.
 *
 * SdI notification types (notifiche) that drive the lifecycle:
 *   RC — Ricevuta di Consegna (delivery receipt): buyer received the invoice → CLEARED
 *   NS — Notifica di Scarto (rejection): SdI rejected the file → REJECTED
 *   MC — Mancata Consegna (failed delivery): SdI could not deliver → PENDING (retry for 15 days)
 *   NE — Notifica Esito (buyer outcome): buyer accepted/refused → CLEARED or REJECTED
 *   DT — Decorrenza Termini (15-day term expired): SdI considers it delivered → CLEARED
 *   AT — Avvenuta Trasmissione (successful transmission): SdI transmitted to buyer → PENDING/CLEARED
 */

import { TransmissionResult } from '../../../execution/types';

// ---------------------------------------------------------------------------
// SdI submission types
// ---------------------------------------------------------------------------

export interface SdiSubmitRequest {
  /** Trasmittente identifier (IT + 11-digit VAT, e.g. 'IT01234567890'). */
  idTrasmittente: string;
  /** FatturaPA XML bytes (UTF-8, signed if required). */
  xmlBytes: Buffer;
  /** Original filename, e.g. 'IT01234567890_12345.xml'. */
  filename: string;
  /** Certificate (PFX base64) for mTLS / WS-Security. */
  certificate?: string;
  /** Certificate password. */
  certificatePassword?: string;
}

export interface SdiSubmitResult {
  /** SdI-assigned identifier returned in the RispostaRiceviFile. */
  idSdI: number;
  /** Unique identifier SdI assigns to the transmission. */
  idTrasmittente: string;
  /** Normalised filename returned by SdI (may differ from submitted). */
  filename: string;
}

// ---------------------------------------------------------------------------
// SdI notifica (notification) types
// ---------------------------------------------------------------------------

export type SdiNotificaType = 'RC' | 'NS' | 'MC' | 'NE' | 'DT' | 'AT';

export interface SdiNotifica {
  type: SdiNotificaType;
  idSdI: number;
  /** ISO timestamp. */
  dataOraRicezione: string;
  /** Present on NS — human-readable rejection details. */
  descrizioneErrore?: string;
  /** Present on NE — 'EC01' (accepted) or 'EC02' (refused). */
  esitoCommittente?: 'EC01' | 'EC02';
}

export interface SdiStatusResult {
  /** Latest notifica received, or undefined if no notification yet. */
  latestNotifica?: SdiNotifica;
  /** Whether delivery has been attempted. */
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// Port — swappable transport (SOAP SDICoop, SFTP, or mock).
// ---------------------------------------------------------------------------

/**
 * Protocol-level port for SdI communications.
 * The real implementation uses SDICoop (SOAP) + mTLS with the accredited PFX certificate.
 * Inject a mock for tests.
 */
export interface SdiHttpPort {
  /**
   * Submit a FatturaPA file to SdI.
   * Corresponds to the SOAP operation `SdIRiceviFile` on RiceviFileService.
   * Returns the SdI-assigned idSdI on success; throws on error.
   */
  submit(request: SdiSubmitRequest): Promise<SdiSubmitResult>;

  /**
   * Poll SdI for the current status of a previously submitted file.
   * Note: SdI is primarily callback-driven (notifiche); this poll is the fallback.
   * Returns the latest notifica received, if any.
   */
  getStatus(idSdI: number, idTrasmittente: string): Promise<SdiStatusResult>;
}

// ---------------------------------------------------------------------------
// SdiClient — thin orchestrator on top of SdiHttpPort
// ---------------------------------------------------------------------------

export interface SdiClientConfig {
  idTrasmittente: string;
  /** PFX certificate (base64). Required for production SDICoop. */
  certificate?: string;
  /** Certificate password. NEVER logged. */
  certificatePassword?: string;
}

export class SdiClient {
  constructor(
    private readonly http: SdiHttpPort,
    private readonly config: SdiClientConfig,
  ) {}

  /**
   * Submit a FatturaPA XML to SdI.
   * @param xmlBytes Raw XML bytes (UTF-8, signed if applicable).
   * @param filename The canonical SdI filename pattern: IT{VAT}_{progr}.xml (or .p7m if signed).
   */
  async submit(xmlBytes: Buffer, filename: string): Promise<SdiSubmitResult> {
    return this.http.submit({
      idTrasmittente: this.config.idTrasmittente,
      xmlBytes,
      filename,
      certificate: this.config.certificate,
      certificatePassword: this.config.certificatePassword,
    });
  }

  /**
   * Poll SdI for the latest notifica for a given idSdI.
   */
  async getStatus(idSdI: number): Promise<SdiStatusResult> {
    return this.http.getStatus(idSdI, this.config.idTrasmittente);
  }

  /**
   * Map an SdI notifica to a TransmissionResult.
   *
   * SdI lifecycle mapping:
   *   RC (Ricevuta di Consegna)   → CLEARED  (buyer received the document)
   *   NS (Notifica di Scarto)     → REJECTED (SdI schema/format error)
   *   MC (Mancata Consegna)       → PENDING  (delivery failed; SdI retries for 15 days)
   *   NE EC01 (esito accepted)    → CLEARED  (buyer accepted)
   *   NE EC02 (esito refused)     → REJECTED (buyer refused)
   *   DT (Decorrenza Termini)     → CLEARED  (15-day term elapsed; SdI deems delivered)
   *   AT (Avvenuta Trasmissione)  → CLEARED  (SdI successfully transmitted)
   */
  static mapNotifica(notifica: SdiNotifica, ref: string): TransmissionResult {
    const notes: string[] = [`idSdI: ${notifica.idSdI}`, `notifica: ${notifica.type}`, `data: ${notifica.dataOraRicezione}`];

    switch (notifica.type) {
      case 'RC':
        return { channel: 'SDI', status: 'CLEARED', ref, notes };

      case 'NS':
        if (notifica.descrizioneErrore) notes.push(`error: ${notifica.descrizioneErrore}`);
        return { channel: 'SDI', status: 'REJECTED', ref, notes };

      case 'MC':
        return { channel: 'SDI', status: 'PENDING', ref, notes: [...notes, 'mancata consegna: SdI will retry for 15 days'] };

      case 'NE':
        if (notifica.esitoCommittente === 'EC01') {
          return { channel: 'SDI', status: 'CLEARED', ref, notes: [...notes, 'buyer accepted (EC01)'] };
        }
        if (notifica.esitoCommittente === 'EC02') {
          return { channel: 'SDI', status: 'REJECTED', ref, notes: [...notes, 'buyer refused (EC02)'] };
        }
        return { channel: 'SDI', status: 'PENDING', ref, notes: [...notes, 'NE outcome pending'] };

      case 'DT':
        return { channel: 'SDI', status: 'CLEARED', ref, notes: [...notes, 'decorrenza termini: 15 days elapsed, deemed delivered'] };

      case 'AT':
        return { channel: 'SDI', status: 'CLEARED', ref, notes: [...notes, 'avvenuta trasmissione'] };

      default:
        return { channel: 'SDI', status: 'PENDING', ref, notes: [...notes, `unknown notifica type: ${notifica.type}`] };
    }
  }
}
