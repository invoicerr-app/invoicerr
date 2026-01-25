import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { from, interval, map, startWith, switchMap } from 'rxjs';
import { ClientsService } from '@/modules/clients/clients.service';
import type { EditClientsDto } from '@/modules/clients/dto/clients.dto';
import { CompanyGuard } from '@/guards/company.guard';
import { CompanyId } from '@/decorators/company.decorator';

@Controller('clients')
@UseGuards(CompanyGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async getClientsInfo(@CompanyId() companyId: string, @Query('page') page: string) {
    return await this.clientsService.getClients(companyId, page);
  }

  @Sse('sse')
  async getClientsInfoSse(@CompanyId() companyId: string, @Query('page') page: string) {
    return interval(1000).pipe(
      startWith(0),
      switchMap(() => from(this.clientsService.getClients(companyId, page))),
      map((clients) => ({ data: JSON.stringify(clients) })),
    );
  }

  @Get('search')
  async searchClients(@CompanyId() companyId: string, @Query('query') query: string) {
    return await this.clientsService.searchClients(companyId, query);
  }

  @Post()
  postClientsInfo(@CompanyId() companyId: string, @Body() body: EditClientsDto) {
    return this.clientsService.createClient(companyId, body);
  }

  @Patch(':id')
  async editClientsInfo(@CompanyId() companyId: string, @Param('id') id: string, @Body() body: EditClientsDto) {
    return this.clientsService.editClientsInfo(companyId, { ...body, id });
  }

  @Delete(':id')
  deleteClient(@CompanyId() companyId: string, @Param('id') id: string) {
    return this.clientsService.deleteClient(companyId, id);
  }
}
