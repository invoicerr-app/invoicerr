import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { DashboardService } from '@/modules/dashboard/dashboard.service';
import { DashboardController } from '@/modules/dashboard/dashboard.controller';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, JwtService]
})
export class DashboardModule { }
