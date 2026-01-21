import { Injectable, Logger } from '@nestjs/common';
import { TransmissionPayload, TransmissionResult, TransmissionStrategy } from './transmission.interface';
import { EmailTransmissionStrategy } from './strategies/email.strategy';
import { SuperPDPTransmissionStrategy } from './strategies/superpdp.strategy';
import { ChorusTransmissionStrategy } from './strategies/chorus.strategy';

@Injectable()
export class TransmissionService {
  private readonly logger = new Logger(TransmissionService.name);
  private readonly strategies: TransmissionStrategy[];

  constructor(
    private readonly emailStrategy: EmailTransmissionStrategy,
    private readonly superPDPStrategy: SuperPDPTransmissionStrategy,
    private readonly chorusStrategy: ChorusTransmissionStrategy,
  ) {
    this.strategies = [
      this.emailStrategy,
      this.superPDPStrategy,
      this.chorusStrategy,
    ];
  }

  async send(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    const strategy = this.getStrategy(platform);

    if (!strategy) {
      this.logger.warn(`No strategy found for platform: ${platform}, falling back to email`);
      return this.emailStrategy.send(payload);
    }

    this.logger.log(`Sending invoice ${payload.invoiceNumber} via ${strategy.name}`);
    return strategy.send(payload);
  }

  getStrategy(platform: string): TransmissionStrategy | null {
    return this.strategies.find((s) => s.supports(platform)) || null;
  }

  getAvailableStrategies(): string[] {
    return this.strategies.map((s) => s.name);
  }
}
