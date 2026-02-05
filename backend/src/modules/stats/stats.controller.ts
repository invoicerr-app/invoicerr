import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('monthly')
  async getMonthlyStats(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    if (isNaN(y)) {
      throw new BadRequestException('Invalid year');
    }
    return this.statsService.getMonthlyStats(y);
  }

  @Get('yearly')
  async getYearlyStats(@Query('start') start?: string, @Query('end') end?: string) {
    const current = new Date().getFullYear();
    const s = start ? parseInt(start, 10) : current - 5;
    const e = end ? parseInt(end, 10) : current;
    if (isNaN(s) || isNaN(e) || s > e) {
      throw new BadRequestException('Invalid year range');
    }
    return this.statsService.getYearlyStats(s, e);
  }
}