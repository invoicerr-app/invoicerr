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
	UseGuards,
} from "@nestjs/common";
import { from, interval, map, startWith, switchMap } from "rxjs";
import { ClientsService } from "@/modules/clients/clients.service";
import { EditClientsDto } from "@/modules/clients/dto/clients.dto";
import { AuthGuard } from "@/guards/auth.guard";
import { TenantGuard } from "@/guards/tenant.guard";

@Controller("clients")
@UseGuards(AuthGuard, TenantGuard)
export class ClientsController {
	constructor(private readonly clientsService: ClientsService) {}

	@Get()
	async getClientsInfo(@Param("page") page: string) {
		return await this.clientsService.getClients(page);
	}

	@Sse("sse")
	async getClientsInfoSse(@Param("page") page: string) {
		return interval(1000).pipe(
			startWith(0),
			switchMap(() => from(this.clientsService.getClients(page))),
			map((clients) => ({ data: JSON.stringify(clients) })),
		);
	}

	@Get("search")
	async searchClients(@Query("query") query: string) {
		return await this.clientsService.searchClients(query);
	}

	@Post()
	postClientsInfo(@Body() body: EditClientsDto) {
		return this.clientsService.createClient(body);
	}

	@Patch(":id")
	async editClientsInfo(@Param("id") id: string, @Body() body: EditClientsDto) {
		return this.clientsService.editClientsInfo({ ...body, id });
	}

	@Delete(":id")
	deleteClient(@Param("id") id: string) {
		return this.clientsService.deleteClient(id);
	}
}
