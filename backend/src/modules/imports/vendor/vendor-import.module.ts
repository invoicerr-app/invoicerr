import { Module } from '@nestjs/common';

import { VendorImportController } from './vendor-import.controller';
import { VendorImportService } from './vendor-import.service';

/** Read-only translation of a competitor's export onto the two existing CSV imports (issue #759). */
@Module({
  controllers: [VendorImportController],
  providers: [VendorImportService],
})
export class VendorImportModule {}
