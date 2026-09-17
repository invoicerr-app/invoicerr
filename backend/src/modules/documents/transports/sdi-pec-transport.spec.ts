/**
 * The "sdi-pec" transport in isolation — same discipline `sdi-transport.spec.ts` already holds for its
 * sibling: `@/prisma/prisma.service` mocked wholesale, `MailService` mocked as a plain jest object
 * (the same seam `email-transport.spec.ts` already uses for it). Proves:
 *
 *  1. Without a fully-connected channel, `preflight()` throws, naming the channel and its
 *     no-accreditation-required nature.
 *  2. A WELL-FORMED send: builds the correct §2.2 filename, targets the correct PEC address (the
 *     published first-submission one, or the LEARNED reply address once one exists), attaches the
 *     built FatturaPA XML, and returns that filename as `reference` (never an `IdentificativoSdI`,
 *     which does not exist synchronously on this route — see `sdi-pec-transport.ts`'s own header).
 *  3. A MALFORMED attachment name (a channel config whose `idTrasmittente` cannot produce a valid §2.2
 *     filename) is refused HERE, named, before anything is sent.
 *  4. Every other failure mode (no client, failed XSD validation, oversized payload, a mail-transport
 *     rejection) is refused loudly, never silently.
 */
import { BadRequestException, NotImplementedException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import { MailService } from '@/mail/mail.service';

import { DocumentFormatProvider } from '../formats/format-provider';
import { buildSdiPecTransport, SDI_PEC_PROVIDER_ID } from './sdi-pec-transport';
import { SDI_PEC_FIRST_SUBMISSION_ADDRESS } from './sdi-pec/pec-protocol';
import { DocumentTransportContext } from './transport-registry';

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { findUnique: jest.fn() },
    client: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

const mockedPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock };
  client: { findFirst: jest.Mock };
  $queryRaw: jest.Mock;
};

/** `pec-protocol.ts#nextPecProgressivo`'s own persistent counter, backing `buildPecAttachmentFilename`
 *  — a tiny in-memory stand-in for the real `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, the same
 *  fake `pec-protocol.spec.ts` itself uses for the identical SQL shape. Reset in `beforeEach` below so
 *  no test's own counter state leaks into another. */
function statefulPecSequenceMock() {
  const counters = new Map<string, number>();
  return jest.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const idTrasmittente = String(values[0]);
    const current = counters.get(idTrasmittente) ?? 1;
    counters.set(idTrasmittente, current + 1);
    return [{ value: current }];
  });
}

const CONNECTED_CONFIG = {
  providerId: SDI_PEC_PROVIDER_ID,
  channel: 'SDI-PEC',
  environment: 'TEST' as const,
  isActive: true,
  config: {
    pecAddress: 'fatture@rossi-srl.pec.it',
    smtpHost: 'smtps.pec-provider.it',
    smtpPort: 465,
    smtpSecure: true,
    username: 'fatture@rossi-srl.pec.it',
    password: 'super-secret',
    idTrasmittente: 'IT01234567890',
  },
};

function buildDeps(overrides?: { resolveActive?: jest.Mock; build?: jest.Mock; sendMail?: jest.Mock }) {
  const channelCredentials = {
    resolveActive: overrides?.resolveActive ?? jest.fn().mockResolvedValue(CONNECTED_CONFIG),
  } as unknown as ChannelCredentialsService;
  const fatturapaFormatProvider: DocumentFormatProvider = {
    id: 'fatturapa',
    syntax: 'FATTURAPA',
    mime: 'application/xml',
    build:
      overrides?.build ??
      jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<FatturaElettronica/>'),
        validation: { valid: true, errors: [] },
      }),
  };
  const mailService = {
    sendMail: overrides?.sendMail ?? jest.fn().mockResolvedValue({ message: 'ok' }),
  } as unknown as MailService;
  return { channelCredentials, fatturapaFormatProvider, mailService };
}

