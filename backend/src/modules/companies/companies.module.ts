import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyModule } from '@/modules/company/company.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [CompanyModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
})
export class CompaniesModule { }
