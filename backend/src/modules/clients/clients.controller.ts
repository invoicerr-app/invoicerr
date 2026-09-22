import { ClientsService } from '@/modules/clients/clients.service';
import { EditClientsDto } from '@/modules/clients/dto/clients.dto';
import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';
import { RequiresScope } from '@/utils/scope-check';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @RequiresScope('clients:read')
  @ApiOperation({ summary: 'List clients', description: 'Returns a paginated list of clients.' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: String,
    description: 'Page number (1-indexed) of the paginated client list. Defaults to 1.',
  })
  @ApiResponse({ status: 200, description: 'Clients retrieved' })
  async getClients(@ActiveCompany() companyId: string, @Query('page') page: string) {
    return this.clientsService.getClients(companyId, page);
  }

  @Get('search')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: 'Search clients',
    description: 'Searches clients by query string (name, email, etc.).',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    type: String,
    description: 'Free-text search term matched against client name, email, etc.',
  })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@ActiveCompany() companyId: string, @Query('query') query: string) {
    return await this.clientsService.searchClients(companyId, query);
  }

  @Get('duplicates')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: 'Find potential duplicate clients',
    description:
      'Non-blocking duplicate detection for the client wizard: matches an existing, active client ' +
      'by contact email (case-insensitive), or by name + country together (also case-insensitive), ' +
      'scoped to the active company. Returns an empty array when neither criterion is usable — this ' +
      'never refuses anything, it only informs. Pass excludeId when editing an existing client so it ' +
      'never flags itself as its own duplicate.',
  })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiQuery({ name: 'country', required: false, type: String })
  @ApiQuery({
    name: 'excludeId',
    required: false,
    type: String,
    description: 'Client id to exclude (editing)',
  })
  @ApiResponse({ status: 200, description: 'Potential duplicates found (possibly empty)' })
  findDuplicates(
    @ActiveCompany() companyId: string,
    @Query('email') email?: string,
    @Query('name') name?: string,
    @Query('country') country?: string,
    @Query('excludeId') excludeId?: string,
  ) {
    return this.clientsService.findDuplicates(companyId, { email, name, country, excludeId });
  }

  @Get(':id/statement')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: "A client's account statement",
    description:
      'Every "sent" invoice for this client, the credit notes correcting ' +
      'each one, the resulting balance (settlement/compute-settlement.ts — payments and credits ' +
      'already netted in), and an aged balance per currency (current / 0-30 / 31-60 / 60+ days ' +
      "overdue, by the balance's own due date). See settlement/client-statement.ts.",
  })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Statement computed' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  getStatement(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.clientsService.getStatement(companyId, id);
  }

  // Declared AFTER 'search'/'duplicates'/':id/statement' — a bare `:id` is a single-segment wildcard
  // that would otherwise shadow those static routes if it matched first.
  @Get(':id')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: 'Get a client',
    description:
      'Returns a single client by id, scoped to the active company — e.g. the duplicate-detection ' +
      'wizard\'s own "view existing client" link, opening a record that may not be on the caller\'s ' +
      'currently loaded page of the paginated list.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client found' })
  @ApiResponse({ status: 404, description: 'Not found for this company' })
  async getClient(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const client = await this.clientsService.getClientById(companyId, id);
    if (!client) {
      throw new NotFoundException('Client not found');
    }
    return client;
  }

  @Post()
  @RequiresScope('clients:write')
  @ApiOperation({
    summary: 'Create a client',
    description: 'Creates a new client with the provided information.',
  })
  @ApiResponse({ status: 201, description: 'Client created' })
  postClientsInfo(@ActiveCompany() companyId: string, @Body() body: EditClientsDto) {
    return this.clientsService.createClient(companyId, body);
  }

  @Patch(':id')
  @RequiresScope('clients:write')
  @ApiOperation({ summary: 'Update a client', description: 'Updates an existing client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client updated' })
  async editClientsInfo(
    @ActiveCompany() companyId: string,
    @Param('id') id: string,
    @Body() body: EditClientsDto,
  ) {
    return this.clientsService.editClientsInfo(companyId, { ...body, id });
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('clients:write')
  @ApiOperation({ summary: 'Delete a client', description: 'Permanently removes a client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client deleted' })
  deleteClient(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.clientsService.deleteClient(companyId, id);
  }
}
