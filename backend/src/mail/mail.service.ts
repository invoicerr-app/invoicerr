import * as nodemailer from 'nodemailer';

import { IMailProvider, MailOptions, SmtpOverrides } from '@/mail/types';

import { BadRequestException, Injectable } from '@nestjs/common';
import { ResendMailProvider } from '@/mail/providers/resend.provider';
import { SmtpMailProvider } from '@/mail/providers/smtp.provider';
import { logger } from '@/logger/logger.service';
import { sanitizeEmailHtml } from '@/mail/sanitize-email-html';
import { toTransportAttachments } from '@/mail/attachments';
import { resolveCompanyMailSettings } from '@/modules/company/mail-settings/company-mail-settings.resolver';

export type { MailOptions, MailAttachment, SmtpOverrides } from '@/mail/types';

export type InstanceMailProviderId = 'smtp' | 'resend';

/** Thrown by `resolveInstanceMailProviderId` when `MAIL_PROVIDER=brevo` is set. Brevo was removed as
 *  a dedicated provider (product decision, 2026-09-15) — an existing deployment pinning this value
 *  must fail loudly at boot rather than silently fall back to some other provider, since that would
 *  be the exact "quiet catalogue swap" failure mode this codebase's own boot-reseed services already
 *  guard against elsewhere. Brevo remains usable through its own SMTP relay
 *  (`smtp-relay.brevo.com`) via the plain `smtp` provider — nothing about sending through Brevo
 *  itself was removed, only the dedicated HTTP-API integration. */
const BREVO_REMOVED_MESSAGE =
  "MAIL_PROVIDER=brevo is no longer supported; use smtp (Brevo's SMTP relay works) or resend";

/**
 * Instance-level provider SELECTION — the instance-level step of the mail-server cascade ("Mail
 * server — instance then company"): it can be either SMTP or Resend (Resend takes priority if both
 * are set).
 * `MAIL_PROVIDER`, when set explicitly, is always authoritative (backward-compatible: an existing
 * `MAIL_PROVIDER=smtp` deployment keeps selecting smtp regardless of a stray `RESEND_API_KEY` in its
 * environment — a deliberate choice, since an operator who pinned a value did so on purpose and a
 * newly-added var should not silently override it). Only when `MAIL_PROVIDER` is UNSET does this
 * auto-detect, and that is where "Resend wins if both are present" actually applies.
 *
 * Resolution table:
 *
 * | MAIL_PROVIDER | RESEND_API_KEY | SMTP_HOST | Selected                                          |
 * |---------------|-----------------|-----------|---------------------------------------------------|
 * | (unset)       | absent          | absent    | smtp  — "nothing" (falls through to the historical |
 * |               |                 |           | default; SmtpMailProvider's own construction warns |
 * |               |                 |           | below since nothing was actually configured)       |
 * | (unset)       | absent          | present   | smtp  — "SMTP only"                                |
 * | (unset)       | present         | absent    | resend — "Resend only"                             |
 * | (unset)       | present         | present   | resend — "both" (Resend wins per this cascade's    |
 * |               |                 |           | own rule; SMTP is not used as a runtime fallback if |
 * |               |                 |           | Resend fails — deliberately left open, not          |
 * |               |                 |           | implemented here)                                   |
 * | 'smtp'        | *               | *         | smtp   — explicit request, always honored          |
 * | 'brevo'       | *               | *         | throws — removed (see BREVO_REMOVED_MESSAGE above); |
 * |               |                 |           | Brevo's own SMTP relay still works via 'smtp'       |
 * | 'resend'      | *               | *         | resend — explicit request; throws at construction  |
 * |               |                 |           | if RESEND_API_KEY is absent (same posture below)   |
 */
export function resolveInstanceMailProviderId(env: NodeJS.ProcessEnv = process.env): InstanceMailProviderId {
  const explicit = env.MAIL_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (explicit === 'brevo') throw new Error(BREVO_REMOVED_MESSAGE);
    if (explicit === 'smtp' || explicit === 'resend') return explicit;
    throw new Error(`Unknown MAIL_PROVIDER "${explicit}". Supported values: "smtp", "resend".`);
  }
  if (env.RESEND_API_KEY?.trim()) return 'resend';
  return 'smtp';
}

/** Whether THIS instance has anything actually usable to fall back to — used by `sendForCompany`
 *  below to refuse NAMED, before any network attempt, rather than let an unconfigured "smtp" default
 *  fail opaquely against 127.0.0.1 (Node's own resolution for an empty host). */
export function isInstanceMailProviderConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim()) || Boolean(env.SMTP_HOST?.trim());
}

