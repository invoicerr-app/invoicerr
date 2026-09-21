/**
 * The WRITE side (plus status + test-send) of a company's own mail-server override — the
 * company-level step of the mail-server cascade (company → instance → named refusal). Backs
 * `PUT`/`DELETE`/`GET`/`POST test` on `company.controller.ts`
 * (`Controller → Service → Prisma`: this is the only place that touches `ChannelCredentialsService`
 * for the `'mail'` provider id — the controller never does). The READ side used at actual send time
 * lives in the sibling `company-mail-settings.resolver.ts` — split there specifically so
 * `mail/mail.service.ts` can call it without a `mail/` ⇄ `modules/company/` circular import (this file
 * DOES import `MailService`, for `sendTest`; the resolver never imports this file or `MailService`).
 */
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';

import { ChannelCredentialsService } from '@/modules/company/channels/channels.service';
import { logger } from '@/logger/logger.service';
import { mailT } from '@/mail/i18n';
import { MailDeliveryError, assertTenantSmtpEndpoint } from '@/mail/mail-endpoint-guard';
import { MailService } from '@/mail/mail.service';
import { RenderLanguage } from '@/modules/documents/rendering/language/supported-languages';

import { SetCompanyMailSettingsDto } from './company-mail-settings.dto';
import {
  MAIL_SETTINGS_ENVIRONMENT,
  MAIL_SETTINGS_PROVIDER_ID,
  resolveCompanyMailSettings,
} from './company-mail-settings.resolver';
import { CompanyMailSettingsStatus } from './company-mail-settings.types';

/** What a test send reports when it failed for a reason that is NOT a mail outcome — see `sendTest`'s
 *  own header. Deliberately says nothing beyond "not your settings": the real text belongs in the
 *  server log, and pointing a customer at their own mail configuration for a fault that is not theirs
 *  would send them hunting for a problem that does not exist. */
export const UNEXPECTED_TEST_SEND_FAILURE_MESSAGE =
  'The test send failed for an unexpected reason on this server, not in these mail settings. The ' +
  'details are in the server log.';

@Injectable()
export class CompanyMailSettingsService {
  constructor(
    private readonly channelCredentials: ChannelCredentialsService,
    private readonly mailService: MailService,
  ) {}

  /** `GET` — status only, never the SMTP password / Resend API key (same discipline
   *  `ChannelConfigStatus` already holds for every other channel). */
  async getStatus(companyId: string): Promise<CompanyMailSettingsStatus> {
    const settings = await resolveCompanyMailSettings(companyId);
    if (!settings) return { configured: false };
    return { configured: true, kind: settings.kind, fromAddress: settings.fromAddress };
  }

  /** `PUT` — validates the DTO for its own `kind` (SMTP needs host/port/username/password/
   *  fromAddress; Resend needs apiKey/fromAddress), then stores it encrypted via the existing
   *  `ChannelCredentialsService` (503 if `CREDENTIALS_ENCRYPTION_KEY` is not configured on this
   *  server — that guard already lives there, not duplicated here). */
  async set(companyId: string, dto: SetCompanyMailSettingsDto): Promise<CompanyMailSettingsStatus> {
    this.validate(dto);
    if (dto.kind === 'smtp') {
      // Refuse an internal address at WRITE time, not only at connect time. `MailService` re-checks
      // on every actual send (that check, not this one, is what governs — a name that is public today
      // can point somewhere internal tomorrow), but refusing here means a settings form that names
      // `10.0.0.5` or `169.254.169.254` is answered without a socket ever being opened, and the row
      // never gets stored for some later send to trip over.
      await assertTenantSmtpEndpoint(dto.host, dto.port).catch((error) => {
        if (error instanceof MailDeliveryError) throw new BadRequestException(error.message);
        throw error;
      });
    }
    await this.channelCredentials.upsertChannelConfig(companyId, MAIL_SETTINGS_PROVIDER_ID, {
      environment: MAIL_SETTINGS_ENVIRONMENT,
      // `UpsertChannelConfigBody.config` is a bare `Record<string, unknown>` (it stores arbitrary
      // per-provider JSON for every channel, not just this one) — `SetCompanyMailSettingsDto`'s own
      // discriminated-union shape has no index signature of its own, hence the double cast.
      config: dto as unknown as Record<string, unknown>,
      isActive: true,
    });
    return this.getStatus(companyId);
  }

  /** `DELETE` — clears this company's own mail server; sends made for it fall back to the instance
   *  level (or a named refusal if that has nothing configured either — see
   *  `MailService#sendForCompany`). */
  async clear(companyId: string): Promise<{ deleted: boolean }> {
    return this.channelCredentials.deleteChannelConfig(companyId, MAIL_SETTINGS_PROVIDER_ID);
  }

  /**
   * `POST test` — sends a real test email to the REQUESTER's own address (never an address supplied
   * in the request body: this proves "can *I* receive mail sent by this company's configuration",
   * never lets one member probe deliverability to an arbitrary third-party address) through the exact
   * same company → instance → named refusal cascade a real document send would use
   * (`MailService#sendForCompany`).
   *
   * Reports the reason it was given — a rejected password, an invalid Resend key, an address this
   * server refuses to dial, the named "no mail server configured" refusal — because a test button
   * that only ever says "check your configuration" is useless. What it does NOT do is forward an
   * error it has not vetted: `sendForCompany` raises `MailDeliveryError` for every mail outcome, and
   * those messages are safe by construction (`mail-endpoint-guard.ts`'s own header explains which
   * distinctions survive there and which are collapsed, and why the network-level ones have to be).
   * Anything ELSE surfacing here is not a mail outcome at all — a decryption fault, a database error
   * — and its text is about this server's internals, not about this company's mail settings, so it is
   * logged and replaced.
   *
   * `language` — the REQUESTER's own preference (`resolveUserLanguage`, resolved by the controller,
   * which is where the authenticated `CurrentUser` lives) — defaults to English (`mailT(undefined)`)
   * when omitted, matching this mail's behavior before it had a language at all.
   */
  async sendTest(
    companyId: string,
    toEmail: string,
    language?: RenderLanguage,
  ): Promise<{ message: string }> {
    const t = mailT(language);
    try {
      return await this.mailService.sendForCompany(companyId, {
        to: toEmail,
        subject: t('mailSettingsTest.subject'),
        text: t('mailSettingsTest.body'),
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof MailDeliveryError) throw new BadRequestException(error.message);
      logger.error('Test send failed for a reason that is not a mail outcome.', {
        category: 'mail',
        details: { companyId, error },
      });
      throw new BadRequestException(UNEXPECTED_TEST_SEND_FAILURE_MESSAGE);
    }
  }

  private validate(dto: SetCompanyMailSettingsDto): void {
    if (dto.kind === 'smtp') {
      if (!dto.host || !dto.port || !dto.username || !dto.password || !dto.fromAddress) {
        throw new BadRequestException(
          'SMTP mail settings require host, port, username, password and fromAddress.',
        );
      }
      return;
    }
    if (dto.kind === 'resend') {
      if (!dto.apiKey || !dto.fromAddress) {
        throw new BadRequestException('Resend mail settings require apiKey and fromAddress.');
      }
      return;
    }
    throw new BadRequestException('Unknown mail settings kind — expected "smtp" or "resend".');
  }
}
