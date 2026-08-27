import { ClientsService } from '@/modules/clients/clients.service';
import { EditClientsDto } from '@/modules/clients/dto/clients.dto';
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

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) { }

  @Get()
  @ApiOperation({ summary: 'List clients', description: 'Returns a paginated list of clients.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated client list. Defaults to 1.' })
  @ApiResponse({ status: 200, description: 'Clients retrieved' })
  async getClients(@ActiveCompany() companyId: string, @Query('page') page: string) {
    return this.clientsService.getClients(companyId, page);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search clients', description: 'Searches clients by query string (name, email, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name, email, etc.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@ActiveCompany() companyId: string, @Query('query') query: string) {
    return await this.clientsService.searchClients(companyId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a client', description: 'Creates a new client with the provided information.' })
  @ApiResponse({ status: 201, description: 'Client created' })
  postClientsInfo(@ActiveCompany() companyId: string, @Body() body: EditClientsDto) {
    return this.clientsService.createClient(companyId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a client', description: 'Updates an existing client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client updated' })
  async editClientsInfo(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() body: EditClientsDto) {
    return this.clientsService.editClientsInfo(companyId, { ...body, id });
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete a client', description: 'Permanently removes a client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client deleted' })
  deleteClient(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.clientsService.deleteClient(companyId, id);
  }
}