const CTX: DocumentTransportContext = {
  companyId: 'company-1',
  label: 'Invoice',
  document: {
    id: 'doc-1234567890',
    typeId: 'invoice',
    status: 'sending',
    data: { client: 'client-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
    displayNumber: 'FT-2026-0001',
  },
};

describe('buildSdiPecTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      name: 'Rossi SRL',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT12345678901' }],
    });
    mockedPrisma.client.findFirst.mockResolvedValue({
      id: 'client-1',
      name: 'Bianchi SpA',
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    });
    mockedPrisma.$queryRaw.mockImplementation(statefulPecSequenceMock());
  });

  describe('preflight()', () => {
    it('throws (named, no AdE accreditation claimed) when no channel is connected at all', async () => {
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null) });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/SdI-via-PEC channel is not connected/);
      await expect(transport.preflight!('company-1')).rejects.toThrow(/NO AdE accreditation/);
    });

    it('throws when connected but missing a required field (smtpHost)', async () => {
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { ...CONNECTED_CONFIG.config, smtpHost: undefined },
        }),
      });
      const transport = buildSdiPecTransport(deps);
      await expect(transport.preflight!('company-1')).rejects.toThrow(NotImplementedException);
    });

    it('resolves cleanly when fully connected', async () => {
      const deps = buildDeps();
      const transport = buildSdiPecTransport(deps);
      await expect(transport.preflight!('company-1')).resolves.toBeUndefined();
    });
  });

  describe('send() — a well-formed submission', () => {
    it(
      'builds the correct §2.2 filename, targets the published first-submission address (nothing ' +
        'learned yet), attaches the FatturaPA XML, and returns the filename as `reference`',
      async () => {
        const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
        const deps = buildDeps({ sendMail });
        const transport = buildSdiPecTransport(deps);

        const result = await transport.send(CTX);

        expect(result.reference).toMatch(/^IT01234567890_[A-Z0-9]{5}\.xml$/);
        expect(result.providerId).toBe(SDI_PEC_PROVIDER_ID);
        expect(result.message).toContain(result.reference!);
        expect(result.artifacts).toEqual([
          { role: 'fatturapa', mime: 'application/xml', bytes: Buffer.from('<FatturaElettronica/>') },
        ]);

        expect(sendMail).toHaveBeenCalledTimes(1);
        const [options, smtpOverrides] = sendMail.mock.calls[0];
        expect(options.to).toBe(SDI_PEC_FIRST_SUBMISSION_ADDRESS);
        expect(options.attachments).toEqual([
          expect.objectContaining({ filename: result.reference, contentType: 'application/xml' }),
        ]);
        expect(smtpOverrides).toEqual({
          host: 'smtps.pec-provider.it',
          port: 465,
          secure: true,
          username: 'fatture@rossi-srl.pec.it',
          password: 'super-secret',
          fromAddress: 'fatture@rossi-srl.pec.it',
        });
      },
    );

    // THE MUTATION TARGET (fix for a real collision risk, see `pec-protocol.ts`'s own header,
    // "Collision-free progressivo"): the filename USED TO be a pure hash of `documentId` alone — the
    // SAME document would always rebuild the exact SAME name, which meant a genuine resend after a lost
    // delivery confirmation could never pick a fresh name if SdI had, in fact, already accepted the
    // first one (Codice 00002 - Nome file duplicato, permanently unsendable). The progressivo now comes
    // from a persistent counter instead — two sends (even for the very same document) get two DIFFERENT
    // filenames, closing that failure mode; `transportRef`/reconciliation still work unchanged because
    // `pec-notifiche.service.ts` reconciles by whichever filename was ACTUALLY used, never one
    // precomputed ahead of a send (see this transport's own header).
    it('two sends for the SAME document build two DIFFERENT filenames — never a reused, potentially SdI-duplicate name', async () => {
      const deps1 = buildDeps();
      const deps2 = buildDeps();
      const result1 = await buildSdiPecTransport(deps1).send(CTX);
      const result2 = await buildSdiPecTransport(deps2).send(CTX);
      expect(result1.reference).not.toBe(result2.reference);
      expect(result1.reference).toMatch(/^IT01234567890_[A-Z0-9]{5}\.xml$/);
      expect(result2.reference).toMatch(/^IT01234567890_[A-Z0-9]{5}\.xml$/);
    });

    it(
      'targets the LEARNED reply address once one exists — never the fixed first-submission address ' +
        'again (the two-step addressing rule, pec-protocol.ts)',
      async () => {
        const sendMail = jest.fn().mockResolvedValue({ message: 'ok' });
        const deps = buildDeps({
          resolveActive: jest.fn().mockResolvedValue({
            ...CONNECTED_CONFIG,
            config: { ...CONNECTED_CONFIG.config, sdiReplyAddress: 'sdi07@pec.fatturapa.it' },
          }),
          sendMail,
        });
        const transport = buildSdiPecTransport(deps);

        await transport.send(CTX);

        expect(sendMail.mock.calls[0][0].to).toBe('sdi07@pec.fatturapa.it');
      },
    );
  });

  describe('send() — a MALFORMED attachment name is refused before anything is sent', () => {
    it('an idTrasmittente that cannot produce a valid §2.2 filename fails loudly, never silently sanitized', async () => {
      const sendMail = jest.fn();
      const deps = buildDeps({
        resolveActive: jest.fn().mockResolvedValue({
          ...CONNECTED_CONFIG,
          config: { ...CONNECTED_CONFIG.config, idTrasmittente: 'IT 0123 4567 890' },
        }),
        sendMail,
      });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/does not match/);
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe('send() — every other failure mode is loud, never silent', () => {
    it('blocks (never calls mailService) when the channel is not connected — re-checked, not cached from preflight', async () => {
      const sendMail = jest.fn();
      const deps = buildDeps({ resolveActive: jest.fn().mockResolvedValue(null), sendMail });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(NotImplementedException);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('refuses when the invoice has no valid client on file', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      const sendMail = jest.fn();
      const deps = buildDeps({ sendMail });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('never submits an artifact that failed XSD validation', async () => {
      const sendMail = jest.fn();
      const build = jest.fn().mockResolvedValue({
        bytes: new TextEncoder().encode('<invalid/>'),
        validation: { valid: false, errors: ['Data element missing'] },
      });
      const deps = buildDeps({ build, sendMail });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/failed XSD validation/);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it("refuses a FatturaPA payload over this transport's own conservative size safety margin", async () => {
      const sendMail = jest.fn();
      const oversized = new Uint8Array(30 * 1024 * 1024); // 30 MB raw — well past the safety margin
      const build = jest
        .fn()
        .mockResolvedValue({ bytes: oversized, validation: { valid: true, errors: [] } });
      const deps = buildDeps({ build, sendMail });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(BadRequestException);
      await expect(transport.send(CTX)).rejects.toThrow(/safety margin/);
      expect(sendMail).not.toHaveBeenCalled();
    });

    it('wraps a mail-transport rejection into a named BadRequestException — never swallowed', async () => {
      const sendMail = jest.fn().mockRejectedValue(new Error('SMTP 550 mailbox unavailable'));
      const deps = buildDeps({ sendMail });
      const transport = buildSdiPecTransport(deps);

      await expect(transport.send(CTX)).rejects.toThrow(/SdI PEC submission failed: SMTP 550/);
    });
  });
});
