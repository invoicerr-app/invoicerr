import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
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
import { assertWebhookAuth } from './webhook-auth';

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
 * Extract the raw body bytes from the request for HMAC verification.
 * The bodyParser `verify` callback in main.ts attaches the raw bytes to `req.rawBody`.
 * Falls back to re-serialising the parsed body (slightly less reliable but safe for
 * providers that normalise JSON whitespace before signing).
 */
function getRawBody(req: Request, parsedBody: unknown): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (req as any).rawBody;
  if (raw instanceof Buffer) return raw;
  return Buffer.from(JSON.stringify(parsedBody) ?? '', 'utf-8');
}

/**
 * Extract remote IP from the request, honouring X-Forwarded-For (set by a trusted
 * reverse-proxy). Returns undefined when no IP can be determined.
 */
function getRemoteIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first?.trim();
  }
  return req.socket?.remoteAddress;
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
    @Req() req: Request,
    @Headers('x-signature') sigHeader?: string,
    @Headers('x-compliance-secret') secretHeader?: string,
  ) {
    assertWebhookAuth({
      channel: String(channel).toUpperCase(),
      rawBody: getRawBody(req, body),
      signatureHeader: sigHeader,
      sharedSecretHeader: secretHeader,
      remoteIp: getRemoteIp(req),
    });
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
   * Authenticity: HMAC-SHA256 via X-Signature header (preferred) or X-Compliance-Secret
   * fallback. Configure WEBHOOK_SECRET_PDP in env. Optional IP allowlist: WEBHOOK_ALLOWLIST_PDP.
   */
  @Public()
  @Post('pdp/webhook')
  @HttpCode(200)
  async receivePdpWebhook(
    @Body() body: PdpWebhookPayload,
    @Req() req: Request,
    @Headers('x-signature') sigHeader?: string,
    @Headers('x-compliance-secret') secretHeader?: string,
  ) {
    assertWebhookAuth({
      channel: 'PDP',
      rawBody: getRawBody(req, body),
      signatureHeader: sigHeader,
      sharedSecretHeader: secretHeader,
      remoteIp: getRemoteIp(req),
    });

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
   * Authenticity: HMAC-SHA256 via X-Signature (preferred) or X-Compliance-Secret fallback.
   * Configure WEBHOOK_SECRET_SDI. Optional IP allowlist: WEBHOOK_ALLOWLIST_SDI.
   */
  @Public()
  @Post('sdi/notifica')
  @HttpCode(200)
  async receiveSdiNotifica(
    @Body() body: SdiNotificaWebhookPayload,
    @Req() req: Request,
    @Headers('x-signature') sigHeader?: string,
    @Headers('x-compliance-secret') secretHeader?: string,
  ) {
    assertWebhookAuth({
      channel: 'SDI',
      rawBody: getRawBody(req, body),
      signatureHeader: sigHeader,
      sharedSecretHeader: secretHeader,
      remoteIp: getRemoteIp(req),
    });

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
   * Authenticity: HMAC-SHA256 via X-Signature (preferred) or X-Compliance-Secret fallback.
   * Configure WEBHOOK_SECRET_PEPPOL. Optional IP allowlist: WEBHOOK_ALLOWLIST_PEPPOL.
   */
  @Public()
  @Post('peppol/mlr')
  @HttpCode(200)
  async receivePeppolMlr(
    @Body() body: PeppolMlrWebhookPayload,
    @Req() req: Request,
    @Headers('x-signature') sigHeader?: string,
    @Headers('x-compliance-secret') secretHeader?: string,
  ) {
    assertWebhookAuth({
      channel: 'PEPPOL',
      rawBody: getRawBody(req, body),
      signatureHeader: sigHeader,
      sharedSecretHeader: secretHeader,
      remoteIp: getRemoteIp(req),
    });

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
