import { Controller, Sse } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { from, interval, map, startWith, switchMap } from "rxjs";

import { DashboardService } from "@/modules/dashboard/dashboard.service";

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  @Sse('sse')
  @ApiOperation({ summary: 'Subscribe to dashboard updates', description: 'Server-sent event stream that pushes aggregated dashboard data (counts, revenue, etc.) every 5 seconds.' })
  async getDashboardInfoSse() {
    return interval(5000).pipe(
      startWith(0),
      switchMap(() => from(this.dashboardService.getDashboardData())),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }
}
