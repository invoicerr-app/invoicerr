import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  PaymentMethodsService,
  CreatePaymentMethodDto,
  EditPaymentMethodDto,
} from './payment-methods.service';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodService: PaymentMethodsService) { }

  @Get()
  @ApiOperation({ summary: 'List payment methods', description: 'Returns all configured payment methods.' })
  @ApiResponse({ status: 200, description: 'Payment methods retrieved' })
  async findAll(@ActiveCompany() companyId: string) {
    return this.paymentMethodService.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payment method', description: 'Returns a single payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method retrieved' })
  @ApiResponse({ status: 404, description: 'Payment method not found' })
  async findOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const pm = await this.paymentMethodService.findOne(companyId, id);
    if (!pm) {
      return { message: 'Not found' };
    }
    return pm;
  }

  @Post()
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Create a payment method', description: 'Adds a new payment method (bank transfer, PayPal, etc.).' })
  @ApiResponse({ status: 201, description: 'Payment method created' })
  async create(@ActiveCompany() companyId: string, @Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.create(companyId, dto);
  }

  @Patch(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Update a payment method', description: 'Updates an existing payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method updated' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() dto: EditPaymentMethodDto) {
    return this.paymentMethodService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete a payment method', description: 'Soft-deletes a payment method by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment method ID' })
  @ApiResponse({ status: 200, description: 'Payment method deleted' })
  async remove(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.paymentMethodService.softDelete(companyId, id);
  }
}