/** Thrown by `sendForCompany` when NEITHER this company NOR this instance has a mail server
 *  configured — the "company → instance → named refusal" cascade's own last step. Exported so
 *  callers/tests can assert on it without string-matching. */
export const NO_MAIL_SERVER_CONFIGURED_MESSAGE =
  'No mail server is configured: this company has none set in Settings → Mail, and this instance ' +
  'has neither RESEND_API_KEY nor SMTP_HOST configured either. Configure one before sending.';

/**
 * Filters `options.html` through `sanitizeEmailHtml`'s allow-list right before it reaches a real
 * transport. `sanitizeEmailHtml` otherwise only runs on the WRITE path for a company's OWN stored
 * template (see its own header) — it never sees a value some caller built at SEND time by
 * interpolating untrusted text straight into an html string (a legal document's front-matter title in
 * `mail/system-email-templates.ts`, for instance). Escaping that value instead was rejected: `html`
 * is genuinely meant to carry markup — every shipped template is real HTML — so turning `<`/`>` into
 * entities here would mangle every legitimate send, not just a hostile one. Filtering here, at every
 * one of this service's own dispatch points, is what actually closes the gap: a send path can never
 * forget a filter that runs on its own way out, unlike one each template builder would have to
 * remember to apply itself.
 *
 * Builds the returned object property-by-property — never a `{ ...options }` spread — so `html`
 * only ever exists in the result as the sanitized value: there is no intermediate state where the
 * raw string sits on the object waiting to be overwritten, which is what a spread-then-assign would
 * produce (and what a flow analyzer can't always tell apart from a spread whose overwrite got lost
 * or reordered later). Every other `MailOptions` field is copied through unchanged from `options`.
 */
function sanitizedMailOptions(options: MailOptions): MailOptions {
  return {
    to: options.to,
    from: options.from,
    subject: options.subject,
    text: options.text,
    html: options.html === undefined ? undefined : sanitizeEmailHtml(options.html),
    attachments: options.attachments,
  };
}

@Injectable()
export class MailService {
  private readonly provider: IMailProvider;

  constructor() {
    const selected = resolveInstanceMailProviderId();
    switch (selected) {
      case 'resend':
        this.provider = new ResendMailProvider();
        break;
      case 'smtp':
        this.provider = new SmtpMailProvider();
        // An empty SMTP_HOST is NOT a construction-time failure: nodemailer builds the transport
        // regardless (see providers/smtp.provider.ts) and only fails once sendMail() actually tries
        // to connect — Node resolves an empty host to 127.0.0.1, so that failure is a plain
        // ECONNREFUSED, indistinguishable from "a real SMTP server that happens to be down" to
        // anyone not already reading logs. Without this line, a deployment that never sets
        // SMTP_HOST boots clean, answers 200 on every route, and only reveals the gap the first time
        // someone sends a document and either watches the response or goes looking for why a client
        // never got their invoice — the exact silent-failure shape this warning exists to close.
        //
        // This only fires when "smtp" is what got SELECTED (see resolveInstanceMailProviderId's own
        // resolution table) — the "rien" row, where auto-detect falls through to this branch with an
        // empty SMTP_HOST, is exactly the case the mail-server cascade's own "avertissement sinon"
        // describes; a deployment with a working RESEND_API_KEY or a real SMTP_HOST never reaches this
        // branch at all, so it never sees it.
        if (!process.env.SMTP_HOST?.trim()) {
          logger.warn(
            'MAIL_PROVIDER is "smtp" but SMTP_HOST is empty — every outgoing email will fail until it is set.',
            { category: 'mail' },
          );
        }
        break;
    }
  }

