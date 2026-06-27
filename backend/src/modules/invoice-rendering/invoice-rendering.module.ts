import { Module } from '@nestjs/common';
import { InvoiceRenderingService } from './invoice-rendering.service';

@Module({
  providers: [InvoiceRenderingService],
  exports: [InvoiceRenderingService],
})
export class InvoiceRenderingModule {}
