/**
 * SdI (Sistema di Interscambio) client abstraction — root TODO item 10, wave 2. REPRISED from git
 * tag `avant-refonte-documents` (`compliance/providers/transmission/sdi/sdi-client.ts`), with ONE
 * change: `SdiClient.mapNotifica`'s return type used to be the removed compliance engine's own
 * `TransmissionResult` (`execution/types.ts`) — replaced here by `SdiNotificaOutcome`, a small local
 * type carrying the same three facts (`status`/`ref`/`notes`) that engine's own runtime consumed.
 * Nothing about the notifica-mapping LOGIC changed — see this file's own header at the repère for the
 * full RC/NS/MC/NE/DT/AT sourcing (independently confirmed against the published WSDL — see
 * `sdicoop-client.ts`'s own header — while building the REAL client below).
 *
 * Real SdI access for intermediaries requires:
 *   - AdE (Agenzia delle Entrate) accreditation
 *   - A PKCS#12 client certificate AdE's own CA issues on a CSR submitted during accreditation
 *     (`CREDENTIALS_GUIDE.md` §4 — NOT a commercially-purchased "qualified" certificate)
 *   - A dedicated channel: SDICoop (SOAP web service) or SDIFTP
 *
 * CORRECTION (2026-09-01): the SDICoop endpoint this header used to state
 * (`https://sdi.fatturapa.gov.it/SdI_riceviFile/v1.0/RiceviFileService`) was NEVER read from an
 * official source — it does not appear in the published WSDL (`SdIRiceviFile_v1.0.wsdl`'s own
 * `soapbind:address` is a placeholder, `http://servizi.fatturapa.it/ricevi_file`) nor in either
 * instructions PDF fetched this task (see `sdicoop-client.ts`'s own header for the full citation
 * list). Removed rather than left standing uncorrected: the real endpoint is assigned per
 * intermediary at accreditation and is a required "sdi" channel credential (`endpoint`), never a
 * constant.
 *
 * STATUS: **implemented-awaiting-accreditation** — `sdicoop-client.ts`'s `SdiCoopClient` is the REAL
 * `SdiHttpPort` now (see that file's own header for what was read vs extrapolated); this file's own
 * `UNACCREDITED_SDI_HTTP_PORT` below is no longer what `sdi-transport.ts` reaches in production (it
 * now builds a `SdiCoopClient` once credentials — including `endpoint` — are complete), kept only as
 * the honest default for a caller that constructs an `SdiClient` with no port at all. LIVE PROOF:
 * still DEFERRED — pending AdE intermediary accreditation (see `sdicoop.live.spec.ts`, gated
 * `SDI_LIVE=1`). Every test in `sdi-transport.spec.ts` and this file's own sibling specs uses either a
 * mocked port or the real `SdiCoopClient` against a local stub — never the true AdE endpoint.
 *
 * SdI notification types (notifiche) that drive the lifecycle:
 *   RC — Ricevuta di Consegna (delivery receipt): buyer received the invoice → CLEARED
 *   NS — Notifica di Scarto (rejection): SdI rejected the file → REJECTED
 *   MC — Mancata Consegna (failed delivery): SdI could not deliver → PENDING (retry for 15 days)
 *   NE — Notifica Esito (buyer outcome): buyer accepted/refused → CLEARED or REJECTED
 *   DT — Decorrenza Termini (15-day term expired): SdI considers it delivered → CLEARED
 *   AT — Avvenuta Trasmissione (successful transmission): SdI transmitted to buyer → PENDING/CLEARED
 */

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

/** What `SdiClient.mapNotifica` returns — the same three facts the removed compliance engine's own
 *  `TransmissionResult` carried for this call site, without dragging that engine's whole type back
 *  in. `channel` is kept (rather than dropped) so a caller logging this alongside other channels'
 *  outcomes still sees a consistent shape. */
export interface SdiNotificaOutcome {
  channel: 'SDI';
  status: 'CLEARED' | 'REJECTED' | 'PENDING';
  ref: string;
  notes: string[];
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

