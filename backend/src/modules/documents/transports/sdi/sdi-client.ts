/**
 * SdI (Sistema di Interscambio) client abstraction. REPRISED from git
 * tag `avant-refonte-documents` (`compliance/providers/transmission/sdi/sdi-client.ts`), with ONE
 * change: `SdiClient.mapNotifica`'s return type used to be the removed compliance engine's own
 * `TransmissionResult` (`execution/types.ts`) — replaced here by `SdiNotificaOutcome`, a small local
 * type carrying the same three facts (`status`/`ref`/`notes`) that engine's own runtime consumed.
 * Nothing about the notifica-mapping LOGIC changed — see this file's own header at the reference for the
 * full RC/NS/MC/NE/DT/AT sourcing (independently confirmed against the published WSDL — see
 * `sdicoop-client.ts`'s own header — while building the REAL client below).
 *
 * Real SdI access for intermediaries requires:
 *   - AdE (Agenzia delle Entrate) accreditation
 *   - A PKCS#12 client certificate AdE's own CA issues on a CSR submitted during accreditation
 *     (`documentation/docs/developer-guide/credentials-guide.md` §4 — NOT a commercially-purchased "qualified" certificate)
 *   - A dedicated channel: SDICoop (SOAP web service) or SDIFTP
 *
 * CORRECTION (2026-09-01): the SDICoop endpoint this header used to state
 * (`https://sdi.fatturapa.gov.it/SdI_riceviFile/v1.0/RiceviFileService`) was NEVER read from an
 * official source — it does not appear in the published WSDL (`SdIRiceviFile_v1.0.wsdl`'s own
 * `soapbind:address` is a placeholder, `http://servizi.fatturapa.it/ricevi_file`) nor in either
 * instructions PDF (see `sdicoop-client.ts`'s own header for the full citation
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
 *   AT — Attestazione di Avvenuta Trasmissione (transmission attempted, delivery impossible) → REJECTED
 *
 * CORRECTION (verified against a primary source while building the "sdi-pec" sibling transport,
 * 2026-09-13): AT does NOT mean successful transmission — this header, and `mapNotifica`'s own AT
 * case below, previously mapped it to `CLEARED`. The published "Specifiche delle regole tecniche...",
 * v1.8.1, 01/10/2020 (https://www.fatturapa.gov.it/export/documenti/Specifiche_tecniche_SdI_v1.8.1.pdf,
 * read via `pdftotext -layout`), §4 point (e), is explicit that AT is the OPPOSITE of a success: «se,
 * trascorsi 10 giorni dalla data di trasmissione della notifica di mancata consegna, il SdI non è
 * riuscito a recapitare la fattura elettronica al soggetto ricevente, inoltra al soggetto trasmittente
 * una definitiva attestazione di avvenuta trasmissione della fattura con impossibilità di recapito
 * [...]; nei casi di fattura elettronica destinata a soggetti diversa di pubblica amministrazione, tale
 * attestazione attribuisce titolo di definitività alla mancata consegna» — "attestation that
 * transmission occurred, WITH IMPOSSIBILITY OF DELIVERY": a definitive, terminal non-delivery, not a
 * success. `sdi-notifiche.ts`'s own `NOTIFICA_TYPE_LABELS.AT` already had this right ("SdI could not
 * deliver within the maximum term") — only this file's header and `mapNotifica` disagreed with it.
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
 *  why this is not a hidden gap. */
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
   * Map an SdI notifica to an outcome — VERBATIM logic from the reference (see this file's own header
   * on the ONE type-shape change).
   *
   * SdI lifecycle mapping:
   *   RC (Ricevuta di Consegna)   → CLEARED  (buyer received the document)
   *   NS (Notifica di Scarto)     → REJECTED (SdI schema/format error)
   *   MC (Mancata Consegna)       → PENDING  (delivery failed; SdI retries for 15 days)
   *   NE EC01 (esito accepted)    → CLEARED  (buyer accepted)
   *   NE EC02 (esito refused)     → REJECTED (buyer refused)
   *   DT (Decorrenza Termini)     → CLEARED  (15-day term elapsed; SdI deems delivered)
   *   AT (Attestazione di Avvenuta Trasmissione) → REJECTED (definitive non-delivery — see this
   *                                                file's own header, "CORRECTION")
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

      // AT is neither a clean success nor a rejection, and this union has only three values, so the
      // choice has to be argued. The specification (Specifiche tecniche SdI v1.8.1, section 1.10)
      // says an AT attests «l'avvenuta ricezione della fattura e l'impossibilità di recapitare il
      // file al destinatario»: SdI RECEIVED and accepted the invoice, and only delivery to the buyer
      // failed, for lack of a technical channel to reach them. The invoice is fiscally issued and
      // SdI makes it available in the buyer's own reserved area.
      //
      // So REJECTED would be a lie -- nothing was rejected, and a user told their invoice failed
      // would reissue one that already legally exists. CLEARED is the honest half: the authority
      // leg is done. What CLEARED does NOT carry is the seller's remaining obligation to tell the
      // buyer the invoice is waiting for them, which no status in this union can express -- hence
      // the note, which the document screen surfaces verbatim.
      case 'AT':
        return {
          channel: 'SDI',
          status: 'CLEARED',
          ref,
          notes: [
            ...notes,
            'attestazione di avvenuta trasmissione con impossibilità di recapito: SdI accepted the ' +
              'invoice but could not deliver it. It is available in the buyer\'s reserved area, and ' +
              'the seller must tell the buyer it is there.',
          ],
        };

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
