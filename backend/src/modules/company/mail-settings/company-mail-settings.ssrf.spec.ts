/**
 * A company's own mail server is two free-text fields, `host` and `port`, that this backend then
 * dials from inside its own network. This file is the proof that neither half of that is usable as a
 * reconnaissance tool: WHERE the connection may go (`mail-endpoint-guard.ts` delegating to the shared
 * SSRF guard in `@/utils/outbound-url.ts`), and WHAT the caller is told about the attempt.
 *
 * Every test here fails against the code as it stood before that guard existed — the settings route
 * stored any host at all, and `sendForCompany` handed the raw nodemailer error back to the caller, so
 * a closed port, a filtered address and an open port that does not speak SMTP each produced their own
 * distinguishable answer with the host and port echoed inside it.
 *
 * Hermetic on purpose: `node:dns` is mocked, so "this public name resolves somewhere internal" is a
 * real decision made on a real resolver answer without this suite ever depending on the network it
 * runs on. `nodemailer` is mocked the same wholesale way `mail.service.spec.ts` does (see its own
 * comment on why `vi.spyOn` cannot work on that frozen ESM namespace).
 */

import { vi, type Mock } from 'vitest';

process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { BadRequestException } from '@nestjs/common';

import * as dns from 'node:dns';
import * as nodemailer from 'nodemailer';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));
// `outbound-url.ts` imports `node:dns` as a namespace (`import * as dns`, not a default import — see
// that file's own comment on why), so the mock must match that shape exactly.
vi.mock('node:dns', () => ({ promises: { lookup: vi.fn() } }));
vi.mock('@/logger/logger.service', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('./company-mail-settings.resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./company-mail-settings.resolver')>();
  return { ...actual, resolveCompanyMailSettings: vi.fn() };
});
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    companyChannelConfig: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import prisma from '@/prisma/prisma.service';
import {
  SMTP_AUTHENTICATION_FAILED_MESSAGE,
  SMTP_CONNECTION_FAILED_MESSAGE,
  SMTP_ENDPOINT_REFUSED_MESSAGE,
} from '@/mail/mail-endpoint-guard';
import { MailService } from '@/mail/mail.service';

import { ChannelCredentialsService } from '../channels/channels.service';
import { CompanyMailSettingsService } from './company-mail-settings.service';
import { resolveCompanyMailSettings } from './company-mail-settings.resolver';

const lookup = dns.promises.lookup as unknown as Mock;
const createTransport = nodemailer.createTransport as unknown as Mock;
const mockedResolveCompanyMailSettings = resolveCompanyMailSettings as Mock;
const mockedPrisma = prisma as unknown as { companyChannelConfig: { upsert: Mock; updateMany: Mock } };

/** Credentials are irrelevant to every assertion in this file — the endpoint is the subject — so one
 *  obviously-fake pair is reused everywhere rather than inventing a plausible-looking secret per
 *  test. */
const SMTP_AUTH = { username: 'mailer', password: 'x' } as const;

function smtpSettings(host: string, port = 587) {
  return {
    kind: 'smtp' as const,
    host,
    port,
    secure: false,
    ...SMTP_AUTH,
    fromAddress: 'billing@company.example.com',
  };
}

/** A nodemailer failure as it actually arrives: an `Error` carrying the `code` nodemailer tags it
 *  with, and the host/port baked into the message the way `connect ECONNREFUSED 127.0.0.1:9` does. */
