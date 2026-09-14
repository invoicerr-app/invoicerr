/**
 * A company's own mail-server override — TODO_FEATURES.md entry G ("Serveur de mail — instance puis
 * société"). Stored in the EXISTING `CompanyChannelConfig` table (encrypted at rest, the same
 * `CREDENTIALS_ENCRYPTION_KEY`/`ChannelCredentialsService` mechanism every national transport already
 * uses — see that model's own schema.prisma comment: "A method whose FUTURE field genuinely IS a
 * credential ... belongs in `CompanyChannelConfig`") rather than a new table — a company has at most
 * ONE mail server of its own, exactly the "one active config per (company, providerId)" shape that
 * table already enforces, so no migration is needed. `providerId` is `'mail'` (channel `'MAIL'`),
 * always written/read under the fixed `environment: 'PROD'` (`company-mail-settings.service.ts`'s own
 * header explains why a mail server has no sandbox/production split to key on, unlike PDP/KSeF/SdI).
 */
export interface CompanyMailSmtpSettings {
  kind: 'smtp';
  host: string;
  port: number;
  secure: boolean;
  /** SMTP AUTH username. */
  username: string;
  /** SMTP AUTH password — NEVER logged; encrypted at rest via `CompanyChannelConfig.config`. */
  password: string;
  /** Envelope From address. */
  fromAddress: string;
}

export interface CompanyMailResendSettings {
  kind: 'resend';
  /** Resend API key — NEVER logged; encrypted at rest, same as `password` above. */
  apiKey: string;
  fromAddress: string;
}

export type CompanyMailSettings = CompanyMailSmtpSettings | CompanyMailResendSettings;

/** Runtime guard for a decrypted `CompanyChannelConfig.config` blob — a corrupted or hand-edited row
 *  must be treated as "not configured", never crash the send path (the same posture
 *  `ChannelCredentialsService#decryptRow` already holds for a bad ciphertext). */
export function isCompanyMailSettings(value: unknown): value is CompanyMailSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (v.kind === 'smtp') {
    return (
      typeof v.host === 'string' &&
      typeof v.port === 'number' &&
      typeof v.secure === 'boolean' &&
      typeof v.username === 'string' &&
      typeof v.password === 'string' &&
      typeof v.fromAddress === 'string'
    );
  }
  if (v.kind === 'resend') {
    return typeof v.apiKey === 'string' && typeof v.fromAddress === 'string';
  }
  return false;
}

/** What `GET /api/company/mail-settings` returns — status ONLY, never a secret (same discipline as
 *  `ChannelConfigStatus` in `channels.service.ts`). */
export interface CompanyMailSettingsStatus {
  configured: boolean;
  kind?: 'smtp' | 'resend';
  fromAddress?: string;
}
