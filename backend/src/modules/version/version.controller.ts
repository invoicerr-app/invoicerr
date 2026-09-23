import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { VersionInfo, VersionService } from './version.service';

@ApiTags('version')
@Controller('version')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  @ApiOperation({
    summary: 'Installed version and update availability',
    description:
      'The version this instance was built from, and whether a newer one has been published on ' +
      'GitHub. Cached server-side (see VersionService) — never a live GitHub call on every request, ' +
      'and never an error response: an unreachable GitHub simply reports no update available.',
  })
  @ApiResponse({ status: 200, description: 'Version info' })
  async get(): Promise<VersionInfo> {
    return this.versionService.getVersionInfo();
  }
}
