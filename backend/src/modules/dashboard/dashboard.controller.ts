import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { DashboardService } from '@/modules/dashboard/dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Get dashboard summary',
    description: 'Returns aggregated dashboard data (counts, revenue, etc.).',
  })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved' })
  async getDashboardInfo(@ActiveCompany() companyId: string) {
    return this.dashboardService.getDashboardData(companyId);
  }
}
