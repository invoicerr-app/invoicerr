import { Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';

@Module({
  controllers: [MetricsController],
})
export class ObservabilityModule {}
