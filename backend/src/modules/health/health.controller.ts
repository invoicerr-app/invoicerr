import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '@thallesp/nestjs-better-auth';

import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
// The throttler stores its counters in Redis: throttled, this route could never report Redis down.
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'Health check',
    description:
      'Returns 200 when Postgres and Redis both answer, 503 otherwise (public). The 200 body carries ' +
      'both ping latencies, the running version, the server time (ISO 8601 UTC), the process uptime ' +
      'and the log-persistence counters. `status` is "degraded", still with a 200, once `Log` row ' +
      'writes have failed several times in a row: the API serves, but its log screen is not being ' +
      'written to.',
  })
  @ApiResponse({ status: 200, description: 'Service healthy' })
  @ApiResponse({ status: 503, description: 'Database or Redis unreachable' })
  async check() {
    const result = await this.healthService.check();
    if (!result.healthy) {
      throw new ServiceUnavailableException(result.body);
    }
    return result.report;
  }
}
