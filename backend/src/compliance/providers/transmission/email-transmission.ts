import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';
import { ResolvedChannelConfig } from './channel-credentials-port';
import { InvoiceMailPort, SmtpOverrides } from './invoice-mail-port';
import { ChannelConfigSchema, ProviderMaturity, TransmissionProvider } from './transmission-provider';

/** Email — real send via InvoiceMailPort when wired, stub otherwise. */
export class EmailTransmissionProvider implements TransmissionProvider {
  readonly id = 'email';
  readonly channel: ChannelType = 'EMAIL';
  readonly feedback = 'NONE' as const;
  /** PROVEN — real SMTP send is exercised live (email-live.spec.ts). Only the never-wired
   * fallback branch below (no mail port injected) is a stub-safe path; the happy path is real. */
  readonly maturity: ProviderMaturity = 'PROVEN';
  /**
   * Per-company SMTP is optional: when no active config is found, fall back to the global
   * MAIL_PROVIDER (SMTP_* env). The registry must NOT skip this channel for missing config.
   */
  readonly optionalConfig = true;
  readonly configSchema: ChannelConfigSchema = {
    fields: [
      { type: 'text', name: 'host', label: 'SMTP host', placeholder: 'smtp.example.com', required: true },
      { type: 'number', name: 'port', label: 'SMTP port', placeholder: '587', required: true, default: 587 },
      { type: 'switch', name: 'secure', label: 'Use TLS (implicit, port 465)', default: false },
      {
        type: 'text',
        name: 'username',
        label: 'SMTP username',
        placeholder: 'apikey / user@example.com',
        required: true,
      },
      { type: 'text', name: 'password', label: 'SMTP password', required: true, secret: true },
      {
        type: 'text',
        name: 'fromAddress',
        label: 'From address',
        placeholder: 'invoices@company.com',
        required: true,
      },
    ],
  };

  constructor(private readonly mail?: InvoiceMailPort) {}

  async transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    _plan: CompliancePlan,
    key: string,
    log: ComplianceLogger,
    resolvedConfig?: ResolvedChannelConfig,
  ): Promise<TransmissionResult> {
    // Build per-company SMTP overrides when a config is present and complete.
    let smtpOverrides: SmtpOverrides | undefined;
    if (resolvedConfig?.config?.host && resolvedConfig.config.username && resolvedConfig.config.password) {
      const c = resolvedConfig.config;
      smtpOverrides = {
        host: c.host as string,
        port: typeof c.port === 'number' ? c.port : parseInt(String(c.port ?? '587'), 10),
        secure: Boolean(c.secure),
        username: c.username as string,
        password: c.password as string,
        fromAddress: (c.fromAddress as string) ?? (c.username as string),
      };
      log.info('transmission/email', `using per-company SMTP (host: ${smtpOverrides.host}) (key ${key})`);
    }

    if (this.mail && ctx.externalRef) {
      const r = await this.mail.sendInvoiceEmail(ctx.externalRef, smtpOverrides);
      return {
        channel: 'EMAIL',
        status: r.skipped ? 'SKIPPED' : 'SENT',
        notes: r.skipped ? [r.reason ?? 'no email'] : [],
      };
    }
    // M-18: no InvoiceMailPort wired (e.g. a bare `new TransmissionProviderRegistry()` such as
    // the one used by PollScheduler tests) — nothing was actually sent. A stub-safe path must
    // never claim SENT; SKIPPED is the honest terminal status (never attempted, not refused).
    log.warn(
      'transmission/email',
      `no mail port wired — cannot send ${artifacts.length} artifact(s) to ${ctx.buyer.legalName} (key ${key})`,
    );
    return {
      channel: 'EMAIL',
      status: 'SKIPPED',
      notes: ['no mail port wired — configure MailService before this channel can deliver'],
    };
  }
}
