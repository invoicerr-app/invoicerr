import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DashboardController } from '@/modules/dashboard/dashboard.controller';
import { DashboardService } from '@/modules/dashboard/dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, JwtService],
})
export class DashboardModule {}
