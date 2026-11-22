import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { renderMetrics } from './metrics';

/** Prometheus scrape endpoint. Answers 404 unless `METRICS_ENABLED=true`; see `renderMetrics`. */
@ApiExcludeController()
@Controller('metrics')
@SkipThrottle()
export class MetricsController {
  @Get()
  @Public()
  async scrape(@Headers('authorization') authorization: string | undefined, @Res() res: Response) {
    const result = await renderMetrics(authorization);
    res.status(result.status).type(result.contentType).send(result.body);
  }
}
