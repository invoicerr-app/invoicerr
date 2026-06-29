/**
 * Email transmission unit tests.
 *
 * Two regression guards:
 *   1. EmailTransmissionProvider routes per-company SMTP overrides through InvoiceMailPort.
 *   2. MailService builds a per-call nodemailer transport from SmtpOverrides (not the global one).
 *
 * Neither test hits a real SMTP server — all transports are mocked.
 */

// ---------------------------------------------------------------------------
// Mock nodemailer BEFORE any imports that may pull it in transitively.
// ---------------------------------------------------------------------------
const mockSendMail = jest.fn().mockResolvedValue({ messageId: '<test@local>' });
const mockCreateTransport = jest.fn().mockReturnValue({ sendMail: mockSendMail });

jest.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

import { EmailTransmissionProvider } from '../providers';
import { TransmissionProviderRegistry } from '../registry';
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SignedArtifact } from '../../../execution/types';
import { TransactionContext } from '../../../canonical/canonical-document';
import { InvoiceMailPort, SmtpOverrides } from '../invoice-mail-port';
import { ChannelCredentialsPort, ResolvedChannelConfig } from '../channel-credentials-port';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMailMock(): jest.Mocked<InvoiceMailPort> {
  return { sendInvoiceEmail: jest.fn().mockResolvedValue({ sent: true }) };
}

function makeCtx(companyId = 'company-email-test'): TransactionContext {
  return {
    supplier: {
      legalName: 'Acme SAS',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'SIREN', value: '123456789', validated: true }],
    },
    buyer: {
      legalName: 'Client SARL',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'SIREN', value: '987654321', validated: true }],
    },
    lines: [{ id: 'l1', description: 'Service', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2026-07-01'),
    currency: 'EUR',
    supplierCompanyId: companyId,
    externalRef: 'INV-2026-001',
  } as TransactionContext;
}

const NO_ARTIFACTS: SignedArtifact[] = [];

function resolvedSmtpConfig(overrides: Partial<Record<string, unknown>> = {}): ResolvedChannelConfig {
  return {
    providerId: 'email',
    channel: 'EMAIL',
    environment: 'PROD',
    config: {
      host: 'smtp.company.com',
      port: 587,
      secure: false,
      username: 'user@company.com',
      password: 'super-secret-password',
      fromAddress: 'invoices@company.com',
      ...overrides,
    },
    isActive: true,
  };
}

function mockCredentials(resolved: ResolvedChannelConfig | null): ChannelCredentialsPort {
  return {
    resolve: jest.fn().mockResolvedValue(null),
    resolveActive: jest.fn().mockResolvedValue(resolved),
  };
}

// ---------------------------------------------------------------------------
// Section 1 — EmailTransmissionProvider: per-company SMTP path
// ---------------------------------------------------------------------------

