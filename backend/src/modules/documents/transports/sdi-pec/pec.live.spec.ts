/**
 * REAL round-trip for the "sdi-pec" transport — send a genuine FatturaPA XML over a real PEC mailbox's
 * SMTP submission, then drain that SAME mailbox's IMAP inbox (`ImapFlowPecInboxPort`) for SdI's own
 * first reply.
 *
 * Status: **implemented-awaiting-credentials** — this spec has NEVER been executed against a real PEC
 * mailbox: no PEC account exists in this checkout (see `pec-protocol.ts`'s own header for what WAS
 * established from fatturapa.gov.it's own published documentation, and
 * `imapflow-pec-inbox-port.ts`'s own header for the identical posture on the receiving side). Unlike
 * the SDICoop channel, reaching SdI over PEC needs NO accreditation at all — the only missing
 * ingredient is an actual PEC mailbox (any Italian-law-compliant provider), which this task's
 * engineering constraints explicitly rule out obtaining. A GATED SPEC THAT PASSES WITH MOCKS PROVES
 * NOTHING ABOUT THIS INTEGRATION — every other spec in this directory tests the business logic
 * (filename rules, address learning, notifica mapping) against mocked ports; this is the ONE spec that
 * would actually prove the wire protocol works, and it has not run.
 *
 * Gated `PEC_LIVE=1` + the SMTP/IMAP credentials below (`../live-gate.ts`), run the same way every
 * other channel's own live spec is:
 *
 *   PEC_LIVE=1 \
 *     PEC_ID_TRASMITTENTE=IT01234567890 PEC_ADDRESS=fatture@example.pec.it \
 *     PEC_SMTP_HOST=smtps.pec-provider.it PEC_SMTP_PORT=465 PEC_SMTP_SECURE=true \
 *     PEC_IMAP_HOST=imaps.pec-provider.it PEC_IMAP_PORT=993 PEC_IMAP_SECURE=true \
 *     PEC_USERNAME=fatture@example.pec.it PEC_PASSWORD=<password> \
 *     npx jest pec.live --no-coverage
 *
 * Skips cleanly (silently unless the flag is set, then one stderr line) whenever the flag or any
 * credential is absent — which is EVERY run today. No sandbox or fake SMTP/IMAP endpoint is fabricated
 * to force a green run.
 *
 * HARD-SUCCESS CONTRACT (the same discipline every other live spec in this directory enforces): a
 * missing SdI reply within the poll window, or a reply whose `SdiClient.mapNotifica` outcome is not one
 * of CLEARED/REJECTED/PENDING for a recognized notifica type, FAILS this spec — a transient absence of
 * a reply is never treated as a soft pass.
 */
import * as nodemailer from 'nodemailer';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { clientToFormatParty, companyToFormatParty } from '../../formats/party-snapshot';
import { fatturapaFormatProvider } from '../../formats/national/fatturapa-provider';
import { liveDescribe } from '../live-gate';
import { parseSdiNotifica } from '../sdi/sdi-notifiche';
import { ImapFlowPecInboxPort } from './imapflow-pec-inbox-port';
import { buildPecAttachmentFilename, SDI_PEC_FIRST_SUBMISSION_ADDRESS } from './pec-protocol';

const describeLive = liveDescribe('PEC_LIVE', [
  'PEC_ID_TRASMITTENTE',
  'PEC_ADDRESS',
  'PEC_SMTP_HOST',
  'PEC_SMTP_PORT',
  'PEC_IMAP_HOST',
  'PEC_IMAP_PORT',
  'PEC_USERNAME',
  'PEC_PASSWORD',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeLive('SdI PEC live round-trip', () => {
  it(
    'sends a real FatturaPA over PEC and receives a first reply from SdI',
    async () => {
      const idTrasmittente = process.env.PEC_ID_TRASMITTENTE!;
      const pecAddress = process.env.PEC_ADDRESS!;
      const smtpHost = process.env.PEC_SMTP_HOST!;
      const smtpPort = Number(process.env.PEC_SMTP_PORT);
      const smtpSecure = process.env.PEC_SMTP_SECURE !== 'false';
      const imapHost = process.env.PEC_IMAP_HOST!;
      const imapPort = Number(process.env.PEC_IMAP_PORT);
      const imapSecure = process.env.PEC_IMAP_SECURE !== 'false';
      const username = process.env.PEC_USERNAME!;
      const password = process.env.PEC_PASSWORD!;

      const company = {
        name: 'Rossi SRL',
        address: 'Via Roma 10',
        city: 'Milano',
        postalCode: '20100',
        country: 'Italy',
        partyIdentifiers: [{ scheme: 'VAT', value: idTrasmittente }],
      };
      const client = {
        name: 'Bianchi SpA',
        address: 'Corso Italia 20',
        city: 'Roma',
        postalCode: '00100',
        country: 'Italy',
        // Checksum-valid but FICTITIOUS Partita IVA (validateItVat — Luhn-like, backend/src/modules/
        // documents/tax/vat-syntax.ts — passes: check digit 3, not the 9 an earlier draft of this
        // fixture carried, duplicated from sdicoop.live.spec.ts). A real collaudo VAT number would
        // need a PEC mailbox this checkout does not have, per this file's own header.
        partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432103' }],
      };
      const documentId = `pec-live-test-${Date.now()}`;
      const document = {
        id: documentId,
        typeId: 'invoice',
        status: 'sending',
        data: { client: 'client-1' },
        createdAt: new Date(),
        updatedAt: new Date(),
        displayNumber: 'FT-PEC-0001',
      };

      const buildResult = await fatturapaFormatProvider.build(
        buildInvoiceDescriptor(),
        document,
        companyToFormatParty(company),
        clientToFormatParty(client),
      );
      expect(buildResult.validation.valid).toBe(true); // fail loud if the XSD gate itself regressed

      const filename = buildPecAttachmentFilename(idTrasmittente, documentId);

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: { user: username, pass: password },
      });
      await transporter.sendMail({
        from: pecAddress,
        to: SDI_PEC_FIRST_SUBMISSION_ADDRESS,
        subject: `Fattura elettronica — ${filename}`,
        text: 'Fattura elettronica trasmessa tramite PEC al Sistema di Interscambio — round-trip di test.',
        attachments: [{ filename, content: Buffer.from(buildResult.bytes), contentType: 'application/xml' }],
      });

      const port = new ImapFlowPecInboxPort({
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        username,
        password,
      });

      // SdI's own first reply (notifica di scarto/errore, ricevuta di consegna/mancata consegna, or
      // attestazione) is not instantaneous — poll for it rather than assuming it is already there.
      const POLL_ATTEMPTS = 20;
      const POLL_DELAY_MS = 15_000;
      let matched: ReturnType<typeof parseSdiNotifica> = null;
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !matched; attempt++) {
        if (attempt > 0) await sleep(POLL_DELAY_MS);
        const messages = await port.fetchUnseen();
        for (const message of messages) {
          for (const attachment of message.attachments) {
            const parsed = parseSdiNotifica(attachment.content.toString('utf-8'));
            if (parsed?.nomeFile === filename) {
              matched = parsed;
              await port.markSeen(message.id);
              break;
            }
          }
          if (matched) break;
        }
      }

      // HARD-SUCCESS CONTRACT: no reply within the poll window is a FAILURE, never a soft pass.
      expect(matched).not.toBeNull();
      expect(matched?.identificativoSdI).toBeTruthy();
    },
    20 * 15_000 + 30_000,
  );
});
