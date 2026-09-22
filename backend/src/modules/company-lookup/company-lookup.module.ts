import { Module } from '@nestjs/common';
import { CompanyLookupController } from '@/modules/company-lookup/company-lookup.controller';
import { CompanyLookupService } from '@/modules/company-lookup/company-lookup.service';
import { CompanyLookupRegistry, defaultLookupRegistry } from '@/modules/company-lookup/registry';

@Module({
  controllers: [CompanyLookupController],
  providers: [
    // The registry is pure data + stateless clients; one instance for the process.
    { provide: CompanyLookupRegistry, useValue: defaultLookupRegistry },
    CompanyLookupService,
  ],
  exports: [CompanyLookupService],
})
export class CompanyLookupModule {}