describe('EmailTransmissionProvider — per-company SMTP overrides', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();
  });

  it('passes SmtpOverrides to sendInvoiceEmail when resolvedConfig has full SMTP fields', async () => {
    const mail = makeMailMock();
    const provider = new EmailTransmissionProvider(mail);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      NO_ARTIFACTS,
      makeCtx(),
      {} as any,
      'key-1',
      log,
      resolvedSmtpConfig(),
    );

    expect(result.status).toBe('SENT');
    expect(mail.sendInvoiceEmail).toHaveBeenCalledTimes(1);

    const [invoiceId, smtpOverrides] = mail.sendInvoiceEmail.mock.calls[0];
    expect(invoiceId).toBe('INV-2026-001');
    expect(smtpOverrides).toMatchObject<SmtpOverrides>({
      host: 'smtp.company.com',
      port: 587,
      secure: false,
      username: 'user@company.com',
      password: 'super-secret-password',
      fromAddress: 'invoices@company.com',
    });
  });

  it('calls sendInvoiceEmail WITHOUT smtpOverrides when no resolvedConfig (global fallback)', async () => {
    const mail = makeMailMock();
    const provider = new EmailTransmissionProvider(mail);
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(
      NO_ARTIFACTS,
      makeCtx(),
      {} as any,
      'key-2',
      log,
      undefined,
    );

    expect(result.status).toBe('SENT');
    expect(mail.sendInvoiceEmail).toHaveBeenCalledWith('INV-2026-001', undefined);
  });

  it('skips when InvoiceMailPort is not wired (returns stub SENT with notes)', async () => {
    const provider = new EmailTransmissionProvider(); // no mail port
    const log = new RecordingComplianceLogger();

    const result = await provider.transmit(NO_ARTIFACTS, makeCtx(), {} as any, 'key-3', log);

    expect(result.channel).toBe('EMAIL');
    // Stub path: SENT with a note
    expect(result.notes.some((n) => n.includes('stub'))).toBe(true);
  });

  it('returns SKIPPED when mail port returns skipped (client has no email)', async () => {
    const mail = makeMailMock();
    mail.sendInvoiceEmail.mockResolvedValueOnce({ sent: false, skipped: true, reason: 'no email on client' });
    const provider = new EmailTransmissionProvider(mail);

    const result = await provider.transmit(NO_ARTIFACTS, makeCtx(), {} as any, 'key-4', new RecordingComplianceLogger());

    expect(result.status).toBe('SKIPPED');
    expect(result.notes).toContain('no email on client');
  });

  it('does NOT include the password in log entries', async () => {
    const mail = makeMailMock();
    const provider = new EmailTransmissionProvider(mail);
    const log = new RecordingComplianceLogger();

    await provider.transmit(NO_ARTIFACTS, makeCtx(), {} as any, 'key-5', log, resolvedSmtpConfig());

    const allMessages = log.entries.map((e) => e.message).join('\n');
    expect(allMessages).not.toContain('super-secret-password');
  });

  it('optionalConfig is true so registry proceeds without per-company config', () => {
    const provider = new EmailTransmissionProvider();
    expect(provider.optionalConfig).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 2 — Registry integration: optionalConfig = true means no SKIP when
// credentials are absent.
// ---------------------------------------------------------------------------

describe('TransmissionProviderRegistry — email optionalConfig bypass', () => {
  it('does NOT skip email when no per-company config, calls transmit with resolvedConfig=undefined', async () => {
    const mail = makeMailMock();
    const credentials = mockCredentials(null); // no active config
    const reg = new TransmissionProviderRegistry({ mail, credentials });
    const log = new RecordingComplianceLogger();

    const results = await reg.transmitAll(
      NO_ARTIFACTS,
      makeCtx(),
      { channels: [{ type: 'EMAIL' }] } as any,
      'test-key',
      log,
    );

    expect(results).toHaveLength(1);
    // Registry called resolveActive (tried to find config)
    expect(credentials.resolveActive).toHaveBeenCalledWith('company-email-test', 'email');
    // Result is SENT (via InvoiceMailPort) — NOT 'not configured for company'
    expect(results[0].status).toBe('SENT');
    expect(results[0].notes.join(' ')).not.toMatch(/not configured for company/);
  });

  it('uses per-company SMTP when credentials are returned by resolveActive', async () => {
    const mail = makeMailMock();
    const credentials = mockCredentials(resolvedSmtpConfig());
    const reg = new TransmissionProviderRegistry({ mail, credentials });
    const log = new RecordingComplianceLogger();

    const results = await reg.transmitAll(
      NO_ARTIFACTS,
      makeCtx(),
      { channels: [{ type: 'EMAIL' }] } as any,
      'test-key',
      log,
    );

    expect(results[0].status).toBe('SENT');
    // sendInvoiceEmail was called WITH smtpOverrides
    const [, smtpOverrides] = mail.sendInvoiceEmail.mock.calls[0];
    expect(smtpOverrides).toBeDefined();
    expect((smtpOverrides as SmtpOverrides).host).toBe('smtp.company.com');
  });
});

// ---------------------------------------------------------------------------
// Section 3 — MailService: per-call nodemailer transport
// ---------------------------------------------------------------------------

describe('MailService — per-call SMTP transport from SmtpOverrides', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockCreateTransport.mockClear();
    // Set minimal global env so MailService constructor doesn't throw.
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.SMTP_HOST = 'global.smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'global@example.com';
    process.env.SMTP_PASSWORD = 'global-pass';
  });

  afterEach(() => {
    delete process.env.MAIL_PROVIDER;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
  });

  it('builds a per-call transport with per-company credentials', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MailService } = require('@/mail/mail.service');
    const svc = new MailService();

    const smtpOverrides: SmtpOverrides = {
      host: 'smtp.acme.com',
      port: 465,
      secure: true,
      username: 'invoices@acme.com',
      password: 'acme-secret',
      fromAddress: 'billing@acme.com',
    };

    await svc.sendMail(
      { to: 'buyer@client.com', subject: 'Invoice #001', html: '<p>Hello</p>' },
      smtpOverrides,
    );

    // createTransport was called with the per-company settings (not the global ones)
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.acme.com',
        port: 465,
        secure: true,
        auth: { user: 'invoices@acme.com', pass: 'acme-secret' },
      }),
    );

    // sendMail was called on the per-call transport
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'billing@acme.com',
        to: 'buyer@client.com',
        subject: 'Invoice #001',
      }),
    );
  });

  it('does NOT call createTransport for per-company when smtpOverrides is absent (uses global provider)', async () => {
    // Reset mock so we can count calls from this point
    mockCreateTransport.mockClear();
    mockSendMail.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MailService } = require('@/mail/mail.service');
    const svc = new MailService();

    // The SmtpMailProvider calls createTransport in its constructor (global path),
    // so we expect it to be called once (constructor) but NOT again for sendMail.
    const callCountAfterConstruct = mockCreateTransport.mock.calls.length;

    // Call sendMail WITHOUT smtpOverrides
    try {
      await svc.sendMail({ to: 'buyer@client.com', subject: 'Test', html: '<p>Test</p>' });
    } catch {
      // Network call expected to fail — we just verify createTransport was not called again.
    }

    // No extra createTransport call beyond the one from SmtpMailProvider's constructor
    expect(mockCreateTransport.mock.calls.length).toBe(callCountAfterConstruct);
  });
});
