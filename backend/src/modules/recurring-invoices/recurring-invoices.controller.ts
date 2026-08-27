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
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

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
  async getRecurringInvoices(@ActiveCompany() companyId: string, @Query('page') page: string) {
    return this.recurringInvoicesService.getRecurringInvoices(companyId, page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a recurring invoice', description: 'Returns a single recurring invoice by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice retrieved' })
  async getRecurringInvoice(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.recurringInvoicesService.getRecurringInvoice(companyId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring invoice', description: 'Creates a new recurring invoice schedule with items, client, and pricing information.' })
  @ApiResponse({ status: 201, description: 'Recurring invoice created' })
  async createRecurringInvoice(@ActiveCompany() companyId: string, @Body() body: UpsertInvoicesDto) {
    return this.recurringInvoicesService.createRecurringInvoice(companyId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a recurring invoice', description: 'Updates an existing recurring invoice schedule by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice updated' })
  async updateRecurringInvoice(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: UpsertInvoicesDto,
  ) {
    return this.recurringInvoicesService.updateRecurringInvoice(companyId, id, body);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete a recurring invoice', description: 'Permanently removes a recurring invoice schedule by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Recurring invoice ID' })
  @ApiResponse({ status: 200, description: 'Recurring invoice deleted' })
  async deleteRecurringInvoice(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.recurringInvoicesService.deleteRecurringInvoice(companyId, id);
  }
}
