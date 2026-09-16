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
import { MailService } from '@/mail/mail.service';

import { SetCompanyMailSettingsDto } from './company-mail-settings.dto';
import {
  MAIL_SETTINGS_ENVIRONMENT,
  MAIL_SETTINGS_PROVIDER_ID,
  resolveCompanyMailSettings,
} from './company-mail-settings.resolver';
import { CompanyMailSettingsStatus } from './company-mail-settings.types';

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
   * (`MailService#sendForCompany`), and re-throws whatever it raised — the REAL provider error (a bad
   * SMTP password, an invalid Resend key, the named "no mail server configured" refusal, ...) rather
   * than a generic "check your configuration" string, which would defeat the point of a test button.
   */
  async sendTest(companyId: string, toEmail: string): Promise<{ message: string }> {
    try {
      return await this.mailService.sendForCompany(companyId, {
        to: toEmail,
        subject: 'Invoicerr — test email',
        text: 'This is a test email confirming your mail server configuration works.',
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException((error as Error).message);
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
