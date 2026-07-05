import { Controller, Post, Param, Body, Req, Res, Logger, HttpStatus, Get, Delete, UseGuards, Patch } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { WebhooksService } from './webhooks.service';
import { AuthGuard } from '@/guards/auth.guard';
import { WebhookEvent, WebhookType } from '../../../prisma/generated/prisma/client';
import { WebhookDispatcherService } from './webhook-dispatcher.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
    private readonly logger = new Logger(WebhooksController.name);

    constructor(
        private readonly webhooksService: WebhooksService,
        private readonly webhookDispatcher: WebhookDispatcherService,
    ) { }

    @Get('options')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'List webhook types and events', description: 'Returns the available webhook types and event types for configuring a webhook.' })
    @ApiResponse({ status: 200, description: 'Webhook types and events retrieved' })
    async options() {
        const types = Object.values(WebhookType);
        const events = Object.values(WebhookEvent);

        return { types, events };
    }

    @Get(':id')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Get a webhook by ID', description: 'Returns a single webhook configuration (without the secret).' })
    @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
    @ApiResponse({ status: 200, description: 'Webhook retrieved' })
    @ApiResponse({ status: 404, description: 'Webhook not found' })
    async findOne(@Param('id') id: string) {
        return this.webhooksService.findOne(id);
    }

    @Post(':uuid')
    @AllowAnonymous()
    @ApiOperation({ summary: 'Handle an incoming plugin webhook', description: 'Public endpoint called by external services to deliver webhook payloads to a plugin identified by its UUID.' })
    @ApiParam({ name: 'uuid', type: String, description: 'UUID of the target plugin' })
    @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
    @ApiResponse({ status: 500, description: 'Webhook processing failed' })
    async handleWebhook(
        @Param('uuid') uuid: string,
        @Body() body: any,
        @Req() req: Request,
        @Res() res: Response
    ) {
        try {
            const result = await this.webhooksService.handlePluginWebhook(uuid, body, req);

            return res.status(200).json({
                success: true,
                message: 'Webhook processed successfully',
                data: result
            });
        } catch (error) {
            this.logger.error(`Error processing webhook for plugin ${uuid}:`, error);

            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                success: false,
                message: 'Webhook processing failed',
                error: error.message
            });
        }
    }

    // Protected CRUD endpoints for managing webhooks (company-scoped)
    @Get()
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'List all webhooks', description: 'Returns all webhook configurations for the current company (secrets are excluded).' })
    @ApiResponse({ status: 200, description: 'Webhooks retrieved' })
    async list() {
        return this.webhooksService.list();
    }

    @Post()
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Create a webhook', description: 'Creates a new webhook configuration. The secret is returned only in this response.' })
    @ApiBody({ schema: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string', description: 'Webhook type, e.g. GENERIC' }, events: { type: 'array', items: { type: 'string' }, description: 'List of event types to subscribe to' }, secret: { type: 'string', description: 'Optional pre-set secret; generated if omitted' } }, required: ['url'] } })
    @ApiResponse({ status: 201, description: 'Webhook created' })
    async create(@Body() body: any) {
        const { webhook, company } = await this.webhooksService.create(body);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_CREATED, { webhook, company });
        } catch (err) {
            this.logger.error('Failed to dispatch WEBHOOK_CREATED', err);
        }

        // Return the secret only once
        return { success: true, data: { ...webhook } };
    }

    @Patch(':id')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Update a webhook', description: 'Updates the URL, type, events, or secret of an existing webhook configuration.' })
    @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
    @ApiBody({ schema: { type: 'object', properties: { url: { type: 'string' }, type: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, secret: { type: 'string' } } } })
    @ApiResponse({ status: 200, description: 'Webhook updated' })
    @ApiResponse({ status: 404, description: 'Webhook not found' })
    async update(@Param('id') id: string, @Body() body: any) {
        const { webhook, company } = await this.webhooksService.update(id, body);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_UPDATED, { webhook, company });
        } catch (err) {
            this.logger.error('Failed to dispatch WEBHOOK_UPDATED', err);
        }

        return { success: true, data: { ...webhook, secret: undefined } };
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Delete a webhook', description: 'Permanently removes a webhook configuration.' })
    @ApiParam({ name: 'id', type: String, description: 'Webhook ID' })
    @ApiResponse({ status: 200, description: 'Webhook deleted' })
    @ApiResponse({ status: 404, description: 'Webhook not found' })
    async remove(@Param('id') id: string) {
        const { webhook, company } = await this.webhooksService.remove(id);

        try {
            await this.webhookDispatcher.dispatch(WebhookEvent.WEBHOOK_DELETED, { webhook, company });
        } catch (err) {
            this.logger.error('Failed to dispatch WEBHOOK_DELETED', err);
        }

        return { success: true };
    }
}
