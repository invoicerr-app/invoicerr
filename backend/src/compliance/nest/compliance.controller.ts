import { Body, Controller, Headers, HttpCode, HttpException, HttpStatus, Logger, Post } from '@nestjs/common';
import { Public } from '@/decorators/public.decorator';
import { InboundRouter, InboundInput } from '../lifecycle/drivers/inbound-router';
import { ComplianceService } from '../operations/compliance-service';

@Controller('compliance/inbound')
export class ComplianceController {
  private readonly logger = new Logger(ComplianceController.name);

  constructor(
    private readonly inboundRouter: InboundRouter,
    private readonly complianceService: ComplianceService,
  ) {}

  @Public()
  @Post()
  @HttpCode(200)
  async receiveInbound(
    @Body() body: InboundInput,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    const expected = process.env.COMPLIANCE_WEBHOOK_SECRET;
    if (expected && secret !== expected) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    const result = await this.inboundRouter.receive(body);
    this.logger.debug(`inbound result: ${JSON.stringify(result)}`);
    return result;
  }
}
