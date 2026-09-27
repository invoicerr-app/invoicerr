import * as nodemailer from 'nodemailer';

import { IMailProvider, MailOptions, SmtpOverrides } from '@/mail/types';

import { BadRequestException, Injectable } from '@nestjs/common';
import { ResendMailProvider } from '@/mail/providers/resend.provider';
import { SmtpMailProvider } from '@/mail/providers/smtp.provider';
import { logger } from '@/logger/logger.service';
import {
  INSTANCE_MAIL_FAILED_MESSAGE,
  MailDeliveryError,
  assertTenantSmtpEndpoint,
  describeSmtpFailure,
} from '@/mail/mail-endpoint-guard';
import { isValidEmailAddress } from '@/mail/is-valid-email';
import { sanitizeEmailHtml } from '@/mail/sanitize-email-html';
import { toTransportAttachments } from '@/mail/attachments';
import {
  resolveCompanyMailSettings,
  resolveCompanyReplyTo,
} from '@/modules/company/mail-settings/company-mail-settings.resolver';

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

/** The instance-level step of the Reply-To cascade — trimmed, and only returned when it actually
 *  looks like an e-mail address: an operator-set `MAIL_REPLY_TO` is never validated at "save" time
 *  (there is no save, it is an env var read at boot — see the constructor's own warning below), so a
 *  typo here degrades to "no Reply-To header" rather than shipping a broken one on every send. */
function resolveInstanceReplyTo(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.MAIL_REPLY_TO?.trim();
  return value && isValidEmailAddress(value) ? value : undefined;
}

/**
 * The Reply-To cascade, resolved ONCE, centrally: an explicit value already on `options` (no caller
 * sets one today, but the contract stays open for one that might — a signature request replying to
 * the requester, say) wins outright; otherwise the COMPANY's own override
 * (`Company.mailReplyTo`, validated at write time by
 * `company-mail-settings.service.ts#setReplyTo` — see that column's own schema.prisma comment) wins
 * over the INSTANCE's own `MAIL_REPLY_TO`; with neither set, `undefined` — no Reply-To header goes
 * out at all, today's behaviour, unchanged. Every transport below (the company's own SMTP/Resend, the
 * instance's, the one-shot transport `deliverViaSmtp` builds) just forwards whatever ends up on
 * `options.replyTo` after this runs — see `sanitizedMailOptions`, and each provider's own `sendMail`.
 */
