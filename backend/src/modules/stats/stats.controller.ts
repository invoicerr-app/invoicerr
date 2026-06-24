import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StatsService } from './stats.service';

@ApiTags('stats')
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('monthly')
  @ApiOperation({ summary: 'Get monthly statistics', description: 'Returns revenue and document counts grouped by month for a given year.' })
  @ApiQuery({ name: 'year', required: false, type: String, description: 'Year to get monthly stats for. Defaults to the current year.' })
  @ApiResponse({ status: 200, description: 'Monthly stats retrieved' })
  async getMonthlyStats(@Query('year') year?: string) {
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    if (isNaN(y)) {
      throw new BadRequestException('Invalid year');
    }
    return this.statsService.getMonthlyStats(y);
  }

  @Get('yearly')
  @ApiOperation({ summary: 'Get yearly statistics', description: 'Returns annual revenue and document counts for a given year range.' })
  @ApiQuery({ name: 'start', required: false, type: String, description: 'Start year of the range. Defaults to 5 years before the current year.' })
  @ApiQuery({ name: 'end', required: false, type: String, description: 'End year of the range. Defaults to the current year.' })
  @ApiResponse({ status: 200, description: 'Yearly stats retrieved' })
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