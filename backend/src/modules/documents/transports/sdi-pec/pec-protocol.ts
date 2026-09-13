/**
 * Protocol facts for the "sdi-pec" transport — Italy's Sistema di Interscambio (SdI), reached over a
 * certified-email (PEC — Posta Elettronica Certificata) channel that requires NO AdE (Agenzia delle
 * Entrate) accreditation, unlike the SDICoop/SDIFTP channels `sdi/sdicoop-client.ts` implements. Every
 * fact below was read from a primary source, quoted verbatim in Italian, with the exact URL and the
 * date read — the same discipline `sdi/sdicoop-client.ts`'s own header holds, adopted here because a
 * summarising fetch has previously FABRICATED legal text in this repository: this file only ever
 * quotes RAW text fetched with `curl` (a browser User-Agent, verified as real content, never a JS
 * shell or a consent wall).
 *
 * ## Sources read (fetched 2026-09-13)
 *
 *  1. "Inviare la FatturaPA" —
 *     https://www.fatturapa.gov.it/it/comefare/operatori-economici/inviare-la-fatturapa/
 *     (`curl`, plain HTML, ~29 KB, real content — genuine page prose, not a JS shell)
 *
 *     «Sono previsti quattro diversi canali di trasmissione per l'invio dei file: Posta Elettronica
 *     Certificata (PEC) [...]»
 *
 *     «L'utilizzo del canale PEC non presuppone alcun tipo di accreditamento preventivo presso il
 *     Sistema di Interscambio.»
 *
 *     «I file FatturaPA e i file archivio devono essere spediti come allegato del messaggio di PEC.
 *     L'indirizzo PEC a cui destinare i file è il seguente: sdi01@pec.fatturapa.it. Il messaggio,
 *     comprensivo dell'allegato, non deve superare la dimensione di 30 megabytes. Se tale limite
 *     dimensionale non viene rispettato non è garantito il buon esito della trasmissione.»
 *
 *     «Nota bene: il Sistema, con il primo messaggio di risposta, notifica di scarto o ricevuta di
 *     consegna, comunica al trasmittente l'indirizzo di PEC che dovrà utilizzare per i successivi
 *     eventuali invii. L'utilizzo di un indirizzo di PEC diverso da quello assegnato dal SdI non
 *     garantisce il buon fine della ricezione del file FatturaPA.»
 *
 *  2. "Specifiche delle regole tecniche di cui all'Allegato B del DM 55 del 3 aprile 2013 per la
 *     trasmissione delle fatture elettroniche tramite Sistema di Interscambio", v1.8.1, 01/10/2020 —
 *     https://www.fatturapa.gov.it/export/documenti/Specifiche_tecniche_SdI_v1.8.1.pdf
 *     (`curl`, then `pdftotext -layout` — the same tool this repository's own CLAUDE.md already
 *     documents for fatturapa.gov.it's PDFs).
 *
 *     §2.2 "NOMENCLATURA DEI FILE DA TRASMETTERE" (applies to every channel — PEC included — per §3.1's
 *     own cross-reference, "il file [...] deve essere identificato secondo le regole di nomenclatura
 *     previste al precedente paragrafo 2.2"):
 *
 *     «Nei casi a) e b) il nome del file deve rispettare la seguente nomenclatura: codice paese +
 *     identificativo univoco del soggetto trasmittente + progressivo univoco del file [...] il codice
 *     paese va espresso secondo lo standard ISO 3166-1 alpha-2 code; l'identificativo univoco del
 *     soggetto trasmittente [...] ha una lunghezza di: 11 caratteri (minimo) e 16 caratteri (massimo)
 *     nel caso di codice paese IT; 2 caratteri (minimo) e 28 caratteri (massimo) altrimenti [...] il
 *     progressivo univoco del file è rappresentato da una stringa alfanumerica di lunghezza massima di
 *     5 caratteri e con valori ammessi [a-z], [A-Z], [0-9]. [...] Il separatore tra il secondo ed il
 *     terzo elemento del nome file è il carattere underscore ("_") [...] Es.:
 *     ITAAABBB99T99X999W_00001.xml [...] Ogni file inviato al Sistema di Interscambio deve avere un
 *     nome diverso da qualsiasi altro file inviato in precedenza.»
 *
 *     §3.1.1 "POSTA ELETTRONICA CERTIFICATA (SERVIZIO PEC)":
 *
 *     «Il messaggio con relativi allegati non deve superare la dimensione di 30 megabytes, valore che
 *     costituisce il limite massimo entro il quale il gestore è tenuto a garantire il suo invio, come
 *     previsto dall'art. 12 del DM 2 novembre 2005 ("Regole tecniche per la formazione, la
 *     trasmissione e la validazione, anche temporale, della posta elettronica certificata" - G.U. 15
 *     novembre 2005, n. 266)»
 *
 *     «La prima volta che il soggetto trasmittente intende utilizzare la PEC, deve inviare il
 *     messaggio e i relativi file allegati all'indirizzo di posta elettronica certificata del SdI
 *     pubblicato sul sito web www.fatturapa.gov.it; il SdI, con il primo messaggio di risposta,
 *     notifica di errore, ricevuta di consegna, ricevuta di mancata consegna o attestazione di
 *     avvenuta trasmissione della fattura con impossibilità di recapito, comunica al soggetto
 *     trasmittente l'indirizzo di PEC che dovrà utilizzare per le successive eventuali trasmissioni e
 *     che verrà utilizzato anche dal SdI per i messaggi in risposta [...] L'utilizzo di un indirizzo
 *     di PEC diverso da quello assegnato dal SdI non garantisce il buon fine della ricezione del
 *     messaggio di posta da parte del SdI stesso.»
 *
 *     §5.1.1 "VERIFICHE EFFETTUATE SUI FILE FATTURA" — what a malformed or duplicate filename gets:
 *
 *     «attraverso un controllo sulla nomenclatura del file ricevuto il SDI verifica che il nome file
 *     sia conforme con quanto riportato nel precedente paragrafo 2.2 e che non sia stato già inviato
 *     un file con lo stesso nome [...] in caso di esito negativo del controllo (nome file già presente
 *     nel SDI o nome file non conforme) il file viene rifiutato con le seguenti motivazioni: Codice
 *     00001 - Nome file non valido; Codice 00002 - Nome file duplicato.»
 *
 *     This rejection is delivered as a "notifica di scarto" (NS) — see `pec-notifiche.service.ts`'s
 *     own header for how the six/eight notifica types are interpreted, reusing `sdi/sdi-notifiche.ts`
 *     unchanged (the message FORMAT is channel-agnostic, confirmed by "File, fatture e messaggi" —
 *     https://www.fatturapa.gov.it/it/sistemainterscambio/file-fatture-e-messaggi/ — which describes
 *     the eight message kinds with no per-channel variation at all).
 *
 * ## What differs between the PEC route and the SdICoop route — established, not guessed
 *
 * NOTHING in the FatturaPA XML itself: §2.1/§2.2 of the same specification describe ONE file format,
 * ONE signature choice (XAdES-BES → `.xml`, or CAdES-BES → `.xml.p7m`), and ONE filename convention,
 * for every transmission channel alike. `sdi-pec-transport.ts` therefore reuses the EXACT same
 * `fatturapaFormatProvider` (`formats/national/fatturapa-provider.ts`) `sdi-transport.ts` already
 * builds against — no PEC-specific payload variant exists to build. The only real differences are
 * TRANSPORT-level: no accreditation, no client certificate, no fixed endpoint (a PEC mailbox instead),
 * a 30 MB message-size ceiling (vs. SDICoop's own 5 MB attachment ceiling — read in the same §3.1.2,
 * not requoted here since this file's own scope is the PEC route), and the two-step addressing rule
 * (first submission to a published address, every later one to whatever address SdI replied from).
 *
 * ## What is NOT established from these sources, left explicit rather than guessed
 *
 *  - The exact SOAP-free plain-text/HTML body PEC messages carry, if any is required beyond the
 *    attachment itself — the read sources describe only the attachment's own rules. `send()` sends a
 *    short, human-readable plain-text body; this is a product choice, not a requirement read anywhere.
 *  - Whether SdI's own PEC responder EVER re-derives `idTrasmittente` from the sender's PEC envelope
 *    address rather than solely from the FatturaPA XML header's own `IdTrasmittente` — not stated in
 *    either read source. `SDI_REPLY_ADDRESS_HINT_TYPES` below documents exactly which first-response
 *    message kinds the specification says carry the new reply address (see its own comment).
 */

