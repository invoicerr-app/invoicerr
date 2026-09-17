import { Controller, Post, Param, Body, Logger, Get, Delete, UseGuards, Patch } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { AuthGuard } from '@/guards/auth.guard';
import { WebhookEvent, WebhookType, CompanyRole } from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { RequiresScope } from '@/utils/scope-check';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly webhookDispatcher: WebhookDispatcherService,
  ) {}

  @Get('options')
  @UseGuards(AuthGuard)
  @RequiresScope('webhooks:read')
  @ApiOperation({
    summary: 'List webhook types and events',
    description: 'Returns the available webhook types and event types for configuring a webhook.',
  })
  @ApiResponse({ status: 200, description: 'Webhook types and events retrieved' })
  async options() {
    const types = Object.values(WebhookType);
    const events = Object.values(WebhookEvent);

    return { types, events };
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @RequiresScope('webhooks:read')
  @ApiOperation({
    summary: 'Get a webhook by ID',
    description: 'Returns a single webhook configuration (without the secret).',
  })
  @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook retrieved' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  async findOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.webhooksService.findOne(companyId, id);
  }

  // Protected CRUD endpoints for managing webhooks (company-scoped)
  @Get()
  @UseGuards(AuthGuard)
  @RequiresScope('webhooks:read')
  @ApiOperation({
    summary: 'List all webhooks',
    description: 'Returns all webhook configurations for the current company (secrets are excluded).',
  })
  @ApiResponse({ status: 200, description: 'Webhooks retrieved' })
  async list(@ActiveCompany() companyId: string) {
    return this.webhooksService.list(companyId);
  }

  @Post()
  @UseGuards(AuthGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('webhooks:write')
  @ApiOperation({
    summary: 'Create a webhook',
    description: 'Creates a new webhook configuration. The secret is returned only in this response.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        type: { type: 'string', description: 'Webhook type, e.g. GENERIC' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of event types to subscribe to',
        },
        secret: { type: 'string', description: 'Optional pre-set secret; generated if omitted' },
      },
      required: ['url'],
    },
  })
  @ApiResponse({ status: 201, description: 'Webhook created' })
  async create(@ActiveCompany() companyId: string, @Body() body: any) {
    const { webhook, company } = await this.webhooksService.create(companyId, body);

    try {
      // This payload is what OTHER webhooks subscribed to WEBHOOK_CREATED receive over HTTP;
      // `webhook.secret` here is this brand-new webhook's own plaintext secret (see
      // `WebhooksService.create`'s own comment on why it's plaintext at this point), which is for the
      // CALLER of THIS request alone, once, in the response below — never for a third receiver.
      await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_CREATED, {
        webhook: { ...webhook, secret: undefined },
        company,
      });
    } catch (err) {
      this.logger.error('Failed to dispatch WEBHOOK_CREATED', err);
    }

    // Return the secret only once
    return { success: true, data: { ...webhook } };
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('webhooks:write')
  @ApiOperation({
    summary: 'Update a webhook',
    description: 'Updates the URL, type, events, or secret of an existing webhook configuration.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        type: { type: 'string' },
        events: { type: 'array', items: { type: 'string' } },
        secret: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Webhook updated' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() body: any) {
    const { webhook, company } = await this.webhooksService.update(companyId, id, body);

    try {
      // Same reasoning as `create` above: never forward the (encrypted, but still not this
      // receiver's business) secret to another webhook's payload.
      await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_UPDATED, {
        webhook: { ...webhook, secret: undefined },
        company,
      });
    } catch (err) {
      this.logger.error('Failed to dispatch WEBHOOK_UPDATED', err);
    }

    return { success: true, data: { ...webhook, secret: undefined } };
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('webhooks:write')
  @ApiOperation({ summary: 'Delete a webhook', description: 'Permanently removes a webhook configuration.' })
  @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
  @ApiResponse({ status: 200, description: 'Webhook deleted' })
  @ApiResponse({ status: 404, description: 'Webhook not found' })
  async remove(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const { webhook, company } = await this.webhooksService.remove(companyId, id);

    try {
      // Same reasoning as `create` above.
      await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_DELETED, {
        webhook: { ...webhook, secret: undefined },
        company,
      });
    } catch (err) {
      this.logger.error('Failed to dispatch WEBHOOK_DELETED', err);
    }

    return { success: true };
  }
}
