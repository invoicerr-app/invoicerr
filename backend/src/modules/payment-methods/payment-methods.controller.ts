import { Body, Controller, Delete, Get, Param, Patch, Post, Sse, UseGuards } from '@nestjs/common';
import { from, interval, map, startWith } from 'rxjs';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import {
  type CreatePaymentMethodDto,
  type EditPaymentMethodDto,
  PaymentMethodsService,
} from './payment-methods.service';
import { CompanyGuard } from '@/guards/company.guard';
import { CompanyId } from '@/decorators/company.decorator';

@Controller('payment-methods')
@UseGuards(CompanyGuard)
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodsService) {}

  @Get()
  async findAll(@CompanyId() companyId: string) {
    return this.paymentMethodService.findAll(companyId);
  }

  @Sse('sse')
  async getReceiptsInfoSse(@CompanyId() companyId: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.paymentMethodService.findAll(companyId))),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get(':id')
  async findOne(@CompanyId() companyId: string, @Param('id') id: string) {
    const pm = await this.paymentMethodService.findOne(companyId, id);
    if (!pm) {
      return { message: 'Not found' };
    }
    return pm;
  }

  @Post()
  async create(@CompanyId() companyId: string, @Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(companyId, dto);
  }

  @Patch(':id')
  async update(@CompanyId() companyId: string, @Param('id') id: string, @Body() dto: EditPaymentMethodDto) {
    return this.paymentMethodService.update(companyId, id, dto);
  }

  @Delete(':id')
  async remove(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.paymentMethodService.softDelete(companyId, id);
  }
}
