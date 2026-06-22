import { Body, Controller, Delete, Get, Param, Patch, Post, Sse } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PaymentMethodsService,
  CreatePaymentMethodDto,
  EditPaymentMethodDto,
} from './payment-methods.service';
import { switchMap } from 'rxjs/internal/operators/switchMap';
import { from, interval, map, startWith } from 'rxjs';

@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodsService) { }

  @Get()
  @ApiOperation({ summary: 'List payment methods', description: 'Returns all configured payment methods.' })
  @ApiResponse({ status: 200, description: 'Payment methods retrieved' })
  async findAll() {
    return this.paymentMethodService.findAll();
  }

  @Sse('sse')
  @ApiOperation({ summary: 'Subscribe to payment method updates', description: 'Server-sent event stream that pushes the list of payment methods every second.' })
  async getReceiptsInfoSse() {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.paymentMethodService.findAll())),
      map((data) => ({ data: JSON.stringify(data) })),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment method', description: 'Returns a single payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method retrieved' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(@Param('id') id: string) {
    const pm = await this.paymentMethodService.findOne(id);
    if (!pm) {
      return { message: 'Not found' };
    }
    return pm;
  }

  @Post()
  @ApiOperation({ summary: 'Create a payment method', description: 'Adds a new payment method (bank transfer, PayPal, etc.).' })
  @ApiResponse({ status: 201, description: 'Payment method created' })
  async create(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment method', description: 'Updates an existing payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method updated' })
  async update(@Param('id') id: string, @Body() dto: EditPaymentMethodDto) {
    return this.paymentMethodService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a payment method', description: 'Soft-deletes a payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method deleted' })
  async remove(@Param('id') id: string) {
    return this.paymentMethodService.softDelete(id);
  }
}