import { Body, Controller, Delete, Get, Param, Patch, Post, Sse } from '@nestjs/common';
import {
  PaymentMethodsService,
  CreatePaymentMethodDto,
  EditPaymentMethodDto,
} from './payment-methods.service';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import { from, interval, map, startWith } from 'rxjs';

@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodsService) { }

  @Get()
  async findAll() {
    return this.paymentMethodService.findAll();
  }

  @Sse('sse')
  async getReceiptsInfoSse() {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.paymentMethodService.findAll())),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const pm = await this.paymentMethodService.findOne(id);
    if (!pm) {
      return { message: 'Not found' };
    }
    return pm;
  }

  @Post()
  async create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: EditPaymentMethodDto) {
    return this.paymentMethodService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.paymentMethodService.softDelete(id);
  }
}