  /** Builds and uses a one-shot nodemailer transport from decrypted SMTP credentials — shared by the
   *  per-call `smtpOverrides` path below and by `sendForCompany`'s own company-SMTP branch. Never
   *  logs `overrides.password`. */
  private async deliverViaSmtp(options: MailOptions, overrides: SmtpOverrides): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: overrides.host,
      port: overrides.port,
      secure: overrides.secure,
      auth: {
        user: overrides.username,
        pass: overrides.password,
      },
    });
    const safe = sanitizedMailOptions(options);
    await transporter.sendMail({
      from: overrides.fromAddress,
      to: safe.to,
      subject: safe.subject,
      text: safe.text,
      html: safe.html,
      attachments: toTransportAttachments(safe.attachments),
    });
  }

  async sendMail(options: MailOptions, smtpOverrides?: SmtpOverrides) {
    // Per-company SMTP: build a one-shot transport from the decrypted company config.
    // The password is intentionally excluded from all log calls below.
    if (smtpOverrides) {
      try {
        await this.deliverViaSmtp(options, smtpOverrides);
      } catch (error) {
        // Log host+user only — never the password.
        logger.error('Failed to send email via per-company SMTP.', {
          category: 'mail',
          details: { host: smtpOverrides.host, user: smtpOverrides.username, error },
        });
        throw new Error(
          'Failed to send email via per-company SMTP. Check the channel credentials configuration.',
        );
      }
      return { message: 'Email sent successfully' };
    }

    // Global provider path (SMTP_* env vars / Resend).
    try {
      await this.provider.sendMail(sanitizedMailOptions(options));
    } catch (error) {
      logger.error('Failed to send email. Please check your mail provider configuration.', {
        category: 'mail',
        details: { provider: this.provider.id, error },
      });
      throw new Error('Failed to send email. Please check your mail provider configuration.');
    }

    return { message: 'Email sent successfully' };
  }

  /**
   * The "company → instance → named refusal" cascade: sends AS this company, using — in order — (1)
   * this company's OWN mail server (Settings → Mail, SMTP or Resend,
   * `modules/company/mail-settings/`), (2) this INSTANCE's own provider (`this.provider`, selected
   * once at construction — see `resolveInstanceMailProviderId`'s own resolution table), or (3) a
   * NAMED refusal, thrown before any network attempt, when neither level has anything configured —
   * a send must never look like it worked and then silently vanish into an unconfigured transport.
   *
   * Deliberately does NOT rewrap failures into a generic message the way `sendMail` above does:
   * `CompanyMailSettingsService#sendTest` exists specifically to show a company admin the REAL
   * provider error (a bad SMTP password, an invalid Resend key, ECONNREFUSED, ...) while they are
   * configuring this — a generic "check your configuration" string would defeat the entire point of a
   * "test send" button. Every OTHER caller decides for itself, at its own call site, whether to let
   * that real error propagate (documents: `actions/send-document-email.ts`, `reminders/
   * reminder-sweep-runner.ts` — both already tolerate a `sendMail` failure exactly the same way, so
   * the extra detail is free) or to catch it and rewrap it into something narrower for an untrusted
   * caller (`signatures.service.ts#sendTemplatedMail`, `danger.service.ts#requestOtp` — both rethrow
   * the named "no mail server configured" refusal verbatim but collapse any OTHER provider error into
   * a generic message, since their own callers are a public signature page / an OWNER confirming a
   * destructive action, not someone configuring the mail server itself).
   *
   * NOW CONSUMED by every real send in this codebase — see `git log -- mail/mail.service.ts` around
   * the commit that wired this in (this comment used to say "not yet consumed" and named
   * `email-transport.ts` as the one caller left to wire; that caller, and every sibling one
   * (reminders, signature requests, OTP codes, client-portal invites), all go through this method now.
   * The one deliberate holdout is `transports/sdi-pec-transport.ts`: it calls `sendMail` directly with
   * its own `SmtpOverrides` (the company's dedicated PEC mailbox, resolved through
   * `ChannelCredentialsService` under the `'sdi-pec'` provider id, never through `'mail'`/
   * `resolveCompanyMailSettings`) — a PEC mailbox is a certified, protocol-mandated inbox for SdI
   * traffic specifically, not a general outgoing mail server a company might also want its invoices or
   * OTPs to go through, so it is never a candidate for this cascade's company-level branch.
   */
  async sendForCompany(companyId: string, options: MailOptions): Promise<{ message: string }> {
    const companySettings = await resolveCompanyMailSettings(companyId);

    if (companySettings?.kind === 'smtp') {
      await this.deliverViaSmtp(options, {
        host: companySettings.host,
        port: companySettings.port,
        secure: companySettings.secure,
        username: companySettings.username,
        password: companySettings.password,
        fromAddress: companySettings.fromAddress,
      });
      return { message: 'Email sent successfully' };
    }

    if (companySettings?.kind === 'resend') {
      const provider = new ResendMailProvider({
        apiKey: companySettings.apiKey,
        defaultFrom: companySettings.fromAddress,
      });
      await provider.sendMail(sanitizedMailOptions(options));
      return { message: 'Email sent successfully' };
    }

    // No company-level override: fall back to the instance provider — but refuse NAMED if this
    // instance has nothing configured either, rather than let the "smtp" default attempt (and fail
    // opaquely against 127.0.0.1) a connection nobody ever actually set up.
    if (!isInstanceMailProviderConfigured()) {
      throw new BadRequestException(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    }

    await this.provider.sendMail(sanitizedMailOptions(options));
    return { message: 'Email sent successfully' };
  }
}
