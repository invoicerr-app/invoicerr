import { CreatePaymentDto, EditPaymentDto } from '@/modules/payments/dto/payments.dto';
import { PaymentsService } from '@/modules/payments/payments.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Response } from 'express';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) { }

  @Get()
  @ApiOperation({ summary: 'List payments', description: 'Returns a paginated list of payments.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated payment list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Payments retrieved' })
  async getPayments(@Query('page') page: string) {
    return this.paymentsService.getPayments(page);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search payments', description: 'Searches payments by query string (client name, payment number, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name and payment number.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchPayments(@Query('query') query: string) {
    return await this.paymentsService.searchPayments(query);
  }

  @Post('create-from-invoice')
  @ApiOperation({ summary: 'Create payment from invoice', description: 'Generates a payment for a paid invoice.' })
  @ApiResponse({ status: 201, description: 'Payment created from invoice' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the invoice to create a payment for' } } } })
  async createPaymentFromInvoice(@Body('id') invoiceId: string) {
    if (!invoiceId) {
      throw new Error('Invoice ID is required');
    }
    return await this.paymentsService.createPaymentFromInvoice(invoiceId);
  }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Get payment PDF', description: 'Downloads the PDF version of a specific payment.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'PDF retrieved' })
  @ApiResponse({ status: 404, description: 'Payment not found' })
  async getPaymentPdf(@Param('id') id: string, @Res() res: Response) {
    if (id === 'undefined') return res.status(400).send('Invalid payment ID');
    const pdfBuffer = await this.paymentsService.getPaymentPdf(id);
    if (!pdfBuffer) {
      res.status(404).send('Payment not found or PDF generation failed');
      return;
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payment-${id}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.send(pdfBuffer);
  }

  @Post('send')
  @ApiOperation({ summary: 'Send payment by email', description: 'Sends a payment as a PDF attachment via email to the client.' })
  @ApiResponse({ status: 201, description: 'Payment sent' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', description: 'ID of the payment to send' } } } })
  sendPaymentByEmail(@Body('id') id: string) {
    if (!id) {
      throw new Error('Payment ID is required');
    }
    return this.paymentsService.sendPaymentByEmail(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a payment', description: 'Creates a new payment with items, client, and payment information.' })
  @ApiResponse({ status: 201, description: 'Payment created' })
  createPayment(@Body() body: CreatePaymentDto) {
    return this.paymentsService.createPayment(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a payment', description: 'Updates an existing payment by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment updated' })
  editPayment(@Param('id') id: string, @Body() body: EditPaymentDto) {
    return this.paymentsService.editPayment({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a payment', description: 'Permanently removes a payment by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Payment ID' })
  @ApiResponse({ status: 200, description: 'Payment deleted' })
  deletePayment(@Param('id') id: string) {
    return this.paymentsService.deletePayment(id);
  }
}
