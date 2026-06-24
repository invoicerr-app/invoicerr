import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Param, Post } from '@nestjs/common';
import { Public } from '@/decorators/public.decorator';
import { InboundRouter } from '../lifecycle/drivers/inbound-router';
import { ChannelType } from '../types';

interface InboundBody {
  correlationKey: string;
  status: string;
  rawRef?: string;
}

@Controller('compliance/inbound')
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(private readonly inboundRouter: InboundRouter) {}

  // One URL per channel (e.g. /compliance/inbound/SDI, /compliance/inbound/PDP) so each national
  // authority/platform can be registered with its own webhook endpoint.
  // TODO: per-provider HMAC signature verification (the shared secret below is a coarse first gate).
  @Public()
  @Post(':channel')
  @HttpCode(200)
  async receiveInbound(
    @Param('channel') channel: ChannelType,
    @Body() body: InboundBody,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    const expected = process.env.COMPLIANCE_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    const result = await this.inboundRouter.receive({ channel, ...body });
    this.logger.debug(`inbound result: ${JSON.stringify(result)}`);
    return result;
  }
}
