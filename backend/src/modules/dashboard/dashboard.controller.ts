import { Controller, Get, Sse } from "@nestjs/common";
import { from, interval, map, startWith, switchMap } from "rxjs";
import {
	DashboardData,
	DashboardService,
} from "@/modules/dashboard/dashboard.service";

@Controller("dashboard")
export class DashboardController {
	constructor(private readonly dashboardService: DashboardService) {}

	@Get()
	async getDashboardInfo(): Promise<DashboardData> {
		return await this.dashboardService.getDashboardData();
	}

	@Sse("sse")
	async getDashboardInfoSse() {
		return interval(5000).pipe(
			startWith(0),
			switchMap(() => from(this.dashboardService.getDashboardData())),
			map((data) => ({ data: JSON.stringify(data) })),
		);
	}
}