import { createHash } from 'node:crypto';

/** The SdI PEC address for a FIRST submission — read verbatim above, never guessed nor hardcoded from
 *  a different source. A later submission MUST go to whatever address SdI itself replied from instead
 *  (see `resolvePecRecipient` below) — using this constant for every send would violate the exact
 *  rule the specification states ("L'utilizzo di un indirizzo di PEC diverso da quello assegnato dal
 *  SdI non garantisce il buon fine della ricezione del file FatturaPA."). */
export const SDI_PEC_FIRST_SUBMISSION_ADDRESS = 'sdi01@pec.fatturapa.it';

/**
 * The message kinds whose FIRST occurrence carries the trasmittente's own dedicated reply address —
 * read verbatim (§3.1.1): "notifica di errore, ricevuta di consegna, ricevuta di mancata consegna o
 * attestazione di avvenuta trasmissione della fattura con impossibilità di recapito". Cross-referenced
 * against `sdi/sdi-notifiche.ts`'s own `SdiNotificaType` vocabulary (RC/NS/MC/AT — "notifica di
 * errore" reads, in context, as the same rejection this codebase's own six-notifica taxonomy already
 * calls "notifica di scarto"/NS; the specification's own prose is not fully consistent about this one
 * term, and no clearer statement was found — left as the closest honest mapping rather than inventing
 * a distinct, unmodelled 9th message kind).
 */
