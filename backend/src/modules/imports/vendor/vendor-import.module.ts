import { Module } from '@nestjs/common';

import { VendorImportController } from './vendor-import.controller';
import { VendorImportService } from './vendor-import.service';

/** Reads a competitor's export uploaded as a file, for the client and past-document imports. */
@Module({
  controllers: [VendorImportController],
  providers: [VendorImportService],
})
export class VendorImportModule {}