  /**
   * Send the esito committente (NE notifica) to SdI — the buyer's acceptance or refusal.
   *
   * EC01 = accettazione (accepted by buyer)
   * EC02 = rifiuto     (refused by buyer)
   *
   * Corresponds to the SOAP service RiceviNotificaService on the intermediary's SDICoop endpoint.
   * DEFERRED: requires AdE intermediary accreditation + qualified PFX certificate.
   */
  sendEsito(
    idSdI: number,
    idTrasmittente: string,
    esito: 'EC01' | 'EC02',
    descrizione?: string,
  ): Promise<void>;
}

/** The default port a production caller gets when it injects none — throws a NAMED, honest error
 *  rather than pretending a real SOAP transport exists. See `../sdi-transport.ts`'s own header for
 *  why this is not a gap this wave hides. */
export const UNACCREDITED_SDI_HTTP_PORT: SdiHttpPort = {
  submit: async () => {
    throw new Error(
      'SdI SDICoop transport not implemented — AdE (Agenzia delle Entrate) intermediary accreditation ' +
        'and a qualified PFX certificate are required before a real submission can be attempted.',
    );
  },
  getStatus: async () => {
    throw new Error('SdI SDICoop transport not implemented — AdE intermediary accreditation required.');
  },
  sendEsito: async () => {
    throw new Error('SdI sendEsito not implemented — AdE intermediary accreditation required.');
  },
};

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
   * Send the esito committente (NE notifica) — buyer's acceptance or refusal — to SdI.
   *
   * EC01 = accettazione (buyer accepts the invoice)
   * EC02 = rifiuto     (buyer refuses the invoice)
   *
   * DEFERRED: real transport requires AdE intermediary accreditation + qualified PFX.
   */
  async sendEsito(idSdI: number, esito: 'EC01' | 'EC02', descrizione?: string): Promise<void> {
    return this.http.sendEsito(idSdI, this.config.idTrasmittente, esito, descrizione);
  }

  /**
   * Map an SdI notifica to an outcome — VERBATIM logic from the repère (see this file's own header
   * on the ONE type-shape change).
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
  static mapNotifica(notifica: SdiNotifica, ref: string): SdiNotificaOutcome {
    const notes: string[] = [
      `idSdI: ${notifica.idSdI}`,
      `notifica: ${notifica.type}`,
      `data: ${notifica.dataOraRicezione}`,
    ];

    switch (notifica.type) {
      case 'RC':
        return { channel: 'SDI', status: 'CLEARED', ref, notes };

      case 'NS':
        if (notifica.descrizioneErrore) notes.push(`error: ${notifica.descrizioneErrore}`);
        return { channel: 'SDI', status: 'REJECTED', ref, notes };

      case 'MC':
        return {
          channel: 'SDI',
          status: 'PENDING',
          ref,
          notes: [...notes, 'mancata consegna: SdI will retry for 15 days'],
        };

      case 'NE':
        if (notifica.esitoCommittente === 'EC01') {
          return { channel: 'SDI', status: 'CLEARED', ref, notes: [...notes, 'buyer accepted (EC01)'] };
        }
        if (notifica.esitoCommittente === 'EC02') {
          return { channel: 'SDI', status: 'REJECTED', ref, notes: [...notes, 'buyer refused (EC02)'] };
        }
        return { channel: 'SDI', status: 'PENDING', ref, notes: [...notes, 'NE outcome pending'] };

      case 'DT':
        return {
          channel: 'SDI',
          status: 'CLEARED',
          ref,
          notes: [...notes, 'decorrenza termini: 15 days elapsed, deemed delivered'],
        };

      case 'AT':
        return { channel: 'SDI', status: 'CLEARED', ref, notes: [...notes, 'avvenuta trasmissione'] };

      default:
        return {
          channel: 'SDI',
          status: 'PENDING',
          ref,
          notes: [...notes, `unknown notifica type: ${notifica.type}`],
        };
    }
  }
}
