import { IMailProvider, MailOptions } from '@/mail/types';

/**
 * Resend transactional email transport, calling the official HTTP API directly
 * (`POST https://api.resend.com/emails`) rather than the `resend` npm SDK — the mail-server cascade
 * asked for the raw API, and this keeps the dependency footprint identical to `smtp.provider.ts`
 * (nodemailer only) instead of adding a second HTTP-wrapping library.
 *
 * Selected at the INSTANCE level when `MAIL_PROVIDER=resend` is set explicitly, or automatically when
 * `RESEND_API_KEY` is present and `MAIL_PROVIDER` is left unset (see `mail.service.ts`'s own
 * `resolveInstanceMailProviderId` and its resolution table). Also constructed directly, with an
 * explicit `{ apiKey, defaultFrom }` override instead of reading `process.env`, by
 * `MailService.sendForCompany` for a COMPANY that configured its own Resend key in Settings → Mail
 * (`modules/company/mail-settings/`) — the same "one class, two call sites" shape
 * `SmtpMailProvider`/`MailService`'s own per-company `SmtpOverrides` branch already has.
 *
 * ## Source — https://resend.com/docs/api-reference/emails/send-email, fetched as plain text
 * (`curl https://resend.com/docs/api-reference/emails/send-email.md`) on 2026-09-15, re-fetched
 * 2026-09-23 to confirm `reply_to` below, quoted where a field name or gotcha is not obvious from the
 * endpoint alone.
 *
 *  - Request body fields used here: `from` (string, "Name <email>" or bare email — accepted as-is), `to`
 *    (string[]), `subject`, `html`, `text`,
 *    `reply_to` (`string | string[]` per the docs — this provider only ever sends a single address,
 *    the one `mail.service.ts#resolveEffectiveReplyTo` already resolved; omitted entirely, never an
 *    empty string, when that cascade resolves to nothing),
 *    `attachments` (array of `{ filename, content, content_type }` — snake_case: this is the RAW REST
 *    API, not the Node SDK, which camelCases these for you. `content` is "buffer or Base64 string";
 *    JSON has no buffer type, so this always sends the Base64 string form).
 *  - Response on success: `{ "id": "<uuid>" }` — nothing this provider needs to return (the interface
 *    contract is `Promise<void>`, like every other `IMailProvider`).
 *  - Errors: `docs/api-reference/errors` documents named error TYPES (`validation_error`,
 *    `missing_api_key`, `daily_quota_exceeded`, ...) but not one universal JSON error-body shape —
 *    every example in that page is `{ statusCode, name, message }` shaped in practice (confirmed by
 *    the Node SDK's own `ErrorResponse` type), so this provider reads `.message` defensively and falls
 *    back to the raw response text if the body is not JSON or has no `.message`.
 *  - **Gotcha, easy to miss**: `docs/api-reference/introduction` — "All API requests must include a
 *    `User-Agent` header. Requests without this header will be rejected with a `403` status code."
 *    Node's global `fetch` (undici) does NOT set one on its own, so this provider sets it explicitly;
 *    omitting it would surface as an opaque 403 with no hint that the header itself was the problem.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_USER_AGENT = 'invoicerr-mail/1.0';

export interface ResendMailProviderOptions {
  /** Defaults to `process.env.RESEND_API_KEY` — overridden by `MailService.sendForCompany` with a
   *  company's OWN key (`modules/company/mail-settings/`), decrypted from `CompanyChannelConfig`. */
  apiKey?: string;
  /** Defaults to `process.env.MAIL_FROM` (falling back to `SMTP_FROM`/`SMTP_USER`) — overridden with
   *  the company's own `fromAddress` when this is a per-company send. */
  defaultFrom?: string;
}

export class ResendMailProvider implements IMailProvider {
  readonly id = 'resend';

  private readonly apiKey: string;
  private readonly defaultFrom?: string;

  constructor(options: ResendMailProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('MAIL_PROVIDER is "resend" but RESEND_API_KEY is not set.');
    }
    this.apiKey = apiKey;
    this.defaultFrom =
      options.defaultFrom ?? process.env.MAIL_FROM ?? process.env.SMTP_FROM ?? process.env.SMTP_USER;
  }

  async sendMail(options: MailOptions): Promise<void> {
    const to = options.to?.trim();
    if (!to) {
      throw new Error('Missing recipient email address (options.to).');
    }

    const from = options.from || this.defaultFrom;
    if (!from) {
      throw new Error(
        'Missing sender email address. Set MAIL_FROM (or SMTP_FROM/SMTP_USER) or pass options.from.',
      );
    }

    const body: Record<string, unknown> = {
      from,
      to: [to],
      subject: options.subject,
      // Already the fully-resolved cascade value — see `mail.service.ts#resolveEffectiveReplyTo`.
      // `undefined` when the cascade resolved to nothing, which `JSON.stringify` below omits entirely
      // rather than sending `"reply_to": null`/`""`, same discipline as `attachments` right below.
      reply_to: options.replyTo || undefined,
      html: options.html,
      text: options.text,
      attachments: options.attachments?.length
        ? options.attachments.map((a) => ({
            filename: a.filename,
            content: Buffer.from(a.content).toString('base64'),
            content_type: a.contentType,
          }))
        : undefined,
    };

    let response: Response;
    try {
      response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // See this file's own header — omitting this gets an opaque 403 from Resend, not a
          // useful error, on every environment that does not already set one on `fetch` by default.
          'User-Agent': RESEND_USER_AGENT,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Failed to reach the Resend API: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const message = await this.describeError(response);
      throw new Error(`Resend API returned HTTP ${response.status}: ${message}`);
    }
  }

  /** Best-effort extraction of the real failure reason — see this file's own header on why there is
   *  no single documented error-body shape to rely on unconditionally. */
  private async describeError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    if (!text) return response.statusText || 'no response body';
    try {
      const parsed = JSON.parse(text) as { message?: string; name?: string };
      if (parsed.message) return parsed.name ? `${parsed.name}: ${parsed.message}` : parsed.message;
    } catch {
      // Not JSON — fall through to the raw text below.
    }
    return text.slice(0, 500);
  }
}
