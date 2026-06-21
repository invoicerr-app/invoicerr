import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '@/guards/auth.guard';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CurrentUser } from '@/types/user';
import { User } from '@/decorators/user.decorator';

@ApiTags('api-keys')
@Controller('api-keys')
@UseGuards(AuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) { }

  @Post()
  @ApiOperation({ summary: 'Create a new API key', description: 'The plaintext key is only ever returned in this response — it cannot be retrieved again afterwards.' })
  @ApiResponse({ status: 201, description: 'API key created' })
  async create(@User() user: CurrentUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(user.id, dto.name);
  }

  @Get()
  @ApiOperation({ summary: 'List API keys for the current user' })
  @ApiResponse({ status: 200, description: 'List of API keys (without the plaintext key)' })
  async list(@User() user: CurrentUser) {
    return this.apiKeysService.list(user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  async revoke(@User() user: CurrentUser, @Param('id') id: string) {
    await this.apiKeysService.revoke(user.id, id);
    return { success: true };
  }
}