function resolveEffectiveReplyTo(
  explicit: string | undefined,
  companyReplyTo: string | null | undefined,
): string | undefined {
  if (explicit) return explicit;
  if (companyReplyTo) return companyReplyTo;
  return resolveInstanceReplyTo();
}

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
    replyTo: options.replyTo,
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
    // Validated HERE, once at boot, purely as a diagnostic — an env var has no "save" step to refuse
    // a bad value at, unlike a company's own `replyTo` (`company-mail-settings.service.ts#setReplyTo`,
    // which DOES throw). `resolveInstanceReplyTo` already degrades a typo'd value to "no Reply-To"
    // on every send regardless of this warning; this is what tells an operator WHY.
    const configuredReplyTo = process.env.MAIL_REPLY_TO?.trim();
    if (configuredReplyTo && !isValidEmailAddress(configuredReplyTo)) {
      logger.warn(
        `MAIL_REPLY_TO is set to "${configuredReplyTo}", which is not a valid e-mail address — it ` +
          'will be ignored on every send.',
        { category: 'mail' },
      );
    }

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

  /**
   * Builds and uses a one-shot nodemailer transport from decrypted SMTP credentials — shared by the
   * per-call `smtpOverrides` path below and by `sendForCompany`'s own company-SMTP branch. Never logs
   * `overrides.password`.
   *
   * THE single point in this codebase where a TENANT-supplied host and port become a real socket
   * (`Settings → Mail` for a company's own server, the SdI PEC mailbox for `sdi-pec-transport.ts`),
   * which is why both halves of the guard live here rather than on one route: a route-level check
   * would leave every other caller of this method — document sends, reminders, signature requests,
   * OTP mails, client-portal invites, the PEC transport — dialing whatever it was handed.
   *
   * The instance-level provider (`this.provider`, `SMTP_*` env vars) deliberately does NOT go through
   * this: an operator running a relay on `10.0.0.5` is configuring their own server, not probing it.
   */
  private async deliverViaSmtp(options: MailOptions, overrides: SmtpOverrides): Promise<void> {
    const resolved = await assertTenantSmtpEndpoint(overrides.host, overrides.port);

    // Connect to the address the guard just validated, never to the name again: nodemailer does its
    // OWN `dns.resolve` (with a process-wide cache and a fallback-address retry list) the moment it
    // connects, which a short-TTL record can answer differently by then — the rebinding window
    // `ResolvedOutboundUrl` exists to close. Handing it an IP literal short-circuits that resolution
    // entirely (`shared.resolveHostname`'s own `net.isIP` branch), so there is no second lookup and
    // no fallback list. `servername` carries the ORIGINAL hostname so SNI and certificate validation
    // still match the server the tenant actually named — and is omitted when that name IS an IP
    // literal, since an IP is not a legal SNI value.
    const pinnedHost = resolved ? resolved.address : overrides.host;
    const servername = resolved && resolved.hostname !== resolved.address ? resolved.hostname : undefined;

    const transporter = nodemailer.createTransport({
      host: pinnedHost,
      port: overrides.port,
      secure: overrides.secure,
      ...(servername ? { servername } : {}),
      // Bounded, and equal for both phases: without these, an open port that never speaks SMTP (a
      // database, a cache) holds the request for nodemailer's own multi-minute defaults while a
      // closed one fails at once — a timing difference that survives the identical error text below.
      // The address guard above is what makes that difference harmless (nothing internal is reachable
      // any more); this keeps it small anyway, and stops one settings test from pinning a request for
      // two minutes.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      auth: {
        user: overrides.username,
        pass: overrides.password,
      },
    });
    const safe = sanitizedMailOptions(options);
    try {
      await transporter.sendMail({
        from: overrides.fromAddress,
        to: safe.to,
        replyTo: safe.replyTo,
        subject: safe.subject,
        text: safe.text,
        html: safe.html,
        attachments: toTransportAttachments(safe.attachments),
      });
    } catch (error) {
      // The real reason — errno, host, port — goes HERE and nowhere else. Never `overrides.password`.
      logger.error('Failed to send email via a tenant-configured SMTP server.', {
        category: 'mail',
        details: { host: overrides.host, port: overrides.port, user: overrides.username, error },
      });
      throw new MailDeliveryError(describeSmtpFailure(error));
    }
  }

  async sendMail(options: MailOptions, smtpOverrides?: SmtpOverrides) {
    // Per-company SMTP: build a one-shot transport from the decrypted company config.
    // The password is intentionally excluded from all log calls below.
    if (smtpOverrides) {
      try {
        await this.deliverViaSmtp(options, smtpOverrides);
      } catch (error) {
        // `deliverViaSmtp` has already logged the real reason and replaced it with a message that is
        // safe to show a tenant — pass THAT through rather than flattening it back into one string:
        // "the credentials were rejected" and "the address is not allowed" are both actionable, and
        // neither says anything the generic one was hiding. Anything else reaching here is not a
        // delivery failure at all (a bug in this method's own argument handling), so it keeps the
        // narrow message it always had.
        if (error instanceof MailDeliveryError) throw error;
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

    // Global provider path (SMTP_* env vars / Resend) — no company in play here (this is `sendMail`,
    // not `sendForCompany`), so the Reply-To cascade has only two steps: an explicit value already on
    // `options`, else the instance's own `MAIL_REPLY_TO`.
    const optionsWithReplyTo: MailOptions = {
      ...options,
      replyTo: resolveEffectiveReplyTo(options.replyTo, undefined),
    };
    try {
      await this.provider.sendMail(sanitizedMailOptions(optionsWithReplyTo));
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
   * Every failure it raises is a `MailDeliveryError` whose message is ALREADY safe to show whoever
   * triggered the send — see `mail-endpoint-guard.ts`'s own header. That is a middle position between
   * the two this method has held: it used to let the raw provider error through, so a company admin
   * configuring this would see the real reason ("a bad SMTP password, ECONNREFUSED, ..."), which is
   * genuinely what a "test send" button is for — but the same raw text also reported, to anyone who
   * could name a host and a port, whether something was listening on an internal address. Collapsing
   * everything into one generic string instead would defeat that button. So the DISTINCTION survives
   * where it is safe (credentials rejected, message rejected, address not allowed, nothing configured)
   * and disappears where it is not (every network-level outcome, which is one sentence).
   *
   * Every caller therefore gets a message it can surface as-is. The ones that additionally narrow it
   * still do (`signatures.service.ts#sendTemplatedMail`, `danger.service.ts#requestOtp` both rethrow
   * the named "no mail server configured" refusal verbatim but collapse anything else, since their own
   * callers are a public signature page / an OWNER confirming a destructive action, not someone
   * configuring the mail server itself).
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
   *
   * Also resolves the Reply-To cascade (`resolveEffectiveReplyTo`) — its own, separate axis from the
   * mail-SERVER cascade above: a company's `mailReplyTo` can win even when it sends through the
   * INSTANCE's own provider, and the instance's `MAIL_REPLY_TO` can still apply even when the company
   * runs its own SMTP/Resend server. Resolved once, up front, and threaded into every branch below.
   */
  async sendForCompany(companyId: string, options: MailOptions): Promise<{ message: string }> {
    // Both reads happen regardless of which branch below ends up sending: the Reply-To cascade
    // (`resolveCompanyReplyTo`) is INDEPENDENT of the mail-server cascade (`resolveCompanyMailSettings`)
    // — a company can set one without the other (see `Company.mailReplyTo`'s own schema.prisma
    // comment) — so every branch, including the instance-fallback one at the bottom, needs the SAME
    // resolved value.
    const [companySettings, companyReplyTo] = await Promise.all([
      resolveCompanyMailSettings(companyId),
      resolveCompanyReplyTo(companyId),
    ]);
    const optionsWithReplyTo: MailOptions = {
      ...options,
      replyTo: resolveEffectiveReplyTo(options.replyTo, companyReplyTo),
    };

    if (companySettings?.kind === 'smtp') {
      await this.deliverViaSmtp(optionsWithReplyTo, {
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
      try {
        await provider.sendMail(sanitizedMailOptions(optionsWithReplyTo));
      } catch (error) {
        // Resend's own text is kept verbatim, unlike the SMTP branch above: this provider dials ONE
        // fixed public API (`api.resend.com`) that no tenant chooses, so its answer describes the
        // tenant's own key, domain or sender address and can say nothing about this server's network.
        // Wrapped all the same, so `sendTest` can tell a vetted mail failure from any other error
        // that happened to surface on this path.
        throw new MailDeliveryError(error instanceof Error ? error.message : String(error));
      }
      return { message: 'Email sent successfully' };
    }

    // No company-level override: fall back to the instance provider — but refuse NAMED if this
    // instance has nothing configured either, rather than let the "smtp" default attempt (and fail
    // opaquely against 127.0.0.1) a connection nobody ever actually set up.
    if (!isInstanceMailProviderConfigured()) {
      throw new BadRequestException(NO_MAIL_SERVER_CONFIGURED_MESSAGE);
    }

    try {
      await this.provider.sendMail(sanitizedMailOptions(optionsWithReplyTo));
    } catch (error) {
      // The instance provider's own failure must not reach a TENANT raw either: this is the OPERATOR's
      // mail server, so a raw nodemailer error here would describe the hosting infrastructure (its
      // relay's host and port, whether it answered) to whoever clicked "test send" on a company that
      // configured nothing of its own.
      logger.error('Failed to send email via the instance mail provider.', {
        category: 'mail',
        details: { provider: this.provider.id, error },
      });
      throw new MailDeliveryError(INSTANCE_MAIL_FAILED_MESSAGE);
    }
    return { message: 'Email sent successfully' };
  }
}