function nodemailerError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('company mail settings — the SMTP endpoint is not a probe of this server network', () => {
  let mailService: MailService;
  let settingsService: CompanyMailSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Isolated from whatever the real shell exports: the hatch must be OFF (it is on in `.env.test`,
    // for the e2e stack's own Mailpit on localhost), and the instance provider selected here must be
    // deterministic rather than whatever key happens to be in the ambient environment.
    delete process.env.ALLOW_PRIVATE_OUTBOUND_URLS;
    delete process.env.MAIL_PROVIDER;
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = 'instance-relay.example.com';
    mailService = new MailService();
    settingsService = new CompanyMailSettingsService(new ChannelCredentialsService(), mailService);
    // `SmtpMailProvider`'s own constructor built the instance-level transport just above; the calls
    // this file asserts on are the per-company ones only.
    createTransport.mockReset();
    mockedPrisma.companyChannelConfig.updateMany.mockResolvedValue({ count: 0 });
    mockedPrisma.companyChannelConfig.upsert.mockImplementation(async ({ create }) => ({
      id: 'row-1',
      ...create,
    }));
  });

  describe('where it may connect', () => {
    // One case per range that actually matters on a cluster: the loopback a co-located service
    // listens on, the RFC1918 space a managed database and an object store sit in, and the link-local
    // address every major cloud serves instance metadata (and its credentials) from.
    it.each([
      ['loopback', '127.0.0.1', 9],
      ['RFC1918', '10.255.255.1', 80],
      ['cloud instance metadata', '169.254.169.254', 80],
      ['IPv6 loopback', '::1', 25],
      ['IPv6 unique-local', 'fd00::1', 25],
      ['a legacy integer spelling of loopback', '2130706433', 6379],
      ['the name "localhost"', 'localhost', 5433],
    ])('refuses %s at write time, before any socket exists', async (_label, host, port) => {
      await expect(settingsService.set('company-1', smtpSettings(host, port))).rejects.toThrow(
        BadRequestException,
      );
      expect(mockedPrisma.companyChannelConfig.upsert).not.toHaveBeenCalled();
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('refuses a PUBLIC name that resolves to a private address — the literal string is not the target', async () => {
      // The whole point of resolving rather than pattern-matching the host: this name looks like any
      // other customer mail server, and a resolver the attacker controls answers with an internal one.
      lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

      await expect(settingsService.set('company-1', smtpSettings('mail.attacker.example'))).rejects.toThrow(
        SMTP_ENDPOINT_REFUSED_MESSAGE,
      );
      expect(lookup).toHaveBeenCalledWith('mail.attacker.example', { all: true });
      expect(mockedPrisma.companyChannelConfig.upsert).not.toHaveBeenCalled();
    });

    it('refuses a name whose SECOND answer is private — one public record does not vouch for the rest', async () => {
      lookup.mockResolvedValue([
        { address: '203.0.113.10', family: 4 },
        { address: '::1', family: 6 },
      ]);

      await expect(settingsService.set('company-1', smtpSettings('mail.attacker.example'))).rejects.toThrow(
        SMTP_ENDPOINT_REFUSED_MESSAGE,
      );
    });

    it('refuses the same address at SEND time too, even on a row already stored', async () => {
      // Write-time validation is a courtesy; this is the check that governs. A row can predate the
      // guard, be written by another process, or name a host that was public when it was stored.
      mockedResolveCompanyMailSettings.mockResolvedValue(smtpSettings('169.254.169.254', 80));

      await expect(
        mailService.sendForCompany('company-1', { to: 'me@example.com', subject: 'Test' }),
      ).rejects.toThrow(SMTP_ENDPOINT_REFUSED_MESSAGE);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it('connects to the address it VALIDATED, not to the name — no second resolution to rebind', async () => {
      const sendMail = vi.fn().mockResolvedValue(undefined);
      createTransport.mockReturnValue({ sendMail } as never);
      lookup.mockResolvedValue([{ address: '203.0.113.25', family: 4 }]);
      mockedResolveCompanyMailSettings.mockResolvedValue(smtpSettings('smtp.customer.example'));

      await mailService.sendForCompany('company-1', { to: 'me@example.com', subject: 'Test' });

      // The validated IP is what gets dialed; the name survives only as the TLS server name, so a
      // certificate on the legitimate target still matches.
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: '203.0.113.25', servername: 'smtp.customer.example' }),
      );
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it('accepts a genuinely public mail server — the guard refuses internals, not customers', async () => {
      lookup.mockResolvedValue([{ address: '203.0.113.25', family: 4 }]);
      mockedResolveCompanyMailSettings.mockResolvedValue(smtpSettings('smtp.customer.example'));

      await expect(
        settingsService.set('company-1', smtpSettings('smtp.customer.example')),
      ).resolves.toMatchObject({ configured: true, kind: 'smtp' });
      expect(mockedPrisma.companyChannelConfig.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('what it says back', () => {
    /** Drives one real send against a stored public SMTP server whose transport then fails the given
     *  way, and hands back the message the CALLER ends up with. */
    async function messageForTransportFailure(error: Error): Promise<string> {
      vi.clearAllMocks();
      lookup.mockResolvedValue([{ address: '203.0.113.25', family: 4 }]);
      mockedResolveCompanyMailSettings.mockResolvedValue(smtpSettings('smtp.customer.example', 587));
      createTransport.mockReturnValue({ sendMail: vi.fn().mockRejectedValue(error) } as never);

      return await settingsService
        .sendTest('company-1', 'owner@company.example.com')
        .then(() => '<the send unexpectedly succeeded>')
        .catch((thrown: Error) => thrown.message);
    }

    it('reports nothing that separates "nothing listening" from "something listening but not SMTP"', async () => {
      // The three outcomes a real stack produces, and that used to be three distinguishable answers:
      // a closed port, a filtered address, and an open port belonging to something that is not a mail
      // server (it answered the TCP handshake and then never spoke SMTP).
      const closedPort = await messageForTransportFailure(
        nodemailerError('connect ECONNREFUSED 203.0.113.25:587', 'ECONNECTION'),
      );
      const filtered = await messageForTransportFailure(
        nodemailerError('connect EHOSTUNREACH 203.0.113.25:587', 'ESOCKET'),
      );
      const openButSilent = await messageForTransportFailure(
        nodemailerError('Greeting never received', 'ETIMEDOUT'),
      );

      expect(closedPort).toBe(SMTP_CONNECTION_FAILED_MESSAGE);
      expect(filtered).toBe(SMTP_CONNECTION_FAILED_MESSAGE);
      expect(openButSilent).toBe(SMTP_CONNECTION_FAILED_MESSAGE);
    });

    it('never echoes the host, the port or the errno back to the caller', async () => {
      const message = await messageForTransportFailure(
        nodemailerError('connect ECONNREFUSED 203.0.113.25:587', 'ECONNECTION'),
      );

      for (const leak of ['203.0.113.25', '587', 'ECONNREFUSED', 'EHOSTUNREACH', 'Greeting']) {
        expect(message).not.toContain(leak);
      }
    });

    it('DOES report an authentication failure — it is safe, and it is what a customer needs', async () => {
      // Reaching an AUTH exchange at all proves a real mail server answered, so this distinction
      // describes the credentials, never the network. Without it the guard would be useless: a
      // mistyped password would read exactly like an unreachable server.
      const message = await messageForTransportFailure(
        nodemailerError('Invalid login: 535 5.7.8 Authentication credentials invalid', 'EAUTH'),
      );

      expect(message).toBe(SMTP_AUTHENTICATION_FAILED_MESSAGE);
      expect(message).not.toBe(SMTP_CONNECTION_FAILED_MESSAGE);
      // Not even the server's own rejection banner — that is the one part of an AUTH exchange that
      // can describe the host rather than the credentials.
      expect(message).not.toContain('535');
    });
  });
});
