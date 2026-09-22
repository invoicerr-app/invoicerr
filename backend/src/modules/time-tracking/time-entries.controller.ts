import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresScope } from '@/utils/scope-check';

import {
  CreateTimeEntryDto,
  EditTimeEntryDto,
  GenerateInvoiceDto,
  TimeEntriesService,
} from './time-entries.service';

@ApiTags('time-tracking')
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly timeEntriesService: TimeEntriesService) {}

  @Get()
  @RequiresScope('time-tracking:read')
  @ApiOperation({
    summary: 'List time entries',
    description:
      'Filter by project, by client (across every one of its projects), and/or to only the ' +
      'unbilled+billable ones (what the "generate invoice" picker offers).',
  })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'unbilledOnly', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Time entries retrieved' })
  async findAll(
    @ActiveCompany() companyId: string,
    @Query('projectId') projectId?: string,
    @Query('clientId') clientId?: string,
    @Query('unbilledOnly') unbilledOnly?: string,
  ) {
    return this.timeEntriesService.findAll(companyId, {
      projectId,
      clientId,
      unbilledOnly: unbilledOnly === 'true',
    });
  }

  @Post()
  @RequiresScope('time-tracking:write')
  @ApiOperation({ summary: 'Log a time entry' })
  @ApiResponse({ status: 201, description: 'Time entry logged' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async create(@ActiveCompany() companyId: string, @Body() dto: CreateTimeEntryDto) {
    return this.timeEntriesService.create(companyId, dto);
  }

  @Patch(':id')
  @RequiresScope('time-tracking:write')
  @ApiOperation({ summary: 'Edit a time entry' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Time entry updated' })
  @ApiResponse({ status: 404, description: 'Time entry not found' })
  @ApiResponse({ status: 409, description: 'The entry has already been billed and is now read-only' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() dto: EditTimeEntryDto) {
    return this.timeEntriesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @RequiresScope('time-tracking:write')
  @ApiOperation({ summary: 'Delete a time entry' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Time entry deleted' })
  @ApiResponse({ status: 404, description: 'Time entry not found' })
  @ApiResponse({ status: 409, description: 'The entry has already been billed and can no longer be deleted' })
  async remove(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.timeEntriesService.remove(companyId, id);
  }

  @Post('generate-invoice')
  // The one route here that is NOT gated on `time-tracking:write`: it reads time entries and CREATES
  // AN INVOICE, and `@RequiresScope` is an any-of check, so it cannot demand both scopes at once.
  // Named on the heavier consequence, therefore: a key that may only log hours must not be able to
  // mint a billable document out of them, whereas a key already trusted to write invoices loses
  // nothing by being trusted with the ones this route drafts. A key holding both scopes satisfies it
  // through this one all the same.
  @RequiresScope('invoices:write')
  @ApiOperation({
    summary: 'Bill selected time entries to a new draft invoice',
    description:
      'Atomically creates a new draft invoice with one line per selected entry and marks every one of ' +
      'them billed — see TimeEntriesService.billToInvoice for the double-billing guard.',
  })
  @ApiResponse({ status: 201, description: 'Draft invoice created, entries marked billed' })
  @ApiResponse({
    status: 400,
    description: 'No entries selected, or one cannot be billed yet (rate, client, …)',
  })
  @ApiResponse({ status: 404, description: 'Client not found' })
  @ApiResponse({ status: 409, description: 'One or more entries were already billed' })
  async generateInvoice(@ActiveCompany() companyId: string, @Body() dto: GenerateInvoiceDto) {
    return this.timeEntriesService.billToInvoice(companyId, dto);
  }
}
