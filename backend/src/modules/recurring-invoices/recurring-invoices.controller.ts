import { UpsertInvoicesDto } from '@/modules/recurring-invoices/dto/invoices.dto';
import { RecurringInvoicesService } from '@/modules/recurring-invoices/recurring-invoices.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('recurring-invoices')
@Controller('recurring-invoices')
export class RecurringInvoicesController {
  constructor(
    private readonly recurringInvoicesService: RecurringInvoicesService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'List recurring invoices', description: 'Returns a paginated list of recurring invoices.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated recurring invoice list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Recurring invoices retrieved' })
  async getRecurringInvoices(@Query('page') page: string) {
    return this.recurringInvoicesService.getRecurringInvoices(page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a recurring invoice', description: 'Returns a single recurring invoice by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice retrieved' })
  async getRecurringInvoice(@Param('id') id: string) {
    return this.recurringInvoicesService.getRecurringInvoice(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring invoice', description: 'Creates a new recurring invoice schedule with items, client, and pricing information.' })
  @ApiResponse({ status: 201, description: 'Recurring invoice created' })
  async createRecurringInvoice(@Body() body: UpsertInvoicesDto) {
    return this.recurringInvoicesService.createRecurringInvoice(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring invoice', description: 'Updates an existing recurring invoice schedule by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice updated' })
  async updateRecurringInvoice(
    @Param('id') id: string,
    @Body() body: UpsertInvoicesDto,
  ) {
    return this.recurringInvoicesService.updateRecurringInvoice(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a recurring invoice', description: 'Permanently removes a recurring invoice schedule by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice deleted' })
  async deleteRecurringInvoice(@Param('id') id: string) {
    return this.recurringInvoicesService.deleteRecurringInvoice(id);
  }
}