export const SDI_REPLY_ADDRESS_HINT_TYPES = ['RC', 'NS', 'MC', 'AT'] as const;

/** Read verbatim (§3.1.1, citing DM 2 novembre 2005 art. 12): the ENTIRE PEC message, headers plus
 *  every attachment, must not exceed this size — never just the FatturaPA attachment on its own. */
export const PEC_MESSAGE_MAX_BYTES = 30 * 1024 * 1024;

/**
 * A conservative ceiling on the RAW (pre-encoding) FatturaPA XML this transport will attempt to send.
 * The 30 MB figure just above bounds the FINAL wire message, base64-encoded attachment included
 * (~4/3 inflation) plus MIME/PEC envelope overhead — neither of which this code builds by hand (that
 * is `MailService`/nodemailer's job). Rather than predict the exact final size, this constant reserves
 * generous headroom (≈70% of the 30 MB ceiling for the RAW bytes, leaving the rest for base64 + PEC's
 * own transport-level envelope) so a legitimately oversized invoice is refused HERE, named, before an
 * opaque bounce ever comes back — an engineering safety margin, not a fact read from any source.
 */
export const PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES = Math.floor((PEC_MESSAGE_MAX_BYTES * 0.7) / (4 / 3));

/**
 * The filename structure read from §2.2 above, encoded as a validator. Deliberately STRICTER than
 * `sdi/sdicoop-client.ts#NOMEFILE_PATTERN` (that one is the SOAP `nomeFile_Type` XSD's own permissive
 * `[a-zA-Z0-9_.]{9,50}` — a wire-level constraint, not the full human-facing naming RULE from §2.2):
 * this pattern requires the "_" separator to land exactly between a plausible id and a ≤5-character
 * alphanumeric progressivo, matching the worked examples above byte for byte
 * ("ITAAABBB99T99X999W_00001.xml", "IT99999999999_00002.xml.p7m").
 *
 * NOTE, found while researching this file, left for a maintainer to weigh rather than silently fixed
 * here: `sdi-transport.ts`'s own SDICoop filename generator derives its progressivo from
 * `ctx.document.id.slice(-10)` — up to 10 characters, which satisfies the looser XSD pattern but would
 * FAIL this stricter §2.2 rule (max 5). That file is unchanged by this task (a different channel, a
 * different transport, out of scope for "add a sibling") — flagged here because both now cite the
 * same primary source and a future reader deserves to know they currently disagree.
 */
