import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { API_KEY_SCOPES } from '@/modules/api-keys/scopes';
import { ApiKeysService } from './api-keys.service';
import { AuthGuard } from '@/guards/auth.guard';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { CurrentUser } from '@/types/user';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';

@ApiTags('api-keys')
@Controller('api-keys')
@UseGuards(AuthGuard)
@Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get('options')
  @ApiOperation({ summary: 'List available API key scopes' })
  @ApiResponse({ status: 200, description: 'Scopes retrieved' })
  async options() {
    return { scopes: API_KEY_SCOPES };
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
    description:
      'The plaintext key is only ever returned in this response — it cannot be retrieved again afterwards.',
  })
  @ApiResponse({ status: 201, description: 'API key created' })
  async create(@ActiveCompany() companyId: string, @User() user: CurrentUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(companyId, user.id, dto.name, dto.scopes);
  }

  @Get()
  @ApiOperation({ summary: 'List API keys for the active company' })
  @ApiResponse({ status: 200, description: 'List of API keys (without the plaintext key)' })
  async list(@ActiveCompany() companyId: string) {
    return this.apiKeysService.list(companyId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiParam({ name: 'id', type: String, description: 'API key ID' })
  @ApiResponse({ status: 200, description: 'API key revoked' })
  async revoke(@ActiveCompany() companyId: string, @Param('id') id: string) {
    await this.apiKeysService.revoke(companyId, id);
    return { success: true };
  }
}
