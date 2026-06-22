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
  Sse,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { from, interval, map, startWith, switchMap } from 'rxjs';

@ApiTags('clients')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) { }

  @Sse('sse')
  @ApiOperation({ summary: 'Subscribe to client list updates', description: 'Server-sent event stream that pushes the client list every second.' })
  @ApiQuery({ name: 'page', required: false, type: String, description: 'Page number (1-indexed) of the paginated client list. Defaults to 1.' })
  async getClientsInfoSse(@Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.clientsService.getClients(page))),
      map((clients) => ({ data: JSON.stringify(clients) })),
    );
  }

  @Get('search')
  @ApiOperation({ summary: 'Search clients', description: 'Searches clients by query string (name, email, etc.).' })
  @ApiQuery({ name: 'query', required: true, type: String, description: 'Free-text search term matched against client name, email, etc.' })
  @ApiResponse({ status: 200, description: 'Search results retrieved' })
  async searchClients(@Query('query') query: string) {
    return await this.clientsService.searchClients(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a client', description: 'Creates a new client with the provided information.' })
  @ApiResponse({ status: 201, description: 'Client created' })
  postClientsInfo(@Body() body: EditClientsDto) {
    return this.clientsService.createClient(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a client', description: 'Updates an existing client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client updated' })
  async editClientsInfo(@Param('id') id: string, @Body() body: EditClientsDto) {
    return this.clientsService.editClientsInfo({ ...body, id });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a client', description: 'Permanently removes a client by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Client ID' })
  @ApiResponse({ status: 200, description: 'Client deleted' })
  deleteClient(@Param('id') id: string) {
    return this.clientsService.deleteClient(id);
  }
}
