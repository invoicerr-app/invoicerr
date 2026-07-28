import { Module } from '@nestjs/common';
import { ChannelCredentialsService } from './channel-credentials.service';

/**
 * Channel credentials module — resolves per-company channel configs (encrypted at rest).
 * Cycle-safe: this module imports Prisma (not compliance, not invoices).
 * Compliance imports the port interface; the NestJS DI wires the service at runtime.
 */
@Module({
  providers: [ChannelCredentialsService],
  exports: [ChannelCredentialsService],
})
export class ChannelCredentialsModule {}
