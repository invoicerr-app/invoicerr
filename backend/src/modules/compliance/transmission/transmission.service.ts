import { Injectable, Logger, Optional } from '@nestjs/common';
import { TransmissionStatus } from '../interfaces';
import { ChorusTransmissionStrategy } from './strategies/chorus.strategy';
import { EmailTransmissionStrategy } from './strategies/email.strategy';
import { PeppolTransmissionStrategy } from './strategies/peppol.strategy';
import { SaftTransmissionStrategy } from './strategies/saft.strategy';
import { SdITransmissionStrategy } from './strategies/sdi.strategy';
import { SuperPDPTransmissionStrategy } from './strategies/superpdp.strategy';
import { VerifactuTransmissionStrategy } from './strategies/verifactu.strategy';
import {
  TransmissionPayload,
  TransmissionResult,
  TransmissionStrategy,
} from './transmission.interface';

@Injectable()
export class TransmissionService {
  private readonly logger = new Logger(TransmissionService.name);
  private readonly strategies: TransmissionStrategy[];

  constructor(
    private readonly emailStrategy: EmailTransmissionStrategy,
    @Optional() private readonly superPDPStrategy: SuperPDPTransmissionStrategy,
    @Optional() private readonly chorusStrategy: ChorusTransmissionStrategy,
    @Optional() private readonly peppolStrategy: PeppolTransmissionStrategy,
    @Optional() private readonly sdiStrategy: SdITransmissionStrategy,
    @Optional() private readonly verifactuStrategy: VerifactuTransmissionStrategy,
    @Optional() private readonly saftStrategy: SaftTransmissionStrategy,
  ) {
    // Type guard to filter out null/undefined strategies from @Optional() injections
    const isStrategy = (s: TransmissionStrategy | null | undefined): s is TransmissionStrategy => s != null;

    this.strategies = [
      this.emailStrategy,
      this.superPDPStrategy,
      this.chorusStrategy,
      this.peppolStrategy,
      this.sdiStrategy,
      this.verifactuStrategy,
      this.saftStrategy,
    ].filter(isStrategy);

    this.logger.log(`Loaded ${this.strategies.length} transmission strategies: ${this.getAvailableStrategies().join(', ')}`);
  }

  /**
   * Send invoice via the specified platform
   */
  async send(platform: string, payload: TransmissionPayload): Promise<TransmissionResult> {
    const strategy = this.getStrategy(platform);

    if (!strategy) {
      this.logger.warn(`No strategy found for platform: ${platform}, falling back to email`);
      return this.emailStrategy.send(payload);
    }

    this.logger.log(`Sending invoice ${payload.invoiceNumber} via ${strategy.name}`);
    return strategy.send(payload);
  }

  /**
   * Check transmission status
   */
  async checkStatus(platform: string, externalId: string): Promise<TransmissionStatus> {
    const strategy = this.getStrategy(platform);

    if (!strategy || !strategy.checkStatus) {
      this.logger.warn(`Status check not supported for platform: ${platform}`);
      return 'pending';
    }

    return strategy.checkStatus(externalId);
  }

  /**
   * Cancel a transmission (if supported)
   */
  async cancel(platform: string, externalId: string): Promise<boolean> {
    const strategy = this.getStrategy(platform);

    if (!strategy || !strategy.cancel) {
      this.logger.warn(`Cancellation not supported for platform: ${platform}`);
      return false;
    }

    return strategy.cancel(externalId);
  }

  /**
   * Get strategy for a platform
   */
  getStrategy(platform: string): TransmissionStrategy | null {
    return this.strategies.find((s) => s.supports(platform)) || null;
  }

  /**
   * Get list of available strategy names
   */
  getAvailableStrategies(): string[] {
    return this.strategies.map((s) => s.name);
  }

  /**
   * Check if a platform is supported
   */
  isSupported(platform: string): boolean {
    return this.getStrategy(platform) !== null;
  }

  /**
   * Get all supported platforms across all strategies
   */
  getSupportedPlatforms(): string[] {
    const platforms = new Set<string>();
    for (const strategy of this.strategies) {
      if (strategy.supportedPlatforms) {
        for (const platform of strategy.supportedPlatforms) {
          platforms.add(platform);
        }
      }
    }
    return Array.from(platforms);
  }
}
