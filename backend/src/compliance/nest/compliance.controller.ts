import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Param, Post } from '@nestjs/common';
import { Public } from '@/decorators/public.decorator';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ChannelType } from '../types';
import {
  parsePdpWebhook,
  parseSdiNotifica,
  parsePeppolMlr,
  PdpWebhookPayload,
  SdiNotificaWebhookPayload,
  PeppolMlrWebhookPayload,
} from '../lifecycle/drivers/inbound-parsers';
import type { InboundInput } from '../lifecycle/drivers/inbound-router';

/**
 * Generic body accepted by the canonical `/compliance/inbound/:channel` endpoint.
 * Any system that knows our internal correlationKey (documentId or external ref,
 * depending on how the registration was created) can push a status via this shape.
 */
interface GenericInboundBody {
  correlationKey: string;
  status: string;
  rawRef?: string;
}

/**
 * Authenticity guard: very coarse shared-secret check as a first line of defence.
 * Per-channel HMAC/signature verification is a TODO seam — each channel's real
 * verification (SuperPDP HMAC, SdI mTLS, Peppol AP TLS client cert) should be added
 * here or in a per-channel NestJS guard once live credentials are available.
 */
function assertSecret(secret: string | undefined): void {
  const expected = process.env.COMPLIANCE_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }
}

@Controller('compliance/inbound')
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(private readonly inboundRouter: InboundRouter) {}

  /**
   * Generic inbound status endpoint.
   *
   * Used when the caller provides a pre-formatted `InboundInput`-compatible body
   * (i.e. knows our internal correlationKey). Also used for channels that don't
   * have a dedicated parser (KSeF — polling-only, GOV_PORTAL_API, etc.).
   *
   * Channel-specific parsing endpoints below take precedence; they are registered on
   * the same prefix and are matched first by their explicit route patterns.
   */
  @Public()
  @Post(':channel')
  @HttpCode(200)
  async receiveInbound(
    @Param('channel') channel: ChannelType,
    @Body() body: GenericInboundBody,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    assertSecret(secret);
    const result = await this.inboundRouter.receive({ channel, ...body });
    this.logger.debug(`inbound [${channel}] generic result: ${result.kind}`);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Channel-specific webhook endpoints — parse native payload → InboundInput
  // ---------------------------------------------------------------------------

  /**
   * PDP (France) status webhook.
   *
   * SuperPDP pushes lifecycle events here when the status of a deposited invoice changes.
   * URL to register with SuperPDP: POST /compliance/inbound/pdp/webhook
   *
   * Authenticity: shared secret via `x-compliance-secret` header (coarse gate).
   * TODO: add HMAC-SHA256 verification once SuperPDP publishes their signing spec.
   */
  @Public()
  @Post('pdp/webhook')
  @HttpCode(200)
  async receivePdpWebhook(
    @Body() body: PdpWebhookPayload,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    assertSecret(secret);

    if (!body.invoice_id || !body.status_code) {
      this.logger.warn('inbound/pdp: missing invoice_id or status_code in webhook');
      return { kind: 'IGNORED', reason: 'missing required fields' };
    }

    const input: InboundInput = parsePdpWebhook(body);
    const result = await this.inboundRouter.receive(input);
    this.logger.debug(`inbound/pdp webhook invoice_id=${body.invoice_id} status=${body.status_code}: ${result.kind}`);
    return result;
  }

  /**
   * SdI (Italy) notifica webhook.
   *
   * The SdI intermediary pushes notifiche (RC/NS/MC/NE/DT/AT) here.
   * URL to register with your SDICoop intermediary: POST /compliance/inbound/sdi/notifica
   *
   * Authenticity: shared secret + TODO mTLS from the intermediary's known IP range.
   */
  @Public()
  @Post('sdi/notifica')
  @HttpCode(200)
  async receiveSdiNotifica(
    @Body() body: SdiNotificaWebhookPayload,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    assertSecret(secret);

    if (!body.type || !body.idSdI) {
      this.logger.warn('inbound/sdi: missing type or idSdI in notifica');
      return { kind: 'IGNORED', reason: 'missing required fields' };
    }

    const input: InboundInput = parseSdiNotifica(body);
    const result = await this.inboundRouter.receive(input);
    this.logger.debug(`inbound/sdi notifica type=${body.type} idSdI=${body.idSdI}: ${result.kind}`);
    return result;
  }

  /**
   * Peppol MLR / Invoice Response webhook.
   *
   * The AP gateway pushes delivery status and Invoice Responses here.
   * URL to register with the AP gateway: POST /compliance/inbound/peppol/mlr
   *
   * Authenticity: shared secret + TODO AP-gateway-specific HMAC or mTLS.
   */
  @Public()
  @Post('peppol/mlr')
  @HttpCode(200)
  async receivePeppolMlr(
    @Body() body: PeppolMlrWebhookPayload,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    assertSecret(secret);

    if (!body.messageId || !body.responseCode) {
      this.logger.warn('inbound/peppol: missing messageId or responseCode in MLR');
      return { kind: 'IGNORED', reason: 'missing required fields' };
    }

    const input: InboundInput = parsePeppolMlr(body);
    const result = await this.inboundRouter.receive(input);
    this.logger.debug(`inbound/peppol MLR messageId=${body.messageId} code=${body.responseCode}: ${result.kind}`);
    return result;
  }
}