export const PEC_ATTACHMENT_FILENAME_PATTERN =
  /^[A-Za-z]{2}[A-Za-z0-9]{2,26}_[A-Za-z0-9]{1,5}\.(xml|xml\.p7m|zip)$/;

export function isValidPecAttachmentFilename(filename: string): boolean {
  return PEC_ATTACHMENT_FILENAME_PATTERN.test(filename);
}

/**
 * Deterministic ≤5-character alphanumeric progressivo (§2.2's own maximum) derived from the document
 * id — the same "derived from the invoice, never invented" convention `pdp-transport.ts`'s own
 * `externalId` and `sdi-transport.ts`'s own filename both already follow, just kept within the
 * stricter 5-character bound those two files are not held to (see `PEC_ATTACHMENT_FILENAME_PATTERN`'s
 * own comment). A SHA-1 hash rather than a raw slice of the id: `documentId` is a cuid/uuid whose own
 * characters (hyphens, and possibly more than 5 of them before any letter/digit run repeats) do not
 * fit `[a-zA-Z0-9]{1,5}` directly, so slicing it verbatim the way `sdi-transport.ts` does would not
 * even pass THIS file's own stricter pattern.
 */
export function buildPecProgressivo(documentId: string): string {
  const digestHex = createHash('sha1').update(documentId).digest('hex');
  const numeric = BigInt(`0x${digestHex.slice(0, 12)}`);
  return numeric.toString(36).toUpperCase().slice(-5).padStart(5, '0');
}

/** Builds the canonical PEC attachment filename for a FatturaPA submission — `idTrasmittente` already
 *  carries the country-code prefix concatenated with the fiscal id (e.g. "IT01234567890"), the exact
 *  same field shape `sdi-transport.ts#SdiCredentials.idTrasmittente` already establishes for this
 *  codebase's "sdi" channel — see this file's own header, §2.2, for why country code and fiscal id are
 *  simply adjacent with no separator between them (the worked examples show no separator there
 *  either). The result is validated against `PEC_ATTACHMENT_FILENAME_PATTERN` before being returned —
 *  a caller never receives a filename SdI would reject anyway. */
export function buildPecAttachmentFilename(idTrasmittente: string, documentId: string): string {
  const filename = `${idTrasmittente}_${buildPecProgressivo(documentId)}.xml`;
  if (!isValidPecAttachmentFilename(filename)) {
    throw new Error(
      `Built PEC attachment filename "${filename}" does not match the required §2.2 pattern ` +
        `(${PEC_ATTACHMENT_FILENAME_PATTERN}) — refusing to submit a file SdI would reject anyway ` +
        '(Codice 00001 - Nome file non valido).',
    );
  }
  return filename;
}

/**
 * Which PEC address THIS send must target — the two-step rule read verbatim above: the FIRST
 * submission goes to `SDI_PEC_FIRST_SUBMISSION_ADDRESS`; every later one goes to whatever address SdI
 * itself replied from (`learnedReplyAddress`, populated by `pec-notifiche.service.ts` once a first
 * response has actually been observed — see that file's own header). Never falls back to guessing a
 * DIFFERENT address once one has been learned: the specification is explicit that using anything else
 * "non garantisce il buon fine della ricezione".
 */
export function resolvePecRecipient(learnedReplyAddress: string | undefined): string {
  return learnedReplyAddress?.trim() || SDI_PEC_FIRST_SUBMISSION_ADDRESS;
}
